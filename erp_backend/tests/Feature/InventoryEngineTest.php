<?php

namespace Tests\Feature;

use App\Events\GoodsReceiptValidated;
use App\Models\AuditLog;
use App\Models\GoodsReceipt;
use App\Models\InventoryLedger;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\PurchaseOrder;
use App\Models\StockMovement;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Inventory\InventoryService;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InventoryEngineTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RoleAndPermissionSeeder::class);
    }

    private function userByEmail(string $email): User
    {
        return User::where('email', $email)->firstOrFail();
    }

    private function createActiveSupplier(string $name = 'PT Pemasok Distribusi Nusantara'): Supplier
    {
        return Supplier::create([
            'name' => $name,
            'contact_name' => 'Rizky Pratama',
            'email' => 'supply@pemasok.test',
            'phone' => '021-5550202',
            'address' => 'Jl. Pergudangan Barat No. 45',
            'status' => 'active',
        ]);
    }

    private function createActiveProduct(string $sku = 'SKU-INV-001', string $name = 'Susu UHT 1L'): Product
    {
        return Product::create([
            'sku' => $sku,
            'name' => $name,
            'category_id' => 1,
            'uom' => 'CRT',
            'is_active' => true,
        ]);
    }

    /**
     * @param  array<int, array{product_id: int, qty_ordered: string, unit_price: string}>  $items
     */
    private function createPurchaseOrder(
        Supplier $supplier,
        array $items,
        string $status = PurchaseOrder::STATUS_APPROVED,
        ?string $poNumber = null
    ): PurchaseOrder {
        $total = '0.0000';
        foreach ($items as $item) {
            $total = bcadd($total, bcmul($item['qty_ordered'], $item['unit_price'], 4), 4);
        }

        $po = PurchaseOrder::create([
            'po_number' => $poNumber ?? ('PO-TEST-' . uniqid()),
            'supplier_id' => $supplier->id,
            'total_amount' => bcadd($total, '0', 2),
            'status' => $status,
            'approver_id' => $this->userByEmail('manajer@erp.test')->id,
        ]);

        $po->items()->createMany($items);

        return $po->fresh(['items']);
    }

    public function test_unauthenticated_requests_to_inventory_and_gr_endpoints_return_401(): void
    {
        $this->getJson('/api/goods-receipts')->assertUnauthorized();
        $this->postJson('/api/goods-receipts', [])->assertUnauthorized();
        $this->getJson('/api/inventory/ledgers')->assertUnauthorized();
        $this->getJson('/api/inventory/stock-movements')->assertUnauthorized();
        $this->getJson('/api/inventory/fefo-picking')->assertUnauthorized();
    }

    public function test_goods_receipt_validation_enforces_po_status_batch_expiry_and_partial_receipt_workflow(): void
    {
        Event::fake([GoodsReceiptValidated::class]);

        $gudang = $this->userByEmail('gudang@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $supplier = $this->createActiveSupplier();
        $productA = $this->createActiveProduct('SKU-GR-A', 'Minyak Goreng 2L');
        $productB = $this->createActiveProduct('SKU-GR-B', 'Gula Pasir 1kg');

        $pendingPo = $this->createPurchaseOrder($supplier, [
            ['product_id' => $productA->id, 'qty_ordered' => '50.00', 'unit_price' => '100000.00'],
        ], PurchaseOrder::STATUS_PENDING_APPROVAL);

        $approvedPo = $this->createPurchaseOrder($supplier, [
            ['product_id' => $productA->id, 'qty_ordered' => '100.00', 'unit_price' => '100000.00'],
            ['product_id' => $productB->id, 'qty_ordered' => '50.00', 'unit_price' => '15000.00'],
        ], PurchaseOrder::STATUS_APPROVED);

        Sanctum::actingAs($gudang);
        $today = Carbon::today()->toDateString();
        $expBatch1 = Carbon::today()->addDays(120)->toDateString();
        $expBatch2 = Carbon::today()->addDays(180)->toDateString();
        $expBatchB = Carbon::today()->addDays(150)->toDateString();

        // 1. Ditolak jika PO masih Pending Approval
        $this->postJson('/api/goods-receipts', [
            'po_id' => $pendingPo->id,
            'received_date' => $today,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'batch_number' => 'BATCH-PENDING-01',
                    'expiry_date' => $expBatch1,
                    'qty_received' => '10.00',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['po_id']);

        // 2. Ditolak jika batch_number atau expiry_date tidak diisi
        $this->postJson('/api/goods-receipts', [
            'po_id' => $approvedPo->id,
            'received_date' => $today,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'qty_received' => '10.00',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.batch_number', 'items.0.expiry_date']);

        // 3. Partial Receipt #1: Terima 60 dari 100 Product A
        $gr1Create = $this->postJson('/api/goods-receipts', [
            'po_id' => $approvedPo->id,
            'received_date' => $today,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'batch_number' => 'BATCH-A-01',
                    'expiry_date' => $expBatch1,
                    'qty_received' => '60.00',
                ],
            ],
        ]);

        $gr1Create->assertCreated()
            ->assertJsonPath('data.status', GoodsReceipt::STATUS_DRAFT)
            ->assertJsonPath('data.items.0.qty_received', '60.00')
            ->assertJsonPath('data.items.0.batch.batch_number', 'BATCH-A-01')
            ->assertJsonMissingPath('data.items.0.cost_price')
            ->assertJsonMissingPath('data.purchase_order.total_amount');

        $gr1Id = $gr1Create->json('data.id');

        // Sebelum validasi, stok belum berubah dan belum ada stock_movements
        $this->assertDatabaseCount('inventory_ledgers', 0);
        $this->assertDatabaseCount('stock_movements', 0);

        // Validasi GR #1 -> PO otomatis berubah menjadi Partially Received
        $gr1Validate = $this->postJson("/api/goods-receipts/{$gr1Id}/validate");

        $gr1Validate->assertOk()
            ->assertJsonPath('data.status', GoodsReceipt::STATUS_VALIDATED)
            ->assertJsonPath('data.purchase_order.status', PurchaseOrder::STATUS_PARTIALLY_RECEIVED)
            ->assertJsonMissingPath('data.items.0.cost_price')
            ->assertJsonMissingPath('data.purchase_order.total_amount');

        $this->assertDatabaseHas('purchase_orders', [
            'id' => $approvedPo->id,
            'status' => PurchaseOrder::STATUS_PARTIALLY_RECEIVED,
        ]);

        $this->assertDatabaseHas('stock_movements', [
            'type' => StockMovement::TYPE_IN,
            'qty_change' => '60.00',
            'reference_type' => GoodsReceipt::class,
            'reference_id' => $gr1Id,
            'user_id' => $gudang->id,
        ]);

        // Double validation & delete GR Validated wajib ditolak (422)
        $this->postJson("/api/goods-receipts/{$gr1Id}/validate")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        $this->deleteJson("/api/goods-receipts/{$gr1Id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        // 4. Over-receipt ditolak (sisa Product A hanya 40.00, coba terima 45.00)
        $this->postJson('/api/goods-receipts', [
            'po_id' => $approvedPo->id,
            'received_date' => $today,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'batch_number' => 'BATCH-A-OVER',
                    'expiry_date' => $expBatch2,
                    'qty_received' => '45.00',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty_received']);

        // 5. Partial Receipt #2 (Pelunasan sisa PO dari status Partially Received -> Completed)
        $gr2Create = $this->postJson('/api/goods-receipts', [
            'po_id' => $approvedPo->id,
            'received_date' => $today,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'batch_number' => 'BATCH-A-02',
                    'expiry_date' => $expBatch2,
                    'qty_received' => '40.00',
                ],
                [
                    'product_id' => $productB->id,
                    'batch_number' => 'BATCH-B-01',
                    'expiry_date' => $expBatchB,
                    'qty_received' => '50.00',
                ],
            ],
        ])->assertCreated();

        $gr2Id = $gr2Create->json('data.id');

        $this->postJson("/api/goods-receipts/{$gr2Id}/validate")
            ->assertOk()
            ->assertJsonPath('data.status', GoodsReceipt::STATUS_VALIDATED)
            ->assertJsonPath('data.purchase_order.status', PurchaseOrder::STATUS_COMPLETED);

        $this->assertDatabaseHas('purchase_orders', [
            'id' => $approvedPo->id,
            'status' => PurchaseOrder::STATUS_COMPLETED,
        ]);

        // 6. PO berstatus Completed tidak bisa dibuatkan GR lagi
        $this->postJson('/api/goods-receipts', [
            'po_id' => $approvedPo->id,
            'received_date' => $today,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'batch_number' => 'BATCH-A-03',
                    'expiry_date' => $expBatch2,
                    'qty_received' => '1.00',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['po_id']);

        // 7. Pastikan event akuntansi GoodsReceiptValidated dipicu 2 kali (GR #1 dan GR #2)
        Event::assertDispatchedTimes(GoodsReceiptValidated::class, 2);

        // 8. Finance bisa melihat GR lengkap dengan cost_price & total_amount PO
        Sanctum::actingAs($finance);
        $this->getJson("/api/goods-receipts/{$gr2Id}")
            ->assertOk()
            ->assertJsonPath('data.items.0.cost_price', '100000.00')
            ->assertJsonPath('data.items.1.cost_price', '15000.00')
            ->assertJsonPath('data.purchase_order.total_amount', '10750000.00');
    }

    public function test_moving_weighted_average_calculation_accuracy_with_bcmath(): void
    {
        $gudang = $this->userByEmail('gudang@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $supplier = $this->createActiveSupplier();
        $product = $this->createActiveProduct('SKU-MWA-001', 'Beras Premium 5kg');

        $today = Carbon::today()->toDateString();

        // PO #1: 100.00 unit @ Rp10.000,00 -> Nilai = Rp1.000.000,00 -> MWA = 10000.00
        $po1 = $this->createPurchaseOrder($supplier, [
            ['product_id' => $product->id, 'qty_ordered' => '100.00', 'unit_price' => '10000.00'],
        ]);

        // PO #2: 50.00 unit @ Rp13.000,00 -> Nilai baru = Rp650.000,00
        // MWA = (1.000.000 + 650.000) / (100 + 50) = 1.650.000 / 150 = 11000.00
        $po2 = $this->createPurchaseOrder($supplier, [
            ['product_id' => $product->id, 'qty_ordered' => '50.00', 'unit_price' => '13000.00'],
        ]);

        // PO #3: 70.00 unit @ Rp12.345,67 -> Nilai baru = 864.196,90
        // MWA = (1.650.000,00 + 864.196,90) / (150 + 70) = 2.514.196,90 / 220 = 11428.167727... -> 11428.17
        $po3 = $this->createPurchaseOrder($supplier, [
            ['product_id' => $product->id, 'qty_ordered' => '70.00', 'unit_price' => '12345.67'],
        ]);

        Sanctum::actingAs($gudang);

        // GR #1
        $gr1Id = $this->postJson('/api/goods-receipts', [
            'po_id' => $po1->id,
            'received_date' => $today,
            'items' => [[
                'product_id' => $product->id,
                'batch_number' => 'MWA-B1',
                'expiry_date' => Carbon::today()->addDays(200)->toDateString(),
                'qty_received' => '100.00',
            ]],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/goods-receipts/{$gr1Id}/validate")->assertOk();

        $batch1 = ProductBatch::where('batch_number', 'MWA-B1')->firstOrFail();
        $ledger1 = InventoryLedger::where('product_batch_id', $batch1->id)->firstOrFail();
        $this->assertSame('100.00', $ledger1->qty);
        $this->assertSame('10000.00', $ledger1->cost_price);

        // GR #2
        $gr2Id = $this->postJson('/api/goods-receipts', [
            'po_id' => $po2->id,
            'received_date' => $today,
            'items' => [[
                'product_id' => $product->id,
                'batch_number' => 'MWA-B2',
                'expiry_date' => Carbon::today()->addDays(250)->toDateString(),
                'qty_received' => '50.00',
            ]],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/goods-receipts/{$gr2Id}/validate")->assertOk();

        $batch2 = ProductBatch::where('batch_number', 'MWA-B2')->firstOrFail();
        $ledger2 = InventoryLedger::where('product_batch_id', $batch2->id)->firstOrFail();
        $this->assertSame('50.00', $ledger2->qty);
        $this->assertSame('11000.00', $ledger2->cost_price);
        $this->assertSame('11000.00', $ledger1->fresh()->cost_price);

        // GR #3 (verifikasi presisi BCMath & pembulatan half-up untuk angka desimal tak berujung)
        $gr3Id = $this->postJson('/api/goods-receipts', [
            'po_id' => $po3->id,
            'received_date' => $today,
            'items' => [[
                'product_id' => $product->id,
                'batch_number' => 'MWA-B3',
                'expiry_date' => Carbon::today()->addDays(300)->toDateString(),
                'qty_received' => '70.00',
            ]],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/goods-receipts/{$gr3Id}/validate")->assertOk();

        $batch3 = ProductBatch::where('batch_number', 'MWA-B3')->firstOrFail();
        $ledger3 = InventoryLedger::where('product_batch_id', $batch3->id)->firstOrFail();

        $this->assertSame('11428.17', $ledger3->cost_price);
        $this->assertSame('11428.17', $ledger2->fresh()->cost_price);
        $this->assertSame('11428.17', $ledger1->fresh()->cost_price);

        // Verifikasi lewat API Inventory Ledger untuk Finance (cost_price terlihat) vs Staf Gudang (tersembunyi)
        Sanctum::actingAs($finance);
        $this->getJson("/api/inventory/ledgers?product_id={$product->id}")
            ->assertOk()
            ->assertJsonPath('data.0.cost_price', '11428.17');

        $this->getJson("/api/products/{$product->id}")
            ->assertOk()
            ->assertJsonPath('data.cost_price', '11428.17');

        Sanctum::actingAs($gudang);
        $this->getJson("/api/inventory/ledgers?product_id={$product->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.0.cost_price')
            ->assertJsonMissingPath('data.0.inventory_value');

        // Verifikasi direct BCMath helper untuk kasus 10@10000 + 20@11000 = 320000/30 = 10666.67
        $inventoryService = app(InventoryService::class);
        $this->assertSame(
            '10666.67',
            $inventoryService->calculateMovingWeightedAverage('100000.0000', '10.00', '220000.0000', '20.00')
        );
    }

    public function test_stock_movements_are_immutable_and_accessible_via_stock_card_endpoint(): void
    {
        $gudang = $this->userByEmail('gudang@erp.test');
        $supplier = $this->createActiveSupplier();
        $product = $this->createActiveProduct('SKU-IMM-001', 'Tepung Terigu 1kg');

        $po = $this->createPurchaseOrder($supplier, [
            ['product_id' => $product->id, 'qty_ordered' => '25.00', 'unit_price' => '12000.00'],
        ]);

        Sanctum::actingAs($gudang);

        $grId = $this->postJson('/api/goods-receipts', [
            'po_id' => $po->id,
            'received_date' => Carbon::today()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'batch_number' => 'IMM-B1',
                'expiry_date' => Carbon::today()->addDays(90)->toDateString(),
                'qty_received' => '25.00',
            ]],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/goods-receipts/{$grId}/validate")->assertOk();

        // Cek kartu stok via endpoint GET /api/inventory/stock-movements
        $this->getJson("/api/inventory/stock-movements?product_id={$product->id}&type=IN")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', StockMovement::TYPE_IN)
            ->assertJsonPath('data.0.qty_change', '25.00')
            ->assertJsonPath('data.0.batch.batch_number', 'IMM-B1')
            ->assertJsonMissingPath('data.0.cost_price');

        // Pastikan model StockMovement menolak update dan delete (immutable)
        $movement = StockMovement::firstOrFail();

        try {
            $movement->update(['qty_change' => '999.00']);
            $this->fail('Seharusnya StockMovement melempar LogicException saat di-update.');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }

        try {
            $movement->delete();
            $this->fail('Seharusnya StockMovement melempar LogicException saat di-delete.');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }

        $this->assertDatabaseHas('stock_movements', [
            'id' => $movement->id,
            'qty_change' => '25.00',
        ]);
    }

    public function test_fefo_picking_suggestion_orders_by_nearest_available_expiry_date_and_hides_cost_from_warehouse(): void
    {
        $gudang = $this->userByEmail('gudang@erp.test');
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $product = $this->createActiveProduct('SKU-FEFO-001', 'Yogurt Drink 250ml');

        // Buat batch dengan urutan pembuatan ACAK untuk memastikan sorting murni berdasarkan expiry_date terdekat
        $batchFar = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'FEFO-FAR',
            'expiry_date' => Carbon::today()->addDays(120)->toDateString(),
        ]);

        $batchQuarantined = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'FEFO-IN-QC',
            'expiry_date' => Carbon::today()->addDays(10)->toDateString(),
        ]);

        $batchReserved = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'FEFO-RESERVED',
            'expiry_date' => Carbon::today()->addDays(15)->toDateString(),
        ]);

        $batchExpired = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'FEFO-EXPIRED',
            'expiry_date' => Carbon::today()->subDays(2)->toDateString(),
        ]);

        $batchNearest = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'FEFO-NEAREST',
            'expiry_date' => Carbon::today()->addDays(45)->toDateString(),
        ]);

        $batchMiddle = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'FEFO-MIDDLE',
            'expiry_date' => Carbon::today()->addDays(75)->toDateString(),
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchFar->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '100.00',
            'cost_price' => '8500.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchQuarantined->id,
            'state' => InventoryLedger::STATE_IN_QC,
            'qty' => '50.00',
            'cost_price' => '8500.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchReserved->id,
            'state' => InventoryLedger::STATE_RESERVED,
            'qty' => '40.00',
            'cost_price' => '8500.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchExpired->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '25.00',
            'cost_price' => '8500.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchNearest->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '30.00',
            'cost_price' => '8500.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchMiddle->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '40.00',
            'cost_price' => '8500.00',
        ]);

        // Staf Gudang meminta picking 85.00 unit:
        // Harus ambil: 30.00 dari FEFO-NEAREST, 40.00 dari FEFO-MIDDLE, 15.00 dari FEFO-FAR (total 85.00)
        // Batch in_qc, reserved, dan expired harus DIABAIKAN, dan cost_price wajib disembunyikan
        Sanctum::actingAs($gudang);

        $response = $this->getJson("/api/inventory/fefo-picking?product_id={$product->id}&qty=85.00");

        $response->assertOk()
            ->assertJsonPath('data.requested_qty', '85.00')
            ->assertJsonPath('data.total_available_qty', '170.00')
            ->assertJsonPath('data.allocated_qty', '85.00')
            ->assertJsonPath('data.shortage_qty', '0.00')
            ->assertJsonPath('data.is_fulfilled', true)
            ->assertJsonCount(3, 'data.picking_list')
            ->assertJsonPath('data.picking_list.0.batch_number', 'FEFO-NEAREST')
            ->assertJsonPath('data.picking_list.0.pick_qty', '30.00')
            ->assertJsonPath('data.picking_list.0.remaining_batch_qty', '0.00')
            ->assertJsonPath('data.picking_list.1.batch_number', 'FEFO-MIDDLE')
            ->assertJsonPath('data.picking_list.1.pick_qty', '40.00')
            ->assertJsonPath('data.picking_list.1.remaining_batch_qty', '0.00')
            ->assertJsonPath('data.picking_list.2.batch_number', 'FEFO-FAR')
            ->assertJsonPath('data.picking_list.2.pick_qty', '15.00')
            ->assertJsonPath('data.picking_list.2.remaining_batch_qty', '85.00')
            ->assertJsonMissingPath('data.picking_list.0.cost_price')
            ->assertJsonMissingPath('data.picking_list.1.cost_price')
            ->assertJsonMissingPath('data.picking_list.2.cost_price');

        // Permintaan melebihi stok available (200.00 > 170.00) melaporkan shortage dengan tepat
        $this->getJson("/api/inventory/fefo-picking?product_id={$product->id}&qty=200.00")
            ->assertOk()
            ->assertJsonPath('data.allocated_qty', '170.00')
            ->assertJsonPath('data.shortage_qty', '30.00')
            ->assertJsonPath('data.is_fulfilled', false);

        // Purchasing (memiliki inventory.view_available & inventory.view_cost) bisa melihat cost_price
        Sanctum::actingAs($purchasing);
        $this->getJson("/api/inventory/fefo-picking?product_id={$product->id}&qty=20.00")
            ->assertOk()
            ->assertJsonPath('data.picking_list.0.batch_number', 'FEFO-NEAREST')
            ->assertJsonPath('data.picking_list.0.cost_price', '8500.00');
    }

    public function test_quarantine_expiring_command_moves_batches_within_30_days_to_in_qc_and_logs_movements(): void
    {
        $product = $this->createActiveProduct('SKU-QC-001', 'Sosis Siap Makan');

        // 1. Batch expiring dalam 15 hari (<= 30 hari) -> HARUS dikarantina
        $batchExpiringSoon = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'QC-EXP-15D',
            'expiry_date' => Carbon::today()->addDays(15)->toDateString(),
        ]);

        // 2. Batch tepat di batas 30 hari (<= 30 hari) -> HARUS dikarantina
        $batchAtBoundary = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'QC-EXP-30D',
            'expiry_date' => Carbon::today()->addDays(30)->toDateString(),
        ]);

        // 3. Batch aman 31 hari (> 30 hari) -> TETAP available
        $batchSafe = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'QC-SAFE-31D',
            'expiry_date' => Carbon::today()->addDays(31)->toDateString(),
        ]);

        // 4. Batch expiring 10 hari tapi sudah reserved -> TIDAK disentuh (hanya state available yang dipindah)
        $batchReserved = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'QC-RES-10D',
            'expiry_date' => Carbon::today()->addDays(10)->toDateString(),
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchExpiringSoon->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '45.50',
            'cost_price' => '22000.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchAtBoundary->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '30.00',
            'cost_price' => '22000.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchSafe->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '80.00',
            'cost_price' => '22000.00',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batchReserved->id,
            'state' => InventoryLedger::STATE_RESERVED,
            'qty' => '12.00',
            'cost_price' => '22000.00',
        ]);

        // Jalankan Artisan command inventory:quarantine-expiring
        $this->artisan('inventory:quarantine-expiring')
            ->expectsOutputToContain('2 batch dipindahkan ke in_qc (total qty: 75.50)')
            ->assertExitCode(0);

        // Batch 15 hari & 30 hari: available = 0.00, in_qc = qty semula, cost_price terjaga
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchExpiringSoon->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '0.00',
        ]);
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchExpiringSoon->id,
            'state' => InventoryLedger::STATE_IN_QC,
            'qty' => '45.50',
            'cost_price' => '22000.00',
        ]);

        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchAtBoundary->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '0.00',
        ]);
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchAtBoundary->id,
            'state' => InventoryLedger::STATE_IN_QC,
            'qty' => '30.00',
            'cost_price' => '22000.00',
        ]);

        // Batch aman 31 hari & batch reserved tidak berubah
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchSafe->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '80.00',
        ]);
        $this->assertDatabaseMissing('inventory_ledgers', [
            'product_batch_id' => $batchSafe->id,
            'state' => InventoryLedger::STATE_IN_QC,
        ]);
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchReserved->id,
            'state' => InventoryLedger::STATE_RESERVED,
            'qty' => '12.00',
        ]);

        // Mutasi tercatat di stock_movements (type ADJ) dan audit_logs
        $this->assertDatabaseHas('stock_movements', [
            'product_batch_id' => $batchExpiringSoon->id,
            'type' => StockMovement::TYPE_ADJ,
            'qty_change' => '-45.50',
            'reference_type' => InventoryLedger::class,
        ]);
        $this->assertDatabaseHas('stock_movements', [
            'product_batch_id' => $batchAtBoundary->id,
            'type' => StockMovement::TYPE_ADJ,
            'qty_change' => '-30.00',
            'reference_type' => InventoryLedger::class,
        ]);

        $this->assertSame(
            2,
            AuditLog::where('action', 'inventory.expiry_quarantined')->count()
        );

        // Pastikan FEFO picking tidak lagi menyarankan batch yang sudah dikarantina
        Sanctum::actingAs($this->userByEmail('gudang@erp.test'));
        $this->getJson("/api/inventory/fefo-picking?product_id={$product->id}&qty=50.00")
            ->assertOk()
            ->assertJsonCount(1, 'data.picking_list')
            ->assertJsonPath('data.picking_list.0.batch_number', 'QC-SAFE-31D')
            ->assertJsonPath('data.picking_list.0.pick_qty', '50.00');

        // Idempotency: jalankan command lagi -> 0 batch baru dikarantina, tidak ada duplikat mutasi
        $this->artisan('inventory:quarantine-expiring')
            ->expectsOutputToContain('0 batch dipindahkan ke in_qc (total qty: 0.00)')
            ->assertExitCode(0);

        $this->assertSame(2, StockMovement::where('type', StockMovement::TYPE_ADJ)->count());
    }

    public function test_rbac_boundaries_for_goods_receipt_and_inventory_endpoints(): void
    {
        $gudang = $this->userByEmail('gudang@erp.test');
        $sales = $this->userByEmail('sales@erp.test');
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');

        $supplier = $this->createActiveSupplier();
        $product = $this->createActiveProduct('SKU-RBAC-INV', 'Kopi Bubuk 500g');
        $po = $this->createPurchaseOrder($supplier, [
            ['product_id' => $product->id, 'qty_ordered' => '20.00', 'unit_price' => '50000.00'],
        ]);

        // Staf Gudang buat GR Draft
        Sanctum::actingAs($gudang);
        $grId = $this->postJson('/api/goods-receipts', [
            'po_id' => $po->id,
            'received_date' => Carbon::today()->toDateString(),
            'items' => [[
                'product_id' => $product->id,
                'batch_number' => 'RBAC-B1',
                'expiry_date' => Carbon::today()->addDays(120)->toDateString(),
                'qty_received' => '10.00',
            ]],
        ])->assertCreated()->json('data.id');

        // Buat 1 batch in_qc agar bisa uji isolasi Admin Sales (hanya melihat available)
        $qcBatch = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'RBAC-QC',
            'expiry_date' => Carbon::today()->addDays(10)->toDateString(),
        ]);
        InventoryLedger::create([
            'product_batch_id' => $qcBatch->id,
            'state' => InventoryLedger::STATE_IN_QC,
            'qty' => '5.00',
            'cost_price' => '50000.00',
        ]);

        // Admin Sales: dilarang akses GR dan stock-movements; di ledgers hanya lihat available & tanpa cost_price
        Sanctum::actingAs($sales);
        $this->getJson('/api/goods-receipts')->assertForbidden();
        $this->postJson('/api/goods-receipts', [])->assertForbidden();
        $this->postJson("/api/goods-receipts/{$grId}/validate")->assertForbidden();
        $this->getJson('/api/inventory/stock-movements')->assertForbidden();
        $this->getJson('/api/inventory/ledgers')
            ->assertOk()
            ->assertJsonCount(0, 'data'); // in_qc tidak ditampilkan ke Admin Sales
        $this->getJson("/api/inventory/fefo-picking?product_id={$product->id}&qty=5.00")
            ->assertOk();

        // Purchasing & Manajer: dilarang create/validate GR & stock-movements, boleh lihat ledgers (dengan cost_price) & fefo-picking
        foreach ([$purchasing, $manajer] as $user) {
            Sanctum::actingAs($user);
            $this->getJson('/api/goods-receipts')->assertForbidden();
            $this->postJson('/api/goods-receipts', [])->assertForbidden();
            $this->postJson("/api/goods-receipts/{$grId}/validate")->assertForbidden();
            $this->getJson('/api/inventory/stock-movements')->assertForbidden();
            $this->getJson('/api/inventory/ledgers')
                ->assertOk()
                ->assertJsonPath('data.0.cost_price', '50000.00');
            $this->getJson("/api/inventory/fefo-picking?product_id={$product->id}&qty=5.00")->assertOk();
        }

        // Finance: boleh lihat GR & ledgers (dengan cost_price), tapi dilarang create/validate GR & fefo-picking
        Sanctum::actingAs($finance);
        $this->getJson('/api/goods-receipts')->assertOk();
        $this->getJson("/api/goods-receipts/{$grId}")->assertOk();
        $this->postJson('/api/goods-receipts', [])->assertForbidden();
        $this->postJson("/api/goods-receipts/{$grId}/validate")->assertForbidden();
        $this->getJson('/api/inventory/stock-movements')->assertForbidden();
        $this->getJson('/api/inventory/fefo-picking?product_id=' . $product->id . '&qty=5.00')->assertForbidden();
        $this->getJson('/api/inventory/ledgers')
            ->assertOk()
            ->assertJsonPath('data.0.cost_price', '50000.00');
    }
}
