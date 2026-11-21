<?php

namespace App\Services\Inventory;

use App\Models\AuditLog;
use App\Models\InventoryLedger;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryService
{
    public const DEFAULT_QUARANTINE_DAYS = 30;

    /**
     * Menghitung Moving Weighted Average (MWA) secara presisi dengan BCMath:
     * (Total Nilai Stok Lama + Total Nilai Stok Baru) / (Total Qty Lama + Total Qty Baru)
     */
    public function calculateMovingWeightedAverage(
        string $oldTotalValue,
        string $oldTotalQty,
        string $newTotalValue,
        string $newTotalQty
    ): string {
        $combinedQty = bcadd(
            $this->normalizeDecimal($oldTotalQty, 2),
            $this->normalizeDecimal($newTotalQty, 2),
            2
        );

        if (bccomp($combinedQty, '0.00', 2) <= 0) {
            throw ValidationException::withMessages([
                'qty' => ['Total kuantitas stok harus lebih dari 0 untuk kalkulasi Moving Weighted Average.'],
            ]);
        }

        $combinedValue = bcadd(
            $this->normalizeDecimal($oldTotalValue, 4),
            $this->normalizeDecimal($newTotalValue, 4),
            4
        );

        $rawMwa = bcdiv($combinedValue, $combinedQty, 6);

        return $this->roundDecimal($rawMwa, 2);
    }

    /**
     * Mencatat penerimaan stok masuk (IN) ke state available dalam DB::transaction() + lockForUpdate(),
     * menghitung ulang Moving Weighted Average (MWA) produk menggunakan BCMath,
     * serta mencatat entri immutable di stock_movements.
     *
     * @return array<string, mixed>
     */
    public function receiveStock(
        ProductBatch $batch,
        string $qtyReceived,
        string $unitCost,
        Model $reference,
        User $actor
    ): array {
        $normalizedQty = $this->normalizeDecimal($qtyReceived, 2);
        $normalizedUnitCost = $this->normalizeDecimal($unitCost, 2);

        if (bccomp($normalizedQty, '0.00', 2) <= 0) {
            throw ValidationException::withMessages([
                'qty_received' => ['Kuantitas stok masuk harus lebih dari 0.'],
            ]);
        }

        if (bccomp($normalizedUnitCost, '0.00', 2) < 0) {
            throw ValidationException::withMessages([
                'unit_price' => ['Harga satuan tidak boleh bernilai negatif.'],
            ]);
        }

        return DB::transaction(function () use ($batch, $normalizedQty, $normalizedUnitCost, $reference, $actor): array {
            // Lock product row untuk mencegah race condition antar batch untuk produk yang sama
            $lockedProduct = Product::query()
                ->lockForUpdate()
                ->findOrFail($batch->product_id);

            $lockedBatch = ProductBatch::query()
                ->lockForUpdate()
                ->findOrFail($batch->id);

            $batchIds = ProductBatch::query()
                ->where('product_id', $lockedProduct->id)
                ->pluck('id');

            // Lock seluruh ledger produk terkait sebelum membaca nilai stok lama & memperbarui MWA
            $existingLedgers = InventoryLedger::query()
                ->whereIn('product_batch_id', $batchIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            $oldTotalQty = '0.00';
            $oldTotalValue = '0.0000';

            foreach ($existingLedgers as $ledger) {
                $ledgerQty = (string) $ledger->qty;
                if (bccomp($ledgerQty, '0.00', 2) > 0) {
                    $oldTotalQty = bcadd($oldTotalQty, $ledgerQty, 2);
                    $lineValue = bcmul($ledgerQty, (string) $ledger->cost_price, 4);
                    $oldTotalValue = bcadd($oldTotalValue, $lineValue, 4);
                }
            }

            $newTotalValue = bcmul($normalizedQty, $normalizedUnitCost, 4);
            $newMwaCostPrice = $this->calculateMovingWeightedAverage(
                oldTotalValue: $oldTotalValue,
                oldTotalQty: $oldTotalQty,
                newTotalValue: $newTotalValue,
                newTotalQty: $normalizedQty
            );

            /** @var InventoryLedger|null $targetLedger */
            $targetLedger = $existingLedgers->first(
                static fn (InventoryLedger $ledger): bool => $ledger->product_batch_id === $lockedBatch->id
                    && $ledger->state === InventoryLedger::STATE_AVAILABLE
            );

            if ($targetLedger === null) {
                $targetLedger = InventoryLedger::create([
                    'product_batch_id' => $lockedBatch->id,
                    'state' => InventoryLedger::STATE_AVAILABLE,
                    'qty' => $normalizedQty,
                    'cost_price' => $newMwaCostPrice,
                ]);
            } else {
                $updatedBatchQty = bcadd((string) $targetLedger->qty, $normalizedQty, 2);
                $targetLedger->update([
                    'qty' => $updatedBatchQty,
                    'cost_price' => $newMwaCostPrice,
                ]);
            }

            // Sinkronisasi HPP MWA baru ke seluruh ledger aktif produk agar valuasi stok selalu konsisten
            foreach ($existingLedgers as $ledger) {
                if ($ledger->id === $targetLedger->id) {
                    continue;
                }

                if (bccomp((string) $ledger->qty, '0.00', 2) > 0 && bccomp((string) $ledger->cost_price, $newMwaCostPrice, 2) !== 0) {
                    $ledger->update([
                        'cost_price' => $newMwaCostPrice,
                    ]);
                }
            }

            // Wajib mencatat entri baru pada immutable stock_movements
            $movement = StockMovement::create([
                'product_batch_id' => $lockedBatch->id,
                'type' => StockMovement::TYPE_IN,
                'qty_change' => $normalizedQty,
                'reference_type' => $reference->getMorphClass(),
                'reference_id' => $reference->getKey(),
                'user_id' => $actor->id,
            ]);

            return [
                'product_id' => $lockedProduct->id,
                'product_batch_id' => $lockedBatch->id,
                'inventory_ledger_id' => $targetLedger->id,
                'stock_movement_id' => $movement->id,
                'qty_received' => $normalizedQty,
                'unit_cost' => $normalizedUnitCost,
                'received_value' => $this->roundDecimal($newTotalValue, 2),
                'previous_total_qty' => $oldTotalQty,
                'new_total_qty' => bcadd($oldTotalQty, $normalizedQty, 2),
                'new_mwa_cost_price' => $newMwaCostPrice,
            ];
        });
    }

    /**
     * Menghasilkan saran FEFO (First Expired, First Out) picking list berdasarkan
     * product_batches.expiry_date terdekat yang berstatus available.
     *
     * @return array<string, mixed>
     */
    public function suggestFefoPicking(int $productId, string $requestedQty): array
    {
        $product = Product::query()->findOrFail($productId);
        $normalizedRequestedQty = $this->normalizeDecimal($requestedQty, 2);

        if (bccomp($normalizedRequestedQty, '0.00', 2) <= 0) {
            throw ValidationException::withMessages([
                'qty' => ['Kuantitas picking yang diminta harus lebih dari 0.'],
            ]);
        }

        $today = Carbon::today()->toDateString();

        $availableLedgers = InventoryLedger::query()
            ->select('inventory_ledgers.*')
            ->join('product_batches', 'product_batches.id', '=', 'inventory_ledgers.product_batch_id')
            ->where('product_batches.product_id', $product->id)
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
            ->with('productBatch')
            ->get();

        $remainingQty = $normalizedRequestedQty;
        $allocatedQty = '0.00';
        $totalAvailableQty = '0.00';
        $pickingList = [];

        foreach ($availableLedgers as $ledger) {
            $batchAvailableQty = $this->normalizeDecimal((string) $ledger->qty, 2);
            $totalAvailableQty = bcadd($totalAvailableQty, $batchAvailableQty, 2);

            if (bccomp($remainingQty, '0.00', 2) <= 0) {
                continue;
            }

            $pickQty = bccomp($batchAvailableQty, $remainingQty, 2) >= 0
                ? $remainingQty
                : $batchAvailableQty;

            $remainingBatchQty = bcsub($batchAvailableQty, $pickQty, 2);
            $allocatedQty = bcadd($allocatedQty, $pickQty, 2);
            $remainingQty = bcsub($remainingQty, $pickQty, 2);

            $pickingList[] = [
                'inventory_ledger_id' => $ledger->id,
                'product_batch_id' => $ledger->product_batch_id,
                'batch_number' => $ledger->productBatch->batch_number,
                'expiry_date' => $ledger->productBatch->expiry_date?->format('Y-m-d'),
                'state' => $ledger->state,
                'available_qty' => $batchAvailableQty,
                'pick_qty' => $pickQty,
                'remaining_batch_qty' => $remainingBatchQty,
                'cost_price' => (string) $ledger->cost_price,
            ];
        }

        return [
            'product' => [
                'id' => $product->id,
                'sku' => $product->sku,
                'name' => $product->name,
                'uom' => $product->uom,
            ],
            'requested_qty' => $normalizedRequestedQty,
            'total_available_qty' => $totalAvailableQty,
            'allocated_qty' => $allocatedQty,
            'shortage_qty' => $remainingQty,
            'is_fulfilled' => bccomp($remainingQty, '0.00', 2) === 0,
            'picking_list' => $pickingList,
        ];
    }

    /**
     * Memindahkan seluruh stok berstatus available yang expiry_date-nya <= $daysThreshold hari
     * ke state in_qc (quarantined), mencatat mutasi di stock_movements dan audit_logs.
     *
     * @return array<string, mixed>
     */
    public function quarantineExpiringStock(
        int $daysThreshold = self::DEFAULT_QUARANTINE_DAYS,
        ?User $actor = null,
        ?string $ipAddress = null
    ): array {
        $resolvedActor = $actor ?? $this->resolveSystemActor();
        $cutoffDate = Carbon::today()->addDays($daysThreshold)->toDateString();

        return DB::transaction(function () use ($cutoffDate, $daysThreshold, $resolvedActor, $ipAddress): array {
            $expiringLedgerIds = InventoryLedger::query()
                ->join('product_batches', 'product_batches.id', '=', 'inventory_ledgers.product_batch_id')
                ->whereNull('product_batches.deleted_at')
                ->whereNotNull('product_batches.expiry_date')
                ->whereDate('product_batches.expiry_date', '<=', $cutoffDate)
                ->where('inventory_ledgers.state', InventoryLedger::STATE_AVAILABLE)
                ->where('inventory_ledgers.qty', '>', 0)
                ->orderBy('product_batches.expiry_date', 'asc')
                ->orderBy('inventory_ledgers.id', 'asc')
                ->pluck('inventory_ledgers.id');

            $quarantinedItems = [];
            $totalQuarantinedQty = '0.00';

            if ($expiringLedgerIds->isEmpty()) {
                return [
                    'cutoff_date' => $cutoffDate,
                    'days_threshold' => $daysThreshold,
                    'quarantined_batches_count' => 0,
                    'total_quarantined_qty' => $totalQuarantinedQty,
                    'items' => [],
                ];
            }

            $lockedAvailableLedgers = InventoryLedger::query()
                ->whereIn('id', $expiringLedgerIds)
                ->with('productBatch.product')
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            foreach ($lockedAvailableLedgers as $availableLedger) {
                $qtyToMove = $this->normalizeDecimal((string) $availableLedger->qty, 2);

                if (bccomp($qtyToMove, '0.00', 2) <= 0) {
                    continue;
                }

                $costPrice = $this->normalizeDecimal((string) $availableLedger->cost_price, 2);

                $qcLedger = InventoryLedger::query()
                    ->where('product_batch_id', $availableLedger->product_batch_id)
                    ->where('state', InventoryLedger::STATE_IN_QC)
                    ->lockForUpdate()
                    ->first();

                $oldQcQty = $qcLedger !== null ? (string) $qcLedger->qty : '0.00';

                $oldPayload = [
                    'product_batch_id' => $availableLedger->product_batch_id,
                    'available_qty' => $qtyToMove,
                    'in_qc_qty' => $oldQcQty,
                    'state' => InventoryLedger::STATE_AVAILABLE,
                ];

                // Pindahkan stok dari available ke in_qc
                $availableLedger->update([
                    'qty' => '0.00',
                ]);

                if ($qcLedger === null) {
                    $qcLedger = InventoryLedger::create([
                        'product_batch_id' => $availableLedger->product_batch_id,
                        'state' => InventoryLedger::STATE_IN_QC,
                        'qty' => $qtyToMove,
                        'cost_price' => $costPrice,
                    ]);
                } else {
                    $qcLedger->update([
                        'qty' => bcadd((string) $qcLedger->qty, $qtyToMove, 2),
                        'cost_price' => $costPrice,
                    ]);
                }

                // Catat mutasi karantina pada immutable stock_movements
                $movement = StockMovement::create([
                    'product_batch_id' => $availableLedger->product_batch_id,
                    'type' => StockMovement::TYPE_ADJ,
                    'qty_change' => '-' . $qtyToMove,
                    'reference_type' => InventoryLedger::class,
                    'reference_id' => $qcLedger->id,
                    'user_id' => $resolvedActor->id,
                ]);

                AuditLog::create([
                    'user_id' => $resolvedActor->id,
                    'action' => 'inventory.expiry_quarantined',
                    'model_type' => InventoryLedger::class,
                    'model_id' => $qcLedger->id,
                    'old_payload' => $oldPayload,
                    'new_payload' => [
                        'product_batch_id' => $availableLedger->product_batch_id,
                        'batch_number' => $availableLedger->productBatch?->batch_number,
                        'expiry_date' => $availableLedger->productBatch?->expiry_date?->format('Y-m-d'),
                        'available_qty' => '0.00',
                        'in_qc_qty' => (string) $qcLedger->qty,
                        'quarantined_qty' => $qtyToMove,
                        'state' => InventoryLedger::STATE_IN_QC,
                        'stock_movement_id' => $movement->id,
                        'days_threshold' => $daysThreshold,
                    ],
                    'ip_address' => $ipAddress,
                ]);

                $totalQuarantinedQty = bcadd($totalQuarantinedQty, $qtyToMove, 2);

                $quarantinedItems[] = [
                    'product_id' => $availableLedger->productBatch?->product_id,
                    'product_sku' => $availableLedger->productBatch?->product?->sku,
                    'product_batch_id' => $availableLedger->product_batch_id,
                    'batch_number' => $availableLedger->productBatch?->batch_number,
                    'expiry_date' => $availableLedger->productBatch?->expiry_date?->format('Y-m-d'),
                    'qty_quarantined' => $qtyToMove,
                    'qc_ledger_id' => $qcLedger->id,
                    'stock_movement_id' => $movement->id,
                ];
            }

            return [
                'cutoff_date' => $cutoffDate,
                'days_threshold' => $daysThreshold,
                'quarantined_batches_count' => count($quarantinedItems),
                'total_quarantined_qty' => $totalQuarantinedQty,
                'items' => $quarantinedItems,
            ];
        });
    }

    private function resolveSystemActor(): User
    {
        $superAdmin = User::query()
            ->where('is_active', true)
            ->whereHas('roles', static function ($query): void {
                $query->where('name', 'Super Admin');
            })
            ->orderBy('id')
            ->first();

        if ($superAdmin !== null) {
            return $superAdmin;
        }

        return User::query()->orderBy('id')->firstOrFail();
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
