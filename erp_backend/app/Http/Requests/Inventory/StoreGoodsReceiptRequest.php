<?php

namespace App\Http\Requests\Inventory;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreGoodsReceiptRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('goods_receipts.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $merged = [];

        if (is_string($this->receipt_number)) {
            $trimmed = trim($this->receipt_number);
            $merged['receipt_number'] = $trimmed !== '' ? $trimmed : null;
        }

        if (is_array($this->items)) {
            $merged['items'] = array_map(static function ($item) {
                if (is_array($item) && isset($item['batch_number']) && is_string($item['batch_number'])) {
                    $item['batch_number'] = trim($item['batch_number']);
                }

                return $item;
            }, $this->items);
        }

        if ($merged !== []) {
            $this->merge($merged);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'po_id' => [
                'required',
                'integer',
                Rule::exists('purchase_orders', 'id')->whereNull('deleted_at'),
            ],
            'receipt_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._-]+$/',
                Rule::unique('goods_receipts', 'receipt_number'),
            ],
            'received_date' => [
                'required',
                'date_format:Y-m-d',
            ],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => [
                'required',
                'integer',
                Rule::exists('products', 'id')->whereNull('deleted_at'),
            ],
            'items.*.batch_number' => [
                'required',
                'string',
                'max:100',
                'regex:/^[A-Za-z0-9._-]+$/',
            ],
            'items.*.expiry_date' => [
                'required',
                'date_format:Y-m-d',
                'after_or_equal:received_date',
            ],
            'items.*.qty_received' => [
                'required',
                'numeric',
                'gt:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
        ];
    }
}
