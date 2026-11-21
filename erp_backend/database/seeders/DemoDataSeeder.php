<?php

namespace Database\Seeders;

use App\Models\Customer;
use App\Models\CustomerPayment;
use App\Models\PaymentVoucher;
use App\Models\Product;
use App\Models\PurchaseInvoice;
use App\Models\PurchaseRequisition;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Finance\AccountPayableService;
use App\Services\Finance\AccountReceivableService;
use App\Services\Finance\GeneralLedgerService;
use App\Services\Inventory\GoodsReceiptService;
use App\Services\Procurement\PurchaseOrderService;
use App\Services\Sales\DeliveryOrderService;
use App\Services\Sales\SalesOrderService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use RuntimeException;

class DemoDataSeeder extends Seeder
{
    public function __construct(
        private readonly PurchaseOrderService $purchaseOrderService,
        private readonly GoodsReceiptService $goodsReceiptService,
        private readonly AccountPayableService $accountPayableService,
        private readonly SalesOrderService $salesOrderService,
        private readonly DeliveryOrderService $deliveryOrderService,
        private readonly AccountReceivableService $accountReceivableService,
        private readonly GeneralLedgerService $generalLedgerService,
    ) {}

    public function run(): void
    {
        // Guard agar seeder aman jika dijalankan ulang tanpa migrate:fresh
        if (PurchaseInvoice::withTrashed()->where('idempotency_key', 'demo-seed-p2p-1-invoice')->exists()) {
            $this->command?->warn('DemoDataSeeder sudah pernah dijalankan sebelumnya. Melewati proses seeding ulang.');

            return;
        }

        // Ambil aktor RBAC hasil RoleAndPermissionSeeder sesuai peran domain masing-masing
        $purchasing = $this->resolveUserByEmail('purchasing@erp.test');
        $manajer = $this->resolveUserByEmail('manajer@erp.test');
        $gudang = $this->resolveUserByEmail('gudang@erp.test');
        $finance = $this->resolveUserByEmail('finance@erp.test');
        $sales = $this->resolveUserByEmail('sales@erp.test');

        $today = Carbon::today();
        $ipAddress = '127.0.0.1';

        // =====================================================================
        // 1. MASTER DATA: 5 Produk, 3 Supplier, 3 Customer
        // =====================================================================
        $products = $this->seedProducts();
        $suppliers = $this->seedSuppliers();
        $customers = $this->seedCustomers();

        // =====================================================================
        // 2. ALUR P2P #1 (Total Rp7.900.000 <= Rp10jt -> Approved oleh Purchasing)
        //    PR -> PO Approved -> Goods Receipt Validated (multi-batch FEFO)
        //    -> Purchase Invoice AP (3-Way Matching) -> Payment Voucher (Paid)
        // =====================================================================
        $pr1 = $this->purchaseOrderService->createPurchaseRequisition(
            data: ['status' => PurchaseRequisition::STATUS_DRAFT],
            actor: $purchasing,
            ipAddress: $ipAddress
        );
        $pr1 = $this->purchaseOrderService->submitPurchaseRequisition(
            purchaseRequisition: $pr1,
            actor: $purchasing,
            ipAddress: $ipAddress
        );

        $po1 = $this->purchaseOrderService->convertRequisitionToPurchaseOrder(
            purchaseRequisition: $pr1,
            data: [
                'supplier_id' => $suppliers['kimia']->id,
                'items' => [
                    [
                        'product_id' => $products['paracetamol']->id,
                        'qty_ordered' => '60.00',
                        'unit_price' => '45000.00',
                    ],
                    [
                        'product_id' => $products['vitc']->id,
                        'qty_ordered' => '100.00',
                        'unit_price' => '52000.00',
                    ],
                ],
            ],
            actor: $purchasing,
            ipAddress: $ipAddress
        );

        $po1 = $this->purchaseOrderService->approvePurchaseOrder(
            purchaseOrder: $po1,
            actor: $purchasing,
            notes: 'Approved oleh Purchasing (nilai PO <= Rp10.000.000).',
            ipAddress: $ipAddress
        );

        // GR #1: Setiap produk diterima dalam 2 batch dengan tanggal kadaluarsa berbeda agar FEFO terlihat jelas
        $gr1 = $this->goodsReceiptService->createGoodsReceipt(
            data: [
                'po_id' => $po1->id,
                'received_date' => $today->copy()->subDays(10)->toDateString(),
                'items' => [
                    [
                        'product_id' => $products['paracetamol']->id,
                        'batch_number' => 'BATCH-PCM-26A',
                        'expiry_date' => $today->copy()->addDays(45)->toDateString(),
                        'qty_received' => '25.00',
                    ],
                    [
                        'product_id' => $products['paracetamol']->id,
                        'batch_number' => 'BATCH-PCM-26B',
                        'expiry_date' => $today->copy()->addDays(180)->toDateString(),
                        'qty_received' => '35.00',
                    ],
                    [
                        'product_id' => $products['vitc']->id,
                        'batch_number' => 'BATCH-VITC-26A',
                        'expiry_date' => $today->copy()->addDays(60)->toDateString(),
                        'qty_received' => '40.00',
                    ],
                    [
                        'product_id' => $products['vitc']->id,
                        'batch_number' => 'BATCH-VITC-26B',
                        'expiry_date' => $today->copy()->addDays(240)->toDateString(),
                        'qty_received' => '60.00',
                    ],
                ],
            ],
            actor: $gudang,
            ipAddress: $ipAddress
        );

        // Validasi GR #1 -> InventoryLedger + StockMovement (IN) + MWA + Event GL (Debit 1201-INVENTORY / Credit 2102-GRIR)
        $this->goodsReceiptService->validateGoodsReceipt(
            goodsReceipt: $gr1,
            actor: $gudang,
            ipAddress: $ipAddress
        );

        // Purchase Invoice AP #1 -> 3-Way Matching + GL (Debit 2102-GRIR / Credit 2101-AP)
        $apInvoice1 = $this->accountPayableService->createPurchaseInvoice(
            data: [
                'po_id' => $po1->id,
                'supplier_id' => $suppliers['kimia']->id,
                'invoice_date' => $today->copy()->subDays(9)->toDateString(),
                'due_date' => $today->copy()->addDays(21)->toDateString(),
                'total_billed' => '7900000.00',
                'idempotency_key' => 'demo-seed-p2p-1-invoice',
                'items' => [
                    [
                        'product_id' => $products['paracetamol']->id,
                        'qty_billed' => '60.00',
                        'unit_price' => '45000.00',
                    ],
                    [
                        'product_id' => $products['vitc']->id,
                        'qty_billed' => '100.00',
                        'unit_price' => '52000.00',
                    ],
                ],
            ],
            actor: $finance,
            ipAddress: $ipAddress
        );

        // Payment Voucher #1 (Pelunasan penuh -> Status Invoice: Paid) + GL (Debit 2101-AP / Credit 1101-CASH-BANK)
        $this->accountPayableService->recordPayment(
            data: [
                'purchase_invoice_id' => $apInvoice1->id,
                'amount_paid' => '7900000.00',
                'payment_date' => $today->copy()->subDays(7)->toDateString(),
                'payment_method' => PaymentVoucher::METHOD_BANK_TRANSFER,
                'idempotency_key' => 'demo-seed-p2p-1-payment',
            ],
            actor: $finance,
            ipAddress: $ipAddress
        );

        // =====================================================================
        // 3. ALUR P2P #2 (Total Rp19.100.000 > Rp10jt -> Approved oleh Manajer)
        //    PR -> PO Approved -> Goods Receipt Validated (multi-batch FEFO & MWA baru)
        //    -> Purchase Invoice AP (3-Way Matching) -> Payment Voucher (Partially Paid)
        // =====================================================================
        $pr2 = $this->purchaseOrderService->createPurchaseRequisition(
            data: ['status' => PurchaseRequisition::STATUS_DRAFT],
            actor: $purchasing,
            ipAddress: $ipAddress
        );
        $pr2 = $this->purchaseOrderService->submitPurchaseRequisition(
            purchaseRequisition: $pr2,
            actor: $purchasing,
            ipAddress: $ipAddress
        );

        $po2 = $this->purchaseOrderService->convertRequisitionToPurchaseOrder(
            purchaseRequisition: $pr2,
            data: [
                'supplier_id' => $suppliers['medika']->id,
                'items' => [
                    // Paracetamol dibeli lagi dengan harga Rp50.000 -> MWA tepat menjadi Rp47.000,00
                    // ((60 * 45.000) + (40 * 50.000)) / 100 = 4.700.000 / 100 = 47.000,00
                    [
                        'product_id' => $products['paracetamol']->id,
                        'qty_ordered' => '40.00',
                        'unit_price' => '50000.00',
                    ],
                    [
                        'product_id' => $products['masker']->id,
                        'qty_ordered' => '200.00',
                        'unit_price' => '32000.00',
                    ],
                    [
                        'product_id' => $products['sanitizer']->id,
                        'qty_ordered' => '120.00',
                        'unit_price' => '35000.00',
                    ],
                    [
                        'product_id' => $products['susu']->id,
                        'qty_ordered' => '50.00',
                        'unit_price' => '130000.00',
                    ],
                ],
            ],
            actor: $purchasing,
            ipAddress: $ipAddress
        );

        $po2 = $this->purchaseOrderService->approvePurchaseOrder(
            purchaseOrder: $po2,
            actor: $manajer,
            notes: 'Approved oleh Manajer sesuai Tiered Approval Matrix (> Rp10.000.000).',
            ipAddress: $ipAddress
        );

        // GR #2: Multi-batch dengan variasi tanggal kadaluarsa berbeda untuk seluruh produk
        $gr2 = $this->goodsReceiptService->createGoodsReceipt(
            data: [
                'po_id' => $po2->id,
                'received_date' => $today->copy()->subDays(6)->toDateString(),
                'items' => [
                    [
                        'product_id' => $products['paracetamol']->id,
                        'batch_number' => 'BATCH-PCM-26C',
                        'expiry_date' => $today->copy()->addDays(365)->toDateString(),
                        'qty_received' => '40.00',
                    ],
                    [
                        'product_id' => $products['masker']->id,
                        'batch_number' => 'BATCH-MSK-26A',
                        'expiry_date' => $today->copy()->addDays(90)->toDateString(),
                        'qty_received' => '80.00',
                    ],
                    [
                        'product_id' => $products['masker']->id,
                        'batch_number' => 'BATCH-MSK-26B',
                        'expiry_date' => $today->copy()->addDays(300)->toDateString(),
                        'qty_received' => '120.00',
                    ],
                    [
                        'product_id' => $products['sanitizer']->id,
                        'batch_number' => 'BATCH-HSG-26A',
                        'expiry_date' => $today->copy()->addDays(75)->toDateString(),
                        'qty_received' => '50.00',
                    ],
                    [
                        'product_id' => $products['sanitizer']->id,
                        'batch_number' => 'BATCH-HSG-26B',
                        'expiry_date' => $today->copy()->addDays(270)->toDateString(),
                        'qty_received' => '70.00',
                    ],
                    [
                        'product_id' => $products['susu']->id,
                        'batch_number' => 'BATCH-SUSU-26A',
                        'expiry_date' => $today->copy()->addDays(50)->toDateString(),
                        'qty_received' => '20.00',
                    ],
                    [
                        'product_id' => $products['susu']->id,
                        'batch_number' => 'BATCH-SUSU-26B',
                        'expiry_date' => $today->copy()->addDays(210)->toDateString(),
                        'qty_received' => '30.00',
                    ],
                ],
            ],
            actor: $gudang,
            ipAddress: $ipAddress
        );

        $this->goodsReceiptService->validateGoodsReceipt(
            goodsReceipt: $gr2,
            actor: $gudang,
            ipAddress: $ipAddress
        );

        // Purchase Invoice AP #2 -> Total Rp19.100.000
        $apInvoice2 = $this->accountPayableService->createPurchaseInvoice(
            data: [
                'po_id' => $po2->id,
                'supplier_id' => $suppliers['medika']->id,
                'invoice_date' => $today->copy()->subDays(5)->toDateString(),
                'due_date' => $today->copy()->addDays(25)->toDateString(),
                'total_billed' => '19100000.00',
                'idempotency_key' => 'demo-seed-p2p-2-invoice',
                'items' => [
                    [
                        'product_id' => $products['paracetamol']->id,
                        'qty_billed' => '40.00',
                        'unit_price' => '50000.00',
                    ],
                    [
                        'product_id' => $products['masker']->id,
                        'qty_billed' => '200.00',
                        'unit_price' => '32000.00',
                    ],
                    [
                        'product_id' => $products['sanitizer']->id,
                        'qty_billed' => '120.00',
                        'unit_price' => '35000.00',
                    ],
                    [
                        'product_id' => $products['susu']->id,
                        'qty_billed' => '50.00',
                        'unit_price' => '130000.00',
                    ],
                ],
            ],
            actor: $finance,
            ipAddress: $ipAddress
        );

        // Payment Voucher #2 (Pembayaran parsial Rp10.000.000 -> Status: Partially Paid, sisa Rp9.100.000 terlihat di AP Aging)
        $this->accountPayableService->recordPayment(
            data: [
                'purchase_invoice_id' => $apInvoice2->id,
                'amount_paid' => '10000000.00',
                'payment_date' => $today->copy()->subDays(4)->toDateString(),
                'payment_method' => PaymentVoucher::METHOD_BANK_TRANSFER,
                'idempotency_key' => 'demo-seed-p2p-2-payment',
            ],
            actor: $finance,
            ipAddress: $ipAddress
        );

        // =====================================================================
        // 4. ALUR O2C #1 (Total Penjualan Rp14.100.000 | HPP COGS Rp9.865.000)
        //    Sales Order Confirmed -> Delivery Order Dispatched (FEFO lintas batch)
        //    -> Sales Invoice AR -> Customer Payment (Partially Paid, sisa terlihat di AR Aging)
        // =====================================================================
        $so1 = $this->salesOrderService->createSalesOrder(
            data: [
                'customer_id' => $customers['rs_harapan']->id,
                'order_date' => $today->copy()->subDays(3)->toDateString(),
                'items' => [
                    // 45 BOX -> FEFO akan menghabiskan BATCH-PCM-26A (25) lalu mengambil 20 dari BATCH-PCM-26B (sisa 15 + 40 di 26C)
                    [
                        'product_id' => $products['paracetamol']->id,
                        'qty_ordered' => '45.00',
                        'unit_price' => '65000.00',
                    ],
                    // 50 TUBE -> FEFO akan menghabiskan BATCH-VITC-26A (40) lalu mengambil 10 dari BATCH-VITC-26B
                    [
                        'product_id' => $products['vitc']->id,
                        'qty_ordered' => '50.00',
                        'unit_price' => '75000.00',
                    ],
                    // 100 BOX -> FEFO akan menghabiskan BATCH-MSK-26A (80) lalu mengambil 20 dari BATCH-MSK-26B
                    [
                        'product_id' => $products['masker']->id,
                        'qty_ordered' => '100.00',
                        'unit_price' => '48000.00',
                    ],
                    // 15 KALENG -> FEFO mengambil 15 dari BATCH-SUSU-26A (sisa 5 di 26A & 30 di 26B)
                    [
                        'product_id' => $products['susu']->id,
                        'qty_ordered' => '15.00',
                        'unit_price' => '175000.00',
                    ],
                ],
            ],
            actor: $sales,
            ipAddress: $ipAddress
        );

        $so1 = $this->salesOrderService->confirmSalesOrder(
            salesOrder: $so1,
            actor: $sales,
            ipAddress: $ipAddress
        );

        $do1 = $this->deliveryOrderService->createDeliveryOrder(
            data: [
                'sales_order_id' => $so1->id,
                'delivery_date' => $today->copy()->subDays(2)->toDateString(),
                'items' => [
                    [
                        'product_id' => $products['paracetamol']->id,
                        'qty_dispatched' => '45.00',
                    ],
                    [
                        'product_id' => $products['vitc']->id,
                        'qty_dispatched' => '50.00',
                    ],
                    [
                        'product_id' => $products['masker']->id,
                        'qty_dispatched' => '100.00',
                    ],
                    [
                        'product_id' => $products['susu']->id,
                        'qty_dispatched' => '15.00',
                    ],
                ],
            ],
            actor: $gudang,
            ipAddress: $ipAddress
        );

        // Dispatch DO #1 -> FEFO stock deduction + StockMovement (OUT) + Event GL COGS (Debit 5101-COGS / Credit 1201-INVENTORY)
        $do1 = $this->deliveryOrderService->dispatchDeliveryOrder(
            deliveryOrder: $do1,
            actor: $gudang,
            ipAddress: $ipAddress
        );

        // Sales Invoice AR #1 -> Total Rp14.100.000 + GL (Debit 1102-AR / Credit 4101-SALES-REVENUE)
        $arInvoice1 = $this->accountReceivableService->createSalesInvoice(
            data: [
                'sales_order_id' => $so1->id,
                'delivery_order_id' => $do1->id,
                'invoice_date' => $today->copy()->subDays(2)->toDateString(),
                'due_date' => $today->copy()->addDays(28)->toDateString(),
                'idempotency_key' => 'demo-seed-o2c-1-invoice',
            ],
            actor: $finance,
            ipAddress: $ipAddress
        );

        // Customer Payment #1 (Pembayaran parsial Rp10.000.000 -> Status: Partially Paid, sisa Rp4.100.000 terlihat di AR Aging)
        $this->accountReceivableService->recordCustomerPayment(
            data: [
                'sales_invoice_id' => $arInvoice1->id,
                'amount_received' => '10000000.00',
                'payment_date' => $today->copy()->subDay()->toDateString(),
                'payment_method' => CustomerPayment::METHOD_BANK_TRANSFER,
                'idempotency_key' => 'demo-seed-o2c-1-payment',
            ],
            actor: $finance,
            ipAddress: $ipAddress
        );

        // Verifikasi akhir keseimbangan General Ledger via GeneralLedgerService
        $trialBalance = $this->generalLedgerService->getTrialBalance();

        if (! $trialBalance['is_balanced']) {
            throw new RuntimeException(
                "General Ledger tidak seimbang setelah DemoDataSeeder! Debit: {$trialBalance['grand_total_debit']}, Credit: {$trialBalance['grand_total_credit']}"
            );
        }

        $this->command?->info(
            "DemoDataSeeder selesai! Trial Balance SEIMBANG (Debit = Credit = Rp{$trialBalance['grand_total_debit']})."
        );
    }

