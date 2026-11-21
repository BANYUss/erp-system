<?php

namespace App\Http\Requests\Finance;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ApAgingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->canAny(['invoices.view', 'financial_reports.view']) ?? false;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'as_of_date' => [
                'sometimes',
                'nullable',
                'date_format:Y-m-d',
            ],
            'supplier_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('suppliers', 'id')->whereNull('deleted_at'),
            ],
        ];
    }
}
