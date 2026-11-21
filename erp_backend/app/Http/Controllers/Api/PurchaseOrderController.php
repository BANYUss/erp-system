<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Procurement\ApprovePurchaseOrderRequest;
use App\Http\Requests\Procurement\RejectPurchaseOrderRequest;
use App\Http\Requests\Procurement\StorePurchaseOrderRequest;
use App\Http\Resources\PurchaseOrderResource;
use App\Models\PurchaseOrder;
use App\Services\Procurement\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class PurchaseOrderController extends Controller
{
    public function __construct(
        private readonly PurchaseOrderService $purchaseOrderService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = PurchaseOrder::query()
            ->with(['purchaseRequisition', 'supplier', 'approver', 'items.product'])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('po_number', 'like', "%{$search}%");
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }

        if ($request->filled('supplier_id')) {
            $query->where('supplier_id', $request->integer('supplier_id'));
        }

        if ($request->filled('pr_id')) {
            $query->where('pr_id', $request->integer('pr_id'));
        }

        return PurchaseOrderResource::collection($query->paginate($perPage));
    }

    public function store(StorePurchaseOrderRequest $request): JsonResponse
    {
        $purchaseOrder = $this->purchaseOrderService->createPurchaseOrder(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new PurchaseOrderResource($purchaseOrder))
            ->additional(['message' => 'Purchase Order berhasil dibuat.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(PurchaseOrder $purchaseOrder): PurchaseOrderResource
    {
        $purchaseOrder->load(['purchaseRequisition', 'supplier', 'approver', 'items.product']);

        return new PurchaseOrderResource($purchaseOrder);
    }

    public function approve(ApprovePurchaseOrderRequest $request, PurchaseOrder $purchaseOrder): PurchaseOrderResource
    {
        $approvedPo = $this->purchaseOrderService->approvePurchaseOrder(
            purchaseOrder: $purchaseOrder,
            actor: $request->user(),
            notes: $request->validated('notes'),
            ipAddress: $request->ip()
        );

        return (new PurchaseOrderResource($approvedPo))
            ->additional(['message' => 'Purchase Order berhasil di-approve.']);
    }

    public function reject(RejectPurchaseOrderRequest $request, PurchaseOrder $purchaseOrder): PurchaseOrderResource
    {
        $rejectedPo = $this->purchaseOrderService->rejectPurchaseOrder(
            purchaseOrder: $purchaseOrder,
            actor: $request->user(),
            reason: $request->validated('reason'),
            ipAddress: $request->ip()
        );

        return (new PurchaseOrderResource($rejectedPo))
            ->additional(['message' => 'Purchase Order berhasil di-reject.']);
    }

    public function destroy(Request $request, PurchaseOrder $purchaseOrder): JsonResponse
    {
        $this->purchaseOrderService->deletePurchaseOrder(
            purchaseOrder: $purchaseOrder,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return response()->json([
            'message' => 'Purchase Order berhasil dihapus.',
        ]);
    }
}
