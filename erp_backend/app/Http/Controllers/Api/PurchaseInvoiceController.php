<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Finance\ApAgingRequest;
use App\Http\Requests\Finance\StorePurchaseInvoiceRequest;
use App\Http\Resources\ApAgingResource;
use App\Http\Resources\PurchaseInvoiceResource;
use App\Models\PurchaseInvoice;
use App\Services\Finance\AccountPayableService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class PurchaseInvoiceController extends Controller
{
    public function __construct(
        private readonly AccountPayableService $accountPayableService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = PurchaseInvoice::query()
            ->with(['purchaseOrder', 'supplier', 'items.product', 'paymentVouchers'])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('invoice_number', 'like', "%{$search}%");
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }

        if ($request->filled('po_id')) {
            $query->where('po_id', $request->integer('po_id'));
        }

        if ($request->filled('supplier_id')) {
            $query->where('supplier_id', $request->integer('supplier_id'));
        }

        return PurchaseInvoiceResource::collection($query->paginate($perPage));
    }

    public function store(StorePurchaseInvoiceRequest $request): JsonResponse
    {
        $invoice = $this->accountPayableService->createPurchaseInvoice(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new PurchaseInvoiceResource($invoice))
            ->additional(['message' => 'Purchase Invoice berhasil dibuat setelah lolos validasi 3-Way Matching.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(PurchaseInvoice $purchaseInvoice): PurchaseInvoiceResource
    {
        $purchaseInvoice->load([
            'purchaseOrder.supplier',
            'supplier',
            'items.product',
            'paymentVouchers',
            'generalLedgers',
        ]);

        return new PurchaseInvoiceResource($purchaseInvoice);
    }

    public function destroy(Request $request, PurchaseInvoice $purchaseInvoice): JsonResponse
    {
        $this->accountPayableService->deletePurchaseInvoice(
            invoice: $purchaseInvoice,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return response()->json([
            'message' => 'Purchase Invoice berhasil dihapus dan jurnal balik telah dicatat.',
        ]);
    }

    public function apAging(ApAgingRequest $request): ApAgingResource
    {
        $validated = $request->validated();

        $summary = $this->accountPayableService->getApAgingSummary(
            asOfDate: $validated['as_of_date'] ?? null,
            supplierId: isset($validated['supplier_id']) ? (int) $validated['supplier_id'] : null
        );

        return new ApAgingResource($summary);
    }
}
