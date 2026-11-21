<?php

namespace App\Http\Requests\Procurement;

use App\Models\PurchaseRequisition;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePurchaseRequisitionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('purchase_requisitions.create') ?? false;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->pr_number)) {
            $this->merge([
                'pr_number' => trim($this->pr_number) !== '' ? trim($this->pr_number) : null,
            ]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'pr_number' => [
                'sometimes',
                'nullable',
                'string',
                'max:50',
                'regex:/^[A-Za-z0-9._-]+$/',
                Rule::unique('purchase_requisitions', 'pr_number'),
            ],
            'status' => [
                'sometimes',
                'string',
                Rule::in([
                    PurchaseRequisition::STATUS_DRAFT,
                    PurchaseRequisition::STATUS_SUBMITTED,
                ]),
            ],
        ];
    }
}
