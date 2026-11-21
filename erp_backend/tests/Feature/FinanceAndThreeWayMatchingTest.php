<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\GeneralLedger;
use App\Models\GoodsReceipt;
use App\Models\PaymentVoucher;
use App\Models\Product;
use App\Models\PurchaseInvoice;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FinanceAndThreeWayMatchingTest extends TestCase
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

    private function createActiveSupplier(string $name = 'PT Distribusi Pangan Sejahtera'): Supplier
    {
        return Supplier::create([
            'name' => $name,
            'contact_name' => 'Hendra Wijaya',
            'email' => 'ap@' . strtolower(preg_replace('/[^A-Za-z0-9]/', '', $name)) . '.test',
            'phone' => '021-5550909',
            'address' => 'Jl. Keuangan Industri No. 12',
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

    /**
     * @param  array<int, array{product_id: int, qty_ordered: string, unit_price: string}>  $items
     */
    private function createApprovedPo(Supplier $supplier, array $items, ?string $poNumber = null): PurchaseOrder
    {
        $total = '0.0000';
        foreach ($items as $item) {
            $total = bcadd($total, bcmul($item['qty_ordered'], $item['unit_price'], 4), 4);
        }

        $po = PurchaseOrder::create([
            'po_number' => $poNumber ?? ('PO-FIN-' . uniqid()),
            'supplier_id' => $supplier->id,
            'total_amount' => bcadd($total, '0', 2),
            'status' => PurchaseOrder::STATUS_APPROVED,
            'approver_id' => $this->userByEmail('manajer@erp.test')->id,
        ]);

        $po->items()->createMany($items);

        return $po->fresh(['items']);
    }

    /**
     * Membuat & memvalidasi Goods Receipt lewat endpoint API sebagai Staf Gudang
     * sehingga seluruh alur inventory + event GoodsReceiptValidated berjalan end-to-end.
     *
     * @param  array<int, array{product_id: int, batch_number: string, expiry_date: string, qty_received: string}>  $items
     */
    private function createAndValidateGoodsReceipt(PurchaseOrder $po, array $items, ?string $receivedDate = null): int
    {
        $gudang = $this->userByEmail('gudang@erp.test');
        Sanctum::actingAs($gudang);

        $date = $receivedDate ?? Carbon::today()->toDateString();

        $grId = $this->postJson('/api/goods-receipts', [
            'po_id' => $po->id,
            'received_date' => $date,
            'items' => $items,
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/goods-receipts/{$grId}/validate")->assertOk();

        return (int) $grId;
    }

    public function test_unauthenticated_requests_to_finance_endpoints_return_401(): void
    {
        $this->getJson('/api/purchase-invoices')->assertUnauthorized();
        $this->postJson('/api/purchase-invoices', [])->assertUnauthorized();
        $this->getJson('/api/purchase-invoices/ap-aging')->assertUnauthorized();
        $this->getJson('/api/payment-vouchers')->assertUnauthorized();
        $this->postJson('/api/payment-vouchers', [])->assertUnauthorized();
        $this->getJson('/api/general-ledgers')->assertUnauthorized();
        $this->postJson('/api/general-ledgers', [])->assertUnauthorized();
        $this->getJson('/api/general-ledgers/summary')->assertUnauthorized();
    }

    public function test_event_listener_automatically_posts_balanced_bcmath_journal_when_gr_validated(): void
    {
        $supplier = $this->createActiveSupplier();
        $productA = $this->createActiveProduct('SKU-GL-A', 'Minyak Sawit 2L');
        $productB = $this->createActiveProduct('SKU-GL-B', 'Tepung Beras 1kg');

        // Harga desimal untuk menguji presisi BCMath:
        // 7.50 * 12345.67 = 92592.5250 -> dibulatkan half-up = 92592.53
        // 20.00 * 15000.00 = 300000.00
        // Total GR = 392592.53
        $po = $this->createApprovedPo($supplier, [
            ['product_id' => $productA->id, 'qty_ordered' => '10.00', 'unit_price' => '12345.67'],
            ['product_id' => $productB->id, 'qty_ordered' => '20.00', 'unit_price' => '15000.00'],
        ]);

        $receivedDate = Carbon::today()->toDateString();
        $grId = $this->createAndValidateGoodsReceipt($po, [
            [
                'product_id' => $productA->id,
                'batch_number' => 'GL-BATCH-A1',
                'expiry_date' => Carbon::today()->addDays(120)->toDateString(),
                'qty_received' => '7.50',
            ],
            [
                'product_id' => $productB->id,
                'batch_number' => 'GL-BATCH-B1',
                'expiry_date' => Carbon::today()->addDays(150)->toDateString(),
                'qty_received' => '20.00',
            ],
        ], $receivedDate);

        // Listener GoodsReceiptValidated wajib otomatis mencatat tepat 2 baris jurnal di general_ledgers
        $entries = GeneralLedger::query()
            ->where('reference_type', GoodsReceipt::class)
            ->where('reference_id', $grId)
            ->orderBy('id')
            ->get();

        $this->assertCount(2, $entries);

        // Baris 1: Debit Persediaan (1201-INVENTORY)
        $this->assertSame(GeneralLedger::ACCOUNT_INVENTORY, $entries[0]->account_code);
        $this->assertSame('392592.53', $entries[0]->debit);
        $this->assertSame('0.00', $entries[0]->credit);
        $this->assertSame($receivedDate, $entries[0]->transaction_date->toDateString());

        // Baris 2: Credit Hutang Sementara / GR-IR Clearing (2102-GRIR)
        $this->assertSame(GeneralLedger::ACCOUNT_GRIR_CLEARING, $entries[1]->account_code);
        $this->assertSame('0.00', $entries[1]->debit);
        $this->assertSame('392592.53', $entries[1]->credit);

        // Verifikasi GeneralLedger bersifat immutable (menolak update & delete)
        try {
            $entries[0]->update(['debit' => '1.00']);
            $this->fail('GeneralLedger seharusnya melempar LogicException saat di-update.');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }

        try {
            $entries[0]->delete();
            $this->fail('GeneralLedger seharusnya melempar LogicException saat di-delete.');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('immutable', $e->getMessage());
        }
    }

    public function test_three_way_matching_enforces_po_price_partial_gr_qty_and_invoice_total(): void
    {
        $finance = $this->userByEmail('finance@erp.test');
        $supplier = $this->createActiveSupplier();
        $productA = $this->createActiveProduct('SKU-3WM-A', 'Kopi Arabika 1kg');
        $productB = $this->createActiveProduct('SKU-3WM-B', 'Coklat Bubuk 500g');

        // PO: 100 unit Product A @ 100.000 + 50 unit Product B @ 20.000 (Total PO = 11.000.000)
        $po = $this->createApprovedPo($supplier, [
            ['product_id' => $productA->id, 'qty_ordered' => '100.00', 'unit_price' => '100000.00'],
            ['product_id' => $productB->id, 'qty_ordered' => '50.00', 'unit_price' => '20000.00'],
        ]);

        $today = Carbon::today()->toDateString();
        $dueDate = Carbon::today()->addDays(30)->toDateString();

        // 1. GAGAL (422): PO belum memiliki Goods Receipt yang divalidasi
        Sanctum::actingAs($finance);
        $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'due_date' => $dueDate,
            'total_billed' => '10000000.00',
            'idempotency_key' => 'inv-no-gr-001',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '100.00', 'unit_price' => '100000.00'],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['po_id']);

        // 2. Partial Receipt #1: Gudang hanya menerima & memvalidasi 60 unit Product A (Nilai = 6.000.000)
        $this->createAndValidateGoodsReceipt($po, [
            [
                'product_id' => $productA->id,
                'batch_number' => '3WM-A-B1',
                'expiry_date' => Carbon::today()->addDays(180)->toDateString(),
                'qty_received' => '60.00',
            ],
        ], $today);

        Sanctum::actingAs($finance);

        // 2a. GAGAL (422): Selisih harga satuan (Invoice 105.000 vs PO 100.000)
        $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'due_date' => $dueDate,
            'total_billed' => '6300000.00',
            'idempotency_key' => 'inv-price-mismatch',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '60.00', 'unit_price' => '105000.00'],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.unit_price']);

        // 2b. GAGAL (422): Over-billing kuantitas (Invoice menagih 70 unit, padahal fisik diterima baru 60 unit)
        $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'due_date' => $dueDate,
            'total_billed' => '7000000.00',
            'idempotency_key' => 'inv-over-qty',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '70.00', 'unit_price' => '100000.00'],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty_billed']);

        // 2c. GAGAL (422): Selisih total_billed (60 * 100.000 = 6.000.000, tapi total_billed = 6.100.000)
        $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'due_date' => $dueDate,
            'total_billed' => '6100000.00',
            'idempotency_key' => 'inv-total-mismatch',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '60.00', 'unit_price' => '100000.00'],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['total_billed']);

        // 2d. SUKSES (201): Tagihan sesuai Partial Receipt #1 (60 unit Product A @ 100.000 = 6.000.000)
        $inv1Response = $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'invoice_date' => $today,
            'due_date' => $dueDate,
            'total_billed' => '6000000.00',
            'idempotency_key' => 'inv-partial-001',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '60.00', 'unit_price' => '100000.00'],
            ],
        ]);

        $inv1Response->assertCreated()
            ->assertJsonPath('data.status', PurchaseInvoice::STATUS_UNPAID)
            ->assertJsonPath('data.total_billed', '6000000.00')
            ->assertJsonPath('data.total_paid', '0.00')
            ->assertJsonPath('data.remaining_balance', '6000000.00')
            ->assertJsonCount(1, 'data.items');

        $inv1Id = $inv1Response->json('data.id');

        // Verifikasi jurnal AP otomatis tercatat: Debit 2102-GRIR / Credit 2101-AP
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => PurchaseInvoice::class,
            'reference_id' => $inv1Id,
            'account_code' => GeneralLedger::ACCOUNT_GRIR_CLEARING,
            'debit' => '6000000.00',
            'credit' => '0.00',
        ]);
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => PurchaseInvoice::class,
            'reference_id' => $inv1Id,
            'account_code' => GeneralLedger::ACCOUNT_AP,
            'debit' => '0.00',
            'credit' => '6000000.00',
        ]);

        // 2e. GAGAL (409 Conflict): Replay request Invoice dengan idempotency_key yang sama
        $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'due_date' => $dueDate,
            'total_billed' => '6000000.00',
            'idempotency_key' => 'inv-partial-001',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '60.00', 'unit_price' => '100000.00'],
            ],
        ])->assertStatus(409)
            ->assertJsonPath('error', 'duplicate_idempotency_key');

        // 2f. GAGAL (422): Over-billing kumulatif — mencoba menagih lagi 1 unit Product A sebelum GR #2 datang
        $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'due_date' => $dueDate,
            'total_billed' => '100000.00',
            'idempotency_key' => 'inv-over-cumulative-001',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '1.00', 'unit_price' => '100000.00'],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty_billed']);

        // 3. Partial Receipt #2: Gudang menerima sisa 40 unit Product A & 50 unit Product B (Nilai = 5.000.000)
        $this->createAndValidateGoodsReceipt($po, [
            [
                'product_id' => $productA->id,
                'batch_number' => '3WM-A-B2',
                'expiry_date' => Carbon::today()->addDays(210)->toDateString(),
                'qty_received' => '40.00',
            ],
            [
                'product_id' => $productB->id,
                'batch_number' => '3WM-B-B1',
                'expiry_date' => Carbon::today()->addDays(200)->toDateString(),
                'qty_received' => '50.00',
            ],
        ], $today);

        // 3a. SUKSES (201): Tagihan tahap 2 untuk sisa 40 Product A + 50 Product B = 5.000.000
        Sanctum::actingAs($finance);
        $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'invoice_date' => $today,
            'due_date' => $dueDate,
            'total_billed' => '5000000.00',
            'idempotency_key' => 'inv-partial-002',
            'items' => [
                ['product_id' => $productA->id, 'qty_billed' => '40.00', 'unit_price' => '100000.00'],
                ['product_id' => $productB->id, 'qty_billed' => '50.00', 'unit_price' => '20000.00'],
            ],
        ])->assertCreated()
            ->assertJsonPath('data.total_billed', '5000000.00')
            ->assertJsonCount(2, 'data.items');

        $this->assertDatabaseCount('purchase_invoices', 2);
    }

    public function test_payment_allocation_enforces_idempotency_updates_invoice_status_and_posts_gl(): void
    {
        $finance = $this->userByEmail('finance@erp.test');
        $supplier = $this->createActiveSupplier();
        $product = $this->createActiveProduct('SKU-PAY-001', 'Susu Bubuk 1kg');

        $po = $this->createApprovedPo($supplier, [
            ['product_id' => $product->id, 'qty_ordered' => '50.00', 'unit_price' => '100000.00'],
        ]);

        $today = Carbon::today()->toDateString();

        $this->createAndValidateGoodsReceipt($po, [
            [
                'product_id' => $product->id,
                'batch_number' => 'PAY-B1',
                'expiry_date' => Carbon::today()->addDays(180)->toDateString(),
                'qty_received' => '50.00',
            ],
        ], $today);

        Sanctum::actingAs($finance);

        $invoiceId = $this->postJson('/api/purchase-invoices', [
            'po_id' => $po->id,
            'invoice_date' => $today,
            'due_date' => Carbon::today()->addDays(15)->toDateString(),
            'total_billed' => '5000000.00',
            'idempotency_key' => 'inv-pay-flow-001',
            'items' => [
                ['product_id' => $product->id, 'qty_billed' => '50.00', 'unit_price' => '100000.00'],
            ],
        ])->assertCreated()->json('data.id');

        // 1. Pembayaran Tahap 1 (Partial): Rp2.000.000 -> Status berubah Unpaid -> Partially Paid
        $pay1 = $this->postJson('/api/payment-vouchers', [
            'purchase_invoice_id' => $invoiceId,
            'amount_paid' => '2000000.00',
            'payment_date' => $today,
            'payment_method' => PaymentVoucher::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'pay-idem-001',
        ]);

        $pay1->assertCreated()
            ->assertJsonPath('data.amount_paid', '2000000.00')
            ->assertJsonPath('data.idempotency_key', 'pay-idem-001')
            ->assertJsonPath('data.purchase_invoice.status', PurchaseInvoice::STATUS_PARTIALLY_PAID)
            ->assertJsonPath('data.purchase_invoice.total_paid', '2000000.00')
            ->assertJsonPath('data.purchase_invoice.remaining_balance', '3000000.00');

        $voucher1Id = $pay1->json('data.id');

        // Verifikasi jurnal pembayaran: Debit 2101-AP / Credit 1101-CASH-BANK
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => PaymentVoucher::class,
            'reference_id' => $voucher1Id,
            'account_code' => GeneralLedger::ACCOUNT_AP,
            'debit' => '2000000.00',
            'credit' => '0.00',
        ]);
        $this->assertDatabaseHas('general_ledgers', [
            'reference_type' => PaymentVoucher::class,
            'reference_id' => $voucher1Id,
            'account_code' => GeneralLedger::ACCOUNT_CASH_BANK,
            'debit' => '0.00',
            'credit' => '2000000.00',
        ]);

        // 2. ANTI DOUBLE-SPEND: Replay request pembayaran dengan idempotency_key yang sama (via body & via header) -> 409 Conflict
        $glCountBeforeDuplicate = GeneralLedger::count();

        $this->postJson('/api/payment-vouchers', [
            'purchase_invoice_id' => $invoiceId,
            'amount_paid' => '2000000.00',
            'payment_date' => $today,
            'payment_method' => PaymentVoucher::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'pay-idem-001',
        ])->assertStatus(409)
            ->assertJsonPath('error', 'duplicate_idempotency_key')
            ->assertJsonPath('existing_resource_id', $voucher1Id);

        $this->withHeader('Idempotency-Key', 'pay-idem-001')
            ->postJson('/api/payment-vouchers', [
                'purchase_invoice_id' => $invoiceId,
                'amount_paid' => '2000000.00',
                'payment_date' => $today,
                'payment_method' => PaymentVoucher::METHOD_BANK_TRANSFER,
            ])->assertStatus(409)
            ->assertJsonPath('error', 'duplicate_idempotency_key');

        // Pastikan tidak ada voucher baru maupun jurnal baru yang tercipta
        $this->assertDatabaseCount('payment_vouchers', 1);
        $this->assertSame($glCountBeforeDuplicate, GeneralLedger::count());

        // 3. Overpayment (melebihi sisa Rp3.000.000) wajib ditolak 422
        $this->postJson('/api/payment-vouchers', [
            'purchase_invoice_id' => $invoiceId,
            'amount_paid' => '3500000.00',
            'payment_date' => $today,
            'payment_method' => PaymentVoucher::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'pay-idem-over',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['amount_paid']);

        // 4. Pembayaran Tahap 2 (Pelunasan Rp3.000.000 via Idempotency-Key header) -> Partially Paid -> Paid
        $pay2 = $this->withHeader('Idempotency-Key', 'pay-idem-002')
            ->postJson('/api/payment-vouchers', [
                'purchase_invoice_id' => $invoiceId,
                'amount_paid' => '3000000.00',
                'payment_date' => $today,
                'payment_method' => PaymentVoucher::METHOD_VIRTUAL_ACCOUNT,
            ]);

        $pay2->assertCreated()
            ->assertJsonPath('data.purchase_invoice.status', PurchaseInvoice::STATUS_PAID)
            ->assertJsonPath('data.purchase_invoice.total_paid', '5000000.00')
            ->assertJsonPath('data.purchase_invoice.remaining_balance', '0.00');

        // 5. Pembayaran pada Invoice yang sudah Paid ditolak 422
        $this->postJson('/api/payment-vouchers', [
            'purchase_invoice_id' => $invoiceId,
            'amount_paid' => '100000.00',
            'payment_date' => $today,
            'payment_method' => PaymentVoucher::METHOD_CASH,
            'idempotency_key' => 'pay-idem-after-paid',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['purchase_invoice_id']);

        // 6. Verifikasi Trial Balance seimbang dan akun GR/IR serta AP sudah net 0.00
        $summaryResponse = $this->getJson('/api/general-ledgers/summary')->assertOk();
        $summaryResponse
            ->assertJsonPath('data.is_balanced', true)
            ->assertJsonPath('data.grand_total_debit', '15000000.00')
            ->assertJsonPath('data.grand_total_credit', '15000000.00');

        $accounts = collect($summaryResponse->json('data.accounts'))->keyBy('account_code');
        $this->assertSame('5000000.00', $accounts->get(GeneralLedger::ACCOUNT_INVENTORY)['net_balance']);
        $this->assertSame('-5000000.00', $accounts->get(GeneralLedger::ACCOUNT_CASH_BANK)['net_balance']);
        $this->assertSame('0.00', $accounts->get(GeneralLedger::ACCOUNT_GRIR_CLEARING)['net_balance']);
        $this->assertSame('0.00', $accounts->get(GeneralLedger::ACCOUNT_AP)['net_balance']);

        // Verifikasi audit log tercatat untuk alokasi pembayaran
        $this->assertSame(2, AuditLog::where('action', 'purchase_invoice.payment_allocated')->count());
    }

    public function test_ap_aging_dashboard_groups_unpaid_and_partially_paid_invoices_into_four_buckets(): void
    {
        $finance = $this->userByEmail('finance@erp.test');
        $supplierA = $this->createActiveSupplier('PT Pemasok Alpha');
        $supplierB = $this->createActiveSupplier('PT Pemasok Beta');
        $product = $this->createActiveProduct('SKU-AGE-001', 'Biskuit Kemasan');

        $poA = $this->createApprovedPo($supplierA, [
            ['product_id' => $product->id, 'qty_ordered' => '100.00', 'unit_price' => '100000.00'],
        ]);
        $poB = $this->createApprovedPo($supplierB, [
            ['product_id' => $product->id, 'qty_ordered' => '100.00', 'unit_price' => '100000.00'],
        ]);

        $asOf = Carbon::parse('2026-11-21');

        // 1. Current (belum jatuh tempo: +10 hari, Unpaid 1.000.000)
        PurchaseInvoice::create([
            'invoice_number' => 'INV-AGE-CUR1',
            'po_id' => $poA->id,
            'supplier_id' => $supplierA->id,
            'total_billed' => '1000000.00',
            'due_date' => $asOf->copy()->addDays(10)->toDateString(),
            'status' => PurchaseInvoice::STATUS_UNPAID,
            'idempotency_key' => 'age-cur-1',
        ]);

        // 2. Current (tepat jatuh tempo hari ini: 0 hari overdue, Partially Paid: 2.000.000 - 500.000 = 1.500.000)
        $partialInvoice = PurchaseInvoice::create([
            'invoice_number' => 'INV-AGE-CUR2',
            'po_id' => $poA->id,
            'supplier_id' => $supplierA->id,
            'total_billed' => '2000000.00',
            'due_date' => $asOf->toDateString(),
            'status' => PurchaseInvoice::STATUS_PARTIALLY_PAID,
            'idempotency_key' => 'age-cur-2',
        ]);
        PaymentVoucher::create([
            'voucher_number' => 'PV-AGE-001',
            'purchase_invoice_id' => $partialInvoice->id,
            'amount_paid' => '500000.00',
            'payment_date' => '2026-11-15',
            'payment_method' => PaymentVoucher::METHOD_BANK_TRANSFER,
            'idempotency_key' => 'pv-age-001',
        ]);

        // 3. 1-30 Days (20 hari overdue, Unpaid 3.000.000)
        PurchaseInvoice::create([
            'invoice_number' => 'INV-AGE-1-30',
            'po_id' => $poA->id,
            'supplier_id' => $supplierA->id,
            'total_billed' => '3000000.00',
            'due_date' => $asOf->copy()->subDays(20)->toDateString(),
            'status' => PurchaseInvoice::STATUS_UNPAID,
            'idempotency_key' => 'age-1-30',
        ]);

        // 4. 31-60 Days (45 hari overdue, Unpaid 4.000.000)
        PurchaseInvoice::create([
            'invoice_number' => 'INV-AGE-31-60',
            'po_id' => $poB->id,
            'supplier_id' => $supplierB->id,
            'total_billed' => '4000000.00',
            'due_date' => $asOf->copy()->subDays(45)->toDateString(),
            'status' => PurchaseInvoice::STATUS_UNPAID,
            'idempotency_key' => 'age-31-60',
        ]);

        // 5. >60 Days (90 hari overdue, Unpaid 5.000.000)
        PurchaseInvoice::create([
            'invoice_number' => 'INV-AGE-OVER60',
            'po_id' => $poB->id,
            'supplier_id' => $supplierB->id,
            'total_billed' => '5000000.00',
            'due_date' => $asOf->copy()->subDays(90)->toDateString(),
            'status' => PurchaseInvoice::STATUS_UNPAID,
            'idempotency_key' => 'age-over-60',
        ]);

        // 6. Paid invoice (WAJIB tidak masuk AP Aging Dashboard)
        PurchaseInvoice::create([
            'invoice_number' => 'INV-AGE-PAID',
            'po_id' => $poB->id,
            'supplier_id' => $supplierB->id,
            'total_billed' => '6000000.00',
            'due_date' => $asOf->copy()->subDays(120)->toDateString(),
            'status' => PurchaseInvoice::STATUS_PAID,
            'idempotency_key' => 'age-paid',
        ]);

        Sanctum::actingAs($finance);

        $response = $this->getJson('/api/purchase-invoices/ap-aging?as_of_date=2026-11-21');

        $response->assertOk()
            ->assertJsonPath('data.as_of_date', '2026-11-21')
            ->assertJsonPath('data.total_invoices', 5)
            ->assertJsonPath('data.total_outstanding', '14500000.00')
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
            ->assertJsonPath('data.buckets.over_60_days.total_outstanding', '5000000.00')
            ->assertJsonCount(2, 'data.by_supplier');

        // Filter berdasarkan supplier_id
        $this->getJson("/api/purchase-invoices/ap-aging?as_of_date=2026-11-21&supplier_id={$supplierB->id}")
            ->assertOk()
            ->assertJsonPath('data.total_invoices', 2)
            ->assertJsonPath('data.total_outstanding', '9000000.00')
            ->assertJsonPath('data.buckets.current.count', 0)
            ->assertJsonPath('data.buckets.31_60_days.total_outstanding', '4000000.00')
            ->assertJsonPath('data.buckets.over_60_days.total_outstanding', '5000000.00');
    }

    public function test_rbac_protects_finance_endpoints_for_finance_manager_super_admin_and_forbids_warehouse_and_sales(): void
    {
        $superAdmin = $this->userByEmail('superadmin@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');
        $gudang = $this->userByEmail('gudang@erp.test');
        $sales = $this->userByEmail('sales@erp.test');
        $purchasing = $this->userByEmail('purchasing@erp.test');

        // 1. Staf Gudang, Admin Sales, dan Purchasing WAJIB ditolak 403 di seluruh endpoint Finance
        foreach ([$gudang, $sales, $purchasing] as $forbiddenUser) {
            Sanctum::actingAs($forbiddenUser);
            $this->getJson('/api/purchase-invoices')->assertForbidden();
            $this->postJson('/api/purchase-invoices', [])->assertForbidden();
            $this->getJson('/api/purchase-invoices/ap-aging')->assertForbidden();
            $this->getJson('/api/payment-vouchers')->assertForbidden();
            $this->postJson('/api/payment-vouchers', [])->assertForbidden();
            $this->getJson('/api/general-ledgers')->assertForbidden();
            $this->postJson('/api/general-ledgers', [])->assertForbidden();
            $this->getJson('/api/general-ledgers/summary')->assertForbidden();
        }

        // 2. Manajer: boleh akses semua endpoint monitoring/read Finance (AP Aging, Invoices, Vouchers, General Ledger)
        Sanctum::actingAs($manajer);
        $this->getJson('/api/purchase-invoices')->assertOk();
        $this->getJson('/api/purchase-invoices/ap-aging')->assertOk();
        $this->getJson('/api/payment-vouchers')->assertOk();
        $this->getJson('/api/general-ledgers')->assertOk();
        $this->getJson('/api/general-ledgers/summary')->assertOk();
        // Manajer dilarang melakukan mutasi pembukuan langsung
        $this->postJson('/api/purchase-invoices', [])->assertForbidden();
        $this->postJson('/api/payment-vouchers', [])->assertForbidden();
        $this->postJson('/api/general-ledgers', [])->assertForbidden();

        // 3. Finance & Super Admin: boleh akses read & write (validasi jurnal manual & tolak jurnal unbalanced 422)
        foreach ([$finance, $superAdmin] as $authorizedUser) {
            Sanctum::actingAs($authorizedUser);
            $this->getJson('/api/purchase-invoices')->assertOk();
            $this->getJson('/api/purchase-invoices/ap-aging')->assertOk();
            $this->getJson('/api/payment-vouchers')->assertOk();
            $this->getJson('/api/general-ledgers')->assertOk();
            $this->getJson('/api/general-ledgers/summary')->assertOk();

            // Jurnal tidak seimbang wajib ditolak 422
            $this->postJson('/api/general-ledgers', [
                'transaction_date' => Carbon::today()->toDateString(),
                'lines' => [
                    ['account_code' => GeneralLedger::ACCOUNT_CASH_BANK, 'debit' => '100000.00', 'credit' => '0.00'],
                    ['account_code' => GeneralLedger::ACCOUNT_AP, 'debit' => '0.00', 'credit' => '90000.00'],
                ],
            ])->assertUnprocessable()
                ->assertJsonValidationErrors(['lines']);
        }
    }
}
