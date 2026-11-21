<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\DeliveryOrderItem
 */
class DeliveryOrderItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewCost = $user !== null && $user->can('inventory.view_cost');

        $cogsTotal = null;
        if ($canViewCost) {
            $rawCogs = bcmul((string) $this->qty_dispatched, (string) $this->unit_cost, 4);
            $cogsTotal = bcadd(bcadd($rawCogs, '0.0050', 4), '0', 2);
        }

        return [
            'id' => $this->id,
            'delivery_order_id' => $this->delivery_order_id,
            'product_id' => $this->product_id,
            'product_batch_id' => $this->product_batch_id,
            'qty_dispatched' => (string) $this->qty_dispatched,
            // HPP MWA (unit_cost) & cogs_total disembunyikan sepenuhnya dari Admin Sales & Staf Gudang
            'unit_cost' => $this->when($canViewCost, (string) $this->unit_cost),
            'cogs_total' => $this->when($canViewCost, $cogsTotal),
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
