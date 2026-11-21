<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\DeliveryOrder;
use App\Models\DeliveryOrderItem;
use App\Models\GeneralLedger;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\SalesInvoice;
use App\Models\SalesOrder;
use App\Models\SalesOrderItem;
use App\Models\StockMovement;
use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrderToCashRelationsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RoleAndPermissionSeeder::class);
    }

    public function test_o2c_relations_decimal_precision_and_soft_deletes(): void
    {
        $salesUser = User::where('email', 'sales@erp.test')->firstOrFail();
        $gudangUser = User::where('email', 'gudang@erp.test')->firstOrFail();

        $customer = Customer::create([
            'name' => 'PT Retail Nusantara',
            'email' => 'buyer@retailnusantara.test',
            'credit_limit' => '500000000000.00',
            'status' => 'active',
        ]);

        $product = Product::create([
            'sku' => 'SKU-O2C-001',
            'name' => 'Kopi Arabika 1kg',
            'uom' => 'PACK',
            'is_active' => true,
        ]);

        $batch = ProductBatch::create([
            'product_id' => $product->id,
            'batch_number' => 'B-KOPI-202611',
            'expiry_date' => '2027-11-30',
        ]);

        $salesOrder = SalesOrder::create([
            'so_number' => 'SO-202611-0001',
            'customer_id' => $customer->id,
            'salesperson_id' => $salesUser->id,
            'order_date' => '2026-11-21',
            'total_amount' => '123456789012.75',
            'status' => SalesOrder::STATUS_CONFIRMED,
        ]);

        $salesOrderItem = SalesOrderItem::create([
            'sales_order_id' => $salesOrder->id,
            'product_id' => $product->id,
            'qty_ordered' => '250.50',
            'unit_price' => '125000.25',
            'line_total' => '31312562.63',
        ]);

        $deliveryOrder = DeliveryOrder::create([
            'do_number' => 'DO-202611-0001',
            'sales_order_id' => $salesOrder->id,
            'delivery_date' => '2026-11-22',
            'status' => DeliveryOrder::STATUS_DISPATCHED,
        ]);

        $deliveryOrderItem = DeliveryOrderItem::create([
            'delivery_order_id' => $deliveryOrder->id,
            'product_id' => $product->id,
            'product_batch_id' => $batch->id,
            'qty_dispatched' => '250.50',
            'unit_cost' => '98750.45',
        ]);

        $stockMovement = StockMovement::create([
            'product_batch_id' => $batch->id,
            'type' => StockMovement::TYPE_OUT,
            'qty_change' => '-250.50',
            'reference_type' => DeliveryOrder::class,
            'reference_id' => $deliveryOrder->id,
            'user_id' => $gudangUser->id,
        ]);

        $salesInvoice = SalesInvoice::create([
            'invoice_number' => 'INV-AR-202611-0001',
            'sales_order_id' => $salesOrder->id,
            'customer_id' => $customer->id,
            'total_billed' => '123456789012.75',
            'due_date' => '2026-12-21',
            'status' => SalesInvoice::STATUS_PARTIALLY_PAID,
            'idempotency_key' => 'idem-ar-inv-0001',
        ]);

        $customerPayment = CustomerPayment::create([
            'receipt_number' => 'RCP-202611-0001',
            'sales_invoice_id' => $salesInvoice->id,
            'amount_received' => '60000000000.50',
            'payment_date' => '2026-11-23',
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'idem-ar-pay-0001',
        ]);

        $journal = GeneralLedger::create([
            'transaction_date' => '2026-11-23',
            'account_code' => '1102-BANK',
            'debit' => '60000000000.50',
            'credit' => '0.00',
            'reference_type' => CustomerPayment::class,
            'reference_id' => $customerPayment->id,
            'description' => 'Penerimaan pembayaran piutang customer',
        ]);

        // Verifikasi relasi SalesOrder & SalesOrderItem
        $this->assertTrue($salesOrder->customer->is($customer));
        $this->assertTrue($salesOrder->salesperson->is($salesUser));
        $this->assertTrue($customer->salesOrders->contains($salesOrder));
        $this->assertTrue($salesUser->salesOrders->contains($salesOrder));
        $this->assertCount(1, $salesOrder->items);
        $this->assertTrue($salesOrderItem->salesOrder->is($salesOrder));
        $this->assertTrue($salesOrderItem->product->is($product));
        $this->assertTrue($product->salesOrderItems->contains($salesOrderItem));

        // Verifikasi relasi DeliveryOrder & DeliveryOrderItem
        $this->assertTrue($deliveryOrder->salesOrder->is($salesOrder));
        $this->assertTrue($salesOrder->deliveryOrders->contains($deliveryOrder));
        $this->assertCount(1, $deliveryOrder->items);
        $this->assertTrue($deliveryOrderItem->deliveryOrder->is($deliveryOrder));
        $this->assertTrue($deliveryOrderItem->product->is($product));
        $this->assertTrue($deliveryOrderItem->productBatch->is($batch));
        $this->assertTrue($product->deliveryOrderItems->contains($deliveryOrderItem));
        $this->assertTrue($batch->deliveryOrderItems->contains($deliveryOrderItem));
        $this->assertTrue($deliveryOrder->stockMovements->contains($stockMovement));

        // Verifikasi relasi SalesInvoice & CustomerPayment
        $this->assertTrue($salesInvoice->salesOrder->is($salesOrder));
        $this->assertTrue($salesInvoice->customer->is($customer));
        $this->assertTrue($salesOrder->salesInvoices->contains($salesInvoice));
        $this->assertTrue($customer->salesInvoices->contains($salesInvoice));
        $this->assertCount(1, $salesInvoice->customerPayments);
        $this->assertTrue($customerPayment->salesInvoice->is($salesInvoice));
        $this->assertTrue($customerPayment->generalLedgers->contains($journal));

        // Verifikasi presisi DECIMAL(15,2) dan date casts
        $freshSo = $salesOrder->fresh();
        $freshSoItem = $salesOrderItem->fresh();
        $freshDo = $deliveryOrder->fresh();
        $freshDoItem = $deliveryOrderItem->fresh();
        $freshInv = $salesInvoice->fresh();
        $freshPay = $customerPayment->fresh();

        $this->assertSame('123456789012.75', $freshSo->total_amount);
        $this->assertSame('2026-11-21', $freshSo->order_date->format('Y-m-d'));
        $this->assertSame('250.50', $freshSoItem->qty_ordered);
        $this->assertSame('125000.25', $freshSoItem->unit_price);
        $this->assertSame('31312562.63', $freshSoItem->line_total);
        $this->assertSame('2026-11-22', $freshDo->delivery_date->format('Y-m-d'));
        $this->assertSame('250.50', $freshDoItem->qty_dispatched);
        $this->assertSame('98750.45', $freshDoItem->unit_cost);
        $this->assertSame('123456789012.75', $freshInv->total_billed);
        $this->assertSame('2026-12-21', $freshInv->due_date->format('Y-m-d'));
        $this->assertSame('60000000000.50', $freshPay->amount_received);
        $this->assertSame('2026-11-23', $freshPay->payment_date->format('Y-m-d'));

        // Verifikasi SoftDeletes pada 6 tabel O2C
        $customerPayment->delete();
        $salesInvoice->delete();
        $deliveryOrderItem->delete();
        $deliveryOrder->delete();
        $salesOrderItem->delete();
        $salesOrder->delete();

        $this->assertSoftDeleted('customer_payments', ['id' => $customerPayment->id]);
        $this->assertSoftDeleted('sales_invoices', ['id' => $salesInvoice->id]);
        $this->assertSoftDeleted('delivery_order_items', ['id' => $deliveryOrderItem->id]);
        $this->assertSoftDeleted('delivery_orders', ['id' => $deliveryOrder->id]);
        $this->assertSoftDeleted('sales_order_items', ['id' => $salesOrderItem->id]);
        $this->assertSoftDeleted('sales_orders', ['id' => $salesOrder->id]);
    }

    public function test_sales_invoice_idempotency_key_must_be_unique(): void
    {
        $salesUser = User::where('email', 'sales@erp.test')->firstOrFail();

        $customer = Customer::create([
            'name' => 'PT Customer Idempotent AR',
            'credit_limit' => '10000000.00',
            'status' => 'active',
        ]);

        $salesOrder = SalesOrder::create([
            'so_number' => 'SO-IDEM-0001',
            'customer_id' => $customer->id,
            'salesperson_id' => $salesUser->id,
            'order_date' => '2026-11-21',
            'total_amount' => '5000000.00',
            'status' => SalesOrder::STATUS_CONFIRMED,
        ]);

        SalesInvoice::create([
            'invoice_number' => 'INV-AR-IDEM-0001',
            'sales_order_id' => $salesOrder->id,
            'customer_id' => $customer->id,
            'total_billed' => '5000000.00',
            'due_date' => '2026-12-21',
            'status' => SalesInvoice::STATUS_UNPAID,
            'idempotency_key' => 'unique-ar-invoice-key-001',
        ]);

        $this->expectException(QueryException::class);

        SalesInvoice::create([
            'invoice_number' => 'INV-AR-IDEM-0002',
            'sales_order_id' => $salesOrder->id,
            'customer_id' => $customer->id,
            'total_billed' => '5000000.00',
            'due_date' => '2026-12-21',
            'status' => SalesInvoice::STATUS_UNPAID,
            'idempotency_key' => 'unique-ar-invoice-key-001',
        ]);
    }

    public function test_customer_payment_idempotency_key_must_be_unique(): void
    {
        $salesUser = User::where('email', 'sales@erp.test')->firstOrFail();

        $customer = Customer::create([
            'name' => 'PT Customer Idempotent Pay',
            'credit_limit' => '10000000.00',
            'status' => 'active',
        ]);

        $salesOrder = SalesOrder::create([
            'so_number' => 'SO-IDEM-0002',
            'customer_id' => $customer->id,
            'salesperson_id' => $salesUser->id,
            'order_date' => '2026-11-21',
            'total_amount' => '5000000.00',
            'status' => SalesOrder::STATUS_CONFIRMED,
        ]);

        $salesInvoice = SalesInvoice::create([
            'invoice_number' => 'INV-AR-IDEM-0003',
            'sales_order_id' => $salesOrder->id,
            'customer_id' => $customer->id,
            'total_billed' => '5000000.00',
            'due_date' => '2026-12-21',
            'status' => SalesInvoice::STATUS_UNPAID,
            'idempotency_key' => 'unique-ar-invoice-key-002',
        ]);

        CustomerPayment::create([
            'receipt_number' => 'RCP-IDEM-0001',
            'sales_invoice_id' => $salesInvoice->id,
            'amount_received' => '2500000.00',
            'payment_date' => '2026-11-22',
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'unique-ar-payment-key-001',
        ]);

        $this->expectException(QueryException::class);

        CustomerPayment::create([
            'receipt_number' => 'RCP-IDEM-0002',
            'sales_invoice_id' => $salesInvoice->id,
            'amount_received' => '2500000.00',
            'payment_date' => '2026-11-22',
            'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'unique-ar-payment-key-001',
        ]);
    }
}
