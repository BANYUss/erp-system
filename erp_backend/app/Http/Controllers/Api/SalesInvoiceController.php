<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Finance\ArAgingRequest;
use App\Http\Requests\Finance\StoreSalesInvoiceRequest;
use App\Http\Resources\ArAgingResource;
use App\Http\Resources\SalesInvoiceResource;
use App\Models\SalesInvoice;
use App\Services\Finance\AccountReceivableService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class SalesInvoiceController extends Controller
{
    public function __construct(
        private readonly AccountReceivableService $accountReceivableService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = SalesInvoice::query()
            ->with(['salesOrder', 'customer', 'customerPayments'])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('invoice_number', 'like', "%{$search}%");
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }

        if ($request->filled('sales_order_id')) {
            $query->where('sales_order_id', $request->integer('sales_order_id'));
        }

        if ($request->filled('customer_id')) {
            $query->where('customer_id', $request->integer('customer_id'));
        }

        return SalesInvoiceResource::collection($query->paginate($perPage));
    }

    public function store(StoreSalesInvoiceRequest $request): JsonResponse
    {
        $invoice = $this->accountReceivableService->createSalesInvoice(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new SalesInvoiceResource($invoice))
            ->additional(['message' => 'Sales Invoice (AR) berhasil diterbitkan dan jurnal pendapatan telah dicatat.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(SalesInvoice $salesInvoice): SalesInvoiceResource
    {
        $salesInvoice->load([
            'salesOrder.customer',
            'customer',
            'customerPayments',
            'generalLedgers',
        ]);

        return new SalesInvoiceResource($salesInvoice);
    }

    public function destroy(Request $request, SalesInvoice $salesInvoice): JsonResponse
    {
        $this->accountReceivableService->deleteSalesInvoice(
            invoice: $salesInvoice,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return response()->json([
            'message' => 'Sales Invoice berhasil dihapus dan jurnal balik telah dicatat.',
        ]);
    }

    public function arAging(ArAgingRequest $request): ArAgingResource
    {
        $validated = $request->validated();

        $summary = $this->accountReceivableService->getArAgingSummary(
            asOfDate: $validated['as_of_date'] ?? null,
            customerId: isset($validated['customer_id']) ? (int) $validated['customer_id'] : null
        );

        return new ArAgingResource($summary);
    }
}
