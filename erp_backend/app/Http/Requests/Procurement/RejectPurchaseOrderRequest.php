<?php

namespace App\Http\Requests\Procurement;

use Illuminate\Foundation\Http\FormRequest;

class RejectPurchaseOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('purchase_orders.approve') ?? false;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->reason)) {
            $this->merge([
                'reason' => trim($this->reason) !== '' ? trim($this->reason) : null,
            ]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'reason' => ['sometimes', 'nullable', 'string', 'min:3', 'max:500'],
        ];
    }
}
