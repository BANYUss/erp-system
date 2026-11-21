<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\FefoPickingRequest;
use App\Http\Resources\FefoPickingResource;
use App\Http\Resources\InventoryLedgerResource;
use App\Http\Resources\StockMovementResource;
use App\Models\InventoryLedger;
use App\Models\StockMovement;
use App\Services\Inventory\InventoryService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;

class InventoryController extends Controller
{
    public function __construct(
        private readonly InventoryService $inventoryService
    ) {}

    public function ledgers(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);
        $user = $request->user();

        $query = InventoryLedger::query()
            ->with(['productBatch.product'])
            ->orderByDesc('id');

        // Role yang hanya memiliki inventory.view_available (misal: Admin Sales) hanya melihat stok available
        if (
            $user !== null
            && ! $user->can('inventory.view_physical')
            && ! $user->can('inventory.view_cost')
        ) {
            $query->where('state', InventoryLedger::STATE_AVAILABLE);
        } elseif ($request->filled('state')) {
            $query->where('state', (string) $request->query('state'));
        }

        if ($request->filled('product_id')) {
            $productId = $request->integer('product_id');
            $query->whereHas('productBatch', static function ($batchQuery) use ($productId): void {
                $batchQuery->where('product_id', $productId);
            });
        }

        if ($request->filled('batch_number')) {
            $batchNumber = trim((string) $request->query('batch_number'));
            $query->whereHas('productBatch', static function ($batchQuery) use ($batchNumber): void {
                $batchQuery->where('batch_number', 'like', "%{$batchNumber}%");
            });
        }

        if ($request->filled('expiring_within_days')) {
            $days = max($request->integer('expiring_within_days'), 0);
            $cutoffDate = Carbon::today()->addDays($days)->toDateString();

            $query->whereHas('productBatch', static function ($batchQuery) use ($cutoffDate): void {
                $batchQuery->whereNotNull('expiry_date')
                    ->whereDate('expiry_date', '<=', $cutoffDate);
            });
        }

        return InventoryLedgerResource::collection($query->paginate($perPage));
    }

    public function stockMovements(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = StockMovement::query()
            ->with(['productBatch.product', 'user'])
            ->orderByDesc('id');

        if ($request->filled('product_id')) {
            $productId = $request->integer('product_id');
            $query->whereHas('productBatch', static function ($batchQuery) use ($productId): void {
                $batchQuery->where('product_id', $productId);
            });
        }

        if ($request->filled('product_batch_id')) {
            $query->where('product_batch_id', $request->integer('product_batch_id'));
        }

        if ($request->filled('type')) {
            $query->where('type', strtoupper((string) $request->query('type')));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('created_at', '>=', (string) $request->query('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', (string) $request->query('date_to'));
        }

        return StockMovementResource::collection($query->paginate($perPage));
    }

    public function fefoPicking(FefoPickingRequest $request): FefoPickingResource
    {
        $validated = $request->validated();

        $suggestion = $this->inventoryService->suggestFefoPicking(
            productId: (int) $validated['product_id'],
            requestedQty: (string) $validated['qty']
        );

        return new FefoPickingResource($suggestion);
    }
}