    /**
     * @return array<string, Product>
     */
    private function seedProducts(): array
    {
        $catalog = [
            'paracetamol' => [
                'sku' => 'SKU-FAR-001',
                'name' => 'Paracetamol 500mg Strip (Box 100)',
                'category_id' => 1,
                'uom' => 'BOX',
                'is_active' => true,
            ],
            'vitc' => [
                'sku' => 'SKU-FAR-002',
                'name' => 'Vitamin C 1000mg Effervescent (Tube)',
                'category_id' => 1,
                'uom' => 'TUBE',
                'is_active' => true,
            ],
            'masker' => [
                'sku' => 'SKU-ALK-001',
                'name' => 'Masker Medis 3-Ply Earloop (Box 50)',
                'category_id' => 2,
                'uom' => 'BOX',
                'is_active' => true,
            ],
            'sanitizer' => [
                'sku' => 'SKU-ALK-002',
                'name' => 'Hand Sanitizer Gel 500ml Pump',
                'category_id' => 2,
                'uom' => 'BOTOL',
                'is_active' => true,
            ],
            'susu' => [
                'sku' => 'SKU-NUT-001',
                'name' => 'Susu Nutrisi Dewasa 800g Kaleng',
                'category_id' => 3,
                'uom' => 'KALENG',
                'is_active' => true,
            ],
        ];

        $seeded = [];
        foreach ($catalog as $key => $attributes) {
            $seeded[$key] = Product::updateOrCreate(
                ['sku' => $attributes['sku']],
                $attributes
            );
        }

        return $seeded;
    }

