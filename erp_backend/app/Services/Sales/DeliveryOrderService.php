<?php

namespace App\Services\Sales;

use App\Events\DeliveryOrderDispatched;
use App\Models\AuditLog;
use App\Models\DeliveryOrder;
use App\Models\DeliveryOrderItem;
use App\Models\InventoryLedger;
use App\Models\Product;
use App\Models\SalesOrder;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class DeliveryOrderService
{
    /**
     * Membuat Delivery Order berstatus Draft dari Sales Order berstatus Confirmed atau Partially Delivered.
     * Memvalidasi sisa kuantitas SO dan ketersediaan stok FEFO (anti-overselling) dengan lockForUpdate(),
     * serta menyiapkan alokasi batch FEFO & snapshot HPP MWA (unit_cost) tanpa memotong stok sebelum Dispatched.
     *
     * @param  array<string, mixed>  $data
     */
    public function createDeliveryOrder(array $data, User $actor, ?string $ipAddress = null): DeliveryOrder
    {
        return DB::transaction(function () use ($data, $actor, $ipAddress): DeliveryOrder {
            $lockedSo = SalesOrder::query()
                ->with(['items.product', 'customer'])
                ->lockForUpdate()
                ->findOrFail((int) $data['sales_order_id']);

            $this->assertSalesOrderDeliverable($lockedSo);

            $orderedByProduct = $this->aggregateOrderedQtyByProduct($lockedSo);
            $alreadyDispatchedByProduct = $this->aggregateDispatchedQtyByProduct($lockedSo->id);

            $items = $data['items'] ?? [];
            if ($items === []) {
                throw ValidationException::withMessages([
                    'items' => ['Minimal 1 item pengiriman wajib disertakan dalam Delivery Order.'],
                ]);
            }

            $requestedByProduct = [];
            $firstIndexByProduct = [];

            foreach ($items as $index => $item) {
                $productId = (int) $item['product_id'];
                $qtyDispatched = $this->normalizeDecimal((string) $item['qty_dispatched'], 2);

                if (! isset($orderedByProduct[$productId])) {
                    throw ValidationException::withMessages([
                        "items.{$index}.product_id" => ['Produk tidak terdaftar pada Sales Order yang dipilih.'],
                    ]);
                }

                if (bccomp($qtyDispatched, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        "items.{$index}.qty_dispatched" => ['Kuantitas pengiriman harus lebih dari 0.'],
                    ]);
                }

                $firstIndexByProduct[$productId] ??= $index;
                $requestedByProduct[$productId] = bcadd(
                    $requestedByProduct[$productId] ?? '0.00',
                    $qtyDispatched,
                    2
                );

                $alreadyDispatched = $alreadyDispatchedByProduct[$productId] ?? '0.00';
                $projectedTotal = bcadd($alreadyDispatched, $requestedByProduct[$productId], 2);

                if (bccomp($projectedTotal, $orderedByProduct[$productId], 2) > 0) {
                    $remaining = bcsub($orderedByProduct[$productId], $alreadyDispatched, 2);

                    throw ValidationException::withMessages([
                        "items.{$index}.qty_dispatched" => [
                            "Kuantitas pengiriman ({$requestedByProduct[$productId]}) melebihi sisa pesanan SO (sisa yang belum dikirim: {$remaining}).",
                        ],
                    ]);
                }
            }

            // Urutkan product_id ascending agar lock order deterministik (mencegah deadlock)
            ksort($requestedByProduct);

            $preparedItems = [];

            foreach ($requestedByProduct as $productId => $requestedQty) {
                $product = Product::query()->lockForUpdate()->findOrFail($productId);
                $availableLedgers = $this->lockAvailableFefoLedgers($productId);

                $allocations = $this->buildFefoAllocations(
                    product: $product,
                    availableLedgers: $availableLedgers,
                    requestedQty: $requestedQty,
                    errorKey: 'items.' . $firstIndexByProduct[$productId] . '.qty_dispatched'
                );

                foreach ($allocations as $allocation) {
                    $preparedItems[] = [
                        'product_id' => $productId,
                        'product_batch_id' => $allocation['ledger']->product_batch_id,
                        'qty_dispatched' => $allocation['qty'],
                        'unit_cost' => $allocation['unit_cost'],
                    ];
                }
            }

            $doNumber = ! empty($data['do_number'])
                ? trim((string) $data['do_number'])
                : $this->generateDoNumber();

            $deliveryOrder = DeliveryOrder::create([
                'do_number' => $doNumber,
                'sales_order_id' => $lockedSo->id,
                'delivery_date' => $data['delivery_date'] ?? now()->toDateString(),
                'status' => DeliveryOrder::STATUS_DRAFT,
            ]);

            $deliveryOrder->items()->createMany($preparedItems);
            $deliveryOrder->load([
                'salesOrder.customer',
                'items.product',
                'items.productBatch',
            ]);

            $this->recordAuditLog(
                actor: $actor,
                action: 'delivery_order.created',
                modelType: DeliveryOrder::class,
                modelId: $deliveryOrder->id,
                oldPayload: null,
                newPayload: array_merge($this->deliveryOrderPayload($deliveryOrder), [
                    'items_count' => $deliveryOrder->items->count(),
                ]),
                ipAddress: $ipAddress
            );

            return $deliveryOrder;
        });
    }

    /**
     * Memvalidasi & mengirim Delivery Order (Draft -> Dispatched) dalam DB::transaction() + lockForUpdate():
     * - Mengalokasikan stok secara otomatis dari product_batches berstatus available berdasarkan expiry_date terdekat (FEFO).
     * - Menolak dengan HTTP 422 jika stok available tidak mencukupi (anti-overselling).
     * - Menyimpan snapshot HPP MWA saat ini (unit_cost) pada delivery_order_items.
     * - Mengurangi qty di inventory_ledgers (state: available) & mencatat mutasi OUT di immutable stock_movements.
     * - Memperbarui status SalesOrder secara otomatis (Partially Delivered / Completed).
     * - Memicu event DeliveryOrderDispatched untuk jurnal otomatis COGS (Debit 5101-COGS / Credit 1201-INVENTORY).
     */
    public function dispatchDeliveryOrder(
        DeliveryOrder $deliveryOrder,
        User $actor,
        ?string $ipAddress = null
    ): DeliveryOrder {
        return DB::transaction(function () use ($deliveryOrder, $actor, $ipAddress): DeliveryOrder {
            $lockedDo = DeliveryOrder::query()
                ->with(['items.product', 'items.productBatch'])
                ->lockForUpdate()
                ->findOrFail($deliveryOrder->id);

            if ($lockedDo->status !== DeliveryOrder::STATUS_DRAFT) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Delivery Order berstatus Draft yang dapat di-dispatch.'],
                ]);
            }

            if ($lockedDo->items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => ['Delivery Order tidak memiliki item untuk di-dispatch.'],
                ]);
            }

            $lockedSo = SalesOrder::query()
                ->with(['items.product', 'customer'])
                ->lockForUpdate()
                ->findOrFail($lockedDo->sales_order_id);

            $this->assertSalesOrderDeliverable($lockedSo);

            $orderedByProduct = $this->aggregateOrderedQtyByProduct($lockedSo);
            $alreadyDispatchedByProduct = $this->aggregateDispatchedQtyByProduct($lockedSo->id);

            // Agregasi total kuantitas per produk dari item Draft DO
            $requestedByProduct = [];
            foreach ($lockedDo->items as $doItem) {
                $productId = $doItem->product_id;
                $qty = $this->normalizeDecimal((string) $doItem->qty_dispatched, 2);

                if (! isset($orderedByProduct[$productId])) {
                    throw ValidationException::withMessages([
                        'items' => ['Terdapat produk pada Delivery Order yang tidak terdaftar pada Sales Order.'],
                    ]);
                }

                if (bccomp($qty, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        'items' => ['Kuantitas pengiriman harus lebih dari 0.'],
                    ]);
                }

                $requestedByProduct[$productId] = bcadd(
                    $requestedByProduct[$productId] ?? '0.00',
                    $qty,
                    2
                );
            }

            // Re-validasi terhadap sisa pesanan SO (mencegah over-delivery saat concurrent dispatch)
            foreach ($requestedByProduct as $productId => $requestedQty) {
                $alreadyDispatched = $alreadyDispatchedByProduct[$productId] ?? '0.00';
                $projectedTotal = bcadd($alreadyDispatched, $requestedQty, 2);

                if (bccomp($projectedTotal, $orderedByProduct[$productId], 2) > 0) {
                    $remaining = bcsub($orderedByProduct[$productId], $alreadyDispatched, 2);

                    throw ValidationException::withMessages([
                        'items' => [
                            "Kuantitas pengiriman ({$requestedQty}) melebihi sisa pesanan SO untuk product_id {$productId} (sisa: {$remaining}).",
                        ],
                    ]);
                }
            }

            ksort($requestedByProduct);

            $oldDoPayload = $this->deliveryOrderPayload($lockedDo);
            $oldSoPayload = $this->salesOrderPayload($lockedSo);

            $finalItems = [];
            $dispatches = [];
            $totalCogsHighPrecision = '0.0000';

            foreach ($requestedByProduct as $productId => $requestedQty) {
                $product = Product::query()->lockForUpdate()->findOrFail($productId);
                $availableLedgers = $this->lockAvailableFefoLedgers($productId);

                $allocations = $this->buildFefoAllocations(
                    product: $product,
                    availableLedgers: $availableLedgers,
                    requestedQty: $requestedQty,
                    errorKey: 'items'
                );

                foreach ($allocations as $allocation) {
                    /** @var InventoryLedger $ledger */
                    $ledger = $allocation['ledger'];
                    $pickQty = $allocation['qty'];
                    $unitCost = $allocation['unit_cost'];

                    $newBatchQty = bcsub((string) $ledger->qty, $pickQty, 2);
                    $ledger->update([
                        'qty' => $newBatchQty,
                    ]);

                    // Catat mutasi OUT di immutable stock_movements
                    $movement = StockMovement::create([
                        'product_batch_id' => $ledger->product_batch_id,
                        'type' => StockMovement::TYPE_OUT,
                        'qty_change' => '-' . $pickQty,
                        'reference_type' => $lockedDo->getMorphClass(),
                        'reference_id' => $lockedDo->id,
                        'user_id' => $actor->id,
                    ]);

                    $lineCogsHigh = bcmul($pickQty, $unitCost, 4);
                    $totalCogsHighPrecision = bcadd($totalCogsHighPrecision, $lineCogsHigh, 4);

                    $finalItems[] = [
                        'product_id' => $productId,
                        'product_batch_id' => $ledger->product_batch_id,
                        'qty_dispatched' => $pickQty,
                        'unit_cost' => $unitCost,
                    ];

                    $dispatches[] = [
                        'product_id' => $productId,
                        'product_batch_id' => $ledger->product_batch_id,
                        'inventory_ledger_id' => $ledger->id,
                        'stock_movement_id' => $movement->id,
                        'qty_dispatched' => $pickQty,
                        'unit_cost' => $unitCost,
                        'cogs_value' => $this->roundDecimal($lineCogsHigh, 2),
                    ];
                }
            }

            // Sinkronkan alokasi batch FEFO final + snapshot unit_cost MWA ke delivery_order_items
            $lockedDo->items()->forceDelete();
            $lockedDo->items()->createMany($finalItems);

            $lockedDo->update([
                'status' => DeliveryOrder::STATUS_DISPATCHED,
            ]);

            // Tentukan status SO terbaru: Completed jika seluruh item SO sudah terkirim penuh, selain itu Partially Delivered
            $isAllCompleted = true;
            foreach ($orderedByProduct as $productId => $qtyOrdered) {
                $totalDispatchedForProduct = bcadd(
                    $alreadyDispatchedByProduct[$productId] ?? '0.00',
                    $requestedByProduct[$productId] ?? '0.00',
                    2
                );

                if (bccomp($totalDispatchedForProduct, $qtyOrdered, 2) < 0) {
                    $isAllCompleted = false;
                    break;
                }
            }

            $newSoStatus = $isAllCompleted
                ? SalesOrder::STATUS_COMPLETED
                : SalesOrder::STATUS_PARTIALLY_DELIVERED;

            if ($lockedSo->status !== $newSoStatus) {
                $lockedSo->update([
                    'status' => $newSoStatus,
                ]);

                $this->recordAuditLog(
                    actor: $actor,
                    action: 'sales_order.delivery_status_updated',
                    modelType: SalesOrder::class,
                    modelId: $lockedSo->id,
                    oldPayload: $oldSoPayload,
                    newPayload: array_merge($this->salesOrderPayload($lockedSo), [
                        'delivery_order_id' => $lockedDo->id,
                        'do_number' => $lockedDo->do_number,
                    ]),
                    ipAddress: $ipAddress
                );
            }

            $this->recordAuditLog(
                actor: $actor,
                action: 'delivery_order.dispatched',
                modelType: DeliveryOrder::class,
                modelId: $lockedDo->id,
                oldPayload: $oldDoPayload,
                newPayload: array_merge($this->deliveryOrderPayload($lockedDo), [
                    'so_status' => $newSoStatus,
                    'total_cogs' => $this->roundDecimal($totalCogsHighPrecision, 2),
                    'dispatches' => $dispatches,
                ]),
                ipAddress: $ipAddress
            );

            $dispatchedDo = $lockedDo->fresh([
                'salesOrder.customer',
                'items.product',
                'items.productBatch',
            ]);

            DB::afterCommit(static function () use ($dispatchedDo, $dispatches, $actor): void {
                DeliveryOrderDispatched::dispatch($dispatchedDo, $dispatches, $actor);
            });

            return $dispatchedDo;
        });
    }

    /**
     * Menandai Delivery Order telah diterima oleh customer (Dispatched -> Delivered).
     */
    public function markDelivered(
        DeliveryOrder $deliveryOrder,
        User $actor,
        ?string $ipAddress = null
    ): DeliveryOrder {
        return DB::transaction(function () use ($deliveryOrder, $actor, $ipAddress): DeliveryOrder {
            $lockedDo = DeliveryOrder::query()
                ->lockForUpdate()
                ->findOrFail($deliveryOrder->id);

            if ($lockedDo->status !== DeliveryOrder::STATUS_DISPATCHED) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Delivery Order berstatus Dispatched yang dapat ditandai Delivered.'],
                ]);
            }

            $oldPayload = $this->deliveryOrderPayload($lockedDo);

            $lockedDo->update([
                'status' => DeliveryOrder::STATUS_DELIVERED,
            ]);

            $this->recordAuditLog(
                actor: $actor,
                action: 'delivery_order.delivered',
                modelType: DeliveryOrder::class,
                modelId: $lockedDo->id,
                oldPayload: $oldPayload,
                newPayload: $this->deliveryOrderPayload($lockedDo),
                ipAddress: $ipAddress
            );

            return $lockedDo->fresh([
                'salesOrder.customer',
                'items.product',
                'items.productBatch',
            ]);
        });
    }

    /**
     * Menghapus (SoftDelete) Delivery Order yang masih Draft atau Cancelled.
     * Delivery Order yang sudah Dispatched/Delivered bersifat immutable dan tidak dapat dihapus.
     */
    public function deleteDeliveryOrder(
        DeliveryOrder $deliveryOrder,
        User $actor,
        ?string $ipAddress = null
    ): void {
        DB::transaction(function () use ($deliveryOrder, $actor, $ipAddress): void {
            $lockedDo = DeliveryOrder::query()
                ->lockForUpdate()
                ->findOrFail($deliveryOrder->id);

            if (! in_array($lockedDo->status, [
                DeliveryOrder::STATUS_DRAFT,
                DeliveryOrder::STATUS_CANCELLED,
            ], true)) {
                throw ValidationException::withMessages([
                    'status' => ['Delivery Order yang sudah di-dispatch atau dikirim tidak dapat dihapus.'],
                ]);
            }

            $oldPayload = $this->deliveryOrderPayload($lockedDo);

            $lockedDo->items()->delete();
            $lockedDo->delete();

            $this->recordAuditLog(
                actor: $actor,
                action: 'delivery_order.deleted',
                modelType: DeliveryOrder::class,
                modelId: $lockedDo->id,
                oldPayload: $oldPayload,
                newPayload: null,
                ipAddress: $ipAddress
            );
        });
    }

    private function assertSalesOrderDeliverable(SalesOrder $salesOrder): void
    {
        if (! in_array($salesOrder->status, [
            SalesOrder::STATUS_CONFIRMED,
            SalesOrder::STATUS_PARTIALLY_DELIVERED,
        ], true)) {
            throw ValidationException::withMessages([
                'sales_order_id' => [
                    'Delivery Order hanya dapat diproses untuk Sales Order berstatus Confirmed atau Partially Delivered.',
                ],
            ]);
        }
    }

    /**
     * Mengunci seluruh ledger available non-expired milik produk berdasarkan urutan FEFO (expiry_date terdekat).
     *
     * @return Collection<int, InventoryLedger>
     */
    private function lockAvailableFefoLedgers(int $productId): Collection
    {
        $today = Carbon::today()->toDateString();

        return InventoryLedger::query()
            ->select('inventory_ledgers.*')
            ->join('product_batches', 'product_batches.id', '=', 'inventory_ledgers.product_batch_id')
            ->where('product_batches.product_id', $productId)
            ->whereNull('product_batches.deleted_at')
            ->where('inventory_ledgers.state', InventoryLedger::STATE_AVAILABLE)
            ->where('inventory_ledgers.qty', '>', 0)
            ->where(function ($query) use ($today): void {
                $query->whereNull('product_batches.expiry_date')
                    ->orWhereDate('product_batches.expiry_date', '>=', $today);
            })
            ->orderByRaw('CASE WHEN product_batches.expiry_date IS NULL THEN 1 ELSE 0 END ASC')
            ->orderBy('product_batches.expiry_date', 'asc')
            ->orderBy('product_batches.id', 'asc')
            ->lockForUpdate()
            ->get();
    }

    /**
     * Menyusun alokasi batch FEFO dan menolak dengan 422 jika stok available tidak mencukupi (anti-overselling).
     *
     * @param  Collection<int, InventoryLedger>  $availableLedgers
     * @return array<int, array{ledger: InventoryLedger, qty: string, unit_cost: string}>
     */
    private function buildFefoAllocations(
        Product $product,
        Collection $availableLedgers,
        string $requestedQty,
        string $errorKey
    ): array {
        $totalAvailable = '0.00';

        foreach ($availableLedgers as $ledger) {
            $totalAvailable = bcadd($totalAvailable, $this->normalizeDecimal((string) $ledger->qty, 2), 2);
        }

        if (bccomp($totalAvailable, $requestedQty, 2) < 0) {
            throw ValidationException::withMessages([
                $errorKey => [
                    "Stok available tidak mencukupi (anti-overselling) untuk produk {$product->sku} ({$product->name}): diminta {$requestedQty}, tersedia {$totalAvailable}.",
                ],
            ]);
        }

        $remainingToAllocate = $requestedQty;
        $allocations = [];

        foreach ($availableLedgers as $ledger) {
            if (bccomp($remainingToAllocate, '0.00', 2) <= 0) {
                break;
            }

            $batchAvailable = $this->normalizeDecimal((string) $ledger->qty, 2);
            if (bccomp($batchAvailable, '0.00', 2) <= 0) {
                continue;
            }

            $pickQty = bccomp($batchAvailable, $remainingToAllocate, 2) >= 0
                ? $remainingToAllocate
                : $batchAvailable;

            $allocations[] = [
                'ledger' => $ledger,
                'qty' => $pickQty,
                'unit_cost' => $this->normalizeDecimal((string) $ledger->cost_price, 2),
            ];

            $remainingToAllocate = bcsub($remainingToAllocate, $pickQty, 2);
        }

        return $allocations;
    }

    /**
     * @return array<int, string>
     */
    private function aggregateOrderedQtyByProduct(SalesOrder $salesOrder): array
    {
        $ordered = [];

        foreach ($salesOrder->items as $soItem) {
            $productId = $soItem->product_id;
            $ordered[$productId] = bcadd(
                $ordered[$productId] ?? '0.00',
                (string) $soItem->qty_ordered,
                2
            );
        }

        return $ordered;
    }

    /**
     * @return array<int, string>
     */
    private function aggregateDispatchedQtyByProduct(int $salesOrderId): array
    {
        $dispatchedDoIds = DeliveryOrder::query()
            ->where('sales_order_id', $salesOrderId)
            ->whereIn('status', [
                DeliveryOrder::STATUS_DISPATCHED,
                DeliveryOrder::STATUS_DELIVERED,
            ])
            ->orderBy('id')
            ->lockForUpdate()
            ->pluck('id');

        if ($dispatchedDoIds->isEmpty()) {
            return [];
        }

        $items = DeliveryOrderItem::query()
            ->whereIn('delivery_order_id', $dispatchedDoIds->all())
            ->get(['product_id', 'qty_dispatched']);

        $dispatched = [];

        foreach ($items as $item) {
            $productId = $item->product_id;
            $dispatched[$productId] = bcadd(
                $dispatched[$productId] ?? '0.00',
                (string) $item->qty_dispatched,
                2
            );
        }

        return $dispatched;
    }

    private function generateDoNumber(): string
    {
        $prefix = 'DO-' . now()->format('Ym') . '-';

        $latestNumber = DeliveryOrder::withTrashed()
            ->where('do_number', 'like', $prefix . '%')
            ->orderByDesc('do_number')
            ->value('do_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (DeliveryOrder::withTrashed()->where('do_number', $candidate)->exists());

        return $candidate;
    }

    /**
     * @return array<string, mixed>
     */
    private function deliveryOrderPayload(DeliveryOrder $do): array
    {
        return [
            'id' => $do->id,
            'do_number' => $do->do_number,
            'sales_order_id' => $do->sales_order_id,
            'delivery_date' => $do->delivery_date?->format('Y-m-d'),
            'status' => $do->status,
        ];
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
