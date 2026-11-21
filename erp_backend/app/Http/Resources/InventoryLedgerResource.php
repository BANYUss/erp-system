<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\InventoryLedger
 */
class InventoryLedgerResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewCost = $user !== null && $user->can('inventory.view_cost');

        $inventoryValue = null;
        if ($canViewCost) {
            $rawValue = bcmul((string) $this->qty, (string) $this->cost_price, 4);
            $inventoryValue = bcadd(bcadd($rawValue, '0.0050', 4), '0', 2);
        }

        return [
            'id' => $this->id,
            'product_batch_id' => $this->product_batch_id,
            'state' => $this->state,
            'qty' => (string) $this->qty,
            // Kolom finansial disembunyikan sepenuhnya untuk Staf Gudang & Admin Sales
            'cost_price' => $this->when($canViewCost, (string) $this->cost_price),
            'inventory_value' => $this->when($canViewCost, $inventoryValue),
            'batch' => $this->whenLoaded('productBatch', function () {
                $batchData = [
                    'id' => $this->productBatch->id,
                    'product_id' => $this->productBatch->product_id,
                    'batch_number' => $this->productBatch->batch_number,
                    'expiry_date' => $this->productBatch->expiry_date?->format('Y-m-d'),
                ];

                if ($this->productBatch->relationLoaded('product') && $this->productBatch->product !== null) {
                    $batchData['product'] = [
                        'id' => $this->productBatch->product->id,
                        'sku' => $this->productBatch->product->sku,
                        'name' => $this->productBatch->product->name,
                        'uom' => $this->productBatch->product->uom,
                    ];
                }

                return $batchData;
            }),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
