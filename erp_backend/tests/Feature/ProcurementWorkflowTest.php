<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\PurchaseRequisition;
use App\Models\Supplier;
use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProcurementWorkflowTest extends TestCase
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

    private function createActiveSupplier(string $name = 'PT Pemasok Distribusi'): Supplier
    {
        return Supplier::create([
            'name' => $name,
            'contact_name' => 'Budi Santoso',
            'email' => 'order@pemasok.test',
            'phone' => '021-5550101',
            'address' => 'Jl. Industri Raya No. 8',
            'status' => 'active',
        ]);
    }

    private function createActiveProduct(string $sku = 'SKU-P2P-001', string $name = 'Beras Premium 5kg'): Product
    {
        return Product::create([
            'sku' => $sku,
            'name' => $name,
            'category_id' => 1,
            'uom' => 'SAK',
            'is_active' => true,
        ]);
    }

    public function test_unauthenticated_requests_to_procurement_endpoints_are_rejected_with_401(): void
    {
        $this->getJson('/api/purchase-requisitions')->assertUnauthorized();
        $this->postJson('/api/purchase-requisitions', [])->assertUnauthorized();
        $this->getJson('/api/purchase-orders')->assertUnauthorized();
        $this->postJson('/api/purchase-orders', [])->assertUnauthorized();
    }

    public function test_complete_pr_to_po_workflow_and_purchasing_can_approve_po_up_to_10_million(): void
    {
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $supplier = $this->createActiveSupplier();
        $product = $this->createActiveProduct();

        Sanctum::actingAs($purchasing);

        // 1. Purchasing membuat PR (default status Draft)
        $prCreateResponse = $this->postJson('/api/purchase-requisitions', []);

        $prCreateResponse->assertCreated()
            ->assertJsonPath('data.requestor_id', $purchasing->id)
            ->assertJsonPath('data.status', PurchaseRequisition::STATUS_DRAFT);

        $prId = $prCreateResponse->json('data.id');

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $purchasing->id,
            'action' => 'purchase_requisition.created',
            'model_type' => PurchaseRequisition::class,
            'model_id' => $prId,
        ]);

        // PR berstatus Draft tidak boleh langsung dikonversi sebelum disubmit
        $this->postJson("/api/purchase-requisitions/{$prId}/convert-to-po", [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '100.00',
                    'unit_price' => '100000.00',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['pr_id']);

        // 2. Submit PR (Draft -> Submitted)
        $this->postJson("/api/purchase-requisitions/{$prId}/submit")
            ->assertOk()
            ->assertJsonPath('data.status', PurchaseRequisition::STATUS_SUBMITTED);

        $submittedAudit = AuditLog::where('action', 'purchase_requisition.submitted')
            ->where('model_type', PurchaseRequisition::class)
            ->where('model_id', $prId)
            ->firstOrFail();

        $this->assertSame(PurchaseRequisition::STATUS_DRAFT, $submittedAudit->old_payload['status']);
        $this->assertSame(PurchaseRequisition::STATUS_SUBMITTED, $submittedAudit->new_payload['status']);

        // 3. Konversi PR -> PO dengan total tepat Rp10.000.000,00 (batas atas Tier 1)
        $poResponse = $this->postJson("/api/purchase-requisitions/{$prId}/convert-to-po", [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '100.00',
                    'unit_price' => '100000.00',
                ],
            ],
        ]);

        $poResponse->assertCreated()
            ->assertJsonPath('data.pr_id', $prId)
            ->assertJsonPath('data.supplier_id', $supplier->id)
            ->assertJsonPath('data.total_amount', '10000000.00')
            ->assertJsonPath('data.status', PurchaseOrder::STATUS_PENDING_APPROVAL)
            ->assertJsonPath('data.requires_manager_approval', false)
            ->assertJsonPath('data.approver_id', null)
            ->assertJsonPath('data.items.0.subtotal', '10000000.00');

        $poId = $poResponse->json('data.id');

        // Pastikan status PR otomatis berubah menjadi Converted dalam DB::transaction()
        $this->assertDatabaseHas('purchase_requisitions', [
            'id' => $prId,
            'status' => PurchaseRequisition::STATUS_CONVERTED,
        ]);

        // Konversi ulang PR yang sudah Converted harus ditolak (422)
        $this->postJson("/api/purchase-requisitions/{$prId}/convert-to-po", [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '10.00',
                    'unit_price' => '50000.00',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['pr_id']);

        // 4. Purchasing BISA approve PO karena total_amount <= Rp10.000.000,00
        $approveResponse = $this->postJson("/api/purchase-orders/{$poId}/approve", [
            'notes' => 'Disetujui sesuai batas wewenang Purchasing.',
        ]);

        $approveResponse->assertOk()
            ->assertJsonPath('data.status', PurchaseOrder::STATUS_APPROVED)
            ->assertJsonPath('data.approver_id', $purchasing->id)
            ->assertJsonPath('data.approver.email', 'purchasing@erp.test');

        // Verifikasi pencatatan audit_logs (old_payload vs new_payload)
        $approvalAudit = AuditLog::where('action', 'purchase_order.approved')
            ->where('model_type', PurchaseOrder::class)
            ->where('model_id', $poId)
            ->firstOrFail();

        $this->assertSame($purchasing->id, $approvalAudit->user_id);
        $this->assertSame(PurchaseOrder::STATUS_PENDING_APPROVAL, $approvalAudit->old_payload['status']);
        $this->assertNull($approvalAudit->old_payload['approver_id']);
        $this->assertSame(PurchaseOrder::STATUS_APPROVED, $approvalAudit->new_payload['status']);
        $this->assertSame($purchasing->id, $approvalAudit->new_payload['approver_id']);
        $this->assertSame('10000000.00', $approvalAudit->new_payload['total_amount']);
        $this->assertSame('Disetujui sesuai batas wewenang Purchasing.', $approvalAudit->new_payload['notes']);

        // Approve ulang PO yang sudah Approved ditolak (422)
        $this->postJson("/api/purchase-orders/{$poId}/approve")
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    public function test_tiered_approval_matrix_blocks_purchasing_above_10_million_and_allows_manager_and_super_admin(): void
    {
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');
        $superAdmin = $this->userByEmail('superadmin@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $gudang = $this->userByEmail('gudang@erp.test');
        $sales = $this->userByEmail('sales@erp.test');

        $supplier = $this->createActiveSupplier();
        $productA = $this->createActiveProduct('SKU-TIER-A', 'Minyak Goreng 2L');
        $productB = $this->createActiveProduct('SKU-TIER-B', 'Gula Pasir 1kg');

        // Purchasing membuat PR 1 (langsung Submitted) & konversi ke PO 1 senilai Rp10.000.000,01 (tepat di atas Rp10 juta)
        Sanctum::actingAs($purchasing);

        $pr1Id = $this->postJson('/api/purchase-requisitions', [
            'status' => PurchaseRequisition::STATUS_SUBMITTED,
        ])->assertCreated()->json('data.id');

        $po1Response = $this->postJson("/api/purchase-requisitions/{$pr1Id}/convert-to-po", [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'qty_ordered' => '100.00',
                    'unit_price' => '100000.00',
                ],
                [
                    'product_id' => $productB->id,
                    'qty_ordered' => '1.00',
                    'unit_price' => '0.01',
                ],
            ],
        ]);

        $po1Response->assertCreated()
            ->assertJsonPath('data.total_amount', '10000000.01')
            ->assertJsonPath('data.requires_manager_approval', true)
            ->assertJsonPath('data.status', PurchaseOrder::STATUS_PENDING_APPROVAL);

        $po1Id = $po1Response->json('data.id');

        // Purchasing DITOLAK (403) saat mencoba approve atau reject PO > Rp10.000.000
        $this->postJson("/api/purchase-orders/{$po1Id}/approve")->assertForbidden();
        $this->postJson("/api/purchase-orders/{$po1Id}/reject", ['reason' => 'Coba tolak'])->assertForbidden();

        // Role lain (Finance, Staf Gudang, Admin Sales) juga DITOLAK (403)
        foreach ([$finance, $gudang, $sales] as $unauthorizedUser) {
            Sanctum::actingAs($unauthorizedUser);
            $this->postJson("/api/purchase-orders/{$po1Id}/approve")->assertForbidden();
        }

        // Pastikan status PO 1 belum berubah dan belum ada audit log approval
        $this->assertDatabaseHas('purchase_orders', [
            'id' => $po1Id,
            'status' => PurchaseOrder::STATUS_PENDING_APPROVAL,
            'approver_id' => null,
        ]);
        $this->assertDatabaseMissing('audit_logs', [
            'action' => 'purchase_order.approved',
            'model_type' => PurchaseOrder::class,
            'model_id' => $po1Id,
        ]);

        // Manajer BISA approve PO 1 (> Rp10 juta)
        Sanctum::actingAs($manajer);
        $this->postJson("/api/purchase-orders/{$po1Id}/approve", [
            'notes' => 'Approved oleh Manajer untuk pengadaan di atas limit.',
        ])->assertOk()
            ->assertJsonPath('data.status', PurchaseOrder::STATUS_APPROVED)
            ->assertJsonPath('data.approver_id', $manajer->id);

        $managerAudit = AuditLog::where('action', 'purchase_order.approved')
            ->where('model_type', PurchaseOrder::class)
            ->where('model_id', $po1Id)
            ->firstOrFail();

        $this->assertSame($manajer->id, $managerAudit->user_id);
        $this->assertSame(PurchaseOrder::STATUS_PENDING_APPROVAL, $managerAudit->old_payload['status']);
        $this->assertSame(PurchaseOrder::STATUS_APPROVED, $managerAudit->new_payload['status']);
        $this->assertSame($manajer->id, $managerAudit->new_payload['approver_id']);

        // PO 2 senilai Rp25.000.000,00 dibuat lewat POST /api/purchase-orders dengan pr_id
        Sanctum::actingAs($purchasing);
        $pr2Id = $this->postJson('/api/purchase-requisitions', [
            'status' => PurchaseRequisition::STATUS_SUBMITTED,
        ])->assertCreated()->json('data.id');

        $po2Id = $this->postJson('/api/purchase-orders', [
            'pr_id' => $pr2Id,
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $productA->id,
                    'qty_ordered' => '250.00',
                    'unit_price' => '100000.00',
                ],
            ],
        ])->assertCreated()
            ->assertJsonPath('data.total_amount', '25000000.00')
            ->assertJsonPath('data.requires_manager_approval', true)
            ->json('data.id');

        $this->assertDatabaseHas('purchase_requisitions', [
            'id' => $pr2Id,
            'status' => PurchaseRequisition::STATUS_CONVERTED,
        ]);

        // Purchasing tetap 403 untuk PO 2
        $this->postJson("/api/purchase-orders/{$po2Id}/approve")->assertForbidden();

        // Super Admin BISA approve PO 2 (> Rp10 juta)
        Sanctum::actingAs($superAdmin);
        $this->postJson("/api/purchase-orders/{$po2Id}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', PurchaseOrder::STATUS_APPROVED)
            ->assertJsonPath('data.approver_id', $superAdmin->id);

        $superAdminAudit = AuditLog::where('action', 'purchase_order.approved')
            ->where('model_type', PurchaseOrder::class)
            ->where('model_id', $po2Id)
            ->firstOrFail();

        $this->assertSame($superAdmin->id, $superAdminAudit->user_id);
        $this->assertSame(PurchaseOrder::STATUS_PENDING_APPROVAL, $superAdminAudit->old_payload['status']);
        $this->assertSame(PurchaseOrder::STATUS_APPROVED, $superAdminAudit->new_payload['status']);
    }

    public function test_po_rejection_records_audit_log_with_old_and_new_payload(): void
    {
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');
        $supplier = $this->createActiveSupplier();
        $product = $this->createActiveProduct();

        Sanctum::actingAs($purchasing);

        // PO <= Rp10 juta dapat di-reject oleh Purchasing
        $smallPoId = $this->postJson('/api/purchase-orders', [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '20.00',
                    'unit_price' => '250000.00',
                ],
            ],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/purchase-orders/{$smallPoId}/reject", [
            'reason' => 'Harga penawaran supplier melebihi pagu.',
        ])->assertOk()
            ->assertJsonPath('data.status', PurchaseOrder::STATUS_REJECTED)
            ->assertJsonPath('data.approver_id', $purchasing->id);

        $smallRejectAudit = AuditLog::where('action', 'purchase_order.rejected')
            ->where('model_type', PurchaseOrder::class)
            ->where('model_id', $smallPoId)
            ->firstOrFail();

        $this->assertSame(PurchaseOrder::STATUS_PENDING_APPROVAL, $smallRejectAudit->old_payload['status']);
        $this->assertSame(PurchaseOrder::STATUS_REJECTED, $smallRejectAudit->new_payload['status']);
        $this->assertSame('Harga penawaran supplier melebihi pagu.', $smallRejectAudit->new_payload['reason']);

        // PO > Rp10 juta hanya bisa di-reject oleh Manajer / Super Admin
        $largePoId = $this->postJson('/api/purchase-orders', [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '150.00',
                    'unit_price' => '100000.00',
                ],
            ],
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/purchase-orders/{$largePoId}/reject", [
            'reason' => 'Purchasing tidak berhak reject di atas limit.',
        ])->assertForbidden();

        Sanctum::actingAs($manajer);
        $this->postJson("/api/purchase-orders/{$largePoId}/reject", [
            'reason' => 'Anggaran kuartal ini sudah penuh.',
        ])->assertOk()
            ->assertJsonPath('data.status', PurchaseOrder::STATUS_REJECTED)
            ->assertJsonPath('data.approver_id', $manajer->id);

        $largeRejectAudit = AuditLog::where('action', 'purchase_order.rejected')
            ->where('model_type', PurchaseOrder::class)
            ->where('model_id', $largePoId)
            ->firstOrFail();

        $this->assertSame($manajer->id, $largeRejectAudit->user_id);
        $this->assertSame(PurchaseOrder::STATUS_PENDING_APPROVAL, $largeRejectAudit->old_payload['status']);
        $this->assertSame(PurchaseOrder::STATUS_REJECTED, $largeRejectAudit->new_payload['status']);
        $this->assertSame('Anggaran kuartal ini sudah penuh.', $largeRejectAudit->new_payload['reason']);
    }

    public function test_rbac_boundaries_for_procurement_endpoints(): void
    {
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $manajer = $this->userByEmail('manajer@erp.test');
        $finance = $this->userByEmail('finance@erp.test');
        $gudang = $this->userByEmail('gudang@erp.test');
        $sales = $this->userByEmail('sales@erp.test');

        $supplier = $this->createActiveSupplier();
        $product = $this->createActiveProduct();

        Sanctum::actingAs($purchasing);
        $prId = $this->postJson('/api/purchase-requisitions', [
            'status' => PurchaseRequisition::STATUS_SUBMITTED,
        ])->assertCreated()->json('data.id');

        $poId = $this->postJson('/api/purchase-orders', [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $product->id,
                    'qty_ordered' => '10.00',
                    'unit_price' => '100000.00',
                ],
            ],
        ])->assertCreated()->json('data.id');

        // Staf Gudang & Admin Sales tidak boleh akses PR maupun PO
        foreach ([$gudang, $sales] as $user) {
            Sanctum::actingAs($user);
            $this->getJson('/api/purchase-requisitions')->assertForbidden();
            $this->getJson("/api/purchase-requisitions/{$prId}")->assertForbidden();
            $this->postJson('/api/purchase-requisitions', [])->assertForbidden();
            $this->getJson('/api/purchase-orders')->assertForbidden();
            $this->getJson("/api/purchase-orders/{$poId}")->assertForbidden();
            $this->postJson('/api/purchase-orders', [])->assertForbidden();
            $this->postJson("/api/purchase-orders/{$poId}/approve")->assertForbidden();
        }

        // Finance boleh melihat PO, tapi tidak boleh membuat PR/PO atau approve PO
        Sanctum::actingAs($finance);
        $this->getJson('/api/purchase-orders')->assertOk();
        $this->getJson("/api/purchase-orders/{$poId}")->assertOk();
        $this->getJson('/api/purchase-requisitions')->assertForbidden();
        $this->postJson('/api/purchase-orders', [])->assertForbidden();
        $this->postJson("/api/purchase-orders/{$poId}/approve")->assertForbidden();

        // Manajer boleh melihat PR & PO, tapi tidak boleh membuat PR/PO
        Sanctum::actingAs($manajer);
        $this->getJson('/api/purchase-requisitions')->assertOk();
        $this->getJson("/api/purchase-requisitions/{$prId}")->assertOk();
        $this->getJson('/api/purchase-orders')->assertOk();
        $this->getJson("/api/purchase-orders/{$poId}")->assertOk();
        $this->postJson('/api/purchase-requisitions', [])->assertForbidden();
        $this->postJson('/api/purchase-orders', [])->assertForbidden();
    }

    public function test_validation_and_atomic_rollback_when_conversion_fails(): void
    {
        $purchasing = $this->userByEmail('purchasing@erp.test');
        $supplier = $this->createActiveSupplier();
        $inactiveProduct = Product::create([
            'sku' => 'SKU-INACTIVE',
            'name' => 'Produk Nonaktif',
            'uom' => 'PCS',
            'is_active' => false,
        ]);

        Sanctum::actingAs($purchasing);

        $prId = $this->postJson('/api/purchase-requisitions', [
            'status' => PurchaseRequisition::STATUS_SUBMITTED,
        ])->assertCreated()->json('data.id');

        // FormRequest menolak payload invalid (items kosong, qty <= 0, precision > 2)
        $this->postJson("/api/purchase-requisitions/{$prId}/convert-to-po", [
            'supplier_id' => $supplier->id,
            'items' => [],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items']);

        $this->postJson("/api/purchase-requisitions/{$prId}/convert-to-po", [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $inactiveProduct->id,
                    'qty_ordered' => '0',
                    'unit_price' => '1000.123',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty_ordered', 'items.0.unit_price']);

        // Produk nonaktif gagal di Service -> DB::transaction() rollback, PR tetap Submitted, tidak ada PO terbuat
        $this->postJson("/api/purchase-requisitions/{$prId}/convert-to-po", [
            'supplier_id' => $supplier->id,
            'items' => [
                [
                    'product_id' => $inactiveProduct->id,
                    'qty_ordered' => '5.00',
                    'unit_price' => '50000.00',
                ],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.product_id']);

        $this->assertDatabaseHas('purchase_requisitions', [
            'id' => $prId,
            'status' => PurchaseRequisition::STATUS_SUBMITTED,
        ]);
        $this->assertDatabaseCount('purchase_orders', 0);
    }
}
