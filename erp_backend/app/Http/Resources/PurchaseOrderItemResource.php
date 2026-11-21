<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\PurchaseOrderItem
 */
class PurchaseOrderItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $rawSubtotal = bcmul((string) $this->qty_ordered, (string) $this->unit_price, 4);
        $subtotal = bcadd(bcadd($rawSubtotal, '0.0050', 4), '0', 2);

        return [
            'id' => $this->id,
            'po_id' => $this->po_id,
            'product_id' => $this->product_id,
            'qty_ordered' => (string) $this->qty_ordered,
            'unit_price' => (string) $this->unit_price,
            'subtotal' => $subtotal,
            'product' => $this->whenLoaded('product', function () {
                return [
                    'id' => $this->product->id,
                    'sku' => $this->product->sku,
                    'name' => $this->product->name,
                    'uom' => $this->product->uom,
                ];
            }),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
