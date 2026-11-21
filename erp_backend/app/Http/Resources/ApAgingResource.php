<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ApAgingResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'as_of_date' => $this->resource['as_of_date'],
            'total_outstanding' => $this->resource['total_outstanding'],
            'total_invoices' => $this->resource['total_invoices'],
            'buckets' => $this->resource['buckets'],
            'by_supplier' => $this->resource['by_supplier'],
        ];
    }
}
