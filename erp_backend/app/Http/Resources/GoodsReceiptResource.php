<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\GoodsReceipt
 */
class GoodsReceiptResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewFinancial = $user !== null
            && $user->can('inventory.view_cost')
            && $user->can('purchase_orders.view');

        return [
            'id' => $this->id,
            'po_id' => $this->po_id,
            'receipt_number' => $this->receipt_number,
            'received_date' => $this->received_date?->format('Y-m-d'),
            'status' => $this->status,
            'purchase_order' => $this->whenLoaded('purchaseOrder', function () use ($canViewFinancial) {
                $poData = [
                    'id' => $this->purchaseOrder->id,
                    'po_number' => $this->purchaseOrder->po_number,
                    'supplier_id' => $this->purchaseOrder->supplier_id,
                    'status' => $this->purchaseOrder->status,
                ];

                if ($canViewFinancial) {
                    $poData['total_amount'] = (string) $this->purchaseOrder->total_amount;
                }

                if ($this->purchaseOrder->relationLoaded('supplier') && $this->purchaseOrder->supplier !== null) {
                    $poData['supplier'] = [
                        'id' => $this->purchaseOrder->supplier->id,
                        'name' => $this->purchaseOrder->supplier->name,
                    ];
                }

                return $poData;
            }),
            'items' => GoodsReceiptItemResource::collection($this->whenLoaded('items')),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
