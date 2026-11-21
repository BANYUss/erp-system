<?php

namespace App\Http\Requests\Finance;

use App\Models\PaymentVoucher;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePaymentVoucherRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('payments.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $merged = [];

        if (is_string($this->voucher_number)) {
            $trimmed = trim($this->voucher_number);
            $merged['voucher_number'] = $trimmed !== '' ? $trimmed : null;
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
            'purchase_invoice_id' => [
                'required',
                'integer',
                Rule::exists('purchase_invoices', 'id')->whereNull('deleted_at'),
            ],
            'voucher_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._\/-]+$/',
                Rule::unique('payment_vouchers', 'voucher_number'),
            ],
            'amount_paid' => [
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
                    PaymentVoucher::METHOD_BANK_TRANSFER,
                    PaymentVoucher::METHOD_CASH,
                    PaymentVoucher::METHOD_GIRO,
                    PaymentVoucher::METHOD_CHEQUE,
                    PaymentVoucher::METHOD_VIRTUAL_ACCOUNT,
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
