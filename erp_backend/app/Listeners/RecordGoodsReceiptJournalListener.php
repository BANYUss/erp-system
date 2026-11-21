<?php

namespace App\Listeners;

use App\Events\GoodsReceiptValidated;
use App\Services\Finance\GeneralLedgerService;

class RecordGoodsReceiptJournalListener
{
    public function __construct(
        private readonly GeneralLedgerService $generalLedgerService
    ) {}

    public function handle(GoodsReceiptValidated $event): void
    {
        $this->generalLedgerService->recordGoodsReceiptJournal(
            goodsReceipt: $event->goodsReceipt,
            valuations: $event->valuations,
            actor: $event->actor
        );
    }
}
