<?php

namespace App\Http\Requests\Inventory;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class FefoPickingRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return $user !== null
            && ($user->can('inventory.view_available') || $user->can('inventory.view_physical'));
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'product_id' => [
                'required',
                'integer',
                Rule::exists('products', 'id')->whereNull('deleted_at'),
            ],
            'qty' => [
                'required',
                'numeric',
                'gt:0',
                'regex:/^\d{1,13}(\.\d{1,2})?$/',
            ],
        ];
    }
}
