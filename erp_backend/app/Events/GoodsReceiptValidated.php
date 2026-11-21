<?php

namespace App\Events;

use App\Models\GoodsReceipt;
use App\Models\User;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class GoodsReceiptValidated
{
    use Dispatchable, SerializesModels;

    /**
     * @param  array<int, array<string, mixed>>  $valuations
     */
    public function __construct(
        public readonly GoodsReceipt $goodsReceipt,
        public readonly array $valuations,
        public readonly User $actor
    ) {}
}
