<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\SalesInvoice
 */
class SalesInvoiceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $totalReceived = '0.00';

        if ($this->relationLoaded('customerPayments')) {
            foreach ($this->customerPayments as $payment) {
                $totalReceived = bcadd($totalReceived, (string) $payment->amount_received, 2);
            }
        }

        $totalBilled = bcadd((string) $this->total_billed, '0', 2);
        $remainingBalance = bcsub($totalBilled, $totalReceived, 2);

        return [
            'id' => $this->id,
            'invoice_number' => $this->invoice_number,
            'sales_order_id' => $this->sales_order_id,
            'customer_id' => $this->customer_id,
            'total_billed' => $totalBilled,
            'total_received' => $this->when($this->relationLoaded('customerPayments'), $totalReceived),
            'remaining_balance' => $this->when($this->relationLoaded('customerPayments'), $remainingBalance),
            'due_date' => $this->due_date?->format('Y-m-d'),
            'status' => $this->status,
            'idempotency_key' => $this->idempotency_key,
            'sales_order' => $this->whenLoaded('salesOrder', function () {
                return [
                    'id' => $this->salesOrder->id,
                    'so_number' => $this->salesOrder->so_number,
                    'total_amount' => (string) $this->salesOrder->total_amount,
                    'status' => $this->salesOrder->status,
                ];
            }),
            'customer' => $this->whenLoaded('customer', function () {
                return [
                    'id' => $this->customer->id,
                    'name' => $this->customer->name,
                    'email' => $this->customer->email,
                ];
            }),
            'customer_payments' => CustomerPaymentResource::collection($this->whenLoaded('customerPayments')),
            'general_ledgers' => GeneralLedgerResource::collection($this->whenLoaded('generalLedgers')),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
