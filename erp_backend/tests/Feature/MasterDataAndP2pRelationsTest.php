<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\PurchaseRequisition;
use App\Models\Supplier;
use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MasterDataAndP2pRelationsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RoleAndPermissionSeeder::class);
    }

    public function test_product_and_product_batch_relations_and_casts(): void
    {
        $product = Product::create([
            'sku' => 'SKU-001',
            'name' => 'Beras Premium 5kg',
            'category_id' => 1,
            'uom' => 'SAK',
            'is_active' => true,
        ]);

        $batchEarlier = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'BATCH-2026-01',
            'expiry_date' => '2026-12-31',
        ]);

        $batchLater = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'BATCH-2027-01',
            'expiry_date' => '2027-06-30',
        ]);

        $this->assertTrue($product->is_active);
        $this->assertCount(2, $product->batches);
        $this->assertTrue($batchEarlier->product->is($product));
        $this->assertSame('2026-12-31', $batchEarlier->expiry_date->format('Y-m-d'));
        $this->assertSame(
            [$batchEarlier->id, $batchLater->id],
            $product->batches()->orderBy('expiry_date')->pluck('id')->all()
        );
    }

    public function test_p2p_model_relations_decimal_casts_and_soft_deletes(): void
    {
        $purchasingUser = User::where('email', 'purchasing@erp.test')->firstOrFail();
        $managerUser = User::where('email', 'manajer@erp.test')->firstOrFail();

        $supplier = Supplier::create([
            'name' => 'PT Sumber Pangan Nusantara',
            'contact_name' => 'Budi Santoso',
            'email' => 'sales@sumberpangan.test',
            'phone' => '021-5551234',
            'address' => 'Jl. Industri No. 10, Bekasi',
            'status' => 'active',
        ]);

        $customer = Customer::create([
            'name' => 'Toko Makmur Jaya',
            'email' => 'owner@makmurjaya.test',
            'credit_limit' => '25000000.50',
            'status' => 'active',
        ]);

        $product = Product::create([
            'sku' => 'SKU-002',
            'name' => 'Minyak Goreng 2L',
            'category_id' => 2,
            'uom' => 'CRT',
            'is_active' => true,
        ]);

        $pr = PurchaseRequisition::create([
            'pr_number' => 'PR-202611-0001',
            'requestor_id' => $purchasingUser->id,
            'status' => PurchaseRequisition::STATUS_CONVERTED,
        ]);

        $po = PurchaseOrder::create([
            'po_number' => 'PO-202611-0001',
            'pr_id' => $pr->id,
            'supplier_id' => $supplier->id,
            'total_amount' => '15000000.00',
            'status' => PurchaseOrder::STATUS_APPROVED,
            'approver_id' => $managerUser->id,
        ]);

        $poItem = PurchaseOrderItem::create([
            'po_id' => $po->id,
            'product_id' => $product->id,
            'qty_ordered' => '100.00',
            'unit_price' => '150000.00',
        ]);

        // Verifikasi relasi lengkap
        $this->assertTrue($pr->requestor->is($purchasingUser));
        $this->assertTrue($purchasingUser->purchaseRequisitions->contains($pr));
        $this->assertTrue($pr->purchaseOrders->contains($po));

        $this->assertTrue($po->purchaseRequisition->is($pr));
        $this->assertTrue($po->supplier->is($supplier));
        $this->assertTrue($po->approver->is($managerUser));
        $this->assertTrue($supplier->purchaseOrders->contains($po));
        $this->assertTrue($managerUser->approvedPurchaseOrders->contains($po));

        $this->assertCount(1, $po->items);
        $this->assertTrue($poItem->purchaseOrder->is($po));
        $this->assertTrue($poItem->product->is($product));
        $this->assertTrue($product->purchaseOrderItems->contains($poItem));

        // Verifikasi tipe DECIMAL(15,2)
        $this->assertSame('25000000.50', $customer->fresh()->credit_limit);
        $this->assertSame('15000000.00', $po->fresh()->total_amount);
        $this->assertSame('100.00', $poItem->fresh()->qty_ordered);
        $this->assertSame('150000.00', $poItem->fresh()->unit_price);

        // Verifikasi SoftDeletes pada tabel transaksi
        $poItem->delete();
        $po->delete();
        $pr->delete();

        $this->assertSoftDeleted('purchase_order_items', ['id' => $poItem->id]);
        $this->assertSoftDeleted('purchase_orders', ['id' => $po->id]);
        $this->assertSoftDeleted('purchase_requisitions', ['id' => $pr->id]);
    }

    public function test_foreign_key_constraints_are_enforced(): void
    {
        $this->expectException(QueryException::class);

        PurchaseOrder::create([
            'po_number' => 'PO-INVALID-FK',
            'supplier_id' => 999999,
            'total_amount' => '1000.00',
            'status' => PurchaseOrder::STATUS_PENDING_APPROVAL,
        ]);
    }
}
