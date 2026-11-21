<?php

namespace App\Http\Requests\Procurement;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ConvertPurchaseRequisitionToPoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('purchase_orders.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->po_number)) {
            $this->merge([
                'po_number' => trim($this->po_number) !== '' ? trim($this->po_number) : null,
            ]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'po_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._-]+$/',
                Rule::unique('purchase_orders', 'po_number'),
            ],
            'supplier_id' => [
                'required',
                'integer',
                Rule::exists('suppliers', 'id')->whereNull('deleted_at'),
            ],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => [
                'required',
                'integer',
                Rule::exists('products', 'id')->whereNull('deleted_at'),
            ],
            'items.*.qty_ordered' => [
                'required',
                'numeric',
                'gt:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
            'items.*.unit_price' => [
                'required',
                'numeric',
                'gt:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
        ];
    }
}
