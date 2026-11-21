<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\PaymentVoucher
 */
class PaymentVoucherResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'voucher_number' => $this->voucher_number,
            'purchase_invoice_id' => $this->purchase_invoice_id,
            'amount_paid' => (string) $this->amount_paid,
            'payment_date' => $this->payment_date?->format('Y-m-d'),
            'payment_method' => $this->payment_method,
            'idempotency_key' => $this->idempotency_key,
            'purchase_invoice' => $this->whenLoaded('purchaseInvoice', function () {
                $invoice = $this->purchaseInvoice;
                $data = [
                    'id' => $invoice->id,
                    'invoice_number' => $invoice->invoice_number,
                    'po_id' => $invoice->po_id,
                    'supplier_id' => $invoice->supplier_id,
                    'total_billed' => (string) $invoice->total_billed,
                    'due_date' => $invoice->due_date?->format('Y-m-d'),
                    'status' => $invoice->status,
                ];

                if ($invoice->relationLoaded('paymentVouchers')) {
                    $totalPaid = '0.00';
                    foreach ($invoice->paymentVouchers as $v) {
                        $totalPaid = bcadd($totalPaid, (string) $v->amount_paid, 2);
                    }
                    $data['total_paid'] = $totalPaid;
                    $data['remaining_balance'] = bcsub((string) $invoice->total_billed, $totalPaid, 2);
                }

                if ($invoice->relationLoaded('supplier') && $invoice->supplier !== null) {
                    $data['supplier'] = [
                        'id' => $invoice->supplier->id,
                        'name' => $invoice->supplier->name,
                    ];
                }

                return $data;
            }),
            'general_ledgers' => GeneralLedgerResource::collection($this->whenLoaded('generalLedgers')),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
