<?php

namespace App\Events;

use App\Models\DeliveryOrder;
use App\Models\User;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class DeliveryOrderDispatched
{
    use Dispatchable, SerializesModels;

    /**
     * @param  array<int, array<string, mixed>>  $dispatches
     */
    public function __construct(
        public readonly DeliveryOrder $deliveryOrder,
        public readonly array $dispatches,
        public readonly User $actor
    ) {}
}
