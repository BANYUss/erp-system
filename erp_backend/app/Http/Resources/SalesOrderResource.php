<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\SalesOrder
 */
class SalesOrderResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewSellingPrice = $user !== null && $user->can('products.view_selling_price');

        return [
            'id' => $this->id,
            'so_number' => $this->so_number,
            'customer_id' => $this->customer_id,
            'salesperson_id' => $this->salesperson_id,
            'order_date' => $this->order_date?->format('Y-m-d'),
            'total_amount' => $this->when($canViewSellingPrice, (string) $this->total_amount),
            'status' => $this->status,
            'customer' => $this->whenLoaded('customer', function () {
                return new CustomerResource($this->customer);
            }),
            'salesperson' => $this->whenLoaded('salesperson', function () {
                return $this->salesperson === null ? null : [
                    'id' => $this->salesperson->id,
                    'name' => $this->salesperson->name,
                    'email' => $this->salesperson->email,
                ];
            }),
            'items' => SalesOrderItemResource::collection($this->whenLoaded('items')),
            'delivery_orders' => DeliveryOrderResource::collection($this->whenLoaded('deliveryOrders')),
            'sales_invoices' => SalesInvoiceResource::collection($this->whenLoaded('salesInvoices')),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
