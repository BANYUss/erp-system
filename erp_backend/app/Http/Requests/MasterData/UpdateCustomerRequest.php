<?php

namespace App\Http\Requests\MasterData;

use App\Models\Customer;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCustomerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('customers.manage') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $updates = [];

        foreach (['name', 'email', 'status'] as $field) {
            if ($this->has($field) && is_string($this->input($field))) {
                $updates[$field] = trim($this->input($field));
            }
        }

        if ($updates !== []) {
            $this->merge($updates);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        $customer = $this->route('customer');
        $customerId = $customer instanceof Customer ? $customer->id : $customer;

        return [
            'name' => ['sometimes', 'required', 'string', 'min:2', 'max:255'],
            'email' => [
                'sometimes',
                'nullable',
                'string',
                'email:rfc',
                'max:255',
                Rule::unique('customers', 'email')->ignore($customerId),
            ],
            'credit_limit' => ['sometimes', 'required', 'numeric', 'min:0', 'max:9999999999999.99', 'decimal:0,2'],
            'status' => ['sometimes', 'required', 'string', Rule::in(['active', 'inactive', 'suspended'])],
        ];
    }
}
