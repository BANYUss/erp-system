<?php

namespace App\Http\Requests\Sales;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSalesOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('sales_orders.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->so_number)) {
            $trimmed = trim($this->so_number);
            $this->merge([
                'so_number' => $trimmed !== '' ? $trimmed : null,
            ]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'customer_id' => [
                'required',
                'integer',
                Rule::exists('customers', 'id')->whereNull('deleted_at'),
            ],
            'so_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._\/-]+$/',
                Rule::unique('sales_orders', 'so_number'),
            ],
            'order_date' => [
                'sometimes',
                'nullable',
                'date_format:Y-m-d',
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
