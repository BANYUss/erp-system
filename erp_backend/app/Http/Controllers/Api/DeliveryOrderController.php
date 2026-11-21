<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Sales\DispatchDeliveryOrderRequest;
use App\Http\Requests\Sales\StoreDeliveryOrderRequest;
use App\Http\Resources\DeliveryOrderResource;
use App\Models\DeliveryOrder;
use App\Services\Sales\DeliveryOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DeliveryOrderController extends Controller
{
    public function __construct(
        private readonly DeliveryOrderService $deliveryOrderService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = DeliveryOrder::query()
            ->with([
                'salesOrder.customer',
                'items.product',
                'items.productBatch',
            ])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('do_number', 'like', "%{$search}%");
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }

        if ($request->filled('sales_order_id')) {
            $query->where('sales_order_id', $request->integer('sales_order_id'));
        }

        return DeliveryOrderResource::collection($query->paginate($perPage));
    }

    public function store(StoreDeliveryOrderRequest $request): JsonResponse
    {
        $deliveryOrder = $this->deliveryOrderService->createDeliveryOrder(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new DeliveryOrderResource($deliveryOrder))
            ->additional(['message' => 'Delivery Order berhasil dibuat dengan status Draft.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(Request $request, DeliveryOrder $deliveryOrder): DeliveryOrderResource
    {
        $relations = [
            'salesOrder.customer',
            'items.product',
            'items.productBatch',
        ];

        if ($request->user()?->can('general_ledger.view')) {
            $relations[] = 'generalLedgers';
        }

        $deliveryOrder->load($relations);

        return new DeliveryOrderResource($deliveryOrder);
    }

    public function dispatchOrder(DispatchDeliveryOrderRequest $request, DeliveryOrder $deliveryOrder): DeliveryOrderResource
    {
        $dispatchedDo = $this->deliveryOrderService->dispatchDeliveryOrder(
            deliveryOrder: $deliveryOrder,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new DeliveryOrderResource($dispatchedDo))
            ->additional(['message' => 'Delivery Order berhasil di-dispatch dengan alokasi FEFO dan mutasi stok keluar.']);
    }

    public function deliver(DispatchDeliveryOrderRequest $request, DeliveryOrder $deliveryOrder): DeliveryOrderResource
    {
        $deliveredDo = $this->deliveryOrderService->markDelivered(
            deliveryOrder: $deliveryOrder,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new DeliveryOrderResource($deliveredDo))
            ->additional(['message' => 'Delivery Order berhasil ditandai Delivered.']);
    }

    public function destroy(Request $request, DeliveryOrder $deliveryOrder): JsonResponse
    {
        $this->deliveryOrderService->deleteDeliveryOrder(
            deliveryOrder: $deliveryOrder,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return response()->json([
            'message' => 'Delivery Order berhasil dihapus.',
        ]);
    }
}
