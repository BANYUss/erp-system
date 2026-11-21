<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class GeneralLedger extends Model
{
    use HasFactory;

    public const ACCOUNT_CASH_BANK = '1101-CASH-BANK';
    public const ACCOUNT_AR = '1102-AR';
    public const ACCOUNT_INVENTORY = '1201-INVENTORY';
    public const ACCOUNT_AP = '2101-AP';
    public const ACCOUNT_GRIR_CLEARING = '2102-GRIR';
    public const ACCOUNT_SALES_REVENUE = '4101-SALES-REVENUE';
    public const ACCOUNT_COGS = '5101-COGS';

    protected static function booted(): void
    {
        static::updating(static function (): void {
            throw new \LogicException('GeneralLedger bersifat immutable dan tidak dapat diubah.');
        });

        static::deleting(static function (): void {
            throw new \LogicException('GeneralLedger bersifat immutable dan tidak dapat dihapus.');
        });
    }

    /**
     * @var array<int, string>
     */
    protected $fillable = [
        'transaction_date',
        'account_code',
        'debit',
        'credit',
        'reference_type',
        'reference_id',
        'description',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'transaction_date' => 'date',
            'debit' => 'decimal:2',
            'credit' => 'decimal:2',
        ];
    }

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }
}
