<?php

namespace App\Http\Requests\Finance;

use Illuminate\Foundation\Http\FormRequest;

class StoreGeneralLedgerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('general_ledger.manage') ?? false;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'transaction_date' => [
                'required',
                'date_format:Y-m-d',
            ],
            'lines' => ['required', 'array', 'min:2'],
            'lines.*.account_code' => [
                'required',
                'string',
                'max:50',
            ],
            'lines.*.debit' => [
                'required',
                'numeric',
                'gte:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
            'lines.*.credit' => [
                'required',
                'numeric',
                'gte:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
            'lines.*.description' => [
                'sometimes',
                'nullable',
                'string',
                'max:500',
            ],
        ];
    }
}
