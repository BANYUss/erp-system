<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FefoPickingResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewCost = $user !== null && $user->can('inventory.view_cost');

        $pickingList = array_map(static function (array $entry) use ($canViewCost): array {
            $item = [
                'inventory_ledger_id' => $entry['inventory_ledger_id'],
                'product_batch_id' => $entry['product_batch_id'],
                'batch_number' => $entry['batch_number'],
                'expiry_date' => $entry['expiry_date'],
                'state' => $entry['state'],
                'available_qty' => $entry['available_qty'],
                'pick_qty' => $entry['pick_qty'],
                'remaining_batch_qty' => $entry['remaining_batch_qty'],
            ];

            // Kolom cost_price disembunyikan dari Staf Gudang dan role tanpa inventory.view_cost
            if ($canViewCost) {
                $item['cost_price'] = $entry['cost_price'];
            }

            return $item;
        }, $this->resource['picking_list'] ?? []);

        return [
            'product' => $this->resource['product'],
            'requested_qty' => $this->resource['requested_qty'],
            'total_available_qty' => $this->resource['total_available_qty'],
            'allocated_qty' => $this->resource['allocated_qty'],
            'shortage_qty' => $this->resource['shortage_qty'],
            'is_fulfilled' => (bool) $this->resource['is_fulfilled'],
            'picking_list' => $pickingList,
        ];
    }
}
