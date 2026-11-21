<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\StoreGoodsReceiptRequest;
use App\Http\Requests\Inventory\ValidateGoodsReceiptRequest;
use App\Http\Resources\GoodsReceiptResource;
use App\Models\GoodsReceipt;
use App\Services\Inventory\GoodsReceiptService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class GoodsReceiptController extends Controller
{
    public function __construct(
        private readonly GoodsReceiptService $goodsReceiptService
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = GoodsReceipt::query()
            ->with([
                'purchaseOrder.supplier',
                'items.product',
                'items.productBatch.inventoryLedgers',
            ])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where('receipt_number', 'like', "%{$search}%");
        }

        if ($request->filled('status')) {
            $query->where('status', (string) $request->query('status'));
        }

        if ($request->filled('po_id')) {
            $query->where('po_id', $request->integer('po_id'));
        }

        return GoodsReceiptResource::collection($query->paginate($perPage));
    }

    public function store(StoreGoodsReceiptRequest $request): JsonResponse
    {
        $goodsReceipt = $this->goodsReceiptService->createGoodsReceipt(
            data: $request->validated(),
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new GoodsReceiptResource($goodsReceipt))
            ->additional(['message' => 'Goods Receipt berhasil dibuat dengan status Draft.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(GoodsReceipt $goodsReceipt): GoodsReceiptResource
    {
        $goodsReceipt->load([
            'purchaseOrder.supplier',
            'items.product',
            'items.productBatch.inventoryLedgers',
        ]);

        return new GoodsReceiptResource($goodsReceipt);
    }

    public function validateReceipt(ValidateGoodsReceiptRequest $request, GoodsReceipt $goodsReceipt): GoodsReceiptResource
    {
        $validatedGr = $this->goodsReceiptService->validateGoodsReceipt(
            goodsReceipt: $goodsReceipt,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return (new GoodsReceiptResource($validatedGr))
            ->additional(['message' => 'Goods Receipt berhasil divalidasi dan stok telah diperbarui.']);
    }

    public function destroy(Request $request, GoodsReceipt $goodsReceipt): JsonResponse
    {
        $this->goodsReceiptService->deleteGoodsReceipt(
            goodsReceipt: $goodsReceipt,
            actor: $request->user(),
            ipAddress: $request->ip()
        );

        return response()->json([
            'message' => 'Goods Receipt berhasil dihapus.',
        ]);
    }
}
