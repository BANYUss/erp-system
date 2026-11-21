<?php

namespace App\Listeners;

use App\Events\DeliveryOrderDispatched;
use App\Services\Finance\GeneralLedgerService;

class RecordDeliveryOrderCogsJournalListener
{
    public function __construct(
        private readonly GeneralLedgerService $generalLedgerService
    ) {}

    public function handle(DeliveryOrderDispatched $event): void
    {
        $this->generalLedgerService->recordDeliveryOrderCogsJournal(
            deliveryOrder: $event->deliveryOrder,
            dispatches: $event->dispatches,
            actor: $event->actor
        );
    }
}
