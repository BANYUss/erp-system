<?php

namespace App\Http\Resources;

use App\Models\InventoryLedger;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\GoodsReceiptItem
 */
class GoodsReceiptItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewCost = $user !== null && $user->can('inventory.view_cost');

        $costPrice = null;
        if ($canViewCost && $this->relationLoaded('productBatch') && $this->productBatch !== null && $this->productBatch->relationLoaded('inventoryLedgers')) {
            $ledger = $this->productBatch->inventoryLedgers
                ->first(static fn (InventoryLedger $item): bool => $item->state === InventoryLedger::STATE_AVAILABLE)
                ?? $this->productBatch->inventoryLedgers->first();

            $costPrice = $ledger !== null ? (string) $ledger->cost_price : null;
        }

        return [
            'id' => $this->id,
            'goods_receipt_id' => $this->goods_receipt_id,
            'product_id' => $this->product_id,
            'product_batch_id' => $this->product_batch_id,
            'qty_received' => (string) $this->qty_received,
            // Kolom finansial disembunyikan sepenuhnya untuk Staf Gudang dan role tanpa izin inventory.view_cost
            'cost_price' => $this->when($canViewCost, $costPrice),
            'product' => $this->whenLoaded('product', function () {
                return [
                    'id' => $this->product->id,
                    'sku' => $this->product->sku,
                    'name' => $this->product->name,
                    'uom' => $this->product->uom,
                ];
            }),
            'batch' => $this->whenLoaded('productBatch', function () {
                return [
                    'id' => $this->productBatch->id,
                    'batch_number' => $this->productBatch->batch_number,
                    'expiry_date' => $this->productBatch->expiry_date?->format('Y-m-d'),
                ];
            }),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
