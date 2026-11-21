<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\PurchaseRequisition
 */
class PurchaseRequisitionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'pr_number' => $this->pr_number,
            'requestor_id' => $this->requestor_id,
            'status' => $this->status,
            'requestor' => $this->whenLoaded('requestor', function () {
                return [
                    'id' => $this->requestor->id,
                    'name' => $this->requestor->name,
                    'email' => $this->requestor->email,
                ];
            }),
            'purchase_orders' => $this->whenLoaded('purchaseOrders', function () {
                return $this->purchaseOrders->map(function ($po) {
                    return [
                        'id' => $po->id,
                        'po_number' => $po->po_number,
                        'supplier_id' => $po->supplier_id,
                        'total_amount' => (string) $po->total_amount,
                        'status' => $po->status,
                    ];
                })->values();
            }),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
