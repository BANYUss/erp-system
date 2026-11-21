<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\InventoryLedger;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Supplier;
use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MasterDataApiTest extends TestCase
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

    public function test_unauthenticated_requests_are_rejected_with_401(): void
    {
        $this->getJson('/api/products')->assertUnauthorized();
        $this->getJson('/api/suppliers')->assertUnauthorized();
        $this->getJson('/api/customers')->assertUnauthorized();
    }

    public function test_super_admin_has_full_crud_access_with_soft_deletes_on_all_master_data(): void
    {
        Sanctum::actingAs($this->userByEmail('superadmin@erp.test'));

        // 1. Products CRUD + Financial visibility + SoftDelete
        $productCreate = $this->postJson('/api/products', [
            'sku' => 'SKU-MDM-001',
            'name' => 'Beras Pandan Wangi 5kg',
            'category_id' => 1,
            'uom' => 'SAK',
            'is_active' => true,
        ]);

        $productCreate->assertCreated()
            ->assertJsonPath('data.sku', 'SKU-MDM-001')
            ->assertJsonPath('data.name', 'Beras Pandan Wangi 5kg')
            ->assertJsonPath('data.uom', 'SAK')
            ->assertJsonPath('data.is_active', true);

        $productId = $productCreate->json('data.id');

        $batch = ProductBatch::create([
            'product_id' => $productId,
            'batch_number' => 'BATCH-MDM-01',
            'expiry_date' => '2027-06-30',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batch->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '100.00',
            'cost_price' => '65000.00',
        ]);

        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.sku', 'SKU-MDM-001')
            ->assertJsonPath('data.0.available_qty', '100.00')
            ->assertJsonPath('data.0.cost_price', '65000.00')
            ->assertJsonPath('data.0.inventory_value', '6500000.00');

        $this->getJson("/api/products/{$productId}")
            ->assertOk()
            ->assertJsonPath('data.cost_price', '65000.00')
            ->assertJsonPath('data.batches.0.inventory_ledgers.0.cost_price', '65000.00');

        $this->putJson("/api/products/{$productId}", [
            'name' => 'Beras Pandan Wangi Premium 5kg',
            'is_active' => false,
        ])->assertOk()
            ->assertJsonPath('data.name', 'Beras Pandan Wangi Premium 5kg')
            ->assertJsonPath('data.is_active', false);

        $this->deleteJson("/api/products/{$productId}")
            ->assertOk()
            ->assertJsonPath('message', 'Produk berhasil dihapus.');

        $this->assertSoftDeleted('products', ['id' => $productId]);
        $this->getJson("/api/products/{$productId}")->assertNotFound();

        // 2. Suppliers CRUD + SoftDelete
        $supplierCreate = $this->postJson('/api/suppliers', [
            'name' => 'PT Distribusi Makmur',
            'contact_name' => 'Andi Wijaya',
            'email' => 'andi@distribusimakmur.test',
            'phone' => '+62-21-5550199',
            'address' => 'Jl. Raya Industri No. 12',
            'status' => 'active',
        ]);

        $supplierCreate->assertCreated()
            ->assertJsonPath('data.name', 'PT Distribusi Makmur')
            ->assertJsonPath('data.status', 'active');

        $supplierId = $supplierCreate->json('data.id');

        $this->getJson('/api/suppliers')
            ->assertOk()
            ->assertJsonPath('data.0.id', $supplierId);

        $this->patchJson("/api/suppliers/{$supplierId}", [
            'status' => 'inactive',
            'contact_name' => 'Siti Rahma',
        ])->assertOk()
            ->assertJsonPath('data.status', 'inactive')
            ->assertJsonPath('data.contact_name', 'Siti Rahma');

        $this->deleteJson("/api/suppliers/{$supplierId}")
            ->assertOk()
            ->assertJsonPath('message', 'Supplier berhasil dihapus.');

        $this->assertSoftDeleted('suppliers', ['id' => $supplierId]);
        $this->getJson("/api/suppliers/{$supplierId}")->assertNotFound();

        // 3. Customers CRUD + SoftDelete
        $customerCreate = $this->postJson('/api/customers', [
            'name' => 'CV Sumber Rejeki',
            'email' => 'purchasing@sumberrejeki.test',
            'credit_limit' => '50000000.75',
            'status' => 'active',
        ]);

        $customerCreate->assertCreated()
            ->assertJsonPath('data.name', 'CV Sumber Rejeki')
            ->assertJsonPath('data.credit_limit', '50000000.75')
            ->assertJsonPath('data.status', 'active');

        $customerId = $customerCreate->json('data.id');

        $this->getJson("/api/customers/{$customerId}")
            ->assertOk()
            ->assertJsonPath('data.credit_limit', '50000000.75');

        $this->putJson("/api/customers/{$customerId}", [
            'credit_limit' => '75000000.00',
            'status' => 'suspended',
        ])->assertOk()
            ->assertJsonPath('data.credit_limit', '75000000.00')
            ->assertJsonPath('data.status', 'suspended');

        $this->deleteJson("/api/customers/{$customerId}")
            ->assertOk()
            ->assertJsonPath('message', 'Customer berhasil dihapus.');

        $this->assertSoftDeleted('customers', ['id' => $customerId]);
        $this->getJson("/api/customers/{$customerId}")->assertNotFound();
    }

    public function test_purchasing_can_manage_products_and_suppliers_but_is_forbidden_from_customers(): void
    {
        $customer = Customer::create([
            'name' => 'Toko Retail Satu',
            'email' => 'retail1@erp.test',
            'credit_limit' => '10000000.00',
            'status' => 'active',
        ]);

        Sanctum::actingAs($this->userByEmail('purchasing@erp.test'));

        // Purchasing boleh CRUD Product
        $productResponse = $this->postJson('/api/products', [
            'sku' => 'SKU-PUR-001',
            'name' => 'Gula Kristal 1kg',
            'uom' => 'PACK',
        ])->assertCreated();

        $productId = $productResponse->json('data.id');

        $this->putJson("/api/products/{$productId}", [
            'name' => 'Gula Kristal Putih 1kg',
        ])->assertOk()
            ->assertJsonPath('data.name', 'Gula Kristal Putih 1kg');

        $this->deleteJson("/api/products/{$productId}")->assertOk();
        $this->assertSoftDeleted('products', ['id' => $productId]);

        // Purchasing boleh CRUD Supplier
        $supplierResponse = $this->postJson('/api/suppliers', [
            'name' => 'PT Pemasok Utama',
            'email' => 'order@pemasokutama.test',
        ])->assertCreated();

        $supplierId = $supplierResponse->json('data.id');

        $this->putJson("/api/suppliers/{$supplierId}", [
            'phone' => '021-88990011',
        ])->assertOk()
            ->assertJsonPath('data.phone', '021-88990011');

        $this->deleteJson("/api/suppliers/{$supplierId}")->assertOk();
        $this->assertSoftDeleted('suppliers', ['id' => $supplierId]);

        // Purchasing dilarang akses Customer (403 Forbidden)
        $this->getJson('/api/customers')->assertForbidden();
        $this->getJson("/api/customers/{$customer->id}")->assertForbidden();
        $this->postJson('/api/customers', [
            'name' => 'Forbidden Customer',
            'credit_limit' => '1000.00',
        ])->assertForbidden();
        $this->putJson("/api/customers/{$customer->id}", ['name' => 'Edited'])->assertForbidden();
        $this->deleteJson("/api/customers/{$customer->id}")->assertForbidden();
    }

    public function test_admin_sales_can_only_view_products_and_customers_and_gets_403_elsewhere(): void
    {
        $product = Product::create([
            'sku' => 'SKU-SLS-001',
            'name' => 'Minyak Goreng 2L',
            'uom' => 'CRT',
            'is_active' => true,
        ]);

        $batch = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'BATCH-SLS-01',
            'expiry_date' => '2027-08-31',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batch->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '50.00',
            'cost_price' => '180000.00',
        ]);

        $supplier = Supplier::create([
            'name' => 'PT Supplier Rahasia',
            'status' => 'active',
        ]);

        $customer = Customer::create([
            'name' => 'Minimarket Sejahtera',
            'email' => 'owner@sejahtera.test',
            'credit_limit' => '35000000.00',
            'status' => 'active',
        ]);

        Sanctum::actingAs($this->userByEmail('sales@erp.test'));

        // Admin Sales bisa lihat Product (tersedia available_qty, tanpa HPP/cost_price)
        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.sku', 'SKU-SLS-001')
            ->assertJsonPath('data.0.available_qty', '50.00')
            ->assertJsonMissingPath('data.0.cost_price')
            ->assertJsonMissingPath('data.0.inventory_value');

        $this->getJson("/api/products/{$product->id}")
            ->assertOk()
            ->assertJsonPath('data.available_qty', '50.00')
            ->assertJsonMissingPath('data.cost_price');

        // Admin Sales bisa lihat Customer beserta credit_limit
        $this->getJson('/api/customers')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Minimarket Sejahtera')
            ->assertJsonPath('data.0.credit_limit', '35000000.00');

        $this->getJson("/api/customers/{$customer->id}")
            ->assertOk()
            ->assertJsonPath('data.credit_limit', '35000000.00');

        // Admin Sales DILARANG mutasi Product, mutasi Customer, atau akses Supplier (403)
        $this->postJson('/api/products', ['sku' => 'SKU-X', 'name' => 'X', 'uom' => 'PCS'])->assertForbidden();
        $this->putJson("/api/products/{$product->id}", ['name' => 'Changed'])->assertForbidden();
        $this->deleteJson("/api/products/{$product->id}")->assertForbidden();

        $this->postJson('/api/customers', ['name' => 'New Cust', 'credit_limit' => '1000.00'])->assertForbidden();
        $this->putJson("/api/customers/{$customer->id}", ['credit_limit' => '99999999.00'])->assertForbidden();
        $this->deleteJson("/api/customers/{$customer->id}")->assertForbidden();

        $this->getJson('/api/suppliers')->assertForbidden();
        $this->getJson("/api/suppliers/{$supplier->id}")->assertForbidden();
        $this->postJson('/api/suppliers', ['name' => 'Blocked Supplier'])->assertForbidden();
        $this->putJson("/api/suppliers/{$supplier->id}", ['name' => 'Blocked'])->assertForbidden();
        $this->deleteJson("/api/suppliers/{$supplier->id}")->assertForbidden();
    }

    public function test_staf_gudang_can_only_view_products_without_financial_data_and_gets_403_elsewhere(): void
    {
        $product = Product::create([
            'sku' => 'SKU-GDG-001',
            'name' => 'Tepung Terigu 1kg',
            'uom' => 'SAK',
            'is_active' => true,
        ]);

        $batch = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'BATCH-GDG-01',
            'expiry_date' => '2027-03-15',
        ]);

        InventoryLedger::create([
            'product_batch_id' => $batch->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '250.00',
            'cost_price' => '11500.00',
        ]);

        $supplier = Supplier::create([
            'name' => 'PT Pemasok Tepung',
            'status' => 'active',
        ]);

        $customer = Customer::create([
            'name' => 'Toko Kue Nusantara',
            'credit_limit' => '20000000.00',
            'status' => 'active',
        ]);

        Sanctum::actingAs($this->userByEmail('gudang@erp.test'));

        // Staf Gudang hanya bisa lihat Product TANPA data finansial apapun
        $this->getJson('/api/products')
            ->assertOk()
            ->assertJsonPath('data.0.sku', 'SKU-GDG-001')
            ->assertJsonPath('data.0.available_qty', '250.00')
            ->assertJsonPath('data.0.batches.0.batch_number', 'BATCH-GDG-01')
            ->assertJsonPath('data.0.batches.0.inventory_ledgers.0.qty', '250.00')
            ->assertJsonMissingPath('data.0.cost_price')
            ->assertJsonMissingPath('data.0.selling_price')
            ->assertJsonMissingPath('data.0.inventory_value')
            ->assertJsonMissingPath('data.0.batches.0.inventory_ledgers.0.cost_price');

        $this->getJson("/api/products/{$product->id}")
            ->assertOk()
            ->assertJsonPath('data.sku', 'SKU-GDG-001')
            ->assertJsonMissingPath('data.cost_price')
            ->assertJsonMissingPath('data.selling_price')
            ->assertJsonMissingPath('data.inventory_value')
            ->assertJsonMissingPath('data.batches.0.inventory_ledgers.0.cost_price');

        // Staf Gudang DILARANG kelola Product dan DILARANG akses Supplier/Customer (403)
        $this->postJson('/api/products', ['sku' => 'SKU-NO', 'name' => 'No', 'uom' => 'PCS'])->assertForbidden();
        $this->putJson("/api/products/{$product->id}", ['name' => 'Edited'])->assertForbidden();
        $this->deleteJson("/api/products/{$product->id}")->assertForbidden();

        $this->getJson('/api/suppliers')->assertForbidden();
        $this->getJson("/api/suppliers/{$supplier->id}")->assertForbidden();
        $this->postJson('/api/suppliers', ['name' => 'Forbidden'])->assertForbidden();

        $this->getJson('/api/customers')->assertForbidden();
        $this->getJson("/api/customers/{$customer->id}")->assertForbidden();
        $this->postJson('/api/customers', ['name' => 'Forbidden', 'credit_limit' => '0.00'])->assertForbidden();
    }

    public function test_strict_form_request_validation_rejects_invalid_payloads(): void
    {
        Sanctum::actingAs($this->userByEmail('superadmin@erp.test'));

        Product::create([
            'sku' => 'SKU-EXISTING',
            'name' => 'Existing Product',
            'uom' => 'PCS',
        ]);

        // Product validation: duplicate SKU, invalid SKU chars, missing uom
        $this->postJson('/api/products', [
            'sku' => 'SKU-EXISTING',
            'name' => 'A',
            'uom' => '',
            'category_id' => 0,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['sku', 'name', 'uom', 'category_id']);

        $this->postJson('/api/products', [
            'sku' => 'SKU INVALID SPACE',
            'name' => 'Valid Product Name',
            'uom' => 'PCS',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['sku']);

        // Supplier validation: invalid email, phone, status
        $this->postJson('/api/suppliers', [
            'name' => 'P',
            'email' => 'not-an-email',
            'phone' => 'invalid-phone-abc',
            'status' => 'unknown_status',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'email', 'phone', 'status']);

        // Customer validation: negative credit_limit & precision > 2 decimals & invalid status
        $this->postJson('/api/customers', [
            'name' => 'Customer Invalid',
            'email' => 'bad-email',
            'credit_limit' => '-500.00',
            'status' => 'deleted',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'credit_limit', 'status']);

        $this->postJson('/api/customers', [
            'name' => 'Customer Precision Invalid',
            'credit_limit' => '1000.123',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['credit_limit']);
    }
}
