<?php

namespace App\Services\Finance;

use App\Models\AuditLog;
use App\Models\CustomerPayment;
use App\Models\DeliveryOrder;
use App\Models\GeneralLedger;
use App\Models\GoodsReceipt;
use App\Models\PaymentVoucher;
use App\Models\PurchaseInvoice;
use App\Models\SalesInvoice;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class GeneralLedgerService
{
    /**
     * Mencatat entri jurnal double-entry ke general_ledgers secara atomik.
     * Menolak jurnal yang tidak seimbang (total debit != total credit) dengan error 422.
     *
     * @param  array<int, array{account_code: string, debit: string|int|float, credit: string|int|float, description?: string|null}>  $lines
     * @return Collection<int, GeneralLedger>
     */
    public function recordJournalEntry(
        string $transactionDate,
        array $lines,
        ?Model $reference = null,
        ?User $actor = null,
        ?string $ipAddress = null
    ): Collection {
        if (count($lines) < 2) {
            throw ValidationException::withMessages([
                'lines' => ['Entri jurnal double-entry wajib memiliki minimal 2 baris (debit dan kredit).'],
            ]);
        }

        $totalDebit = '0.00';
        $totalCredit = '0.00';
        $preparedLines = [];

        foreach ($lines as $index => $line) {
            $accountCode = trim((string) ($line['account_code'] ?? ''));

            if ($accountCode === '') {
                throw ValidationException::withMessages([
                    "lines.{$index}.account_code" => ['Kode akun (account_code) wajib diisi.'],
                ]);
            }

            $debit = $this->normalizeDecimal((string) ($line['debit'] ?? '0.00'), 2);
            $credit = $this->normalizeDecimal((string) ($line['credit'] ?? '0.00'), 2);

            if (bccomp($debit, '0.00', 2) < 0 || bccomp($credit, '0.00', 2) < 0) {
                throw ValidationException::withMessages([
                    "lines.{$index}" => ['Nilai debit dan kredit tidak boleh negatif.'],
                ]);
            }

            if (bccomp($debit, '0.00', 2) > 0 && bccomp($credit, '0.00', 2) > 0) {
                throw ValidationException::withMessages([
                    "lines.{$index}" => ['Satu baris jurnal tidak boleh memiliki nilai debit dan kredit sekaligus.'],
                ]);
            }

            if (bccomp($debit, '0.00', 2) === 0 && bccomp($credit, '0.00', 2) === 0) {
                throw ValidationException::withMessages([
                    "lines.{$index}" => ['Setiap baris jurnal wajib memiliki nilai debit atau kredit lebih dari 0.'],
                ]);
            }

            $totalDebit = bcadd($totalDebit, $debit, 2);
            $totalCredit = bcadd($totalCredit, $credit, 2);

            $preparedLines[] = [
                'transaction_date' => $transactionDate,
                'account_code' => $accountCode,
                'debit' => $debit,
                'credit' => $credit,
                'reference_type' => $reference?->getMorphClass(),
                'reference_id' => $reference?->getKey(),
                'description' => isset($line['description']) ? trim((string) $line['description']) : null,
            ];
        }

        if (bccomp($totalDebit, '0.00', 2) <= 0 || bccomp($totalDebit, $totalCredit, 2) !== 0) {
            throw ValidationException::withMessages([
                'lines' => [
                    "Jurnal tidak seimbang: total debit ({$totalDebit}) harus sama dengan total kredit ({$totalCredit}).",
                ],
            ]);
        }

        return DB::transaction(function () use ($preparedLines, $transactionDate, $totalDebit, $totalCredit, $reference, $actor, $ipAddress): Collection {
            $entries = new Collection();

            foreach ($preparedLines as $payload) {
                $entries->push(GeneralLedger::create($payload));
            }

            if ($actor !== null) {
                AuditLog::create([
                    'user_id' => $actor->id,
                    'action' => 'general_ledger.posted',
                    'model_type' => $reference !== null ? $reference->getMorphClass() : GeneralLedger::class,
                    'model_id' => $reference !== null ? (int) $reference->getKey() : (int) $entries->first()->id,
                    'old_payload' => null,
                    'new_payload' => [
                        'transaction_date' => $transactionDate,
                        'total_debit' => $totalDebit,
                        'total_credit' => $totalCredit,
                        'entry_ids' => $entries->pluck('id')->all(),
                        'accounts' => $entries->pluck('account_code')->all(),
                    ],
                    'ip_address' => $ipAddress,
                ]);
            }

            return $entries;
        });
    }

    /**
     * Event-Driven Accounting: mencatat jurnal otomatis saat Goods Receipt divalidasi.
     * - Debit  : 1201-INVENTORY (Persediaan Barang Dagang)
     * - Credit : 2102-GRIR      (Hutang Sementara / GR-IR Clearing)
     *
     * @param  array<int, array<string, mixed>>  $valuations
     * @return Collection<int, GeneralLedger>
     */
    public function recordGoodsReceiptJournal(
        GoodsReceipt $goodsReceipt,
        array $valuations,
        User $actor,
        ?string $ipAddress = null
    ): Collection {
        return DB::transaction(function () use ($goodsReceipt, $valuations, $actor, $ipAddress): Collection {
            $lockedGr = GoodsReceipt::query()
                ->with(['purchaseOrder.items', 'items'])
                ->lockForUpdate()
                ->findOrFail($goodsReceipt->id);

            // Idempotency guard: jangan catat jurnal ganda untuk GoodsReceipt yang sama
            $existingEntries = GeneralLedger::query()
                ->where('reference_type', $lockedGr->getMorphClass())
                ->where('reference_id', $lockedGr->id)
                ->orderBy('id')
                ->get();

            if ($existingEntries->isNotEmpty()) {
                return $existingEntries;
            }

            $totalValue = $this->calculateGoodsReceiptTotalValue($lockedGr, $valuations);

            if (bccomp($totalValue, '0.00', 2) <= 0) {
                return new Collection();
            }

            $transactionDate = $lockedGr->received_date?->format('Y-m-d') ?? now()->toDateString();
            $poNumber = $lockedGr->purchaseOrder?->po_number ?? ('PO#' . $lockedGr->po_id);

            return $this->recordJournalEntry(
                transactionDate: $transactionDate,
                lines: [
                    [
                        'account_code' => GeneralLedger::ACCOUNT_INVENTORY,
                        'debit' => $totalValue,
                        'credit' => '0.00',
                        'description' => "Persediaan masuk dari Goods Receipt {$lockedGr->receipt_number} ({$poNumber})",
                    ],
                    [
                        'account_code' => GeneralLedger::ACCOUNT_GRIR_CLEARING,
                        'debit' => '0.00',
                        'credit' => $totalValue,
                        'description' => "Hutang sementara (GR/IR Clearing) untuk Goods Receipt {$lockedGr->receipt_number} ({$poNumber})",
                    ],
                ],
                reference: $lockedGr,
                actor: $actor,
                ipAddress: $ipAddress
            );
        });
    }

    /**
     * Mencatat jurnal pengakuan Purchase Invoice (Account Payable):
     * - Debit  : 2102-GRIR (Clearing Hutang Sementara)
     * - Credit : 2101-AP   (Hutang Usaha / Account Payable)
     *
     * @return Collection<int, GeneralLedger>
     */
    public function recordPurchaseInvoiceJournal(
        PurchaseInvoice $invoice,
        User $actor,
        ?string $transactionDate = null,
        ?string $ipAddress = null
    ): Collection {
        $amount = $this->normalizeDecimal((string) $invoice->total_billed, 2);
        $date = $transactionDate ?? now()->toDateString();
        $poNumber = $invoice->purchaseOrder?->po_number ?? ('PO#' . $invoice->po_id);

        return $this->recordJournalEntry(
            transactionDate: $date,
            lines: [
                [
                    'account_code' => GeneralLedger::ACCOUNT_GRIR_CLEARING,
                    'debit' => $amount,
                    'credit' => '0.00',
                    'description' => "Clearing GR/IR untuk Purchase Invoice {$invoice->invoice_number} ({$poNumber})",
                ],
                [
                    'account_code' => GeneralLedger::ACCOUNT_AP,
                    'debit' => '0.00',
                    'credit' => $amount,
                    'description' => "Pengakuan Hutang Usaha (AP) untuk Purchase Invoice {$invoice->invoice_number} ({$poNumber})",
                ],
            ],
            reference: $invoice,
            actor: $actor,
            ipAddress: $ipAddress
        );
    }

    /**
     * Mencatat jurnal balik saat Purchase Invoice berstatus Unpaid dibatalkan (SoftDelete):
     * - Debit  : 2101-AP   (Pengurangan Hutang Usaha)
     * - Credit : 2102-GRIR (Pengembalian GR/IR Clearing)
     *
     * @return Collection<int, GeneralLedger>
     */
    public function recordPurchaseInvoiceReversalJournal(
        PurchaseInvoice $invoice,
        User $actor,
        ?string $transactionDate = null,
        ?string $ipAddress = null
    ): Collection {
        $amount = $this->normalizeDecimal((string) $invoice->total_billed, 2);
        $date = $transactionDate ?? now()->toDateString();

        return $this->recordJournalEntry(
            transactionDate: $date,
            lines: [
                [
                    'account_code' => GeneralLedger::ACCOUNT_AP,
                    'debit' => $amount,
                    'credit' => '0.00',
                    'description' => "Reversal Hutang Usaha (AP) untuk pembatalan Purchase Invoice {$invoice->invoice_number}",
                ],
                [
                    'account_code' => GeneralLedger::ACCOUNT_GRIR_CLEARING,
                    'debit' => '0.00',
                    'credit' => $amount,
                    'description' => "Reversal GR/IR Clearing untuk pembatalan Purchase Invoice {$invoice->invoice_number}",
                ],
            ],
            reference: $invoice,
            actor: $actor,
            ipAddress: $ipAddress
        );
    }

    /**
     * Mencatat jurnal pembayaran Account Payable (Payment Voucher):
     * - Debit  : 2101-AP        (Pelunasan / Pengurangan Hutang Usaha)
     * - Credit : 1101-CASH-BANK (Kas / Bank Keluar)
     *
     * @return Collection<int, GeneralLedger>
     */
    public function recordPaymentVoucherJournal(
        PaymentVoucher $voucher,
        PurchaseInvoice $invoice,
        User $actor,
        ?string $ipAddress = null
    ): Collection {
        $amount = $this->normalizeDecimal((string) $voucher->amount_paid, 2);
        $date = $voucher->payment_date?->format('Y-m-d') ?? now()->toDateString();

        return $this->recordJournalEntry(
            transactionDate: $date,
            lines: [
                [
                    'account_code' => GeneralLedger::ACCOUNT_AP,
                    'debit' => $amount,
                    'credit' => '0.00',
                    'description' => "Pembayaran AP {$voucher->voucher_number} untuk Invoice {$invoice->invoice_number} via {$voucher->payment_method}",
                ],
                [
                    'account_code' => GeneralLedger::ACCOUNT_CASH_BANK,
                    'debit' => '0.00',
                    'credit' => $amount,
                    'description' => "Pengeluaran Kas/Bank {$voucher->voucher_number} untuk Invoice {$invoice->invoice_number} via {$voucher->payment_method}",
                ],
            ],
            reference: $voucher,
            actor: $actor,
            ipAddress: $ipAddress
        );
    }

    /**
     * Event-Driven Accounting: mencatat jurnal HPP (COGS) otomatis saat Delivery Order dikirim (Dispatched).
     * - Debit  : 5101-COGS      (Harga Pokok Penjualan)
     * - Credit : 1201-INVENTORY (Pengurangan Persediaan Barang Dagang)
     *
     * @param  array<int, array<string, mixed>>  $dispatches
     * @return Collection<int, GeneralLedger>
     */
    public function recordDeliveryOrderCogsJournal(
        DeliveryOrder $deliveryOrder,
        array $dispatches,
        User $actor,
        ?string $ipAddress = null
    ): Collection {
        return DB::transaction(function () use ($deliveryOrder, $dispatches, $actor, $ipAddress): Collection {
            $lockedDo = DeliveryOrder::query()
                ->with(['salesOrder', 'items'])
                ->lockForUpdate()
                ->findOrFail($deliveryOrder->id);

            // Idempotency guard: jangan catat jurnal ganda untuk DeliveryOrder yang sama
            $existingEntries = GeneralLedger::query()
                ->where('reference_type', $lockedDo->getMorphClass())
                ->where('reference_id', $lockedDo->id)
                ->orderBy('id')
                ->get();

            if ($existingEntries->isNotEmpty()) {
                return $existingEntries;
            }

            $totalCogs = $this->calculateDeliveryOrderTotalCogs($lockedDo, $dispatches);

            if (bccomp($totalCogs, '0.00', 2) <= 0) {
                return new Collection();
            }

            $transactionDate = $lockedDo->delivery_date?->format('Y-m-d') ?? now()->toDateString();
            $soNumber = $lockedDo->salesOrder?->so_number ?? ('SO#' . $lockedDo->sales_order_id);

            return $this->recordJournalEntry(
                transactionDate: $transactionDate,
                lines: [
                    [
                        'account_code' => GeneralLedger::ACCOUNT_COGS,
                        'debit' => $totalCogs,
                        'credit' => '0.00',
                        'description' => "Pengakuan HPP (COGS) atas pengiriman Delivery Order {$lockedDo->do_number} ({$soNumber})",
                    ],
                    [
                        'account_code' => GeneralLedger::ACCOUNT_INVENTORY,
                        'debit' => '0.00',
                        'credit' => $totalCogs,
                        'description' => "Pengurangan Persediaan atas pengiriman Delivery Order {$lockedDo->do_number} ({$soNumber})",
                    ],
                ],
                reference: $lockedDo,
                actor: $actor,
                ipAddress: $ipAddress
            );
        });
    }

    /**
     * Mencatat jurnal pengakuan Sales Invoice (Account Receivable & Pendapatan Penjualan):
     * - Debit  : 1102-AR            (Piutang Usaha)
     * - Credit : 4101-SALES-REVENUE (Pendapatan Penjualan)
     *
     * @return Collection<int, GeneralLedger>
     */
    public function recordSalesInvoiceJournal(
        SalesInvoice $invoice,
        User $actor,
        ?string $transactionDate = null,
        ?string $ipAddress = null
    ): Collection {
        $amount = $this->normalizeDecimal((string) $invoice->total_billed, 2);
        $date = $transactionDate ?? now()->toDateString();
        $soNumber = $invoice->salesOrder?->so_number ?? ('SO#' . $invoice->sales_order_id);

        return $this->recordJournalEntry(
            transactionDate: $date,
            lines: [
                [
                    'account_code' => GeneralLedger::ACCOUNT_AR,
                    'debit' => $amount,
                    'credit' => '0.00',
                    'description' => "Pengakuan Piutang Usaha (AR) untuk Sales Invoice {$invoice->invoice_number} ({$soNumber})",
                ],
                [
                    'account_code' => GeneralLedger::ACCOUNT_SALES_REVENUE,
                    'debit' => '0.00',
                    'credit' => $amount,
                    'description' => "Pengakuan Pendapatan Penjualan untuk Sales Invoice {$invoice->invoice_number} ({$soNumber})",
                ],
            ],
            reference: $invoice,
            actor: $actor,
            ipAddress: $ipAddress
        );
    }

    /**
     * Mencatat jurnal balik saat Sales Invoice berstatus Unpaid dibatalkan (SoftDelete):
     * - Debit  : 4101-SALES-REVENUE (Reversal Pendapatan Penjualan)
     * - Credit : 1102-AR            (Reversal Piutang Usaha)
     *
     * @return Collection<int, GeneralLedger>
     */
    public function recordSalesInvoiceReversalJournal(
        SalesInvoice $invoice,
        User $actor,
        ?string $transactionDate = null,
        ?string $ipAddress = null
    ): Collection {
        $amount = $this->normalizeDecimal((string) $invoice->total_billed, 2);
        $date = $transactionDate ?? now()->toDateString();

        return $this->recordJournalEntry(
            transactionDate: $date,
            lines: [
                [
                    'account_code' => GeneralLedger::ACCOUNT_SALES_REVENUE,
                    'debit' => $amount,
                    'credit' => '0.00',
                    'description' => "Reversal Pendapatan Penjualan untuk pembatalan Sales Invoice {$invoice->invoice_number}",
                ],
                [
                    'account_code' => GeneralLedger::ACCOUNT_AR,
                    'debit' => '0.00',
                    'credit' => $amount,
                    'description' => "Reversal Piutang Usaha (AR) untuk pembatalan Sales Invoice {$invoice->invoice_number}",
                ],
            ],
            reference: $invoice,
            actor: $actor,
            ipAddress: $ipAddress
        );
    }

    /**
     * Mencatat jurnal penerimaan pembayaran piutang customer (CustomerPayment):
     * - Debit  : 1101-CASH-BANK (Kas / Bank Masuk)
     * - Credit : 1102-AR        (Pelunasan / Pengurangan Piutang Usaha)
     *
     * @return Collection<int, GeneralLedger>
     */
    public function recordCustomerPaymentJournal(
        CustomerPayment $payment,
        SalesInvoice $invoice,
        User $actor,
        ?string $ipAddress = null
    ): Collection {
        $amount = $this->normalizeDecimal((string) $payment->amount_received, 2);
        $date = $payment->payment_date?->format('Y-m-d') ?? now()->toDateString();

        return $this->recordJournalEntry(
            transactionDate: $date,
            lines: [
                [
                    'account_code' => GeneralLedger::ACCOUNT_CASH_BANK,
                    'debit' => $amount,
                    'credit' => '0.00',
                    'description' => "Penerimaan Kas/Bank {$payment->receipt_number} untuk Sales Invoice {$invoice->invoice_number} via {$payment->payment_method}",
                ],
                [
                    'account_code' => GeneralLedger::ACCOUNT_AR,
                    'debit' => '0.00',
                    'credit' => $amount,
                    'description' => "Pelunasan Piutang Usaha (AR) {$payment->receipt_number} untuk Sales Invoice {$invoice->invoice_number} via {$payment->payment_method}",
                ],
            ],
            reference: $payment,
            actor: $actor,
            ipAddress: $ipAddress
        );
    }

    /**
     * Ringkasan Trial Balance (Neraca Saldo) berbasis BCMath.
     *
     * @return array<string, mixed>
     */
    public function getTrialBalance(?string $dateFrom = null, ?string $dateTo = null): array
    {
        $query = GeneralLedger::query()->orderBy('account_code')->orderBy('id');

        if ($dateFrom !== null && trim($dateFrom) !== '') {
            $query->whereDate('transaction_date', '>=', trim($dateFrom));
        }

        if ($dateTo !== null && trim($dateTo) !== '') {
            $query->whereDate('transaction_date', '<=', trim($dateTo));
        }

        $entries = $query->get(['account_code', 'debit', 'credit']);

        $grouped = [];
        $grandDebit = '0.00';
        $grandCredit = '0.00';

        foreach ($entries as $entry) {
            $code = $entry->account_code;
            $debit = $this->normalizeDecimal((string) $entry->debit, 2);
            $credit = $this->normalizeDecimal((string) $entry->credit, 2);

            if (! isset($grouped[$code])) {
                $grouped[$code] = [
                    'account_code' => $code,
                    'total_debit' => '0.00',
                    'total_credit' => '0.00',
                    'net_balance' => '0.00',
                ];
            }

            $grouped[$code]['total_debit'] = bcadd($grouped[$code]['total_debit'], $debit, 2);
            $grouped[$code]['total_credit'] = bcadd($grouped[$code]['total_credit'], $credit, 2);
            $grouped[$code]['net_balance'] = bcsub(
                $grouped[$code]['total_debit'],
                $grouped[$code]['total_credit'],
                2
            );

            $grandDebit = bcadd($grandDebit, $debit, 2);
            $grandCredit = bcadd($grandCredit, $credit, 2);
        }

        ksort($grouped);

        return [
            'date_from' => $dateFrom,
            'date_to' => $dateTo,
            'grand_total_debit' => $grandDebit,
            'grand_total_credit' => $grandCredit,
            'is_balanced' => bccomp($grandDebit, $grandCredit, 2) === 0,
            'accounts' => array_values($grouped),
        ];
    }

    /**
     * Menghitung total nilai moneter Goods Receipt secara presisi menggunakan BCMath.
     *
     * @param  array<int, array<string, mixed>>  $valuations
     */
    private function calculateGoodsReceiptTotalValue(GoodsReceipt $goodsReceipt, array $valuations): string
    {
        $totalHighPrecision = '0.0000';

        if ($valuations !== []) {
            foreach ($valuations as $valuation) {
                if (isset($valuation['qty_received'], $valuation['unit_cost'])) {
                    $lineValue = bcmul(
                        $this->normalizeDecimal((string) $valuation['qty_received'], 2),
                        $this->normalizeDecimal((string) $valuation['unit_cost'], 2),
                        4
                    );
                    $totalHighPrecision = bcadd($totalHighPrecision, $lineValue, 4);
                } elseif (isset($valuation['received_value'])) {
                    $totalHighPrecision = bcadd(
                        $totalHighPrecision,
                        $this->normalizeDecimal((string) $valuation['received_value'], 4),
                        4
                    );
                }
            }

            return $this->roundDecimal($totalHighPrecision, 2);
        }

        // Fallback jika valuations tidak disuplai: hitung dari GR items x harga satuan PO
        $poUnitPriceByProduct = [];

        if ($goodsReceipt->purchaseOrder !== null) {
            foreach ($goodsReceipt->purchaseOrder->items as $poItem) {
                $poUnitPriceByProduct[$poItem->product_id] = $this->normalizeDecimal((string) $poItem->unit_price, 2);
            }
        }

        foreach ($goodsReceipt->items as $grItem) {
            $unitPrice = $poUnitPriceByProduct[$grItem->product_id] ?? '0.00';
            $lineValue = bcmul(
                $this->normalizeDecimal((string) $grItem->qty_received, 2),
                $unitPrice,
                4
            );
            $totalHighPrecision = bcadd($totalHighPrecision, $lineValue, 4);
        }

        return $this->roundDecimal($totalHighPrecision, 2);
    }

    /**
     * Menghitung total HPP (COGS) Delivery Order secara presisi menggunakan BCMath.
     *
     * @param  array<int, array<string, mixed>>  $dispatches
     */
    private function calculateDeliveryOrderTotalCogs(DeliveryOrder $deliveryOrder, array $dispatches): string
    {
        $totalHighPrecision = '0.0000';

        if ($dispatches !== []) {
            foreach ($dispatches as $dispatch) {
                if (isset($dispatch['qty_dispatched'], $dispatch['unit_cost'])) {
                    $lineValue = bcmul(
                        $this->normalizeDecimal((string) $dispatch['qty_dispatched'], 2),
                        $this->normalizeDecimal((string) $dispatch['unit_cost'], 2),
                        4
                    );
                    $totalHighPrecision = bcadd($totalHighPrecision, $lineValue, 4);
                } elseif (isset($dispatch['cogs_value'])) {
                    $totalHighPrecision = bcadd(
                        $totalHighPrecision,
                        $this->normalizeDecimal((string) $dispatch['cogs_value'], 4),
                        4
                    );
                }
            }

            return $this->roundDecimal($totalHighPrecision, 2);
        }

        foreach ($deliveryOrder->items as $doItem) {
            $lineValue = bcmul(
                $this->normalizeDecimal((string) $doItem->qty_dispatched, 2),
                $this->normalizeDecimal((string) $doItem->unit_cost, 2),
                4
            );
            $totalHighPrecision = bcadd($totalHighPrecision, $lineValue, 4);
        }

        return $this->roundDecimal($totalHighPrecision, 2);
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
