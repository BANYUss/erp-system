<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\PurchaseInvoice
 */
class PurchaseInvoiceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $totalPaid = '0.00';

        if ($this->relationLoaded('paymentVouchers')) {
            foreach ($this->paymentVouchers as $voucher) {
                $totalPaid = bcadd($totalPaid, (string) $voucher->amount_paid, 2);
            }
        }

        $totalBilled = bcadd((string) $this->total_billed, '0', 2);
        $remainingBalance = bcsub($totalBilled, $totalPaid, 2);

        return [
            'id' => $this->id,
            'invoice_number' => $this->invoice_number,
            'po_id' => $this->po_id,
            'supplier_id' => $this->supplier_id,
            'total_billed' => $totalBilled,
            'total_paid' => $this->when($this->relationLoaded('paymentVouchers'), $totalPaid),
            'remaining_balance' => $this->when($this->relationLoaded('paymentVouchers'), $remainingBalance),
            'due_date' => $this->due_date?->format('Y-m-d'),
            'status' => $this->status,
            'idempotency_key' => $this->idempotency_key,
            'purchase_order' => $this->whenLoaded('purchaseOrder', function () {
                return [
                    'id' => $this->purchaseOrder->id,
                    'po_number' => $this->purchaseOrder->po_number,
                    'total_amount' => (string) $this->purchaseOrder->total_amount,
                    'status' => $this->purchaseOrder->status,
                ];
            }),
            'supplier' => $this->whenLoaded('supplier', function () {
                return [
                    'id' => $this->supplier->id,
                    'name' => $this->supplier->name,
                    'email' => $this->supplier->email,
                ];
            }),
            'items' => PurchaseInvoiceItemResource::collection($this->whenLoaded('items')),
            'payment_vouchers' => PaymentVoucherResource::collection($this->whenLoaded('paymentVouchers')),
            'general_ledgers' => GeneralLedgerResource::collection($this->whenLoaded('generalLedgers')),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
