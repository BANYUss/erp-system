<?php

namespace App\Http\Requests\Finance;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSalesInvoiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('invoices.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $merged = [];

        if (is_string($this->invoice_number)) {
            $trimmed = trim($this->invoice_number);
            $merged['invoice_number'] = $trimmed !== '' ? $trimmed : null;
        }

        $idempotencyKey = $this->input('idempotency_key');
        if (! is_string($idempotencyKey) || trim($idempotencyKey) === '') {
            $headerKey = $this->header('Idempotency-Key');
            if (is_string($headerKey) && trim($headerKey) !== '') {
                $merged['idempotency_key'] = trim($headerKey);
            }
        } else {
            $merged['idempotency_key'] = trim($idempotencyKey);
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
            'sales_order_id' => [
                'required_without:delivery_order_id',
                'nullable',
                'integer',
                Rule::exists('sales_orders', 'id')->whereNull('deleted_at'),
            ],
            'delivery_order_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('delivery_orders', 'id')->whereNull('deleted_at'),
            ],
            'customer_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('customers', 'id')->whereNull('deleted_at'),
            ],
            'invoice_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._\/-]+$/',
                Rule::unique('sales_invoices', 'invoice_number'),
            ],
            'invoice_date' => [
                'sometimes',
                'nullable',
                'date_format:Y-m-d',
            ],
            'due_date' => [
                'required',
                'date_format:Y-m-d',
            ],
            'total_billed' => [
                'sometimes',
                'nullable',
                'numeric',
                'gt:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
            'idempotency_key' => [
                'required',
                'string',
                'max:255',
            ],
        ];
    }
}
