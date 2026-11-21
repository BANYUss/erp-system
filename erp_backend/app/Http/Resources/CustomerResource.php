<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Customer
 */
class CustomerResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $canViewCreditLimit = $user !== null && $user->can('customers.view_credit_limit');

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'credit_limit' => $this->when($canViewCreditLimit, (string) $this->credit_limit),
            'status' => $this->status,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
