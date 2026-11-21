<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\GeneralLedger;
use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptItem;
use App\Models\InventoryLedger;
use App\Models\PaymentVoucher;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\PurchaseInvoice;
use App\Models\PurchaseOrder;
use App\Models\StockMovement;
use App\Models\Supplier;
use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InventoryAndFinanceRelationsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RoleAndPermissionSeeder::class);
    }

    public function test_inventory_finance_and_audit_relations_and_casts(): void
    {
        $gudangUser = User::where('email', 'gudang@erp.test')->firstOrFail();
        $financeUser = User::where('email', 'finance@erp.test')->firstOrFail();

        $supplier = Supplier::create([
            'name' => 'PT Logistik Pangan',
            'email' => 'ap@logistikpangan.test',
            'status' => 'active',
        ]);

        $product = Product::create([
            'sku' => 'SKU-INV-001',
            'name' => 'Gula Pasir 1kg',
            'uom' => 'PACK',
            'is_active' => true,
        ]);

        $batch = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'B-GULA-202611',
            'expiry_date' => '2027-11-30',
        ]);

        $po = PurchaseOrder::create([
            'po_number' => 'PO-INV-0001',
            'supplier_id' => $supplier->id,
            'total_amount' => '12000000.00',
            'status' => PurchaseOrder::STATUS_APPROVED,
        ]);

        $gr = GoodsReceipt::create([
            'po_id' => $po->id,
            'receipt_number' => 'GR-202611-0001',
            'received_date' => '2026-11-20',
            'status' => GoodsReceipt::STATUS_VALIDATED,
        ]);

        $grItem = GoodsReceiptItem::create([
            'goods_receipt_id' => $gr->id,
            'product_id' => $product->id,
            'product_batch_id' => $batch->id,
            'qty_received' => '1000.00',
        ]);

        $ledger = InventoryLedger::create([
            'product_batch_id' => $batch->id,
            'state' => InventoryLedger::STATE_AVAILABLE,
            'qty' => '1000.00',
            'cost_price' => '12000.00',
        ]);

        $movement = StockMovement::create([
            'product_batch_id' => $batch->id,
            'type' => StockMovement::TYPE_IN,
            'qty_change' => '1000.00',
            'reference_type' => GoodsReceipt::class,
            'reference_id' => $gr->id,
            'user_id' => $gudangUser->id,
        ]);

        $invoice = PurchaseInvoice::create([
            'invoice_number' => 'INV-AP-202611-0001',
            'po_id' => $po->id,
            'supplier_id' => $supplier->id,
            'total_billed' => '12000000.00',
            'due_date' => '2026-12-20',
            'status' => PurchaseInvoice::STATUS_PAID,
            'idempotency_key' => 'idem-ap-0001',
        ]);

        $voucher = PaymentVoucher::create([
            'voucher_number' => 'PV-202611-0001',
            'purchase_invoice_id' => $invoice->id,
            'amount_paid' => '12000000.00',
            'payment_date' => '2026-11-21',
            'payment_method' => 'bank_transfer',
        ]);

        $journalDebit = GeneralLedger::create([
            'transaction_date' => '2026-11-21',
            'account_code' => '2101-AP',
            'debit' => '12000000.00',
            'credit' => '0.00',
            'reference_type' => PaymentVoucher::class,
            'reference_id' => $voucher->id,
            'description' => 'Pelunasan invoice supplier',
        ]);

        $auditLog = AuditLog::create([
            'user_id' => $financeUser->id,
            'action' => 'payment_created',
            'model_type' => PaymentVoucher::class,
            'model_id' => $voucher->id,
            'old_payload' => ['status' => 'Unpaid'],
            'new_payload' => ['status' => 'Paid', 'amount_paid' => '12000000.00'],
            'ip_address' => '127.0.0.1',
        ]);

        // Verifikasi relasi Inventory
        $this->assertTrue($gr->purchaseOrder->is($po));
        $this->assertTrue($po->goodsReceipts->contains($gr));
        $this->assertCount(1, $gr->items);
        $this->assertTrue($grItem->goodsReceipt->is($gr));
        $this->assertTrue($grItem->product->is($product));
        $this->assertTrue($grItem->productBatch->is($batch));
        $this->assertTrue($product->goodsReceiptItems->contains($grItem));
        $this->assertTrue($batch->goodsReceiptItems->contains($grItem));

        $this->assertTrue($ledger->productBatch->is($batch));
        $this->assertTrue($batch->inventoryLedgers->contains($ledger));
        $this->assertSame('12000.00', $ledger->fresh()->cost_price);

        $this->assertTrue($movement->productBatch->is($batch));
        $this->assertTrue($movement->user->is($gudangUser));
        $this->assertTrue($movement->reference->is($gr));
        $this->assertTrue($gr->stockMovements->contains($movement));
        $this->assertTrue($gudangUser->stockMovements->contains($movement));

        // Verifikasi relasi Finance & Polymorphic GeneralLedger
        $this->assertTrue($invoice->purchaseOrder->is($po));
        $this->assertTrue($invoice->supplier->is($supplier));
        $this->assertTrue($po->purchaseInvoices->contains($invoice));
        $this->assertTrue($supplier->purchaseInvoices->contains($invoice));
        $this->assertSame('12000000.00', $invoice->fresh()->total_billed);

        $this->assertTrue($voucher->purchaseInvoice->is($invoice));
        $this->assertTrue($invoice->paymentVouchers->contains($voucher));
        $this->assertSame('12000000.00', $voucher->fresh()->amount_paid);

        $this->assertTrue($journalDebit->reference->is($voucher));
        $this->assertTrue($voucher->generalLedgers->contains($journalDebit));
        $this->assertSame('12000000.00', $journalDebit->fresh()->debit);
        $this->assertSame('0.00', $journalDebit->fresh()->credit);

        // Verifikasi AuditLog & JSON payload casts
        $this->assertTrue($auditLog->user->is($financeUser));
        $this->assertTrue($auditLog->auditable->is($voucher));
        $this->assertTrue($financeUser->auditLogs->contains($auditLog));
        $this->assertSame(['status' => 'Unpaid'], $auditLog->fresh()->old_payload);
        $this->assertSame('Paid', $auditLog->fresh()->new_payload['status']);

        // Verifikasi SoftDeletes pada tabel transaksi
        $voucher->delete();
        $invoice->delete();
        $grItem->delete();
        $gr->delete();

        $this->assertSoftDeleted('payment_vouchers', ['id' => $voucher->id]);
        $this->assertSoftDeleted('purchase_invoices', ['id' => $invoice->id]);
        $this->assertSoftDeleted('goods_receipt_items', ['id' => $grItem->id]);
        $this->assertSoftDeleted('goods_receipts', ['id' => $gr->id]);
    }

    public function test_purchase_invoice_idempotency_key_must_be_unique(): void
    {
        $supplier = Supplier::create([
            'name' => 'PT Supplier Idempotent',
            'status' => 'active',
        ]);

        $po = PurchaseOrder::create([
            'po_number' => 'PO-IDEM-0001',
            'supplier_id' => $supplier->id,
            'total_amount' => '5000000.00',
            'status' => PurchaseOrder::STATUS_APPROVED,
        ]);

        PurchaseInvoice::create([
            'invoice_number' => 'INV-IDEM-0001',
            'po_id' => $po->id,
            'supplier_id' => $supplier->id,
            'total_billed' => '5000000.00',
            'due_date' => '2026-12-15',
            'status' => PurchaseInvoice::STATUS_UNPAID,
            'idempotency_key' => 'unique-idem-key-123',
        ]);

        $this->expectException(QueryException::class);

        PurchaseInvoice::create([
            'invoice_number' => 'INV-IDEM-0002',
            'po_id' => $po->id,
            'supplier_id' => $supplier->id,
            'total_billed' => '5000000.00',
            'due_date' => '2026-12-15',
            'status' => PurchaseInvoice::STATUS_UNPAID,
            'idempotency_key' => 'unique-idem-key-123',
        ]);
    }
}
