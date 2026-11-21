<?php

namespace App\Http\Requests\MasterData;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('products.manage') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $this->merge(array_filter([
            'sku' => is_string($this->sku) ? trim($this->sku) : $this->sku,
            'name' => is_string($this->name) ? trim($this->name) : $this->name,
            'uom' => is_string($this->uom) ? trim($this->uom) : $this->uom,
        ], fn ($value) => $value !== null));
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'sku' => [
                'required',
                'string',
                'max:255',
                'regex:/^[A-Za-z0-9._-]+$/',
                Rule::unique('products', 'sku'),
            ],
            'name' => ['required', 'string', 'min:2', 'max:255'],
            'category_id' => ['nullable', 'integer', 'min:1'],
            'uom' => ['required', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