    /**
     * @return array<string, Supplier>
     */
    private function seedSuppliers(): array
    {
        $catalog = [
            'kimia' => [
                'name' => 'PT Kimia Nusantara Farma',
                'contact_name' => 'Budi Santoso',
                'email' => 'sales@kimianusantara.co.id',
                'phone' => '+62-21-5501-8801',
                'address' => 'Kawasan Industri Pulogadung Blok J-12, Jakarta Timur',
                'status' => 'active',
            ],
            'medika' => [
                'name' => 'PT Medika Sehat Sentosa',
                'contact_name' => 'Rina Kusuma',
                'email' => 'order@medikasehat.co.id',
                'phone' => '+62-21-5502-4410',
                'address' => 'Jl. Jababeka Raya Kav. 45, Cikarang, Bekasi',
                'status' => 'active',
            ],
            'nutrisi' => [
                'name' => 'CV Nutrisi Prima Sejahtera',
                'contact_name' => 'Hendra Wijaya',
                'email' => 'distribusi@nutrisiprima.co.id',
                'phone' => '+62-31-8432-9900',
                'address' => 'Jl. Rungkut Industri III No. 28, Surabaya',
                'status' => 'active',
            ],
        ];

        $seeded = [];
        foreach ($catalog as $key => $attributes) {
            $seeded[$key] = Supplier::updateOrCreate(
                ['email' => $attributes['email']],
                $attributes
            );
        }

        return $seeded;
    }

