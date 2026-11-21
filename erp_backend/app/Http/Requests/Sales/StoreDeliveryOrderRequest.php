<?php

namespace App\Http\Requests\Sales;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDeliveryOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('delivery_orders.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->do_number)) {
            $trimmed = trim($this->do_number);
            $this->merge([
                'do_number' => $trimmed !== '' ? $trimmed : null,
            ]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'sales_order_id' => [
                'required',
                'integer',
                Rule::exists('sales_orders', 'id')->whereNull('deleted_at'),
            ],
            'do_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._\/-]+$/',
                Rule::unique('delivery_orders', 'do_number'),
            ],
            'delivery_date' => [
                'required',
                'date_format:Y-m-d',
            ],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => [
                'required',
                'integer',
                Rule::exists('products', 'id')->whereNull('deleted_at'),
            ],
            'items.*.qty_dispatched' => [
                'required',
                'numeric',
                'gt:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
        ];
    }
}
