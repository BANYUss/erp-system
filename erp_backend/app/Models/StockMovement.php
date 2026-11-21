<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class StockMovement extends Model
{
    use HasFactory;

    public const TYPE_IN = 'IN';
    public const TYPE_OUT = 'OUT';
    public const TYPE_ADJ = 'ADJ';

    protected static function booted(): void
    {
        static::updating(static function (): void {
            throw new \LogicException('StockMovement bersifat immutable dan tidak dapat diubah.');
        });

        static::deleting(static function (): void {
            throw new \LogicException('StockMovement bersifat immutable dan tidak dapat dihapus.');
        });
    }

    /**
     * @var array<int, string>
     */
    protected $fillable = [
        'product_batch_id',
        'type',
        'qty_change',
        'reference_type',
        'reference_id',
        'user_id',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => 'string',
            'qty_change' => 'decimal:2',
        ];
    }

    public function productBatch(): BelongsTo
    {
        return $this->belongsTo(ProductBatch::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }
}
