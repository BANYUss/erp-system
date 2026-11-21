<?php

namespace App\Http\Requests\Sales;

use Illuminate\Foundation\Http\FormRequest;

class ConfirmSalesOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->canAny([
            'sales_orders.update',
            'customers.override_credit_limit',
        ]) ?? false;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'override_credit_limit' => ['sometimes', 'boolean'],
            'override_reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
