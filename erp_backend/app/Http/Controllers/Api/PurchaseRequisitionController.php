<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Procurement\ConvertPurchaseRequisitionToPoRequest;
use App\Http\Requests\Procurement\StorePurchaseRequisitionRequest;
use App\Http\Resources\PurchaseOrderResource;
use App\Http\Resources\PurchaseRequisitionResource;
use App\Models\PurchaseRequisition;
use App\Services\Procurement\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class PurchaseRequisitionController extends Controller
{
    public function __construct(
        private readonly PurchaseOrderService $purchaseOrderService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = PurchaseRequisition::query()
            ->with(['requestor', 'purchaseOrders'])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('pr_number', 'like', "%{$search}%");
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }

        return PurchaseRequisitionResource::collection($query->paginate($perPage));
    }

    public function store(StorePurchaseRequisitionRequest $request): JsonResponse
    {
        $purchaseRequisition = $this->purchaseOrderService->createPurchaseRequisition(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new PurchaseRequisitionResource($purchaseRequisition))
            ->additional(['message' => 'Purchase Requisition berhasil dibuat.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(PurchaseRequisition $purchaseRequisition): PurchaseRequisitionResource
    {
        $purchaseRequisition->load(['requestor', 'purchaseOrders']);

        return new PurchaseRequisitionResource($purchaseRequisition);
    }

    public function submit(Request $request, PurchaseRequisition $purchaseRequisition): PurchaseRequisitionResource
    {
        $updatedPr = $this->purchaseOrderService->submitPurchaseRequisition(
            purchaseRequisition: $purchaseRequisition,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new PurchaseRequisitionResource($updatedPr))
            ->additional(['message' => 'Purchase Requisition berhasil disubmit.']);
    }

    public function convertToPurchaseOrder(
        ConvertPurchaseRequisitionToPoRequest $request,
        PurchaseRequisition $purchaseRequisition
    ): JsonResponse {
        $purchaseOrder = $this->purchaseOrderService->convertRequisitionToPurchaseOrder(
            purchaseRequisition: $purchaseRequisition,
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new PurchaseOrderResource($purchaseOrder))
            ->additional(['message' => 'Purchase Requisition berhasil dikonversi menjadi Purchase Order.'])
            ->response()
            ->setStatusCode(201);
    }
}
