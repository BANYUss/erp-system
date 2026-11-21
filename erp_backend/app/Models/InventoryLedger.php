<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InventoryLedger extends Model
{
    use HasFactory;

    public const STATE_AVAILABLE = 'available';
    public const STATE_RESERVED = 'reserved';
    public const STATE_IN_TRANSIT = 'in_transit';
    public const STATE_IN_QC = 'in_qc';

    /**
     * @var array<int, string>
     */
    protected $fillable = [
        'product_batch_id',
        'state',
        'qty',
        'cost_price',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'state' => 'string',
            'qty' => 'decimal:2',
            'cost_price' => 'decimal:2',
        ];
    }

    public function productBatch(): BelongsTo
    {
        return $this->belongsTo(ProductBatch::class);
    }
}
