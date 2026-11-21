<?php

namespace App\Services\Finance;

use App\Exceptions\DuplicateIdempotencyKeyException;
use App\Models\AuditLog;
use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptItem;
use App\Models\PaymentVoucher;
use App\Models\PurchaseInvoice;
use App\Models\PurchaseOrder;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AccountPayableService
{
    public function __construct(
        private readonly GeneralLedgerService $generalLedgerService
    ) {}

    /**
     * Membuat Purchase Invoice (Account Payable) dari Purchase Order dengan validasi ketat 3-Way Matching:
     * (a) Harga satuan di Invoice wajib sama persis dengan harga satuan di PO (BCMath).
     * (b) Kuantitas tagihan tidak boleh melebihi sisa kuantitas fisik yang sudah divalidasi di GoodsReceipt
     *     (mendukung Partial Receipt dan beberapa invoice bertahap per PO).
     * (c) Total tagihan (total_billed) wajib cocok dengan hasil perhitungan qty x unit_price
     *     dan tidak boleh menyebabkan cumulative over-billing terhadap total nilai GR tervalidasi.
     *
     * @param  array<string, mixed>  $data
     */
    public function createPurchaseInvoice(array $data, User $actor, ?string $ipAddress = null): PurchaseInvoice
    {
        $idempotencyKey = trim((string) ($data['idempotency_key'] ?? ''));

        if ($idempotencyKey === '') {
            throw ValidationException::withMessages([
                'idempotency_key' => ['Idempotency key wajib diisi untuk pembuatan Purchase Invoice.'],
            ]);
        }

        try {
            return DB::transaction(function () use ($data, $idempotencyKey, $actor, $ipAddress): PurchaseInvoice {
                // 1. Cek idempotency_key terlebih dahulu dengan pessimistic lock
                $existingByIdempotency = PurchaseInvoice::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->lockForUpdate()
                    ->first();

                if ($existingByIdempotency !== null) {
                    throw new DuplicateIdempotencyKeyException(
                        message: "Request duplikat ditolak: Purchase Invoice dengan idempotency_key '{$idempotencyKey}' sudah pernah diproses.",
                        idempotencyKey: $idempotencyKey,
                        resourceType: PurchaseInvoice::class,
                        existingResourceId: $existingByIdempotency->id
                    );
                }

                // 2. Lock Purchase Order beserta itemnya
                $lockedPo = PurchaseOrder::query()
                    ->with(['items.product', 'supplier'])
                    ->lockForUpdate()
                    ->findOrFail((int) $data['po_id']);

                if (! in_array($lockedPo->status, [
                    PurchaseOrder::STATUS_PARTIALLY_RECEIVED,
                    PurchaseOrder::STATUS_COMPLETED,
                ], true)) {
                    throw ValidationException::withMessages([
                        'po_id' => [
                            '3-Way Matching gagal: Purchase Invoice hanya dapat dibuat untuk PO yang sudah memiliki Goods Receipt tervalidasi (Partially Received atau Completed).',
                        ],
                    ]);
                }

                if (isset($data['supplier_id']) && (int) $data['supplier_id'] !== $lockedPo->supplier_id) {
                    throw ValidationException::withMessages([
                        'supplier_id' => ['Supplier pada Invoice tidak sesuai dengan Supplier pada Purchase Order.'],
                    ]);
                }

                // 3. Lock seluruh Goods Receipt tervalidasi milik PO ini
                $validatedGrIds = GoodsReceipt::query()
                    ->where('po_id', $lockedPo->id)
                    ->where('status', GoodsReceipt::STATUS_VALIDATED)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->pluck('id');

                if ($validatedGrIds->isEmpty()) {
                    throw ValidationException::withMessages([
                        'po_id' => [
                            '3-Way Matching gagal: Belum ada Goods Receipt berstatus Validated untuk Purchase Order ini.',
                        ],
                    ]);
                }

                $validatedReceivedByProduct = $this->aggregateValidatedReceivedQtyByProduct($validatedGrIds->all());
                $poUnitPriceByProduct = $this->resolvePoUnitPriceByProduct($lockedPo);

                // 4. Lock seluruh Purchase Invoice aktif milik PO ini untuk mencegah cumulative over-billing
                $existingInvoices = PurchaseInvoice::query()
                    ->where('po_id', $lockedPo->id)
                    ->with('items')
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get();

                $alreadyBilledByProduct = [];
                $alreadyBilledTotal = '0.00';

                foreach ($existingInvoices as $existingInvoice) {
                    $alreadyBilledTotal = bcadd($alreadyBilledTotal, (string) $existingInvoice->total_billed, 2);

                    foreach ($existingInvoice->items as $billedItem) {
                        $pid = $billedItem->product_id;
                        $alreadyBilledByProduct[$pid] = bcadd(
                            $alreadyBilledByProduct[$pid] ?? '0.00',
                            (string) $billedItem->qty_billed,
                            2
                        );
                    }
                }

                // Hitung total nilai maksimum yang telah diterima fisik pada seluruh GR tervalidasi
                $totalValidatedGrValueHigh = '0.0000';
                foreach ($validatedReceivedByProduct as $productId => $qtyReceived) {
                    $poPrice = $poUnitPriceByProduct[$productId] ?? '0.00';
                    $totalValidatedGrValueHigh = bcadd(
                        $totalValidatedGrValueHigh,
                        bcmul($qtyReceived, $poPrice, 4),
                        4
                    );
                }
                $totalValidatedGrValue = $this->roundDecimal($totalValidatedGrValueHigh, 2);

                // 5. Validasi silang 3-Way Matching per item invoice
                $items = $data['items'] ?? [];
                if ($items === []) {
                    throw ValidationException::withMessages([
                        'items' => ['Minimal 1 item wajib disertakan untuk validasi 3-Way Matching.'],
                    ]);
                }

                $incomingQtyByProduct = [];
                $calculatedTotalHigh = '0.0000';
                $preparedItems = [];

                foreach ($items as $index => $item) {
                    $productId = (int) $item['product_id'];
                    $qtyBilled = $this->normalizeDecimal((string) $item['qty_billed'], 2);
                    $unitPrice = $this->normalizeDecimal((string) $item['unit_price'], 2);

                    // (a) Validasi produk terdaftar di PO dan harga satuan cocok dengan PO
                    if (! isset($poUnitPriceByProduct[$productId])) {
                        throw ValidationException::withMessages([
                            "items.{$index}.product_id" => [
                                '3-Way Matching gagal: Produk tidak terdaftar pada Purchase Order.',
                            ],
                        ]);
                    }

                    if (bccomp($qtyBilled, '0.00', 2) <= 0) {
                        throw ValidationException::withMessages([
                            "items.{$index}.qty_billed" => ['Kuantitas yang ditagih harus lebih dari 0.'],
                        ]);
                    }

                    $expectedPoPrice = $poUnitPriceByProduct[$productId];
                    if (bccomp($unitPrice, $expectedPoPrice, 2) !== 0) {
                        throw ValidationException::withMessages([
                            "items.{$index}.unit_price" => [
                                "3-Way Matching gagal (selisih harga): Harga satuan invoice ({$unitPrice}) tidak sesuai dengan harga satuan PO ({$expectedPoPrice}).",
                            ],
                        ]);
                    }

                    // (b) Validasi kuantitas fisik riil yang sudah divalidasi di Goods Receipt (Partial Receipt support)
                    $incomingQtyByProduct[$productId] = bcadd(
                        $incomingQtyByProduct[$productId] ?? '0.00',
                        $qtyBilled,
                        2
                    );

                    $totalValidatedQty = $validatedReceivedByProduct[$productId] ?? '0.00';
                    $alreadyBilledQty = $alreadyBilledByProduct[$productId] ?? '0.00';
                    $remainingBillableQty = bcsub($totalValidatedQty, $alreadyBilledQty, 2);

                    if (bccomp($incomingQtyByProduct[$productId], $remainingBillableQty, 2) > 0) {
                        throw ValidationException::withMessages([
                            "items.{$index}.qty_billed" => [
                                "3-Way Matching gagal (over-billing): Kuantitas ditagih ({$incomingQtyByProduct[$productId]}) melebihi sisa kuantitas fisik yang sudah divalidasi di Goods Receipt ({$remainingBillableQty}).",
                            ],
                        ]);
                    }

                    $lineTotalHigh = bcmul($qtyBilled, $unitPrice, 4);
                    $lineTotal = $this->roundDecimal($lineTotalHigh, 2);
                    $calculatedTotalHigh = bcadd($calculatedTotalHigh, $lineTotalHigh, 4);

                    $preparedItems[] = [
                        'product_id' => $productId,
                        'qty_billed' => $qtyBilled,
                        'unit_price' => $unitPrice,
                        'line_total' => $lineTotal,
                    ];
                }

                // (c) Validasi total tagihan Invoice & batas kumulatif nilai GR tervalidasi
                $calculatedTotal = $this->roundDecimal($calculatedTotalHigh, 2);
                $submittedTotalBilled = $this->normalizeDecimal((string) $data['total_billed'], 2);

                if (bccomp($submittedTotalBilled, $calculatedTotal, 2) !== 0) {
                    throw ValidationException::withMessages([
                        'total_billed' => [
                            "3-Way Matching gagal (selisih total): Total tagihan invoice ({$submittedTotalBilled}) tidak sesuai dengan hasil kalkulasi item PO & GR ({$calculatedTotal}).",
                        ],
                    ]);
                }

                $projectedCumulativeBilled = bcadd($alreadyBilledTotal, $submittedTotalBilled, 2);
                if (bccomp($projectedCumulativeBilled, $totalValidatedGrValue, 2) > 0) {
                    $remainingBillableValue = bcsub($totalValidatedGrValue, $alreadyBilledTotal, 2);

                    throw ValidationException::withMessages([
                        'total_billed' => [
                            "3-Way Matching gagal (over-billing): Total tagihan kumulatif ({$projectedCumulativeBilled}) melebihi nilai total penerimaan fisik tervalidasi ({$totalValidatedGrValue}; sisa yang boleh ditagih: {$remainingBillableValue}).",
                        ],
                    ]);
                }

                $invoiceNumber = ! empty($data['invoice_number'])
                    ? trim((string) $data['invoice_number'])
                    : $this->generateInvoiceNumber();

                $invoice = PurchaseInvoice::create([
                    'invoice_number' => $invoiceNumber,
                    'po_id' => $lockedPo->id,
                    'supplier_id' => $lockedPo->supplier_id,
                    'total_billed' => $submittedTotalBilled,
                    'due_date' => $data['due_date'],
                    'status' => PurchaseInvoice::STATUS_UNPAID,
                    'idempotency_key' => $idempotencyKey,
                ]);

                $invoice->items()->createMany($preparedItems);
                $invoice->load(['purchaseOrder.supplier', 'supplier', 'items.product', 'paymentVouchers']);

                // Catat jurnal pengakuan AP: Debit 2102-GRIR / Credit 2101-AP
                $this->generalLedgerService->recordPurchaseInvoiceJournal(
                    invoice: $invoice,
                    actor: $actor,
                    transactionDate: $data['invoice_date'] ?? now()->toDateString(),
                    ipAddress: $ipAddress
                );

                $this->recordAuditLog(
                    actor: $actor,
                    action: 'purchase_invoice.created',
                    modelType: PurchaseInvoice::class,
                    modelId: $invoice->id,
                    oldPayload: null,
                    newPayload: array_merge($this->purchaseInvoicePayload($invoice), [
                        'items_count' => $invoice->items->count(),
                    ]),
                    ipAddress: $ipAddress
                );

                return $invoice->fresh([
                    'purchaseOrder.supplier',
                    'supplier',
                    'items.product',
                    'paymentVouchers',
                    'generalLedgers',
                ]);
            });
        } catch (QueryException $e) {
            if ($this->isDuplicateIdempotencyConstraintViolation($e)) {
                $existing = PurchaseInvoice::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->first();

                throw new DuplicateIdempotencyKeyException(
                    message: "Request duplikat ditolak: Purchase Invoice dengan idempotency_key '{$idempotencyKey}' sudah pernah diproses.",
                    idempotencyKey: $idempotencyKey,
                    resourceType: PurchaseInvoice::class,
                    existingResourceId: $existing?->id
                );
            }

            throw $e;
        }
    }

    /**
     * Memproses pembayaran Account Payable (PaymentVoucher) dalam DB::transaction() + lockForUpdate():
     * - Mengecek idempotency_key untuk mencegah double-spend akibat request duplikat / retry jaringan.
     * - Mengunci PurchaseInvoice dan menghitung sisa tagihan secara presisi dengan BCMath.
     * - Memperbarui status PurchaseInvoice secara otomatis: Unpaid -> Partially Paid -> Paid.
     * - Mencatat jurnal double-entry di general_ledgers (Debit 2101-AP / Kredit 1101-CASH-BANK).
     *
     * @param  array<string, mixed>  $data
     */
    public function recordPayment(array $data, User $actor, ?string $ipAddress = null): PaymentVoucher
    {
        $idempotencyKey = trim((string) ($data['idempotency_key'] ?? ''));

        if ($idempotencyKey === '') {
            throw ValidationException::withMessages([
                'idempotency_key' => ['Idempotency key wajib diisi untuk memproses pembayaran.'],
            ]);
        }

        try {
            return DB::transaction(function () use ($data, $idempotencyKey, $actor, $ipAddress): PaymentVoucher {
                // 1. Tolak double-spend berdasarkan idempotency_key dengan pessimistic lock
                $existingVoucher = PaymentVoucher::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->lockForUpdate()
                    ->first();

                if ($existingVoucher !== null) {
                    throw new DuplicateIdempotencyKeyException(
                        message: "Pembayaran duplikat (double-spend) ditolak: idempotency_key '{$idempotencyKey}' sudah pernah digunakan pada voucher {$existingVoucher->voucher_number}.",
                        idempotencyKey: $idempotencyKey,
                        resourceType: PaymentVoucher::class,
                        existingResourceId: $existingVoucher->id
                    );
                }

                // 2. Lock Purchase Invoice untuk mencegah race condition alokasi pembayaran
                $lockedInvoice = PurchaseInvoice::query()
                    ->with(['supplier', 'purchaseOrder'])
                    ->lockForUpdate()
                    ->findOrFail((int) $data['purchase_invoice_id']);

                if ($lockedInvoice->status === PurchaseInvoice::STATUS_PAID) {
                    throw ValidationException::withMessages([
                        'purchase_invoice_id' => ['Purchase Invoice sudah lunas (Paid) dan tidak dapat dibayar kembali.'],
                    ]);
                }

                // 3. Lock seluruh voucher pembayaran sebelumnya milik invoice ini
                $previousVouchers = PaymentVoucher::query()
                    ->where('purchase_invoice_id', $lockedInvoice->id)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get(['id', 'amount_paid']);

                $alreadyPaid = '0.00';
                foreach ($previousVouchers as $prevVoucher) {
                    $alreadyPaid = bcadd($alreadyPaid, (string) $prevVoucher->amount_paid, 2);
                }

                $totalBilled = $this->normalizeDecimal((string) $lockedInvoice->total_billed, 2);
                $remainingBalance = bcsub($totalBilled, $alreadyPaid, 2);
                $amountPaid = $this->normalizeDecimal((string) $data['amount_paid'], 2);

                if (bccomp($amountPaid, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        'amount_paid' => ['Jumlah pembayaran harus lebih dari 0.'],
                    ]);
                }

                if (bccomp($amountPaid, $remainingBalance, 2) > 0) {
                    throw ValidationException::withMessages([
                        'amount_paid' => [
                            "Jumlah pembayaran ({$amountPaid}) melebihi sisa tagihan invoice ({$remainingBalance}).",
                        ],
                    ]);
                }

                $voucherNumber = ! empty($data['voucher_number'])
                    ? trim((string) $data['voucher_number'])
                    : $this->generateVoucherNumber();

                $voucher = PaymentVoucher::create([
                    'voucher_number' => $voucherNumber,
                    'purchase_invoice_id' => $lockedInvoice->id,
                    'amount_paid' => $amountPaid,
                    'payment_date' => $data['payment_date'],
                    'payment_method' => trim((string) $data['payment_method']),
                    'idempotency_key' => $idempotencyKey,
                ]);

                // 4. Update status PurchaseInvoice secara otomatis: Unpaid -> Partially Paid -> Paid
                $newTotalPaid = bcadd($alreadyPaid, $amountPaid, 2);
                $newStatus = bccomp($newTotalPaid, $totalBilled, 2) === 0
                    ? PurchaseInvoice::STATUS_PAID
                    : PurchaseInvoice::STATUS_PARTIALLY_PAID;

                $oldInvoicePayload = array_merge($this->purchaseInvoicePayload($lockedInvoice), [
                    'amount_paid_before' => $alreadyPaid,
                    'remaining_balance_before' => $remainingBalance,
                ]);

                $lockedInvoice->update([
                    'status' => $newStatus,
                ]);

                // 5. Catat jurnal double-entry: Debit 2101-AP / Credit 1101-CASH-BANK
                $this->generalLedgerService->recordPaymentVoucherJournal(
                    voucher: $voucher,
                    invoice: $lockedInvoice,
                    actor: $actor,
                    ipAddress: $ipAddress
                );

                // 6. Catat Audit Trail
                $this->recordAuditLog(
                    actor: $actor,
                    action: 'payment_voucher.created',
                    modelType: PaymentVoucher::class,
                    modelId: $voucher->id,
                    oldPayload: null,
                    newPayload: $this->paymentVoucherPayload($voucher),
                    ipAddress: $ipAddress
                );

                $this->recordAuditLog(
                    actor: $actor,
                    action: 'purchase_invoice.payment_allocated',
                    modelType: PurchaseInvoice::class,
                    modelId: $lockedInvoice->id,
                    oldPayload: $oldInvoicePayload,
                    newPayload: array_merge($this->purchaseInvoicePayload($lockedInvoice), [
                        'payment_voucher_id' => $voucher->id,
                        'voucher_number' => $voucher->voucher_number,
                        'amount_paid_now' => $amountPaid,
                        'total_paid' => $newTotalPaid,
                        'remaining_balance' => bcsub($totalBilled, $newTotalPaid, 2),
                    ]),
                    ipAddress: $ipAddress
                );

                return $voucher->fresh([
                    'purchaseInvoice.supplier',
                    'purchaseInvoice.purchaseOrder',
                    'purchaseInvoice.paymentVouchers',
                    'generalLedgers',
                ]);
            });
        } catch (QueryException $e) {
            if ($this->isDuplicateIdempotencyConstraintViolation($e)) {
                $existing = PaymentVoucher::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->first();

                throw new DuplicateIdempotencyKeyException(
                    message: "Pembayaran duplikat (double-spend) ditolak: idempotency_key '{$idempotencyKey}' sudah pernah digunakan.",
                    idempotencyKey: $idempotencyKey,
                    resourceType: PaymentVoucher::class,
                    existingResourceId: $existing?->id
                );
            }

            throw $e;
        }
    }

    /**
     * Menghapus (SoftDelete) Purchase Invoice yang masih Unpaid dan belum memiliki pembayaran.
     * Mencatat jurnal balik (reversal) agar General Ledger tetap akurat dan seimbang.
     */
    public function deletePurchaseInvoice(
        PurchaseInvoice $invoice,
        User $actor,
        ?string $ipAddress = null
    ): void {
        DB::transaction(function () use ($invoice, $actor, $ipAddress): void {
            $lockedInvoice = PurchaseInvoice::query()
                ->with(['items', 'paymentVouchers'])
                ->lockForUpdate()
                ->findOrFail($invoice->id);

            if (
                $lockedInvoice->status !== PurchaseInvoice::STATUS_UNPAID
                || $lockedInvoice->paymentVouchers->isNotEmpty()
            ) {
                throw ValidationException::withMessages([
                    'status' => ['Purchase Invoice yang sudah memiliki pembayaran atau lunas tidak dapat dihapus.'],
                ]);
            }

            $oldPayload = $this->purchaseInvoicePayload($lockedInvoice);

            $this->generalLedgerService->recordPurchaseInvoiceReversalJournal(
                invoice: $lockedInvoice,
                actor: $actor,
                ipAddress: $ipAddress
            );

            $lockedInvoice->items()->delete();
            $lockedInvoice->delete();

            $this->recordAuditLog(
                actor: $actor,
                action: 'purchase_invoice.deleted',
                modelType: PurchaseInvoice::class,
                modelId: $lockedInvoice->id,
                oldPayload: $oldPayload,
                newPayload: null,
                ipAddress: $ipAddress
            );
        });
    }

    /**
     * AP Aging Dashboard: mengelompokkan seluruh utang usaha yang belum lunas (Unpaid & Partially Paid)
     * berdasarkan umur jatuh tempo terhadap tanggal referensi ($asOfDate):
     * - Current    : belum jatuh tempo atau jatuh tempo hari ini (days_overdue <= 0)
     * - 1-30 Days  : lewat jatuh tempo 1 s.d. 30 hari
     * - 31-60 Days : lewat jatuh tempo 31 s.d. 60 hari
     * - >60 Days   : lewat jatuh tempo lebih dari 60 hari
     *
     * @return array<string, mixed>
     */
    public function getApAgingSummary(?string $asOfDate = null, ?int $supplierId = null): array
    {
        $referenceDate = $asOfDate !== null && trim($asOfDate) !== ''
            ? Carbon::parse($asOfDate)->startOfDay()
            : Carbon::today()->startOfDay();

        $query = PurchaseInvoice::query()
            ->with(['supplier', 'purchaseOrder', 'paymentVouchers'])
            ->whereIn('status', [
                PurchaseInvoice::STATUS_UNPAID,
                PurchaseInvoice::STATUS_PARTIALLY_PAID,
            ])
            ->orderBy('due_date', 'asc')
            ->orderBy('id', 'asc');

        if ($supplierId !== null) {
            $query->where('supplier_id', $supplierId);
        }

        $invoices = $query->get();

        $buckets = [
            'current' => [
                'label' => 'Current',
                'count' => 0,
                'total_outstanding' => '0.00',
                'invoices' => [],
            ],
            '1_30_days' => [
                'label' => '1-30 Days',
                'count' => 0,
                'total_outstanding' => '0.00',
                'invoices' => [],
            ],
            '31_60_days' => [
                'label' => '31-60 Days',
                'count' => 0,
                'total_outstanding' => '0.00',
                'invoices' => [],
            ],
            'over_60_days' => [
                'label' => '>60 Days',
                'count' => 0,
                'total_outstanding' => '0.00',
                'invoices' => [],
            ],
        ];

        $bySupplier = [];
        $totalOutstanding = '0.00';
        $totalInvoices = 0;

        foreach ($invoices as $invoice) {
            $totalPaid = '0.00';
            foreach ($invoice->paymentVouchers as $voucher) {
                $totalPaid = bcadd($totalPaid, (string) $voucher->amount_paid, 2);
            }

            $totalBilled = $this->normalizeDecimal((string) $invoice->total_billed, 2);
            $outstanding = bcsub($totalBilled, $totalPaid, 2);

            if (bccomp($outstanding, '0.00', 2) <= 0) {
                continue;
            }

            $dueDate = $invoice->due_date->copy()->startOfDay();
            $rawDaysOverdue = (int) $dueDate->diffInDays($referenceDate, false);
            $daysOverdue = max($rawDaysOverdue, 0);

            $bucketKey = match (true) {
                $rawDaysOverdue <= 0 => 'current',
                $rawDaysOverdue <= 30 => '1_30_days',
                $rawDaysOverdue <= 60 => '31_60_days',
                default => 'over_60_days',
            };

            $invoiceEntry = [
                'id' => $invoice->id,
                'invoice_number' => $invoice->invoice_number,
                'po_id' => $invoice->po_id,
                'po_number' => $invoice->purchaseOrder?->po_number,
                'supplier_id' => $invoice->supplier_id,
                'supplier_name' => $invoice->supplier?->name,
                'due_date' => $dueDate->toDateString(),
                'days_overdue' => $daysOverdue,
                'aging_bucket' => $buckets[$bucketKey]['label'],
                'status' => $invoice->status,
                'total_billed' => $totalBilled,
                'total_paid' => $totalPaid,
                'outstanding_amount' => $outstanding,
            ];

            $buckets[$bucketKey]['count']++;
            $buckets[$bucketKey]['total_outstanding'] = bcadd(
                $buckets[$bucketKey]['total_outstanding'],
                $outstanding,
                2
            );
            $buckets[$bucketKey]['invoices'][] = $invoiceEntry;

            $sid = $invoice->supplier_id;
            if (! isset($bySupplier[$sid])) {
                $bySupplier[$sid] = [
                    'supplier_id' => $sid,
                    'supplier_name' => $invoice->supplier?->name,
                    'current' => '0.00',
                    '1_30_days' => '0.00',
                    '31_60_days' => '0.00',
                    'over_60_days' => '0.00',
                    'total_outstanding' => '0.00',
                    'invoice_count' => 0,
                ];
            }

            $bySupplier[$sid][$bucketKey] = bcadd($bySupplier[$sid][$bucketKey], $outstanding, 2);
            $bySupplier[$sid]['total_outstanding'] = bcadd($bySupplier[$sid]['total_outstanding'], $outstanding, 2);
            $bySupplier[$sid]['invoice_count']++;

            $totalOutstanding = bcadd($totalOutstanding, $outstanding, 2);
            $totalInvoices++;
        }

        return [
            'as_of_date' => $referenceDate->toDateString(),
            'total_outstanding' => $totalOutstanding,
            'total_invoices' => $totalInvoices,
            'buckets' => $buckets,
            'by_supplier' => array_values($bySupplier),
        ];
    }

    /**
     * @param  array<int, int>  $validatedGrIds
     * @return array<int, string>
     */
    private function aggregateValidatedReceivedQtyByProduct(array $validatedGrIds): array
    {
        $items = GoodsReceiptItem::query()
            ->whereIn('goods_receipt_id', $validatedGrIds)
            ->get(['product_id', 'qty_received']);

        $received = [];

        foreach ($items as $item) {
            $productId = $item->product_id;
            $received[$productId] = bcadd(
                $received[$productId] ?? '0.00',
                (string) $item->qty_received,
                2
            );
        }

        return $received;
    }

    /**
     * @return array<int, string>
     */
    private function resolvePoUnitPriceByProduct(PurchaseOrder $purchaseOrder): array
    {
        $totals = [];

        foreach ($purchaseOrder->items as $poItem) {
            $productId = $poItem->product_id;
            $qty = (string) $poItem->qty_ordered;
            $lineValue = bcmul($qty, (string) $poItem->unit_price, 4);

            if (! isset($totals[$productId])) {
                $totals[$productId] = [
                    'qty' => '0.00',
                    'value' => '0.0000',
                    'single_unit_price' => (string) $poItem->unit_price,
                    'lines' => 0,
                ];
            }

            $totals[$productId]['qty'] = bcadd($totals[$productId]['qty'], $qty, 2);
            $totals[$productId]['value'] = bcadd($totals[$productId]['value'], $lineValue, 4);
            $totals[$productId]['lines']++;
        }

        $unitPrices = [];

        foreach ($totals as $productId => $summary) {
            if ($summary['lines'] === 1) {
                $unitPrices[$productId] = $this->normalizeDecimal($summary['single_unit_price'], 2);
            } else {
                $rawAvg = bcdiv($summary['value'], $summary['qty'], 6);
                $unitPrices[$productId] = $this->roundDecimal($rawAvg, 2);
            }
        }

        return $unitPrices;
    }

    private function generateInvoiceNumber(): string
    {
        $prefix = 'INV-AP-' . now()->format('Ym') . '-';

        $latestNumber = PurchaseInvoice::withTrashed()
            ->where('invoice_number', 'like', $prefix . '%')
            ->orderByDesc('invoice_number')
            ->value('invoice_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (PurchaseInvoice::withTrashed()->where('invoice_number', $candidate)->exists());

        return $candidate;
    }

    private function generateVoucherNumber(): string
    {
        $prefix = 'PV-' . now()->format('Ym') . '-';

        $latestNumber = PaymentVoucher::withTrashed()
            ->where('voucher_number', 'like', $prefix . '%')
            ->orderByDesc('voucher_number')
            ->value('voucher_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (PaymentVoucher::withTrashed()->where('voucher_number', $candidate)->exists());

        return $candidate;
    }

    private function isDuplicateIdempotencyConstraintViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? $e->getCode());
        $message = strtolower($e->getMessage());

        return in_array($sqlState, ['23000', '23505'], true)
            && str_contains($message, 'idempotency_key');
    }

    /**
     * @return array<string, mixed>
     */
    private function purchaseInvoicePayload(PurchaseInvoice $invoice): array
    {
        return [
            'id' => $invoice->id,
            'invoice_number' => $invoice->invoice_number,
            'po_id' => $invoice->po_id,
            'supplier_id' => $invoice->supplier_id,
            'total_billed' => (string) $invoice->total_billed,
            'due_date' => $invoice->due_date?->format('Y-m-d'),
            'status' => $invoice->status,
            'idempotency_key' => $invoice->idempotency_key,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function paymentVoucherPayload(PaymentVoucher $voucher): array
    {
        return [
            'id' => $voucher->id,
            'voucher_number' => $voucher->voucher_number,
            'purchase_invoice_id' => $voucher->purchase_invoice_id,
            'amount_paid' => (string) $voucher->amount_paid,
            'payment_date' => $voucher->payment_date?->format('Y-m-d'),
            'payment_method' => $voucher->payment_method,
            'idempotency_key' => $voucher->idempotency_key,
        ];
    }

    /**
     * @param  array<string, mixed>|null  $oldPayload
     * @param  array<string, mixed>|null  $newPayload
     */
    private function recordAuditLog(
        User $actor,
        string $action,
        string $modelType,
        int $modelId,
        ?array $oldPayload,
        ?array $newPayload,
        ?string $ipAddress
    ): AuditLog {
        return AuditLog::create([
            'user_id' => $actor->id,
            'action' => $action,
            'model_type' => $modelType,
            'model_id' => $modelId,
            'old_payload' => $oldPayload,
            'new_payload' => $newPayload,
            'ip_address' => $ipAddress,
        ]);
    }

    private function normalizeDecimal(string $value, int $scale = 2): string
    {
        return bcadd(trim($value), '0', $scale);
    }

    private function roundDecimal(string $value, int $scale = 2): string
    {
        $isNegative = str_starts_with($value, '-');
        $half = '0.' . str_repeat('0', $scale) . '5';

        $adjusted = $isNegative
            ? bcsub($value, $half, $scale + 2)
            : bcadd($value, $half, $scale + 2);

        return bcadd($adjusted, '0', $scale);
    }
}
