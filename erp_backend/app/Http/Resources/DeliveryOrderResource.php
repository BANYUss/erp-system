<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\DeliveryOrder
 */
class DeliveryOrderResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewCost = $user !== null && $user->can('inventory.view_cost');
        $canViewSellingPrice = $user !== null && $user->can('products.view_selling_price');
        $canViewGeneralLedger = $user !== null && $user->can('general_ledger.view');

        $totalCogs = null;
        if ($canViewCost && $this->relationLoaded('items')) {
            $rawTotal = '0.0000';
            foreach ($this->items as $item) {
                $rawTotal = bcadd(
                    $rawTotal,
                    bcmul((string) $item->qty_dispatched, (string) $item->unit_cost, 4),
                    4
                );
            }
            $totalCogs = bcadd(bcadd($rawTotal, '0.0050', 4), '0', 2);
        }

        return [
            'id' => $this->id,
            'do_number' => $this->do_number,
            'sales_order_id' => $this->sales_order_id,
            'delivery_date' => $this->delivery_date?->format('Y-m-d'),
            'status' => $this->status,
            // Kolom HPP/COGS disembunyikan sepenuhnya dari Admin Sales & Staf Gudang
            'total_cogs' => $this->when($canViewCost && $this->relationLoaded('items'), $totalCogs),
            'sales_order' => $this->whenLoaded('salesOrder', function () use ($canViewSellingPrice) {
                $soData = [
                    'id' => $this->salesOrder->id,
                    'so_number' => $this->salesOrder->so_number,
                    'customer_id' => $this->salesOrder->customer_id,
                    'status' => $this->salesOrder->status,
                ];

                if ($canViewSellingPrice) {
                    $soData['total_amount'] = (string) $this->salesOrder->total_amount;
                }

                if ($this->salesOrder->relationLoaded('customer') && $this->salesOrder->customer !== null) {
                    $soData['customer'] = [
                        'id' => $this->salesOrder->customer->id,
                        'name' => $this->salesOrder->customer->name,
                    ];
                }

                return $soData;
            }),
            'items' => DeliveryOrderItemResource::collection($this->whenLoaded('items')),
            'general_ledgers' => $this->when(
                $canViewGeneralLedger && $this->relationLoaded('generalLedgers'),
                fn () => GeneralLedgerResource::collection($this->generalLedgers)
            ),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
