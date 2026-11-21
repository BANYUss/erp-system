<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Finance\StoreGeneralLedgerRequest;
use App\Http\Resources\GeneralLedgerResource;
use App\Models\GeneralLedger;
use App\Services\Finance\GeneralLedgerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class GeneralLedgerController extends Controller
{
    public function __construct(
        private readonly GeneralLedgerService $generalLedgerService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = GeneralLedger::query()->orderByDesc('transaction_date')->orderByDesc('id');

        if ($request->filled('account_code')) {
            $query->where('account_code', trim((string) $request->query('account_code')));
        }

        if ($request->filled('reference_type')) {
            $query->where('reference_type', trim((string) $request->query('reference_type')));
        }

        if ($request->filled('reference_id')) {
            $query->where('reference_id', $request->integer('reference_id'));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('transaction_date', '>=', (string) $request->query('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('transaction_date', '<=', (string) $request->query('date_to'));
        }

        return GeneralLedgerResource::collection($query->paginate($perPage));
    }

    public function store(StoreGeneralLedgerRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $entries = $this->generalLedgerService->recordJournalEntry(
            transactionDate: (string) $validated['transaction_date'],
            lines: $validated['lines'],
            reference: null,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return GeneralLedgerResource::collection($entries)
            ->additional(['message' => 'Entri jurnal General Ledger berhasil dicatat.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(GeneralLedger $generalLedger): GeneralLedgerResource
    {
        return new GeneralLedgerResource($generalLedger);
    }

    public function summary(Request $request): JsonResponse
    {
        $trialBalance = $this->generalLedgerService->getTrialBalance(
            dateFrom: $request->filled('date_from') ? (string) $request->query('date_from') : null,
            dateTo: $request->filled('date_to') ? (string) $request->query('date_to') : null
        );

        return response()->json([
            'data' => $trialBalance,
        ]);
    }
}
