<?php

namespace Tests\Feature;

use App\Events\DeliveryOrderDispatched;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\DeliveryOrder;
use App\Models\GeneralLedger;
use App\Models\InventoryLedger;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\SalesInvoice;
use App\Models\SalesOrder;
use App\Models\StockMovement;
use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderToCashWorkflowTest extends TestCase
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

    private function createActiveCustomer(string $name, string $creditLimit = '20000000.00'): Customer
    {
        return Customer::create([
            'name' => $name,
            'email' => 'ar@' . strtolower(preg_replace('/[^A-Za-z0-9]/', '', $name)) . '.test',
            'credit_limit' => $creditLimit,
            'status' => 'active',
        ]);
    }

    private function createActiveProduct(string $sku, string $name): Product
    {
        return Product::create([
            'sku' => $sku,
            'name' => $name,
            'category_id' => 1,
            'uom' => 'CRT',
            'is_active' => true,
        ]);
    }

    private function seedBatchStock(
        Product $product,
        string $batchNumber,
        string $expiryDate,
        string $qty,
        string $costPrice,
        string $state = InventoryLedger::STATE_AVAILABLE
    ): ProductBatch {
        $batch = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => $batchNumber,
            'expiry_date' => $expiryDate,
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batch->id,
            'state' => $state,
            'qty' => $qty,
            'cost_price' => $costPrice,
        ]);

        return $batch;
    }

    public function test_unauthenticated_requests_to_o2c_endpoints_return_401(): void
    {
        $this->getJson('/api/sales-orders')->assertUnauthorized();
        $this->postJson('/api/sales-orders', [])->assertUnauthorized();
        $this->getJson('/api/delivery-orders')->assertUnauthorized();
        $this->postJson('/api/delivery-orders', [])->assertUnauthorized();
        $this->getJson('/api/sales-invoices')->assertUnauthorized();
        $this->postJson('/api/sales-invoices', [])->assertUnauthorized();
        $this->getJson('/api/sales-invoices/ar-aging')->assertUnauthorized();
        $this->getJson('/api/customer-payments')->assertUnauthorized();
        $this->postJson('/api/customer-payments', [])->assertUnauthorized();
    }

    public function test_sales_order_credit_limit_validation_and_pricing_snapshot(): void
    {
        $sales = $this->userByEmail('sales@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');
        $finance = $this->userByEmail('finance@erp.test');

        // Credit limit customer = Rp10.000.000,00
        $customer = $this->createActiveCustomer('PT Toko Makmur Jaya', '10000000.00');
        $product = $this->createActiveProduct('SKU-O2C-CL1', 'Kopi Sachet 1 Dus');

        $today = Carbon::today()->toDateString();

        // 1. Buat SO #1 (Draft): 50 unit @ 120.000,50 = 6.000.025,00 (Pricing Snapshot disimpan di sales_order_items)
        Sanctum::actingAs($sales);
        $so1Create = $this->postJson('/api/sales-orders', [
            'customer_id' => $customer->id,
            'order_date' => $today,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '50.00',
                    'unit_price' => '120000.50',
                ],
            ],
        ]);

        $so1Create->assertCreated()
            ->assertJsonPath('data.status', SalesOrder::STATUS_DRAFT)
            ->assertJsonPath('data.total_amount', '6000025.00')
            ->assertJsonPath('data.items.0.unit_price', '120000.50')
            ->assertJsonPath('data.items.0.line_total', '6000025.00');

        $so1Id = $so1Create->json('data.id');

        // Konfirmasi SO #1: Piutang belum lunas (0) + SO baru (6.000.025) <= 10.000.000 -> SUKSES
        $this->postJson("/api/sales-orders/{$so1Id}/confirm")
            ->assertOk()
            ->assertJsonPath('data.status', SalesOrder::STATUS_CONFIRMED);

        // Terbitkan Invoice AR untuk SO #1 sebesar 6.000.025,00 (Piutang Unpaid = 6.000.025,00)
        Sanctum::actingAs($finance);
        $inv1Id = $this->postJson('/api/sales-invoices', [
            'sales_order_id' => $so1Id,
            'invoice_date' => $today,
            'due_date' => Carbon::today()->addDays(30)->toDateString(),
            'total_billed' => '6000025.00',
            'idempotency_key' => 'ar-inv-cl-001',
        ])->assertCreated()->json('data.id');

        // 2. Buat SO #2 sebesar Rp4.500.000,00 -> Exposure = 6.000.025 + 4.500.000 = 10.500.025 > 10.000.000
        Sanctum::actingAs($sales);
        $so2Id = $this->postJson('/api/sales-orders', [
            'customer_id' => $customer->id,
            'order_date' => $today,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '30.00',
                    'unit_price' => '150000.00',
                ],
            ],
        ])->assertCreated()->json('data.id');

        // Konfirmasi SO #2 WAJIB DITOLAK 422 karena melebihi credit limit
        $this->postJson("/api/sales-orders/{$so2Id}/confirm")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['credit_limit']);

        $this->assertDatabaseHas('sales_orders', [
            'id' => $so2Id,
            'status' => SalesOrder::STATUS_DRAFT,
        ]);

        // Admin Sales mencoba override credit limit -> DITOLAK 403 Forbidden
        $this->postJson("/api/sales-orders/{$so2Id}/confirm", [
            'override_credit_limit' => true,
        ])->assertForbidden();

        // 3. Customer bayar cicilan Rp1.000.025,00 -> Sisa Piutang = 5.000.000,00
        Sanctum::actingAs($finance);
        $this->postJson('/api/customer-payments', [
            'sales_invoice_id' => $inv1Id,
            'amount_received' => '1000025.00',
            'payment_date' => $today,
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'ar-pay-cl-001',
        ])->assertCreated();

        // Sekarang (5.000.000 + 4.500.000) = 9.500.000 <= 10.000.000 -> Konfirmasi SO #2 BERHASIL!
        Sanctum::actingAs($sales);
        $this->postJson("/api/sales-orders/{$so2Id}/confirm")
            ->assertOk()
            ->assertJsonPath('data.status', SalesOrder::STATUS_CONFIRMED);

        // 4. Buat SO #3 sebesar Rp6.000.000,00 -> (5.000.000 + 6.000.000) = 11.000.000 > 10.000.000
        $so3Id = $this->postJson('/api/sales-orders', [
            'customer_id' => $customer->id,
            'order_date' => $today,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '40.00',
                    'unit_price' => '150000.00',
                ],
            ],
        ])->assertCreated()->json('data.id');

        // Manajer tanpa flag override tetap ditolak 422; dengan override_credit_limit=true berhasil
        Sanctum::actingAs($manajer);
        $this->postJson("/api/sales-orders/{$so3Id}/confirm")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['credit_limit']);

        $this->postJson("/api/sales-orders/{$so3Id}/confirm", [
            'override_credit_limit' => true,
            'override_reason' => 'Persetujuan khusus Kepala Cabang untuk pelanggan VIP.',
        ])->assertOk()
            ->assertJsonPath('data.status', SalesOrder::STATUS_CONFIRMED);

        $this->assertTrue(
            AuditLog::where('action', 'sales_order.confirmed')
                ->where('model_id', $so3Id)
                ->exists()
        );
    }

    public function test_fefo_delivery_dispatch_anti_overselling_stock_out_cogs_gl_and_cost_hiding(): void
    {
        $sales = $this->userByEmail('sales@erp.test');
        $gudang = $this->userByEmail('gudang@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');

        $customer = $this->createActiveCustomer('PT Minimarket Sejahtera', '100000000.00');
        $product = $this->createActiveProduct('SKU-FEFO-DO1', 'Susu Cair UHT 1L');

        $today = Carbon::today()->toDateString();

        // Seed batch dengan urutan ACAK + batch in_qc, reserved, dan expired yang WAJIB diabaikan FEFO:
        // Total stok available yang valid = 30.00 + 40.00 + 50.00 = 120.00 unit (MWA = 12345.67)
        $batchFar = $this->seedBatchStock(
            $product,
            'DO-BATCH-FAR',
            Carbon::today()->addDays(180)->toDateString(),
            '50.00',
            '12345.67',
            InventoryLedger::STATE_AVAILABLE
        );
        $batchQuarantined = $this->seedBatchStock(
            $product,
            'DO-BATCH-INQC',
            Carbon::today()->addDays(10)->toDateString(),
            '100.00',
            '12345.67',
            InventoryLedger::STATE_IN_QC
        );
        $batchExpired = $this->seedBatchStock(
            $product,
            'DO-BATCH-EXPIRED',
            Carbon::today()->subDays(1)->toDateString(),
            '100.00',
            '12345.67',
            InventoryLedger::STATE_AVAILABLE
        );
        $batchNearest = $this->seedBatchStock(
            $product,
            'DO-BATCH-NEAREST',
            Carbon::today()->addDays(45)->toDateString(),
            '30.00',
            '12345.67',
            InventoryLedger::STATE_AVAILABLE
        );
        $batchMiddle = $this->seedBatchStock(
            $product,
            'DO-BATCH-MIDDLE',
            Carbon::today()->addDays(90)->toDateString(),
            '40.00',
            '12345.67',
            InventoryLedger::STATE_AVAILABLE
        );

        // Buat & Konfirmasi SO sebanyak 150.00 unit @ 20000.00 (Total 3.000.000,00)
        Sanctum::actingAs($sales);
        $soId = $this->postJson('/api/sales-orders', [
            'customer_id' => $customer->id,
            'order_date' => $today,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '150.00',
                    'unit_price' => '20000.00',
                ],
            ],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/sales-orders/{$soId}/confirm")->assertOk();

        // 1. ANTI-OVERSELLING: Gudang mencoba kirim 130.00 unit (padahal available valid hanya 120.00) -> 422!
        Sanctum::actingAs($gudang);
        $this->postJson('/api/delivery-orders', [
            'sales_order_id' => $soId,
            'delivery_date' => $today,
            'items' => [
                ['product_id' => $product->id, 'qty_dispatched' => '130.00'],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty_dispatched']);

        $this->assertDatabaseCount('delivery_orders', 0);
        $this->assertDatabaseCount('stock_movements', 0);

        // 2. Pengiriman Parsial #1: Buat DO Draft untuk 55.50 unit -> Alokasi FEFO: 30.00 (NEAREST) + 25.50 (MIDDLE)
        $do1Create = $this->postJson('/api/delivery-orders', [
            'sales_order_id' => $soId,
            'delivery_date' => $today,
            'items' => [
                ['product_id' => $product->id, 'qty_dispatched' => '55.50'],
            ],
        ]);

        // Pastikan Staf Gudang TIDAK bisa melihat unit_cost, cogs_total, total_cogs, maupun sales_order.total_amount
        $do1Create->assertCreated()
            ->assertJsonPath('data.status', DeliveryOrder::STATUS_DRAFT)
            ->assertJsonCount(2, 'data.items')
            ->assertJsonPath('data.items.0.batch.batch_number', 'DO-BATCH-NEAREST')
            ->assertJsonPath('data.items.0.qty_dispatched', '30.00')
            ->assertJsonPath('data.items.1.batch.batch_number', 'DO-BATCH-MIDDLE')
            ->assertJsonPath('data.items.1.qty_dispatched', '25.50')
            ->assertJsonMissingPath('data.total_cogs')
            ->assertJsonMissingPath('data.items.0.unit_cost')
            ->assertJsonMissingPath('data.items.0.cogs_total')
            ->assertJsonMissingPath('data.sales_order.total_amount');

        $do1Id = $do1Create->json('data.id');

        // Sebelum dispatch, stok belum terpotong dan belum ada stock_movements maupun GL
        $this->assertDatabaseHas('inventory_ledgers', ['product_batch_id' => $batchNearest->id, 'qty' => '30.00']);
        $this->assertDatabaseCount('stock_movements', 0);
        $this->assertDatabaseCount('general_ledgers', 0);

        // Dispatch DO #1 (Draft -> Dispatched)
        $do1Dispatch = $this->postJson("/api/delivery-orders/{$do1Id}/dispatch");
        $do1Dispatch->assertOk()
            ->assertJsonPath('data.status', DeliveryOrder::STATUS_DISPATCHED)
            ->assertJsonPath('data.sales_order.status', SalesOrder::STATUS_PARTIALLY_DELIVERED)
            ->assertJsonMissingPath('data.total_cogs')
            ->assertJsonMissingPath('data.items.0.unit_cost')
            ->assertJsonMissingPath('data.sales_order.total_amount');

        // Verifikasi FEFO deduction pada inventory_ledgers
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchNearest->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '0.00',
        ]);
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchMiddle->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '14.50',
        ]);
        $this->assertDatabaseHas('inventory_ledgers', [
            'product_batch_id' => $batchFar->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '50.00',
        ]);
        // Batch in_qc dan expired tetap tidak tersentuh
        $this->assertDatabaseHas('inventory_ledgers', ['product_batch_id' => $batchQuarantined->id, 'qty' => '100.00']);
        $this->assertDatabaseHas('inventory_ledgers', ['product_batch_id' => $batchExpired->id, 'qty' => '100.00']);

        // Verifikasi snapshot unit_cost tersimpan di delivery_order_items
        $this->assertDatabaseHas('delivery_order_items', [
            'delivery_order_id' => $do1Id,
            'product_batch_id' => $batchNearest->id,
            'qty_dispatched' => '30.00',
            'unit_cost' => '12345.67',
        ]);
        $this->assertDatabaseHas('delivery_order_items', [
            'delivery_order_id' => $do1Id,
            'product_batch_id' => $batchMiddle->id,
            'qty_dispatched' => '25.50',
            'unit_cost' => '12345.67',
        ]);

        // Verifikasi immutable stock_movements (type OUT, qty_change negatif)
        $this->assertDatabaseHas('stock_movements', [
            'product_batch_id' => $batchNearest->id,
            'type' => StockMovement::TYPE_OUT,
            'qty_change' => '-30.00',
            'reference_type' => DeliveryOrder::class,
            'reference_id' => $do1Id,
            'user_id' => $gudang->id,
        ]);
        $this->assertDatabaseHas('stock_movements', [
            'product_batch_id' => $batchMiddle->id,
            'type' => StockMovement::TYPE_OUT,
            'qty_change' => '-25.50',
            'reference_type' => DeliveryOrder::class,
            'reference_id' => $do1Id,
            'user_id' => $gudang->id,
        ]);

        // Verifikasi Jurnal Otomatis COGS oleh Listener DeliveryOrderDispatched (BCMath):
        // 30.00 * 12345.67 = 370370.1000
        // 25.50 * 12345.67 = 314814.5850
        // Total COGS = 685184.6850 -> rounded half-up = 685184.69
        $cogsEntries = GeneralLedger::query()
            ->where('reference_type', DeliveryOrder::class)
            ->where('reference_id', $do1Id)
            ->orderBy('id')
            ->get();

        $this->assertCount(2, $cogsEntries);
        $this->assertSame(GeneralLedger::ACCOUNT_COGS, $cogsEntries[0]->account_code);
        $this->assertSame('685184.69', $cogsEntries[0]->debit);
        $this->assertSame('0.00', $cogsEntries[0]->credit);
        $this->assertSame(GeneralLedger::ACCOUNT_INVENTORY, $cogsEntries[1]->account_code);
        $this->assertSame('0.00', $cogsEntries[1]->debit);
        $this->assertSame('685184.69', $cogsEntries[1]->credit);

        // Double dispatch & delete DO yang sudah Dispatched wajib ditolak 422
        $this->postJson("/api/delivery-orders/{$do1Id}/dispatch")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
        $this->deleteJson("/api/delivery-orders/{$do1Id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);

        // 3. Verifikasi Data Masking: Admin Sales dilarang melihat unit_cost/HPP, tapi boleh melihat total_amount SO
        Sanctum::actingAs($sales);
        $this->getJson("/api/delivery-orders/{$do1Id}")
            ->assertOk()
            ->assertJsonPath('data.sales_order.total_amount', '3000000.00')
            ->assertJsonMissingPath('data.total_cogs')
            ->assertJsonMissingPath('data.items.0.unit_cost')
            ->assertJsonMissingPath('data.items.0.cogs_total')
            ->assertJsonMissingPath('data.general_ledgers');

        $this->getJson("/api/sales-orders/{$soId}")
            ->assertOk()
            ->assertJsonPath('data.status', SalesOrder::STATUS_PARTIALLY_DELIVERED)
            ->assertJsonMissingPath('data.delivery_orders.0.total_cogs')
            ->assertJsonMissingPath('data.delivery_orders.0.items.0.unit_cost');

        // Finance & Manajer BISA melihat unit_cost & total_cogs
        foreach ([$finance, $manajer] as $privilegedUser) {
            Sanctum::actingAs($privilegedUser);
            $this->getJson("/api/delivery-orders/{$do1Id}")
                ->assertOk()
                ->assertJsonPath('data.total_cogs', '685184.69')
                ->assertJsonPath('data.items.0.unit_cost', '12345.67')
                ->assertJsonPath('data.items.1.unit_cost', '12345.67');
        }

        // 4. Tambah stok batch baru & selesaikan sisa SO (94.50 unit) -> SO otomatis berubah menjadi Completed
        $this->seedBatchStock(
            $product,
            'DO-BATCH-NEWEST',
            Carbon::today()->addDays(240)->toDateString(),
            '50.00',
            '12345.67',
            InventoryLedger::STATE_AVAILABLE
        );

        Event::fake([DeliveryOrderDispatched::class]);

        Sanctum::actingAs($gudang);
        $do2Id = $this->postJson('/api/delivery-orders', [
            'sales_order_id' => $soId,
            'delivery_date' => $today,
            'items' => [
                ['product_id' => $product->id, 'qty_dispatched' => '94.50'],
            ],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/delivery-orders/{$do2Id}/dispatch")
            ->assertOk()
            ->assertJsonPath('data.status', DeliveryOrder::STATUS_DISPATCHED)
            ->assertJsonPath('data.sales_order.status', SalesOrder::STATUS_COMPLETED)
            ->assertJsonCount(3, 'data.items')
            ->assertJsonPath('data.items.0.batch.batch_number', 'DO-BATCH-MIDDLE')
            ->assertJsonPath('data.items.0.qty_dispatched', '14.50')
            ->assertJsonPath('data.items.1.batch.batch_number', 'DO-BATCH-FAR')
            ->assertJsonPath('data.items.1.qty_dispatched', '50.00')
            ->assertJsonPath('data.items.2.batch.batch_number', 'DO-BATCH-NEWEST')
            ->assertJsonPath('data.items.2.qty_dispatched', '30.00');

        Event::assertDispatchedTimes(DeliveryOrderDispatched::class, 1);

        $this->assertDatabaseHas('sales_orders', [
            'id' => $soId,
            'status' => SalesOrder::STATUS_COMPLETED,
        ]);
    }

    public function test_sales_invoice_revenue_gl_customer_payment_idempotency_409_and_trial_balance(): void
    {
        $sales = $this->userByEmail('sales@erp.test');
        $gudang = $this->userByEmail('gudang@erp.test');
        $finance = $this->userByEmail('finance@erp.test');

        $customer = $this->createActiveCustomer('PT Distribusi Retail Utama', '50000000.00');
        $product = $this->createActiveProduct('SKU-O2C-FIN1', 'Minyak Goreng 2L');

        $today = Carbon::today()->toDateString();
        $dueDate = Carbon::today()->addDays(30)->toDateString();

        // Stok available: 100 unit @ HPP MWA Rp100.000,00
        $this->seedBatchStock(
            $product,
            'FIN-B1',
            Carbon::today()->addDays(180)->toDateString(),
            '100.00',
            '100000.00',
            InventoryLedger::STATE_AVAILABLE
        );

        // 1. SO: 50 unit @ harga jual Rp150.000,00 (Total = Rp7.500.000,00)
        Sanctum::actingAs($sales);
        $soId = $this->postJson('/api/sales-orders', [
            'customer_id' => $customer->id,
            'order_date' => $today,
            'items' => [
                ['product_id' => $product->id, 'qty_ordered' => '50.00', 'unit_price' => '150000.00'],
            ],
        ])->assertCreated()->json('data.id');

        // Gagal menerbitkan SalesInvoice untuk SO Draft (422)
        Sanctum::actingAs($finance);
        $this->postJson('/api/sales-invoices', [
            'sales_order_id' => $soId,
            'due_date' => $dueDate,
            'idempotency_key' => 'ar-inv-draft-so',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['sales_order_id']);

        // Konfirmasi SO & Dispatch DO (COGS = 50 * 100.000 = 5.000.000,00)
        Sanctum::actingAs($sales);
        $this->postJson("/api/sales-orders/{$soId}/confirm")->assertOk();

        Sanctum::actingAs($gudang);
        $doId = $this->postJson('/api/delivery-orders', [
            'sales_order_id' => $soId,
            'delivery_date' => $today,
            'items' => [
                ['product_id' => $product->id, 'qty_dispatched' => '50.00'],
            ],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/delivery-orders/{$doId}/dispatch")->assertOk();

        // 2. Terbitkan SalesInvoice dari DeliveryOrder (total_billed dihitung otomatis = 50 * 150.000 = 7.500.000,00)
        Sanctum::actingAs($finance);
        $invResponse = $this->postJson('/api/sales-invoices', [
            'delivery_order_id' => $doId,
            'invoice_date' => $today,
            'due_date' => $dueDate,
            'idempotency_key' => 'ar-inv-idem-001',
        ]);

        $invResponse->assertCreated()
            ->assertJsonPath('data.status', SalesInvoice::STATUS_UNPAID)
            ->assertJsonPath('data.total_billed', '7500000.00')
            ->assertJsonPath('data.total_received', '0.00')
            ->assertJsonPath('data.remaining_balance', '7500000.00');

        $invoiceId = $invResponse->json('data.id');

        // Verifikasi Jurnal Revenue otomatis: Debit 1102-AR / Credit 4101-SALES-REVENUE
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => SalesInvoice::class,
            'reference_id' => $invoiceId,
            'account_code' => GeneralLedger::ACCOUNT_AR,
            'debit' => '7500000.00',
            'credit' => '0.00',
        ]);
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => SalesInvoice::class,
            'reference_id' => $invoiceId,
            'account_code' => GeneralLedger::ACCOUNT_SALES_REVENUE,
            'debit' => '0.00',
            'credit' => '7500000.00',
        ]);

        // Duplicate idempotency_key saat buat SalesInvoice -> 409 Conflict (via body & via header)
        $glCountAfterInvoice = GeneralLedger::count();
        $this->postJson('/api/sales-invoices', [
            'sales_order_id' => $soId,
            'due_date' => $dueDate,
            'idempotency_key' => 'ar-inv-idem-001',
        ])->assertStatus(409)
            ->assertJsonPath('error', 'duplicate_idempotency_key')
            ->assertJsonPath('existing_resource_id', $invoiceId);

        $this->withHeader('Idempotency-Key', 'ar-inv-idem-001')
            ->postJson('/api/sales-invoices', [
                'sales_order_id' => $soId,
                'due_date' => $dueDate,
            ])->assertStatus(409)
            ->assertJsonPath('error', 'duplicate_idempotency_key');

        $this->assertDatabaseCount('sales_invoices', 1);
        $this->assertSame($glCountAfterInvoice, GeneralLedger::count());

        // 3. Customer Payment Tahap 1 (Partial Rp3.000.000,00) -> Unpaid -> Partially Paid
        $pay1 = $this->postJson('/api/customer-payments', [
            'sales_invoice_id' => $invoiceId,
            'amount_received' => '3000000.00',
            'payment_date' => $today,
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'ar-pay-idem-001',
        ]);

        $pay1->assertCreated()
            ->assertJsonPath('data.amount_received', '3000000.00')
            ->assertJsonPath('data.sales_invoice.status', SalesInvoice::STATUS_PARTIALLY_PAID)
            ->assertJsonPath('data.sales_invoice.total_received', '3000000.00')
            ->assertJsonPath('data.sales_invoice.remaining_balance', '4500000.00');

        $pay1Id = $pay1->json('data.id');

        // Verifikasi Jurnal Kas Masuk: Debit 1101-CASH-BANK / Credit 1102-AR
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => CustomerPayment::class,
            'reference_id' => $pay1Id,
            'account_code' => GeneralLedger::ACCOUNT_CASH_BANK,
            'debit' => '3000000.00',
            'credit' => '0.00',
        ]);
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => CustomerPayment::class,
            'reference_id' => $pay1Id,
            'account_code' => GeneralLedger::ACCOUNT_AR,
            'debit' => '0.00',
            'credit' => '3000000.00',
        ]);

        // 4. ANTI DOUBLE-PAYMENT: Replay idempotency_key -> 409 Conflict
        $glCountBeforeDupPay = GeneralLedger::count();
        $this->postJson('/api/customer-payments', [
            'sales_invoice_id' => $invoiceId,
            'amount_received' => '3000000.00',
            'payment_date' => $today,
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'ar-pay-idem-001',
        ])->assertStatus(409)
            ->assertJsonPath('error', 'duplicate_idempotency_key')
            ->assertJsonPath('existing_resource_id', $pay1Id);

        $this->withHeader('Idempotency-Key', 'ar-pay-idem-001')
            ->postJson('/api/customer-payments', [
                'sales_invoice_id' => $invoiceId,
                'amount_received' => '3000000.00',
                'payment_date' => $today,
                'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            ])->assertStatus(409)
            ->assertJsonPath('error', 'duplicate_idempotency_key');

        $this->assertDatabaseCount('customer_payments', 1);
        $this->assertSame($glCountBeforeDupPay, GeneralLedger::count());

        // 5. Overpayment (Rp5.000.000 > sisa Rp4.500.000) -> WAJIB ditolak 422
        $this->postJson('/api/customer-payments', [
            'sales_invoice_id' => $invoiceId,
            'amount_received' => '5000000.00',
            'payment_date' => $today,
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'ar-pay-over-001',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['amount_received']);

        // 6. Pelunasan Tahap 2 (Rp4.500.000 via header Idempotency-Key) -> Partially Paid -> Paid
        $this->withHeader('Idempotency-Key', 'ar-pay-idem-002')
            ->postJson('/api/customer-payments', [
                'sales_invoice_id' => $invoiceId,
                'amount_received' => '4500000.00',
                'payment_date' => $today,
                'payment_method' => CustomerPayment::METHOD_VIRTUAL_ACCOUNT,
            ])->assertCreated()
            ->assertJsonPath('data.sales_invoice.status', SalesInvoice::STATUS_PAID)
            ->assertJsonPath('data.sales_invoice.total_received', '7500000.00')
            ->assertJsonPath('data.sales_invoice.remaining_balance', '0.00');

        // Pembayaran pada invoice yang sudah Paid -> WAJIB ditolak 422
        $this->postJson('/api/customer-payments', [
            'sales_invoice_id' => $invoiceId,
            'amount_received' => '100000.00',
            'payment_date' => $today,
            'payment_method' => CustomerPayment::METHOD_CASH,
            'idempotency_key' => 'ar-pay-after-paid',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['sales_invoice_id']);

        // 7. Verifikasi Trial Balance General Ledger seimbang sempurna:
        // COGS (5.000.000) + AR Invoice (7.500.000) + Payments (3.000.000 + 4.500.000) = 20.000.000
        $summary = $this->getJson('/api/general-ledgers/summary')->assertOk();
        $summary
            ->assertJsonPath('data.is_balanced', true)
            ->assertJsonPath('data.grand_total_debit', '20000000.00')
            ->assertJsonPath('data.grand_total_credit', '20000000.00');

        $accounts = collect($summary->json('data.accounts'))->keyBy('account_code');
        $this->assertSame('7500000.00', $accounts->get(GeneralLedger::ACCOUNT_CASH_BANK)['net_balance']);
        $this->assertSame('0.00', $accounts->get(GeneralLedger::ACCOUNT_AR)['net_balance']);
        $this->assertSame('-5000000.00', $accounts->get(GeneralLedger::ACCOUNT_INVENTORY)['net_balance']);
        $this->assertSame('-7500000.00', $accounts->get(GeneralLedger::ACCOUNT_SALES_REVENUE)['net_balance']);
        $this->assertSame('5000000.00', $accounts->get(GeneralLedger::ACCOUNT_COGS)['net_balance']);
    }

    public function test_ar_aging_summary_groups_unpaid_and_partially_paid_invoices_into_four_buckets(): void
    {
        $finance = $this->userByEmail('finance@erp.test');
        $sales = $this->userByEmail('sales@erp.test');

        $customerA = $this->createActiveCustomer('PT Pelanggan Alpha', '50000000.00');
        $customerB = $this->createActiveCustomer('PT Pelanggan Beta', '50000000.00');

        $soA = SalesOrder::create([
            'so_number' => 'SO-AGE-A',
            'customer_id' => $customerA->id,
            'salesperson_id' => $sales->id,
            'order_date' => '2026-08-01',
            'total_amount' => '10000000.00',
            'status' => SalesOrder::STATUS_COMPLETED,
        ]);

        $soB = SalesOrder::create([
            'so_number' => 'SO-AGE-B',
            'customer_id' => $customerB->id,
            'salesperson_id' => $sales->id,
            'order_date' => '2026-08-01',
            'total_amount' => '20000000.00',
            'status' => SalesOrder::STATUS_COMPLETED,
        ]);

        $asOf = Carbon::parse('2026-11-21');

        // 1. Current (+15 hari, Unpaid 1.250.000)
        SalesInvoice::create([
            'invoice_number' => 'INV-AR-CUR1',
            'sales_order_id' => $soA->id,
            'customer_id' => $customerA->id,
            'total_billed' => '1250000.00',
            'due_date' => $asOf->copy()->addDays(15)->toDateString(),
            'status' => SalesInvoice::STATUS_UNPAID,
            'idempotency_key' => 'ar-age-cur1',
        ]);

        // 2. Current (jatuh tempo hari ini = 0 hari overdue, Partially Paid: 2.000.000 - 750.000 = 1.250.000)
        $partialInvoice = SalesInvoice::create([
            'invoice_number' => 'INV-AR-CUR2',
            'sales_order_id' => $soA->id,
            'customer_id' => $customerA->id,
            'total_billed' => '2000000.00',
            'due_date' => $asOf->toDateString(),
            'status' => SalesInvoice::STATUS_PARTIALLY_PAID,
            'idempotency_key' => 'ar-age-cur2',
        ]);
        CustomerPayment::create([
            'receipt_number' => 'RCP-AGE-001',
            'sales_invoice_id' => $partialInvoice->id,
            'amount_received' => '750000.00',
            'payment_date' => '2026-11-18',
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'ar-age-pay1',
        ]);

        // 3. 1-30 Days (12 hari overdue, Unpaid 3.000.000)
        SalesInvoice::create([
            'invoice_number' => 'INV-AR-1-30',
            'sales_order_id' => $soA->id,
            'customer_id' => $customerA->id,
            'total_billed' => '3000000.00',
            'due_date' => $asOf->copy()->subDays(12)->toDateString(),
            'status' => SalesInvoice::STATUS_UNPAID,
            'idempotency_key' => 'ar-age-1-30',
        ]);

        // 4. 31-60 Days (45 hari overdue, Unpaid 4.000.000)
        SalesInvoice::create([
            'invoice_number' => 'INV-AR-31-60',
            'sales_order_id' => $soB->id,
            'customer_id' => $customerB->id,
            'total_billed' => '4000000.00',
            'due_date' => $asOf->copy()->subDays(45)->toDateString(),
            'status' => SalesInvoice::STATUS_UNPAID,
            'idempotency_key' => 'ar-age-31-60',
        ]);

        // 5. >60 Days (75 hari overdue, Unpaid 5.500.000)
        SalesInvoice::create([
            'invoice_number' => 'INV-AR-OVER60',
            'sales_order_id' => $soB->id,
            'customer_id' => $customerB->id,
            'total_billed' => '5500000.00',
            'due_date' => $asOf->copy()->subDays(75)->toDateString(),
            'status' => SalesInvoice::STATUS_UNPAID,
            'idempotency_key' => 'ar-age-over60',
        ]);

        // 6. Paid invoice (WAJIB tidak dihitung dalam AR Aging)
        SalesInvoice::create([
            'invoice_number' => 'INV-AR-PAID',
            'sales_order_id' => $soB->id,
            'customer_id' => $customerB->id,
            'total_billed' => '9000000.00',
            'due_date' => $asOf->copy()->subDays(90)->toDateString(),
            'status' => SalesInvoice::STATUS_PAID,
            'idempotency_key' => 'ar-age-paid',
        ]);

        Sanctum::actingAs($finance);

        $this->getJson('/api/sales-invoices/ar-aging?as_of_date=2026-11-21')
            ->assertOk()
            ->assertJsonPath('data.as_of_date', '2026-11-21')
            ->assertJsonPath('data.total_invoices', 5)
            ->assertJsonPath('data.total_outstanding', '15000000.00')
            ->assertJsonPath('data.buckets.current.label', 'Current')
            ->assertJsonPath('data.buckets.current.count', 2)
            ->assertJsonPath('data.buckets.current.total_outstanding', '2500000.00')
            ->assertJsonPath('data.buckets.1_30_days.label', '1-30 Days')
            ->assertJsonPath('data.buckets.1_30_days.count', 1)
            ->assertJsonPath('data.buckets.1_30_days.total_outstanding', '3000000.00')
            ->assertJsonPath('data.buckets.31_60_days.label', '31-60 Days')
            ->assertJsonPath('data.buckets.31_60_days.count', 1)
            ->assertJsonPath('data.buckets.31_60_days.total_outstanding', '4000000.00')
            ->assertJsonPath('data.buckets.over_60_days.label', '>60 Days')
            ->assertJsonPath('data.buckets.over_60_days.count', 1)
            ->assertJsonPath('data.buckets.over_60_days.total_outstanding', '5500000.00')
            ->assertJsonCount(2, 'data.by_customer');

        // Filter berdasarkan customer_id
        $this->getJson("/api/sales-invoices/ar-aging?as_of_date=2026-11-21&customer_id={$customerB->id}")
            ->assertOk()
            ->assertJsonPath('data.total_invoices', 2)
            ->assertJsonPath('data.total_outstanding', '9500000.00')
            ->assertJsonPath('data.buckets.current.count', 0)
            ->assertJsonPath('data.buckets.31_60_days.total_outstanding', '4000000.00')
            ->assertJsonPath('data.buckets.over_60_days.total_outstanding', '5500000.00');
    }

    public function test_rbac_protects_o2c_endpoints_strictly_across_roles(): void
    {
        $gudang = $this->userByEmail('gudang@erp.test');
        $sales = $this->userByEmail('sales@erp.test');
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');

        // Purchasing tidak memiliki akses ke seluruh modul O2C
        Sanctum::actingAs($purchasing);
        $this->getJson('/api/sales-orders')->assertForbidden();
        $this->postJson('/api/sales-orders', [])->assertForbidden();
        $this->getJson('/api/delivery-orders')->assertForbidden();
        $this->postJson('/api/delivery-orders', [])->assertForbidden();
        $this->getJson('/api/sales-invoices')->assertForbidden();
        $this->getJson('/api/sales-invoices/ar-aging')->assertForbidden();
        $this->getJson('/api/customer-payments')->assertForbidden();

        // Staf Gudang: hanya boleh DeliveryOrder; dilarang SalesOrder, SalesInvoice, CustomerPayment
        Sanctum::actingAs($gudang);
        $this->getJson('/api/delivery-orders')->assertOk();
        $this->getJson('/api/sales-orders')->assertForbidden();
        $this->postJson('/api/sales-orders', [])->assertForbidden();
        $this->getJson('/api/sales-invoices')->assertForbidden();
        $this->postJson('/api/sales-invoices', [])->assertForbidden();
        $this->getJson('/api/sales-invoices/ar-aging')->assertForbidden();
        $this->getJson('/api/customer-payments')->assertForbidden();
        $this->postJson('/api/customer-payments', [])->assertForbidden();

        // Admin Sales: boleh SalesOrder & lihat DeliveryOrder; dilarang membuat/dispatch DO serta akses AR/Payment
        Sanctum::actingAs($sales);
        $this->getJson('/api/sales-orders')->assertOk();
        $this->getJson('/api/delivery-orders')->assertOk();
        $this->postJson('/api/delivery-orders', [])->assertForbidden();
        $this->getJson('/api/sales-invoices')->assertForbidden();
        $this->postJson('/api/sales-invoices', [])->assertForbidden();
        $this->getJson('/api/sales-invoices/ar-aging')->assertForbidden();
        $this->getJson('/api/customer-payments')->assertForbidden();
        $this->postJson('/api/customer-payments', [])->assertForbidden();

        // Finance: boleh lihat SO & DO, penuh di SalesInvoice, AR Aging, & CustomerPayment; dilarang create SO/DO
        Sanctum::actingAs($finance);
        $this->getJson('/api/sales-orders')->assertOk();
        $this->postJson('/api/sales-orders', [])->assertForbidden();
        $this->getJson('/api/delivery-orders')->assertOk();
        $this->postJson('/api/delivery-orders', [])->assertForbidden();
        $this->getJson('/api/sales-invoices')->assertOk();
        $this->getJson('/api/sales-invoices/ar-aging')->assertOk();
        $this->getJson('/api/customer-payments')->assertOk();

        // Manajer: boleh read-only SO, DO, SalesInvoice, AR Aging, CustomerPayment; dilarang create mutasi
        Sanctum::actingAs($manajer);
        $this->getJson('/api/sales-orders')->assertOk();
        $this->postJson('/api/sales-orders', [])->assertForbidden();
        $this->getJson('/api/delivery-orders')->assertOk();
        $this->postJson('/api/delivery-orders', [])->assertForbidden();
        $this->getJson('/api/sales-invoices')->assertOk();
        $this->postJson('/api/sales-invoices', [])->assertForbidden();
        $this->getJson('/api/sales-invoices/ar-aging')->assertOk();
        $this->getJson('/api/customer-payments')->assertOk();
        $this->postJson('/api/customer-payments', [])->assertForbidden();
    }
}
