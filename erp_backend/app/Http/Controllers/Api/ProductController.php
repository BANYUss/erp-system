<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\MasterData\StoreProductRequest;
use App\Http\Requests\MasterData\UpdateProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ProductController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $perPage = min(max($request->integer('per_page', 15), 1), 100);

        $query = Product::query()
            ->with(['batches' => function ($batchQuery) {
                $batchQuery->orderBy('expiry_date')->with('inventoryLedgers');
            }])
            ->orderByDesc('id');

        if ($request->filled('search')) {
            $search = trim((string) $request->query('search'));
            $query->where(function ($subQuery) use ($search) {
                $subQuery->where('sku', 'like', "%{$search}%")
                    ->orWhere('name', 'like', "%{$search}%");
            });
        }

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->integer('category_id'));
        }

        if ($request->has('is_active')) {
            $query->where('is_active', $request->boolean('is_active'));
        }

        return ProductResource::collection($query->paginate($perPage));
    }

    public function store(StoreProductRequest $request): JsonResponse
    {
        $product = Product::create($request->validated());
        $product->refresh()->load(['batches' => function ($batchQuery) {
            $batchQuery->orderBy('expiry_date')->with('inventoryLedgers');
        }]);

        return (new ProductResource($product))
            ->additional(['message' => 'Produk berhasil dibuat.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(Product $product): ProductResource
    {
        $product->load(['batches' => function ($batchQuery) {
            $batchQuery->orderBy('expiry_date')->with('inventoryLedgers');
        }]);

        return new ProductResource($product);
    }

    public function update(UpdateProductRequest $request, Product $product): ProductResource
    {
        $product->update($request->validated());
        $product->refresh()->load(['batches' => function ($batchQuery) {
            $batchQuery->orderBy('expiry_date')->with('inventoryLedgers');
        }]);

        return (new ProductResource($product))
            ->additional(['message' => 'Produk berhasil diperbarui.']);
    }

    public function destroy(Product $product): JsonResponse
    {
        $product->delete();

        return response()->json([
            'message' => 'Produk berhasil dihapus.',
        ]);
    }
}
