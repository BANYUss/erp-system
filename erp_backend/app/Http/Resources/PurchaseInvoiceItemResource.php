<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\PurchaseInvoiceItem
 */
class PurchaseInvoiceItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'purchase_invoice_id' => $this->purchase_invoice_id,
            'product_id' => $this->product_id,
            'qty_billed' => (string) $this->qty_billed,
            'unit_price' => (string) $this->unit_price,
            'line_total' => (string) $this->line_total,
            'product' => $this->whenLoaded('product', function () {
                return [
                    'id' => $this->product->id,
                    'sku' => $this->product->sku,
                    'name' => $this->product->name,
                    'uom' => $this->product->uom,
                ];
            }),
        ];
    }
}
