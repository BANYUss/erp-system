<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\CustomerPayment
 */
class CustomerPaymentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'receipt_number' => $this->receipt_number,
            'sales_invoice_id' => $this->sales_invoice_id,
            'amount_received' => (string) $this->amount_received,
            'payment_date' => $this->payment_date?->format('Y-m-d'),
            'payment_method' => $this->payment_method,
            'idempotency_key' => $this->idempotency_key,
            'sales_invoice' => $this->whenLoaded('salesInvoice', function () {
                $invoice = $this->salesInvoice;
                $data = [
                    'id' => $invoice->id,
                    'invoice_number' => $invoice->invoice_number,
                    'sales_order_id' => $invoice->sales_order_id,
                    'customer_id' => $invoice->customer_id,
                    'total_billed' => (string) $invoice->total_billed,
                    'due_date' => $invoice->due_date?->format('Y-m-d'),
                    'status' => $invoice->status,
                ];

                if ($invoice->relationLoaded('customerPayments')) {
                    $totalReceived = '0.00';
                    foreach ($invoice->customerPayments as $p) {
                        $totalReceived = bcadd($totalReceived, (string) $p->amount_received, 2);
                    }
                    $data['total_received'] = $totalReceived;
                    $data['remaining_balance'] = bcsub((string) $invoice->total_billed, $totalReceived, 2);
                }

                if ($invoice->relationLoaded('customer') && $invoice->customer !== null) {
                    $data['customer'] = [
                        'id' => $invoice->customer->id,
                        'name' => $invoice->customer->name,
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
