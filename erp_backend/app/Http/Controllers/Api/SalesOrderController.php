<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Sales\CancelSalesOrderRequest;
use App\Http\Requests\Sales\ConfirmSalesOrderRequest;
use App\Http\Requests\Sales\StoreSalesOrderRequest;
use App\Http\Resources\SalesOrderResource;
use App\Models\SalesOrder;
use App\Services\Sales\SalesOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class SalesOrderController extends Controller
{
    public function __construct(
        private readonly SalesOrderService $salesOrderService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = SalesOrder::query()
            ->with(['customer', 'salesperson', 'items.product'])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('so_number', 'like', "%{$search}%");
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }

        if ($request->filled('customer_id')) {
            $query->where('customer_id', $request->integer('customer_id'));
        }

        if ($request->filled('salesperson_id')) {
            $query->where('salesperson_id', $request->integer('salesperson_id'));
        }

        return SalesOrderResource::collection($query->paginate($perPage));
    }

    public function store(StoreSalesOrderRequest $request): JsonResponse
    {
        $salesOrder = $this->salesOrderService->createSalesOrder(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new SalesOrderResource($salesOrder))
            ->additional(['message' => 'Sales Order berhasil dibuat dengan status Draft.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(Request $request, SalesOrder $salesOrder): SalesOrderResource
    {
        $relations = [
            'customer',
            'salesperson',
            'items.product',
            'deliveryOrders.items.product',
            'deliveryOrders.items.productBatch',
        ];

        if ($request->user()?->can('invoices.view')) {
            $relations[] = 'salesInvoices';
        }

        $salesOrder->load($relations);

        return new SalesOrderResource($salesOrder);
    }

    public function confirm(ConfirmSalesOrderRequest $request, SalesOrder $salesOrder): SalesOrderResource
    {
        $confirmedSo = $this->salesOrderService->confirmSalesOrder(
            salesOrder: $salesOrder,
            actor: $request->user(),
            overrideCreditLimit: $request->boolean('override_credit_limit', false),
            overrideReason: $request->validated('override_reason'),
            ipAddress: $request->ip()
        );

        return (new SalesOrderResource($confirmedSo))
            ->additional(['message' => 'Sales Order berhasil dikonfirmasi setelah lolos validasi Credit Limit.']);
    }

    public function cancel(CancelSalesOrderRequest $request, SalesOrder $salesOrder): SalesOrderResource
    {
        $cancelledSo = $this->salesOrderService->cancelSalesOrder(
            salesOrder: $salesOrder,
            actor: $request->user(),
            reason: $request->validated('reason'),
            ipAddress: $request->ip()
        );

        return (new SalesOrderResource($cancelledSo))
            ->additional(['message' => 'Sales Order berhasil dibatalkan.']);
    }

    public function destroy(Request $request, SalesOrder $salesOrder): JsonResponse
    {
        $this->salesOrderService->deleteSalesOrder(
            salesOrder: $salesOrder,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return response()->json([
            'message' => 'Sales Order berhasil dihapus.',
        ]);
    }
}
