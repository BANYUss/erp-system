<?php

namespace App\Http\Requests\Finance;

use App\Models\CustomerPayment;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCustomerPaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('payments.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $merged = [];

        if (is_string($this->receipt_number)) {
            $trimmed = trim($this->receipt_number);
            $merged['receipt_number'] = $trimmed !== '' ? $trimmed : null;
        }

        if (is_string($this->payment_method)) {
            $merged['payment_method'] = strtolower(trim($this->payment_method));
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
            'sales_invoice_id' => [
                'required',
                'integer',
                Rule::exists('sales_invoices', 'id')->whereNull('deleted_at'),
            ],
            'receipt_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._\/-]+$/',
                Rule::unique('customer_payments', 'receipt_number'),
            ],
            'amount_received' => [
                'required',
                'numeric',
                'gt:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
            'payment_date' => [
                'required',
                'date_format:Y-m-d',
            ],
            'payment_method' => [
                'required',
                'string',
                'max:50',
                Rule::in([
                    CustomerPayment::METHOD_BANK_TRANSFER,
                    CustomerPayment::METHOD_CASH,
                    CustomerPayment::METHOD_GIRO,
                    CustomerPayment::METHOD_CHEQUE,
                    CustomerPayment::METHOD_VIRTUAL_ACCOUNT,
                ]),
            ],
            'idempotency_key' => [
                'required',
                'string',
                'max:255',
            ],
        ];
    }
}
