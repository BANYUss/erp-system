<?php

namespace App\Services\Finance;

use App\Exceptions\DuplicateIdempotencyKeyException;
use App\Models\AuditLog;
use App\Models\CustomerPayment;
use App\Models\DeliveryOrder;
use App\Models\SalesInvoice;
use App\Models\SalesOrder;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AccountReceivableService
{
    public function __construct(
        private readonly GeneralLedgerService $generalLedgerService
    ) {}

    /**
     * Menerbitkan Sales Invoice (Account Receivable) dari Sales Order atau Delivery Order
     * dalam DB::transaction() + lockForUpdate():
     * - Menolak duplikat idempotency_key dengan HTTP 409 Conflict.
     * - Mencegah over-billing melebihi total_amount Sales Order.
     * - Mencatat jurnal otomatis di general_ledgers (Debit 1102-AR / Credit 4101-SALES-REVENUE).
     *
     * @param  array<string, mixed>  $data
     */
    public function createSalesInvoice(array $data, User $actor, ?string $ipAddress = null): SalesInvoice
    {
        $idempotencyKey = trim((string) ($data['idempotency_key'] ?? ''));

        if ($idempotencyKey === '') {
            throw ValidationException::withMessages([
                'idempotency_key' => ['Idempotency key wajib diisi untuk pembuatan Sales Invoice.'],
            ]);
        }

        try {
            return DB::transaction(function () use ($data, $idempotencyKey, $actor, $ipAddress): SalesInvoice {
                // 1. Cek idempotency_key dengan pessimistic lock
                $existingByIdempotency = SalesInvoice::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->lockForUpdate()
                    ->first();

                if ($existingByIdempotency !== null) {
                    throw new DuplicateIdempotencyKeyException(
                        message: "Request duplikat ditolak: Sales Invoice dengan idempotency_key '{$idempotencyKey}' sudah pernah diproses.",
                        idempotencyKey: $idempotencyKey,
                        resourceType: SalesInvoice::class,
                        existingResourceId: $existingByIdempotency->id
                    );
                }

                // 2. Resolve DeliveryOrder (opsional) dan SalesOrder dengan lockForUpdate()
                $lockedDo = null;
                if (! empty($data['delivery_order_id'])) {
                    $lockedDo = DeliveryOrder::query()
                        ->with('items')
                        ->lockForUpdate()
                        ->findOrFail((int) $data['delivery_order_id']);

                    if (! in_array($lockedDo->status, [
                        DeliveryOrder::STATUS_DISPATCHED,
                        DeliveryOrder::STATUS_DELIVERED,
                    ], true)) {
                        throw ValidationException::withMessages([
                            'delivery_order_id' => [
                                'Sales Invoice hanya dapat diterbitkan dari Delivery Order berstatus Dispatched atau Delivered.',
                            ],
                        ]);
                    }
                }

                $salesOrderId = ! empty($data['sales_order_id'])
                    ? (int) $data['sales_order_id']
                    : $lockedDo?->sales_order_id;

                if ($salesOrderId === null) {
                    throw ValidationException::withMessages([
                        'sales_order_id' => ['sales_order_id atau delivery_order_id wajib diisi.'],
                    ]);
                }

                if ($lockedDo !== null && $lockedDo->sales_order_id !== $salesOrderId) {
                    throw ValidationException::withMessages([
                        'delivery_order_id' => ['Delivery Order yang dipilih tidak terhubung dengan Sales Order tersebut.'],
                    ]);
                }

                $lockedSo = SalesOrder::query()
                    ->with(['items.product', 'customer'])
                    ->lockForUpdate()
                    ->findOrFail($salesOrderId);

                if (! in_array($lockedSo->status, [
                    SalesOrder::STATUS_CONFIRMED,
                    SalesOrder::STATUS_PARTIALLY_DELIVERED,
                    SalesOrder::STATUS_COMPLETED,
                ], true)) {
                    throw ValidationException::withMessages([
                        'sales_order_id' => [
                            'Sales Invoice hanya dapat diterbitkan untuk Sales Order berstatus Confirmed, Partially Delivered, atau Completed.',
                        ],
                    ]);
                }

                if (isset($data['customer_id']) && (int) $data['customer_id'] !== $lockedSo->customer_id) {
                    throw ValidationException::withMessages([
                        'customer_id' => ['Customer pada Invoice tidak sesuai dengan Customer pada Sales Order.'],
                    ]);
                }

                // 3. Lock seluruh SalesInvoice aktif milik SO ini untuk mencegah cumulative over-billing
                $existingInvoices = SalesInvoice::query()
                    ->where('sales_order_id', $lockedSo->id)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get(['id', 'total_billed']);

                $alreadyBilledTotal = '0.00';
                foreach ($existingInvoices as $existingInvoice) {
                    $alreadyBilledTotal = bcadd($alreadyBilledTotal, (string) $existingInvoice->total_billed, 2);
                }

                $soTotal = $this->normalizeDecimal((string) $lockedSo->total_amount, 2);
                $remainingBillable = bcsub($soTotal, $alreadyBilledTotal, 2);

                if (bccomp($remainingBillable, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        'sales_order_id' => ['Seluruh nilai Sales Order sudah ditagihkan pada Sales Invoice sebelumnya.'],
                    ]);
                }

                // 4. Tentukan total_billed (dari input eksplisit, kalkulasi item DO x pricing snapshot SO, atau sisa tagihan SO)
                if (isset($data['total_billed']) && $data['total_billed'] !== '' && $data['total_billed'] !== null) {
                    $totalBilled = $this->normalizeDecimal((string) $data['total_billed'], 2);
                } elseif ($lockedDo !== null) {
                    $totalBilled = $this->calculateDeliveryOrderSalesValue($lockedSo, $lockedDo);
                } else {
                    $totalBilled = $remainingBillable;
                }

                if (bccomp($totalBilled, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        'total_billed' => ['Total tagihan (total_billed) harus lebih dari 0.'],
                    ]);
                }

                if (bccomp($totalBilled, $remainingBillable, 2) > 0) {
                    throw ValidationException::withMessages([
                        'total_billed' => [
                            "Total tagihan ({$totalBilled}) melebihi sisa nilai Sales Order yang belum ditagihkan ({$remainingBillable}).",
                        ],
                    ]);
                }

                $invoiceNumber = ! empty($data['invoice_number'])
                    ? trim((string) $data['invoice_number'])
                    : $this->generateInvoiceNumber();

                $invoice = SalesInvoice::create([
                    'invoice_number' => $invoiceNumber,
                    'sales_order_id' => $lockedSo->id,
                    'customer_id' => $lockedSo->customer_id,
                    'total_billed' => $totalBilled,
                    'due_date' => $data['due_date'],
                    'status' => SalesInvoice::STATUS_UNPAID,
                    'idempotency_key' => $idempotencyKey,
                ]);

                $invoice->load(['salesOrder.customer', 'customer', 'customerPayments']);

                // 5. Catat jurnal otomatis AR & Pendapatan Penjualan: Debit 1102-AR / Credit 4101-SALES-REVENUE
                $this->generalLedgerService->recordSalesInvoiceJournal(
                    invoice: $invoice,
                    actor: $actor,
                    transactionDate: $data['invoice_date'] ?? now()->toDateString(),
                    ipAddress: $ipAddress
                );

                // 6. Catat Audit Trail
                $this->recordAuditLog(
                    actor: $actor,
                    action: 'sales_invoice.created',
                    modelType: SalesInvoice::class,
                    modelId: $invoice->id,
                    oldPayload: null,
                    newPayload: array_merge($this->salesInvoicePayload($invoice), [
                        'delivery_order_id' => $lockedDo?->id,
                    ]),
                    ipAddress: $ipAddress
                );

                return $invoice->fresh([
                    'salesOrder.customer',
                    'customer',
                    'customerPayments',
                    'generalLedgers',
                ]);
            });
        } catch (QueryException $e) {
            if ($this->isDuplicateIdempotencyConstraintViolation($e)) {
                $existing = SalesInvoice::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->first();

                throw new DuplicateIdempotencyKeyException(
                    message: "Request duplikat ditolak: Sales Invoice dengan idempotency_key '{$idempotencyKey}' sudah pernah diproses.",
                    idempotencyKey: $idempotencyKey,
                    resourceType: SalesInvoice::class,
                    existingResourceId: $existing?->id
                );
            }

            throw $e;
        }
    }

    /**
     * Mencatat kas masuk dari customer (CustomerPayment) dalam DB::transaction() + lockForUpdate():
     * - Menolak duplikat idempotency_key dengan HTTP 409 Conflict.
     * - Menolak overpayment melebihi sisa piutang dengan HTTP 422.
     * - Memperbarui status SalesInvoice secara otomatis: Unpaid -> Partially Paid -> Paid.
     * - Mencatat jurnal double-entry di general_ledgers (Debit 1101-CASH-BANK / Credit 1102-AR).
     *
     * @param  array<string, mixed>  $data
     */
    public function recordCustomerPayment(array $data, User $actor, ?string $ipAddress = null): CustomerPayment
    {
        $idempotencyKey = trim((string) ($data['idempotency_key'] ?? ''));

        if ($idempotencyKey === '') {
            throw ValidationException::withMessages([
                'idempotency_key' => ['Idempotency key wajib diisi untuk pencatatan pembayaran customer.'],
            ]);
        }

        try {
            return DB::transaction(function () use ($data, $idempotencyKey, $actor, $ipAddress): CustomerPayment {
                // 1. Cek idempotency_key terlebih dahulu dengan pessimistic lock
                $existingPayment = CustomerPayment::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->lockForUpdate()
                    ->first();

                if ($existingPayment !== null) {
                    throw new DuplicateIdempotencyKeyException(
                        message: "Pembayaran duplikat ditolak: idempotency_key '{$idempotencyKey}' sudah pernah digunakan pada receipt {$existingPayment->receipt_number}.",
                        idempotencyKey: $idempotencyKey,
                        resourceType: CustomerPayment::class,
                        existingResourceId: $existingPayment->id
                    );
                }

                // 2. Lock Sales Invoice untuk mencegah race condition alokasi kas masuk
                $lockedInvoice = SalesInvoice::query()
                    ->with(['customer', 'salesOrder'])
                    ->lockForUpdate()
                    ->findOrFail((int) $data['sales_invoice_id']);

                if ($lockedInvoice->status === SalesInvoice::STATUS_PAID) {
                    throw ValidationException::withMessages([
                        'sales_invoice_id' => ['Sales Invoice sudah lunas (Paid) dan tidak dapat menerima pembayaran kembali.'],
                    ]);
                }

                // 3. Lock seluruh pembayaran sebelumnya milik invoice ini
                $previousPayments = CustomerPayment::query()
                    ->where('sales_invoice_id', $lockedInvoice->id)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get(['id', 'amount_received']);

                $alreadyReceived = '0.00';
                foreach ($previousPayments as $prevPayment) {
                    $alreadyReceived = bcadd($alreadyReceived, (string) $prevPayment->amount_received, 2);
                }

                $totalBilled = $this->normalizeDecimal((string) $lockedInvoice->total_billed, 2);
                $remainingBalance = bcsub($totalBilled, $alreadyReceived, 2);
                $amountReceived = $this->normalizeDecimal((string) $data['amount_received'], 2);

                if (bccomp($amountReceived, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        'amount_received' => ['Jumlah kas masuk harus lebih dari 0.'],
                    ]);
                }

                if (bccomp($amountReceived, $remainingBalance, 2) > 0) {
                    throw ValidationException::withMessages([
                        'amount_received' => [
                            "Overpayment ditolak: Jumlah pembayaran ({$amountReceived}) melebihi sisa tagihan piutang ({$remainingBalance}).",
                        ],
                    ]);
                }

                $receiptNumber = ! empty($data['receipt_number'])
                    ? trim((string) $data['receipt_number'])
                    : $this->generateReceiptNumber();

                $payment = CustomerPayment::create([
                    'receipt_number' => $receiptNumber,
                    'sales_invoice_id' => $lockedInvoice->id,
                    'amount_received' => $amountReceived,
                    'payment_date' => $data['payment_date'],
                    'payment_method' => trim((string) $data['payment_method']),
                    'idempotency_key' => $idempotencyKey,
                ]);

                // 4. Update status SalesInvoice secara otomatis: Unpaid -> Partially Paid -> Paid
                $newTotalReceived = bcadd($alreadyReceived, $amountReceived, 2);
                $newStatus = bccomp($newTotalReceived, $totalBilled, 2) === 0
                    ? SalesInvoice::STATUS_PAID
                    : SalesInvoice::STATUS_PARTIALLY_PAID;

                $oldInvoicePayload = array_merge($this->salesInvoicePayload($lockedInvoice), [
                    'amount_received_before' => $alreadyReceived,
                    'remaining_balance_before' => $remainingBalance,
                ]);

                $lockedInvoice->update([
                    'status' => $newStatus,
                ]);

                // 5. Catat jurnal double-entry: Debit 1101-CASH-BANK / Credit 1102-AR
                $this->generalLedgerService->recordCustomerPaymentJournal(
                    payment: $payment,
                    invoice: $lockedInvoice,
                    actor: $actor,
                    ipAddress: $ipAddress
                );

                // 6. Catat Audit Trail
                $this->recordAuditLog(
                    actor: $actor,
                    action: 'customer_payment.created',
                    modelType: CustomerPayment::class,
                    modelId: $payment->id,
                    oldPayload: null,
                    newPayload: $this->customerPaymentPayload($payment),
                    ipAddress: $ipAddress
                );

                $this->recordAuditLog(
                    actor: $actor,
                    action: 'sales_invoice.payment_allocated',
                    modelType: SalesInvoice::class,
                    modelId: $lockedInvoice->id,
                    oldPayload: $oldInvoicePayload,
                    newPayload: array_merge($this->salesInvoicePayload($lockedInvoice), [
                        'customer_payment_id' => $payment->id,
                        'receipt_number' => $payment->receipt_number,
                        'amount_received_now' => $amountReceived,
                        'total_received' => $newTotalReceived,
                        'remaining_balance' => bcsub($totalBilled, $newTotalReceived, 2),
                    ]),
                    ipAddress: $ipAddress
                );

                return $payment->fresh([
                    'salesInvoice.customer',
                    'salesInvoice.salesOrder',
                    'salesInvoice.customerPayments',
                    'generalLedgers',
                ]);
            });
        } catch (QueryException $e) {
            if ($this->isDuplicateIdempotencyConstraintViolation($e)) {
                $existing = CustomerPayment::withTrashed()
                    ->where('idempotency_key', $idempotencyKey)
                    ->first();

                throw new DuplicateIdempotencyKeyException(
                    message: "Pembayaran duplikat ditolak: idempotency_key '{$idempotencyKey}' sudah pernah digunakan.",
                    idempotencyKey: $idempotencyKey,
                    resourceType: CustomerPayment::class,
                    existingResourceId: $existing?->id
                );
            }

            throw $e;
        }
    }

    /**
     * Menghapus (SoftDelete) Sales Invoice yang masih Unpaid dan belum memiliki pembayaran,
     * serta mencatat jurnal balik (reversal) di General Ledger.
     */
    public function deleteSalesInvoice(
        SalesInvoice $invoice,
        User $actor,
        ?string $ipAddress = null
    ): void {
        DB::transaction(function () use ($invoice, $actor, $ipAddress): void {
            $lockedInvoice = SalesInvoice::query()
                ->with('customerPayments')
                ->lockForUpdate()
                ->findOrFail($invoice->id);

            if (
                $lockedInvoice->status !== SalesInvoice::STATUS_UNPAID
                || $lockedInvoice->customerPayments->isNotEmpty()
            ) {
                throw ValidationException::withMessages([
                    'status' => ['Sales Invoice yang sudah memiliki pembayaran atau lunas tidak dapat dihapus.'],
                ]);
            }

            $oldPayload = $this->salesInvoicePayload($lockedInvoice);

            $this->generalLedgerService->recordSalesInvoiceReversalJournal(
                invoice: $lockedInvoice,
                actor: $actor,
                ipAddress: $ipAddress
            );

            $lockedInvoice->delete();

            $this->recordAuditLog(
                actor: $actor,
                action: 'sales_invoice.deleted',
                modelType: SalesInvoice::class,
                modelId: $lockedInvoice->id,
                oldPayload: $oldPayload,
                newPayload: null,
                ipAddress: $ipAddress
            );
        });
    }

    /**
     * AR Aging Summary: mengelompokkan seluruh piutang usaha yang belum lunas (Unpaid & Partially Paid)
     * berdasarkan umur jatuh tempo terhadap tanggal referensi ($asOfDate):
     * - Current    : belum jatuh tempo atau jatuh tempo hari ini (days_overdue <= 0)
     * - 1-30 Days  : lewat jatuh tempo 1 s.d. 30 hari
     * - 31-60 Days : lewat jatuh tempo 31 s.d. 60 hari
     * - >60 Days   : lewat jatuh tempo lebih dari 60 hari
     *
     * @return array<string, mixed>
     */
    public function getArAgingSummary(?string $asOfDate = null, ?int $customerId = null): array
    {
        $referenceDate = $asOfDate !== null && trim($asOfDate) !== ''
            ? Carbon::parse($asOfDate)->startOfDay()
            : Carbon::today()->startOfDay();

        $query = SalesInvoice::query()
            ->with(['customer', 'salesOrder', 'customerPayments'])
            ->whereIn('status', [
                SalesInvoice::STATUS_UNPAID,
                SalesInvoice::STATUS_PARTIALLY_PAID,
            ])
            ->orderBy('due_date', 'asc')
            ->orderBy('id', 'asc');

        if ($customerId !== null) {
            $query->where('customer_id', $customerId);
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

        $byCustomer = [];
        $totalOutstanding = '0.00';
        $totalInvoices = 0;

        foreach ($invoices as $invoice) {
            $totalReceived = '0.00';
            foreach ($invoice->customerPayments as $payment) {
                $totalReceived = bcadd($totalReceived, (string) $payment->amount_received, 2);
            }

            $totalBilled = $this->normalizeDecimal((string) $invoice->total_billed, 2);
            $outstanding = bcsub($totalBilled, $totalReceived, 2);

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
                'sales_order_id' => $invoice->sales_order_id,
                'so_number' => $invoice->salesOrder?->so_number,
                'customer_id' => $invoice->customer_id,
                'customer_name' => $invoice->customer?->name,
                'due_date' => $dueDate->toDateString(),
                'days_overdue' => $daysOverdue,
                'aging_bucket' => $buckets[$bucketKey]['label'],
                'status' => $invoice->status,
                'total_billed' => $totalBilled,
                'total_received' => $totalReceived,
                'outstanding_amount' => $outstanding,
            ];

            $buckets[$bucketKey]['count']++;
            $buckets[$bucketKey]['total_outstanding'] = bcadd(
                $buckets[$bucketKey]['total_outstanding'],
                $outstanding,
                2
            );
            $buckets[$bucketKey]['invoices'][] = $invoiceEntry;

            $cid = $invoice->customer_id;
            if (! isset($byCustomer[$cid])) {
                $byCustomer[$cid] = [
                    'customer_id' => $cid,
                    'customer_name' => $invoice->customer?->name,
                    'current' => '0.00',
                    '1_30_days' => '0.00',
                    '31_60_days' => '0.00',
                    'over_60_days' => '0.00',
                    'total_outstanding' => '0.00',
                    'invoice_count' => 0,
                ];
            }

            $byCustomer[$cid][$bucketKey] = bcadd($byCustomer[$cid][$bucketKey], $outstanding, 2);
            $byCustomer[$cid]['total_outstanding'] = bcadd($byCustomer[$cid]['total_outstanding'], $outstanding, 2);
            $byCustomer[$cid]['invoice_count']++;

            $totalOutstanding = bcadd($totalOutstanding, $outstanding, 2);
            $totalInvoices++;
        }

        return [
            'as_of_date' => $referenceDate->toDateString(),
            'total_outstanding' => $totalOutstanding,
            'total_invoices' => $totalInvoices,
            'buckets' => $buckets,
            'by_customer' => array_values($byCustomer),
        ];
    }

    /**
     * Menghitung nilai penjualan Delivery Order berdasarkan pricing snapshot unit_price pada SalesOrder.
     */
    private function calculateDeliveryOrderSalesValue(SalesOrder $salesOrder, DeliveryOrder $deliveryOrder): string
    {
        $totalsByProduct = [];
        foreach ($salesOrder->items as $soItem) {
            $pid = $soItem->product_id;
            $qty = (string) $soItem->qty_ordered;
            $lineValue = bcmul($qty, (string) $soItem->unit_price, 4);

            if (! isset($totalsByProduct[$pid])) {
                $totalsByProduct[$pid] = [
                    'qty' => '0.00',
                    'value' => '0.0000',
                    'single_unit_price' => (string) $soItem->unit_price,
                    'lines' => 0,
                ];
            }

            $totalsByProduct[$pid]['qty'] = bcadd($totalsByProduct[$pid]['qty'], $qty, 2);
            $totalsByProduct[$pid]['value'] = bcadd($totalsByProduct[$pid]['value'], $lineValue, 4);
            $totalsByProduct[$pid]['lines']++;
        }

        $unitPriceByProduct = [];
        foreach ($totalsByProduct as $pid => $summary) {
            if ($summary['lines'] === 1) {
                $unitPriceByProduct[$pid] = $this->normalizeDecimal($summary['single_unit_price'], 2);
            } else {
                $unitPriceByProduct[$pid] = $this->roundDecimal(bcdiv($summary['value'], $summary['qty'], 6), 2);
            }
        }

        $totalHigh = '0.0000';
        foreach ($deliveryOrder->items as $doItem) {
            $unitPrice = $unitPriceByProduct[$doItem->product_id] ?? '0.00';
            $lineTotal = bcmul($this->normalizeDecimal((string) $doItem->qty_dispatched, 2), $unitPrice, 4);
            $totalHigh = bcadd($totalHigh, $lineTotal, 4);
        }

        return $this->roundDecimal($totalHigh, 2);
    }

    private function generateInvoiceNumber(): string
    {
        $prefix = 'INV-AR-' . now()->format('Ym') . '-';

        $latestNumber = SalesInvoice::withTrashed()
            ->where('invoice_number', 'like', $prefix . '%')
            ->orderByDesc('invoice_number')
            ->value('invoice_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (SalesInvoice::withTrashed()->where('invoice_number', $candidate)->exists());

        return $candidate;
    }

    private function generateReceiptNumber(): string
    {
        $prefix = 'RCP-' . now()->format('Ym') . '-';

        $latestNumber = CustomerPayment::withTrashed()
            ->where('receipt_number', 'like', $prefix . '%')
            ->orderByDesc('receipt_number')
            ->value('receipt_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (CustomerPayment::withTrashed()->where('receipt_number', $candidate)->exists());

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
    private function salesInvoicePayload(SalesInvoice $invoice): array
    {
        return [
            'id' => $invoice->id,
            'invoice_number' => $invoice->invoice_number,
            'sales_order_id' => $invoice->sales_order_id,
            'customer_id' => $invoice->customer_id,
            'total_billed' => (string) $invoice->total_billed,
            'due_date' => $invoice->due_date?->format('Y-m-d'),
            'status' => $invoice->status,
            'idempotency_key' => $invoice->idempotency_key,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function customerPaymentPayload(CustomerPayment $payment): array
    {
        return [
            'id' => $payment->id,
            'receipt_number' => $payment->receipt_number,
            'sales_invoice_id' => $payment->sales_invoice_id,
            'amount_received' => (string) $payment->amount_received,
            'payment_date' => $payment->payment_date?->format('Y-m-d'),
            'payment_method' => $payment->payment_method,
            'idempotency_key' => $payment->idempotency_key,
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
