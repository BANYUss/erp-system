<?php

namespace App\Http\Requests\MasterData;

use App\Models\Product;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('products.manage') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $updates = [];

        if ($this->has('sku') && is_string($this->sku)) {
            $updates['sku'] = trim($this->sku);
        }

        if ($this->has('name') && is_string($this->name)) {
            $updates['name'] = trim($this->name);
        }

        if ($this->has('uom') && is_string($this->uom)) {
            $updates['uom'] = trim($this->uom);
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
        $product = $this->route('product');
        $productId = $product instanceof Product ? $product->id : $product;

        return [
            'sku' => [
                'sometimes',
                'required',
                'string',
                'max:255',
                'regex:/^[A-Za-z0-9._-]+$/',
                Rule::unique('products', 'sku')->ignore($productId),
            ],
            'name' => ['sometimes', 'required', 'string', 'min:2', 'max:255'],
            'category_id' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'uom' => ['sometimes', 'required', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
