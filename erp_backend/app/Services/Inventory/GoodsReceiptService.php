<?php

namespace App\Services\Inventory;

use App\Events\GoodsReceiptValidated;
use App\Models\AuditLog;
use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptItem;
use App\Models\ProductBatch;
use App\Models\PurchaseOrder;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class GoodsReceiptService
{
    public function __construct(
        private readonly InventoryService $inventoryService
    ) {}

    /**
     * Membuat dokumen Goods Receipt berstatus Draft dari PO berstatus Approved atau Partially Received.
     *
     * @param  array<string, mixed>  $data
     */
    public function createGoodsReceipt(array $data, User $actor, ?string $ipAddress = null): GoodsReceipt
    {
        return DB::transaction(function () use ($data, $actor, $ipAddress): GoodsReceipt {
            $lockedPo = PurchaseOrder::query()
                ->with('items')
                ->lockForUpdate()
                ->findOrFail((int) $data['po_id']);

            $this->assertPurchaseOrderReceivable($lockedPo);

            $orderedByProduct = $this->aggregateOrderedQtyByProduct($lockedPo);
            $receivedByProduct = $this->aggregateValidatedReceivedQtyByProduct($lockedPo->id);

            $items = $data['items'] ?? [];
            $incomingByProduct = [];
            $seenBatchPairs = [];
            $preparedItems = [];

            foreach ($items as $index => $item) {
                $productId = (int) $item['product_id'];
                $batchNumber = trim((string) $item['batch_number']);
                $expiryDate = trim((string) $item['expiry_date']);
                $qtyReceived = $this->normalizeDecimal((string) $item['qty_received'], 2);

                if (! isset($orderedByProduct[$productId])) {
                    throw ValidationException::withMessages([
                        "items.{$index}.product_id" => ['Produk tidak terdaftar pada Purchase Order yang dipilih.'],
                    ]);
                }

                if ($batchNumber === '') {
                    throw ValidationException::withMessages([
                        "items.{$index}.batch_number" => ['Nomor batch wajib diisi untuk penerimaan barang.'],
                    ]);
                }

                if ($expiryDate === '') {
                    throw ValidationException::withMessages([
                        "items.{$index}.expiry_date" => ['Tanggal kadaluarsa (expiry_date) wajib diisi.'],
                    ]);
                }

                if (bccomp($qtyReceived, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        "items.{$index}.qty_received" => ['Kuantitas yang diterima harus lebih dari 0.'],
                    ]);
                }

                $pairKey = "{$productId}|{$batchNumber}";
                if (isset($seenBatchPairs[$pairKey])) {
                    throw ValidationException::withMessages([
                        "items.{$index}.batch_number" => ['Kombinasi produk dan batch_number tidak boleh duplikat dalam satu Goods Receipt.'],
                    ]);
                }
                $seenBatchPairs[$pairKey] = true;

                $incomingByProduct[$productId] = bcadd(
                    $incomingByProduct[$productId] ?? '0.00',
                    $qtyReceived,
                    2
                );

                $alreadyReceived = $receivedByProduct[$productId] ?? '0.00';
                $projectedTotal = bcadd($alreadyReceived, $incomingByProduct[$productId], 2);

                if (bccomp($projectedTotal, $orderedByProduct[$productId], 2) > 0) {
                    $remaining = bcsub($orderedByProduct[$productId], $alreadyReceived, 2);

                    throw ValidationException::withMessages([
                        "items.{$index}.qty_received" => [
                            "Kuantitas penerimaan melebihi sisa pesanan PO (sisa yang belum diterima: {$remaining}).",
                        ],
                    ]);
                }

                $batch = $this->resolveOrCreateBatch($productId, $batchNumber, $expiryDate, $index);

                $preparedItems[] = [
                    'product_id' => $productId,
                    'product_batch_id' => $batch->id,
                    'qty_received' => $qtyReceived,
                ];
            }

            $receiptNumber = ! empty($data['receipt_number'])
                ? trim((string) $data['receipt_number'])
                : $this->generateReceiptNumber();

            $goodsReceipt = GoodsReceipt::create([
                'po_id' => $lockedPo->id,
                'receipt_number' => $receiptNumber,
                'received_date' => $data['received_date'],
                'status' => GoodsReceipt::STATUS_DRAFT,
            ]);

            $goodsReceipt->items()->createMany($preparedItems);

            $goodsReceipt->load([
                'purchaseOrder.supplier',
                'items.product',
                'items.productBatch.inventoryLedgers',
            ]);

            $this->recordAuditLog(
                actor: $actor,
                action: 'goods_receipt.created',
                modelType: GoodsReceipt::class,
                modelId: $goodsReceipt->id,
                oldPayload: null,
                newPayload: array_merge($this->goodsReceiptPayload($goodsReceipt), [
                    'items_count' => $goodsReceipt->items->count(),
                ]),
                ipAddress: $ipAddress
            );

            return $goodsReceipt;
        });
    }

    /**
     * Memvalidasi Goods Receipt (Draft -> Validated) dalam DB::transaction() + lockForUpdate():
     * - Re-validasi status PO (Approved / Partially Received) & sisa kuantitas pesanan
     * - Memastikan setiap item memiliki batch_number & expiry_date
     * - Menambahkan stok ke inventory_ledgers (state: available), hitung ulang MWA dengan BCMath,
     *   dan mencatat immutable stock_movements
     * - Memperbarui status PO menjadi Partially Received atau Completed secara otomatis
     * - Mencatat audit_logs dan memicu event GoodsReceiptValidated
     */
    public function validateGoodsReceipt(
        GoodsReceipt $goodsReceipt,
        User $actor,
        ?string $ipAddress = null
    ): GoodsReceipt {
        return DB::transaction(function () use ($goodsReceipt, $actor, $ipAddress): GoodsReceipt {
            $lockedGr = GoodsReceipt::query()
                ->with(['items.productBatch', 'items.product'])
                ->lockForUpdate()
                ->findOrFail($goodsReceipt->id);

            if ($lockedGr->status !== GoodsReceipt::STATUS_DRAFT) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Goods Receipt berstatus Draft yang dapat divalidasi.'],
                ]);
            }

            if ($lockedGr->items->isEmpty()) {
                throw ValidationException::withMessages([
                    'items' => ['Goods Receipt tidak memiliki item untuk divalidasi.'],
                ]);
            }

            $lockedPo = PurchaseOrder::query()
                ->with('items')
                ->lockForUpdate()
                ->findOrFail($lockedGr->po_id);

            $this->assertPurchaseOrderReceivable($lockedPo);

            $orderedByProduct = $this->aggregateOrderedQtyByProduct($lockedPo);
            $unitCostByProduct = $this->resolvePoUnitCostByProduct($lockedPo);
            $alreadyReceivedByProduct = $this->aggregateValidatedReceivedQtyByProduct($lockedPo->id);

            $incomingByProduct = [];

            foreach ($lockedGr->items as $index => $grItem) {
                $productId = $grItem->product_id;
                $batch = $grItem->productBatch;

                if (! isset($orderedByProduct[$productId])) {
                    throw ValidationException::withMessages([
                        "items.{$index}.product_id" => ['Produk pada Goods Receipt tidak terdaftar di Purchase Order.'],
                    ]);
                }

                if ($batch === null || trim((string) $batch->batch_number) === '') {
                    throw ValidationException::withMessages([
                        "items.{$index}.batch_number" => ['Batch number wajib tersedia sebelum validasi Goods Receipt.'],
                    ]);
                }

                if ($batch->expiry_date === null) {
                    throw ValidationException::withMessages([
                        "items.{$index}.expiry_date" => ['Tanggal kadaluarsa (expiry_date) wajib tersedia sebelum validasi Goods Receipt.'],
                    ]);
                }

                $qtyReceived = $this->normalizeDecimal((string) $grItem->qty_received, 2);

                if (bccomp($qtyReceived, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        "items.{$index}.qty_received" => ['Kuantitas diterima harus lebih dari 0.'],
                    ]);
                }

                $incomingByProduct[$productId] = bcadd(
                    $incomingByProduct[$productId] ?? '0.00',
                    $qtyReceived,
                    2
                );

                $alreadyReceived = $alreadyReceivedByProduct[$productId] ?? '0.00';
                $projectedTotal = bcadd($alreadyReceived, $incomingByProduct[$productId], 2);

                if (bccomp($projectedTotal, $orderedByProduct[$productId], 2) > 0) {
                    $remaining = bcsub($orderedByProduct[$productId], $alreadyReceived, 2);

                    throw ValidationException::withMessages([
                        "items.{$index}.qty_received" => [
                            "Kuantitas penerimaan melebihi sisa pesanan PO (sisa yang belum diterima: {$remaining}).",
                        ],
                    ]);
                }
            }

            $oldGrPayload = $this->goodsReceiptPayload($lockedGr);
            $oldPoPayload = $this->purchaseOrderPayload($lockedPo);

            $valuations = [];

            foreach ($lockedGr->items as $grItem) {
                $unitCost = $unitCostByProduct[$grItem->product_id];

                $valuations[] = $this->inventoryService->receiveStock(
                    batch: $grItem->productBatch,
                    qtyReceived: (string) $grItem->qty_received,
                    unitCost: $unitCost,
                    reference: $lockedGr,
                    actor: $actor
                );
            }

            $lockedGr->update([
                'status' => GoodsReceipt::STATUS_VALIDATED,
            ]);

            // Tentukan status PO terbaru (Completed jika seluruh item PO terpenuhi, selain itu Partially Received)
            $isAllCompleted = true;
            foreach ($orderedByProduct as $productId => $qtyOrdered) {
                $totalReceivedForProduct = bcadd(
                    $alreadyReceivedByProduct[$productId] ?? '0.00',
                    $incomingByProduct[$productId] ?? '0.00',
                    2
                );

                if (bccomp($totalReceivedForProduct, $qtyOrdered, 2) < 0) {
                    $isAllCompleted = false;
                    break;
                }
            }

            $newPoStatus = $isAllCompleted
                ? PurchaseOrder::STATUS_COMPLETED
                : PurchaseOrder::STATUS_PARTIALLY_RECEIVED;

            if ($lockedPo->status !== $newPoStatus) {
                $lockedPo->update([
                    'status' => $newPoStatus,
                ]);

                $this->recordAuditLog(
                    actor: $actor,
                    action: 'purchase_order.receipt_status_updated',
                    modelType: PurchaseOrder::class,
                    modelId: $lockedPo->id,
                    oldPayload: $oldPoPayload,
                    newPayload: array_merge($this->purchaseOrderPayload($lockedPo), [
                        'goods_receipt_id' => $lockedGr->id,
                        'receipt_number' => $lockedGr->receipt_number,
                    ]),
                    ipAddress: $ipAddress
                );
            }

            $this->recordAuditLog(
                actor: $actor,
                action: 'goods_receipt.validated',
                modelType: GoodsReceipt::class,
                modelId: $lockedGr->id,
                oldPayload: $oldGrPayload,
                newPayload: array_merge($this->goodsReceiptPayload($lockedGr), [
                    'po_status' => $newPoStatus,
                    'valuations' => $valuations,
                ]),
                ipAddress: $ipAddress
            );

            $validatedGr = $lockedGr->fresh([
                'purchaseOrder.supplier',
                'items.product',
                'items.productBatch.inventoryLedgers',
            ]);

            DB::afterCommit(static function () use ($validatedGr, $valuations, $actor): void {
                GoodsReceiptValidated::dispatch($validatedGr, $valuations, $actor);
            });

            return $validatedGr;
        });
    }

    /**
     * Menghapus (SoftDelete) Goods Receipt yang masih berstatus Draft.
     * Goods Receipt berstatus Validated bersifat immutable dan dilarang dihapus.
     */
    public function deleteGoodsReceipt(
        GoodsReceipt $goodsReceipt,
        User $actor,
        ?string $ipAddress = null
    ): void {
        DB::transaction(function () use ($goodsReceipt, $actor, $ipAddress): void {
            $lockedGr = GoodsReceipt::query()
                ->lockForUpdate()
                ->findOrFail($goodsReceipt->id);

            if ($lockedGr->status !== GoodsReceipt::STATUS_DRAFT) {
                throw ValidationException::withMessages([
                    'status' => ['Goods Receipt yang sudah divalidasi tidak dapat dihapus.'],
                ]);
            }

            $oldPayload = $this->goodsReceiptPayload($lockedGr);

            $lockedGr->items()->delete();
            $lockedGr->delete();

            $this->recordAuditLog(
                actor: $actor,
                action: 'goods_receipt.deleted',
                modelType: GoodsReceipt::class,
                modelId: $lockedGr->id,
                oldPayload: $oldPayload,
                newPayload: null,
                ipAddress: $ipAddress
            );
        });
    }

    private function assertPurchaseOrderReceivable(PurchaseOrder $purchaseOrder): void
    {
        if (! in_array($purchaseOrder->status, [
            PurchaseOrder::STATUS_APPROVED,
            PurchaseOrder::STATUS_PARTIALLY_RECEIVED,
        ], true)) {
            throw ValidationException::withMessages([
                'po_id' => [
                    'Goods Receipt hanya dapat menerima barang dari Purchase Order berstatus Approved atau Partially Received.',
                ],
            ]);
        }
    }

    /**
     * @return array<int, string>
     */
    private function aggregateOrderedQtyByProduct(PurchaseOrder $purchaseOrder): array
    {
        $ordered = [];

        foreach ($purchaseOrder->items as $poItem) {
            $productId = $poItem->product_id;
            $ordered[$productId] = bcadd(
                $ordered[$productId] ?? '0.00',
                (string) $poItem->qty_ordered,
                2
            );
        }

        return $ordered;
    }

    /**
     * @return array<int, string>
     */
    private function resolvePoUnitCostByProduct(PurchaseOrder $purchaseOrder): array
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

        $unitCosts = [];

        foreach ($totals as $productId => $summary) {
            if ($summary['lines'] === 1) {
                $unitCosts[$productId] = $this->normalizeDecimal($summary['single_unit_price'], 2);
            } else {
                $rawAvg = bcdiv($summary['value'], $summary['qty'], 6);
                $unitCosts[$productId] = $this->roundDecimal($rawAvg, 2);
            }
        }

        return $unitCosts;
    }

    /**
     * @return array<int, string>
     */
    private function aggregateValidatedReceivedQtyByProduct(int $poId): array
    {
        $receivedItems = GoodsReceiptItem::query()
            ->whereHas('goodsReceipt', static function ($query) use ($poId): void {
                $query->where('po_id', $poId)
                    ->where('status', GoodsReceipt::STATUS_VALIDATED);
            })
            ->get(['product_id', 'qty_received']);

        $received = [];

        foreach ($receivedItems as $item) {
            $productId = $item->product_id;
            $received[$productId] = bcadd(
                $received[$productId] ?? '0.00',
                (string) $item->qty_received,
                2
            );
        }

        return $received;
    }

    private function resolveOrCreateBatch(
        int $productId,
        string $batchNumber,
        string $expiryDate,
        int $itemIndex
    ): ProductBatch {
        $existingBatch = ProductBatch::withTrashed()
            ->where('product_id', $productId)
            ->where('batch_number', $batchNumber)
            ->lockForUpdate()
            ->first();

        if ($existingBatch === null) {
            return ProductBatch::create([
                'product_id' => $productId,
                'batch_number' => $batchNumber,
                'expiry_date' => $expiryDate,
            ]);
        }

        if ($existingBatch->trashed()) {
            throw ValidationException::withMessages([
                "items.{$itemIndex}.batch_number" => ['Batch number sudah diarsipkan (soft-deleted) dan tidak dapat digunakan kembali.'],
            ]);
        }

        if ($existingBatch->expiry_date !== null && $existingBatch->expiry_date->format('Y-m-d') !== $expiryDate) {
            throw ValidationException::withMessages([
                "items.{$itemIndex}.expiry_date" => [
                    "Batch {$batchNumber} sudah terdaftar dengan expiry_date {$existingBatch->expiry_date->format('Y-m-d')}.",
                ],
            ]);
        }

        if ($existingBatch->expiry_date === null) {
            $existingBatch->update(['expiry_date' => $expiryDate]);
        }

        return $existingBatch;
    }

    private function generateReceiptNumber(): string
    {
        $prefix = 'GR-' . now()->format('Ym') . '-';

        $latestNumber = GoodsReceipt::withTrashed()
            ->where('receipt_number', 'like', $prefix . '%')
            ->orderByDesc('receipt_number')
            ->value('receipt_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (GoodsReceipt::withTrashed()->where('receipt_number', $candidate)->exists());

        return $candidate;
    }

    /**
     * @return array<string, mixed>
     */
    private function goodsReceiptPayload(GoodsReceipt $gr): array
    {
        return [
            'id' => $gr->id,
            'po_id' => $gr->po_id,
            'receipt_number' => $gr->receipt_number,
            'received_date' => $gr->received_date?->format('Y-m-d'),
            'status' => $gr->status,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function purchaseOrderPayload(PurchaseOrder $po): array
    {
        return [
            'id' => $po->id,
            'po_number' => $po->po_number,
            'supplier_id' => $po->supplier_id,
            'status' => $po->status,
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
