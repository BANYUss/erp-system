<?php

namespace App\Http\Requests\Procurement;

use Illuminate\Foundation\Http\FormRequest;

class ApprovePurchaseOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('purchase_orders.approve') ?? false;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->notes)) {
            $this->merge([
                'notes' => trim($this->notes) !== '' ? trim($this->notes) : null,
            ]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
