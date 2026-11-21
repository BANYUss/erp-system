<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class CustomerPayment extends Model
{
    use HasFactory, SoftDeletes;

    public const METHOD_BANK_TRANSFER = 'bank_transfer';
    public const METHOD_CASH = 'cash';
    public const METHOD_GIRO = 'giro';
    public const METHOD_CHEQUE = 'cheque';
    public const METHOD_VIRTUAL_ACCOUNT = 'virtual_account';

    /**
     * @var array<int, string>
     */
    protected $fillable = [
        'receipt_number',
        'sales_invoice_id',
        'amount_received',
        'payment_date',
        'payment_method',
        'idempotency_key',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount_received' => 'decimal:2',
            'payment_date' => 'date',
        ];
    }

    public function salesInvoice(): BelongsTo
    {
        return $this->belongsTo(SalesInvoice::class, 'sales_invoice_id');
    }

    public function generalLedgers(): MorphMany
    {
        return $this->morphMany(GeneralLedger::class, 'reference');
    }
}
