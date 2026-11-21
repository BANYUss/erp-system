<?php

namespace App\Http\Resources;

use App\Models\InventoryLedger;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Product
 */
class ProductResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewCost = $user !== null && $user->can('inventory.view_cost');
        $canViewAvailable = $user !== null && $user->can('inventory.view_available');

        $ledgers = $this->relationLoaded('batches')
            ? $this->batches->flatMap(fn ($batch) => $batch->relationLoaded('inventoryLedgers') ? $batch->inventoryLedgers : collect())
            : collect();

        $availableQty = '0.00';
        $totalQty = '0.00';
        $totalInventoryValue = '0.0000';

        foreach ($ledgers as $ledger) {
            $qty = (string) $ledger->qty;
            $totalQty = bcadd($totalQty, $qty, 2);

            if ($ledger->state === InventoryLedger::STATE_AVAILABLE) {
                $availableQty = bcadd($availableQty, $qty, 2);
            }

            if ($canViewCost) {
                $lineValue = bcmul($qty, (string) $ledger->cost_price, 4);
                $totalInventoryValue = bcadd($totalInventoryValue, $lineValue, 4);
            }
        }

        $averageCostPrice = null;
        if ($canViewCost && bccomp($totalQty, '0.00', 2) > 0) {
            $averageCostPrice = bcdiv($totalInventoryValue, $totalQty, 2);
        }

        return [
            'id' => $this->id,
            'sku' => $this->sku,
            'name' => $this->name,
            'category_id' => $this->category_id,
            'uom' => $this->uom,
            'is_active' => (bool) $this->is_active,
            'available_qty' => $this->when($canViewAvailable && $this->relationLoaded('batches'), $availableQty),
            // Kolom finansial disembunyikan sepenuhnya untuk Staf Gudang dan role tanpa izin inventory.view_cost
            'cost_price' => $this->when($canViewCost, $averageCostPrice),
            'inventory_value' => $this->when($canViewCost, bcadd($totalInventoryValue, '0', 2)),
            'batches' => $this->whenLoaded('batches', function () use ($canViewCost) {
                return $this->batches->map(function ($batch) use ($canViewCost) {
                    return [
                        'id' => $batch->id,
                        'batch_number' => $batch->batch_number,
                        'expiry_date' => $batch->expiry_date?->format('Y-m-d'),
                        'inventory_ledgers' => $batch->relationLoaded('inventoryLedgers')
                            ? $batch->inventoryLedgers->map(function ($ledger) use ($canViewCost) {
                                $ledgerData = [
                                    'id' => $ledger->id,
                                    'state' => $ledger->state,
                                    'qty' => (string) $ledger->qty,
                                ];

                                if ($canViewCost) {
                                    $ledgerData['cost_price'] = (string) $ledger->cost_price;
                                }

                                return $ledgerData;
                            })->values()
                            : [],
                    ];
                })->values();
            }),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
