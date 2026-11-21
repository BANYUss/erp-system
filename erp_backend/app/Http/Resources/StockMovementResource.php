<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\StockMovement
 */
class StockMovementResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'product_batch_id' => $this->product_batch_id,
            'type' => $this->type,
            'qty_change' => (string) $this->qty_change,
            'reference_type' => $this->reference_type,
            'reference_id' => $this->reference_id,
            'user_id' => $this->user_id,
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
            'user' => $this->whenLoaded('user', function () {
                return [
                    'id' => $this->user->id,
                    'name' => $this->user->name,
                    'email' => $this->user->email,
                ];
            }),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
