<?php

namespace App\Http\Requests\Sales;

use Illuminate\Foundation\Http\FormRequest;

class DispatchDeliveryOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('delivery_orders.process') ?? false;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [];
    }
}
