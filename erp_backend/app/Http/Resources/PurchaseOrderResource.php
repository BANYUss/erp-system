<?php

namespace App\Http\Resources;

use App\Services\Procurement\PurchaseOrderService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\PurchaseOrder
 */
class PurchaseOrderResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $requiresManagerApproval = bccomp(
            (string) $this->total_amount,
            PurchaseOrderService::APPROVAL_LIMIT,
            2
        ) > 0;

        return [
            'id' => $this->id,
            'po_number' => $this->po_number,
            'pr_id' => $this->pr_id,
            'supplier_id' => $this->supplier_id,
            'total_amount' => (string) $this->total_amount,
            'status' => $this->status,
            'requires_manager_approval' => $requiresManagerApproval,
            'approver_id' => $this->approver_id,
            'purchase_requisition' => $this->whenLoaded('purchaseRequisition', function () {
                return $this->purchaseRequisition === null ? null : [
                    'id' => $this->purchaseRequisition->id,
                    'pr_number' => $this->purchaseRequisition->pr_number,
                    'status' => $this->purchaseRequisition->status,
                ];
            }),
            'supplier' => $this->whenLoaded('supplier', function () {
                return new SupplierResource($this->supplier);
            }),
            'approver' => $this->whenLoaded('approver', function () {
                return $this->approver === null ? null : [
                    'id' => $this->approver->id,
                    'name' => $this->approver->name,
                    'email' => $this->approver->email,
                ];
            }),
            'items' => PurchaseOrderItemResource::collection($this->whenLoaded('items')),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
