<?php

namespace App\Http\Requests\MasterData;

use App\Models\Supplier;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateSupplierRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('suppliers.manage') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $updates = [];

        foreach (['name', 'contact_name', 'email', 'phone', 'address', 'status'] as $field) {
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
        $supplier = $this->route('supplier');
        $supplierId = $supplier instanceof Supplier ? $supplier->id : $supplier;

        return [
            'name' => ['sometimes', 'required', 'string', 'min:2', 'max:255'],
            'contact_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'email' => [
                'sometimes',
                'nullable',
                'string',
                'email:rfc',
                'max:255',
                Rule::unique('suppliers', 'email')->ignore($supplierId),
            ],
            'phone' => ['sometimes', 'nullable', 'string', 'max:50', 'regex:/^[0-9+\-\s()]+$/'],
            'address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'status' => ['sometimes', 'required', 'string', Rule::in(['active', 'inactive', 'blacklisted'])],
        ];
    }
}