    /**
     * @return array<string, Customer>
     */
    private function seedCustomers(): array
    {
        $catalog = [
            'rs_harapan' => [
                'name' => 'RS Harapan Bunda Jakarta',
                'email' => 'procurement@rsharapanbunda.co.id',
                'credit_limit' => '75000000.00',
                'status' => 'active',
            ],
            'apotek_mandiri' => [
                'name' => 'Apotek Sehat Mandiri Group',
                'email' => 'purchasing@apoteksehatmandiri.co.id',
                'credit_limit' => '40000000.00',
                'status' => 'active',
            ],
            'klinik_medika' => [
                'name' => 'Klinik Pratama Medika Jaya',
                'email' => 'admin@klinikmedikajaya.co.id',
                'credit_limit' => '15000000.00',
                'status' => 'active',
            ],
        ];

        $seeded = [];
        foreach ($catalog as $key => $attributes) {
            $seeded[$key] = Customer::updateOrCreate(
                ['email' => $attributes['email']],
                $attributes
            );
        }

        return $seeded;
    }

    private function resolveUserByEmail(string $email): User
    {
        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            throw new RuntimeException(
                "User '{$email}' tidak ditemukan. Pastikan RoleAndPermissionSeeder telah dijalankan sebelum DemoDataSeeder."
            );
        }

        return $user;
    }
}
