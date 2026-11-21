<?php

namespace App\Services\Sales;

use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\DeliveryOrder;
use App\Models\Product;
use App\Models\SalesInvoice;
use App\Models\SalesOrder;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SalesOrderService
{
    /**
     * Membuat Sales Order berstatus Draft dalam DB::transaction().
     * Menyimpan unit_price sebagai pricing snapshot di sales_order_items dengan presisi BCMath.
     *
     * @param  array<string, mixed>  $data
     */
    public function createSalesOrder(array $data, User $actor, ?string $ipAddress = null): SalesOrder
    {
        return DB::transaction(function () use ($data, $actor, $ipAddress): SalesOrder {
            $customer = Customer::query()->findOrFail((int) $data['customer_id']);

            if ($customer->status !== 'active') {
                throw ValidationException::withMessages([
                    'customer_id' => ['Customer yang dipilih tidak berstatus aktif.'],
                ]);
            }

            $items = $data['items'] ?? [];
            if ($items === []) {
                throw ValidationException::withMessages([
                    'items' => ['Minimal 1 item produk wajib disertakan dalam Sales Order.'],
                ]);
            }

            $productIds = array_values(array_unique(array_map(
                static fn (array $item): int => (int) $item['product_id'],
                $items
            )));

            $products = Product::query()
                ->whereIn('id', $productIds)
                ->get()
                ->keyBy('id');

            $totalAmount = '0.00';
            $preparedItems = [];

            foreach ($items as $index => $item) {
                $productId = (int) $item['product_id'];
                $product = $products->get($productId);

                if ($product === null || ! $product->is_active) {
                    throw ValidationException::withMessages([
                        "items.{$index}.product_id" => ['Produk tidak ditemukan atau tidak aktif.'],
                    ]);
                }

                $qtyOrdered = $this->normalizeDecimal((string) $item['qty_ordered'], 2);
                $unitPrice = $this->normalizeDecimal((string) $item['unit_price'], 2);

                if (bccomp($qtyOrdered, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        "items.{$index}.qty_ordered" => ['Kuantitas pemesanan harus lebih dari 0.'],
                    ]);
                }

                if (bccomp($unitPrice, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        "items.{$index}.unit_price" => ['Harga satuan jual (unit_price) harus lebih dari 0.'],
                    ]);
                }

                $lineTotalHigh = bcmul($qtyOrdered, $unitPrice, 4);
                $lineTotal = $this->roundDecimal($lineTotalHigh, 2);
                $totalAmount = bcadd($totalAmount, $lineTotal, 2);

                $preparedItems[] = [
                    'product_id' => $productId,
                    'qty_ordered' => $qtyOrdered,
                    'unit_price' => $unitPrice,
                    'line_total' => $lineTotal,
                ];
            }

            $soNumber = ! empty($data['so_number'])
                ? trim((string) $data['so_number'])
                : $this->generateSoNumber();

            $salesOrder = SalesOrder::create([
                'so_number' => $soNumber,
                'customer_id' => $customer->id,
                'salesperson_id' => $actor->id,
                'order_date' => $data['order_date'] ?? now()->toDateString(),
                'total_amount' => $totalAmount,
                'status' => SalesOrder::STATUS_DRAFT,
            ]);

            $salesOrder->items()->createMany($preparedItems);
            $salesOrder->load(['customer', 'salesperson', 'items.product']);

            $this->recordAuditLog(
                actor: $actor,
                action: 'sales_order.created',
                modelType: SalesOrder::class,
                modelId: $salesOrder->id,
                oldPayload: null,
                newPayload: array_merge($this->salesOrderPayload($salesOrder), [
                    'items_count' => $salesOrder->items->count(),
                ]),
                ipAddress: $ipAddress
            );

            return $salesOrder;
        });
    }

    /**
     * Mengonfirmasi Sales Order (Draft -> Confirmed) dalam DB::transaction() + lockForUpdate().
     * Memvalidasi Credit Limit secara ketat menggunakan BCMath:
     * (Total Piutang Belum Lunas Customer + Total SO Baru) <= customer.credit_limit.
     * Menolak dengan HTTP 422 jika melebihi limit (kecuali override eksplisit oleh role berizin customers.override_credit_limit).
     */
    public function confirmSalesOrder(
        SalesOrder $salesOrder,
        User $actor,
        bool $overrideCreditLimit = false,
        ?string $overrideReason = null,
        ?string $ipAddress = null
    ): SalesOrder {
        return DB::transaction(function () use (
            $salesOrder,
            $actor,
            $overrideCreditLimit,
            $overrideReason,
            $ipAddress
        ): SalesOrder {
            // 1. Lock Sales Order
            $lockedSo = SalesOrder::query()
                ->with(['items.product', 'salesperson'])
                ->lockForUpdate()
                ->findOrFail($salesOrder->id);

            if ($lockedSo->status !== SalesOrder::STATUS_DRAFT) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Sales Order berstatus Draft yang dapat dikonfirmasi.'],
                ]);
            }

            if ($lockedSo->items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => ['Sales Order tidak memiliki item untuk dikonfirmasi.'],
                ]);
            }

            // 2. Lock Customer untuk mencegah race condition pengecekan Credit Limit
            $lockedCustomer = Customer::query()
                ->lockForUpdate()
                ->findOrFail($lockedSo->customer_id);

            if ($lockedCustomer->status !== 'active') {
                throw ValidationException::withMessages([
                    'customer_id' => ['Customer tidak berstatus aktif sehingga Sales Order tidak dapat dikonfirmasi.'],
                ]);
            }

            // 3. Lock seluruh SalesInvoice belum lunas milik customer beserta pembayarannya
            $unpaidInvoices = SalesInvoice::query()
                ->where('customer_id', $lockedCustomer->id)
                ->whereIn('status', [
                    SalesInvoice::STATUS_UNPAID,
                    SalesInvoice::STATUS_PARTIALLY_PAID,
                ])
                ->orderBy('id')
                ->lockForUpdate()
                ->get(['id', 'total_billed']);

            $paidByInvoice = [];
            $invoiceIds = $unpaidInvoices->pluck('id')->all();

            if ($invoiceIds !== []) {
                $payments = CustomerPayment::query()
                    ->whereIn('sales_invoice_id', $invoiceIds)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get(['sales_invoice_id', 'amount_received']);

                foreach ($payments as $payment) {
                    $invId = $payment->sales_invoice_id;
                    $paidByInvoice[$invId] = bcadd(
                        $paidByInvoice[$invId] ?? '0.00',
                        (string) $payment->amount_received,
                        2
                    );
                }
            }

            $outstandingReceivables = '0.00';
            foreach ($unpaidInvoices as $invoice) {
                $billed = $this->normalizeDecimal((string) $invoice->total_billed, 2);
                $paid = $paidByInvoice[$invoice->id] ?? '0.00';
                $remaining = bcsub($billed, $paid, 2);

                if (bccomp($remaining, '0.00', 2) > 0) {
                    $outstandingReceivables = bcadd($outstandingReceivables, $remaining, 2);
                }
            }

            $newSoTotal = $this->normalizeDecimal((string) $lockedSo->total_amount, 2);
            $projectedExposure = bcadd($outstandingReceivables, $newSoTotal, 2);
            $creditLimit = $this->normalizeDecimal((string) $lockedCustomer->credit_limit, 2);

            $creditLimitExceeded = bccomp($projectedExposure, $creditLimit, 2) > 0;
            $creditLimitOverridden = false;

            if ($creditLimitExceeded) {
                if ($overrideCreditLimit) {
                    if (! $actor->can('customers.override_credit_limit')) {
                        throw new AuthorizationException(
                            'Anda tidak memiliki izin untuk melakukan override credit limit customer.'
                        );
                    }

                    $creditLimitOverridden = true;
                } else {
                    throw ValidationException::withMessages([
                        'credit_limit' => [
                            "Konfirmasi Sales Order ditolak: Total piutang belum lunas ({$outstandingReceivables}) + Total SO baru ({$newSoTotal}) = {$projectedExposure} melebihi batas kredit customer ({$creditLimit}).",
                        ],
                    ]);
                }
            }

            $oldPayload = $this->salesOrderPayload($lockedSo);

            $lockedSo->update([
                'status' => SalesOrder::STATUS_CONFIRMED,
            ]);

            $newPayload = array_merge($this->salesOrderPayload($lockedSo), [
                'outstanding_receivables' => $outstandingReceivables,
                'projected_exposure' => $projectedExposure,
                'credit_limit' => $creditLimit,
                'credit_limit_overridden' => $creditLimitOverridden,
            ]);

            if ($creditLimitOverridden && $overrideReason !== null && trim($overrideReason) !== '') {
                $newPayload['override_reason'] = trim($overrideReason);
            }

            $this->recordAuditLog(
                actor: $actor,
                action: 'sales_order.confirmed',
                modelType: SalesOrder::class,
                modelId: $lockedSo->id,
                oldPayload: $oldPayload,
                newPayload: $newPayload,
                ipAddress: $ipAddress
            );

            return $lockedSo->fresh([
                'customer',
                'salesperson',
                'items.product',
                'deliveryOrders',
                'salesInvoices',
            ]);
        });
    }

    /**
     * Membatalkan Sales Order yang masih Draft atau Confirmed (belum memiliki DO aktif atau Sales Invoice).
     */
    public function cancelSalesOrder(
        SalesOrder $salesOrder,
        User $actor,
        ?string $reason = null,
        ?string $ipAddress = null
    ): SalesOrder {
        return DB::transaction(function () use ($salesOrder, $actor, $reason, $ipAddress): SalesOrder {
            $lockedSo = SalesOrder::query()
                ->lockForUpdate()
                ->findOrFail($salesOrder->id);

            if (! in_array($lockedSo->status, [
                SalesOrder::STATUS_DRAFT,
                SalesOrder::STATUS_CONFIRMED,
            ], true)) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Sales Order berstatus Draft atau Confirmed yang dapat dibatalkan.'],
                ]);
            }

            $hasActiveDeliveryOrder = DeliveryOrder::query()
                ->where('sales_order_id', $lockedSo->id)
                ->where('status', '!=', DeliveryOrder::STATUS_CANCELLED)
                ->lockForUpdate()
                ->exists();

            if ($hasActiveDeliveryOrder) {
                throw ValidationException::withMessages([
                    'status' => ['Sales Order tidak dapat dibatalkan karena sudah memiliki Delivery Order aktif.'],
                ]);
            }

            $hasActiveInvoice = SalesInvoice::query()
                ->where('sales_order_id', $lockedSo->id)
                ->lockForUpdate()
                ->exists();

            if ($hasActiveInvoice) {
                throw ValidationException::withMessages([
                    'status' => ['Sales Order tidak dapat dibatalkan karena sudah memiliki Sales Invoice aktif.'],
                ]);
            }

            $oldPayload = $this->salesOrderPayload($lockedSo);

            $lockedSo->update([
                'status' => SalesOrder::STATUS_CANCELLED,
            ]);

            $newPayload = $this->salesOrderPayload($lockedSo);
            if ($reason !== null && trim($reason) !== '') {
                $newPayload['reason'] = trim($reason);
            }

            $this->recordAuditLog(
                actor: $actor,
                action: 'sales_order.cancelled',
                modelType: SalesOrder::class,
                modelId: $lockedSo->id,
                oldPayload: $oldPayload,
                newPayload: $newPayload,
                ipAddress: $ipAddress
            );

            return $lockedSo->fresh(['customer', 'salesperson', 'items.product']);
        });
    }

    /**
     * Menghapus (SoftDelete) Sales Order yang masih Draft atau Cancelled.
     */
    public function deleteSalesOrder(
        SalesOrder $salesOrder,
        User $actor,
        ?string $ipAddress = null
    ): void {
        DB::transaction(function () use ($salesOrder, $actor, $ipAddress): void {
            $lockedSo = SalesOrder::query()
                ->lockForUpdate()
                ->findOrFail($salesOrder->id);

            if (! in_array($lockedSo->status, [
                SalesOrder::STATUS_DRAFT,
                SalesOrder::STATUS_CANCELLED,
            ], true)) {
                throw ValidationException::withMessages([
                    'status' => ['Sales Order yang sudah dikonfirmasi atau diproses tidak dapat dihapus.'],
                ]);
            }

            $oldPayload = $this->salesOrderPayload($lockedSo);

            $lockedSo->items()->delete();
            $lockedSo->delete();

            $this->recordAuditLog(
                actor: $actor,
                action: 'sales_order.deleted',
                modelType: SalesOrder::class,
                modelId: $lockedSo->id,
                oldPayload: $oldPayload,
                newPayload: null,
                ipAddress: $ipAddress
            );
        });
    }

    private function generateSoNumber(): string
    {
        $prefix = 'SO-' . now()->format('Ym') . '-';

        $latestNumber = SalesOrder::withTrashed()
            ->where('so_number', 'like', $prefix . '%')
            ->orderByDesc('so_number')
            ->value('so_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (SalesOrder::withTrashed()->where('so_number', $candidate)->exists());

        return $candidate;
    }

    /**
     * @return array<string, mixed>
     */
    private function salesOrderPayload(SalesOrder $so): array
    {
        return [
            'id' => $so->id,
            'so_number' => $so->so_number,
            'customer_id' => $so->customer_id,
            'salesperson_id' => $so->salesperson_id,
            'order_date' => $so->order_date?->format('Y-m-d'),
            'total_amount' => (string) $so->total_amount,
            'status' => $so->status,
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
