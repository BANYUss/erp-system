<?php

namespace App\Services\Procurement;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\PurchaseRequisition;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PurchaseOrderService
{
    /**
     * Batas maksimal nilai PO yang dapat di-approve oleh Purchasing (Rp10.000.000,00).
     * Nilai di atas batas ini wajib di-approve oleh Manajer atau Super Admin.
     */
    public const APPROVAL_LIMIT = '10000000.00';

    /**
     * @param  array<string, mixed>  $data
     */
    public function createPurchaseRequisition(array $data, User $actor, ?string $ipAddress = null): PurchaseRequisition
    {
        $status = $data['status'] ?? PurchaseRequisition::STATUS_DRAFT;

        if ($status === PurchaseRequisition::STATUS_SUBMITTED && ! $actor->can('purchase_requisitions.submit')) {
            throw new AuthorizationException('Anda tidak memiliki izin untuk langsung melakukan submit Purchase Requisition.');
        }

        return DB::transaction(function () use ($data, $status, $actor, $ipAddress): PurchaseRequisition {
            $prNumber = ! empty($data['pr_number'])
                ? (string) $data['pr_number']
                : $this->generatePrNumber();

            $purchaseRequisition = PurchaseRequisition::create([
                'pr_number' => $prNumber,
                'requestor_id' => $actor->id,
                'status' => $status,
            ]);

            $this->recordAuditLog(
                actor: $actor,
                action: 'purchase_requisition.created',
                modelType: PurchaseRequisition::class,
                modelId: $purchaseRequisition->id,
                oldPayload: null,
                newPayload: $this->purchaseRequisitionPayload($purchaseRequisition),
                ipAddress: $ipAddress
            );

            return $purchaseRequisition->fresh(['requestor']);
        });
    }

    public function submitPurchaseRequisition(
        PurchaseRequisition $purchaseRequisition,
        User $actor,
        ?string $ipAddress = null
    ): PurchaseRequisition {
        return DB::transaction(function () use ($purchaseRequisition, $actor, $ipAddress): PurchaseRequisition {
            $lockedPr = PurchaseRequisition::query()
                ->lockForUpdate()
                ->findOrFail($purchaseRequisition->id);

            if ($lockedPr->status !== PurchaseRequisition::STATUS_DRAFT) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Purchase Requisition berstatus Draft yang dapat disubmit.'],
                ]);
            }

            $oldPayload = $this->purchaseRequisitionPayload($lockedPr);

            $lockedPr->update([
                'status' => PurchaseRequisition::STATUS_SUBMITTED,
            ]);

            $this->recordAuditLog(
                actor: $actor,
                action: 'purchase_requisition.submitted',
                modelType: PurchaseRequisition::class,
                modelId: $lockedPr->id,
                oldPayload: $oldPayload,
                newPayload: $this->purchaseRequisitionPayload($lockedPr),
                ipAddress: $ipAddress
            );

            return $lockedPr->fresh(['requestor', 'purchaseOrders']);
        });
    }

    /**
     * Mengonversi Purchase Requisition (PR) menjadi Purchase Order (PO) dalam DB::transaction().
     *
     * @param  array<string, mixed>  $data
     */
    public function convertRequisitionToPurchaseOrder(
        PurchaseRequisition $purchaseRequisition,
        array $data,
        User $actor,
        ?string $ipAddress = null
    ): PurchaseOrder {
        return $this->createPurchaseOrder(
            array_merge($data, ['pr_id' => $purchaseRequisition->id]),
            $actor,
            $ipAddress
        );
    }

    /**
     * Membuat Purchase Order (baik langsung maupun hasil konversi dari PR) dalam DB::transaction().
     *
     * @param  array<string, mixed>  $data
     */
    public function createPurchaseOrder(array $data, User $actor, ?string $ipAddress = null): PurchaseOrder
    {
        return DB::transaction(function () use ($data, $actor, $ipAddress): PurchaseOrder {
            $lockedPr = null;

            if (! empty($data['pr_id'])) {
                $lockedPr = PurchaseRequisition::query()
                    ->lockForUpdate()
                    ->findOrFail((int) $data['pr_id']);

                if ($lockedPr->status === PurchaseRequisition::STATUS_CONVERTED) {
                    throw ValidationException::withMessages([
                        'pr_id' => ['Purchase Requisition sudah dikonversi menjadi Purchase Order.'],
                    ]);
                }

                if ($lockedPr->status !== PurchaseRequisition::STATUS_SUBMITTED) {
                    throw ValidationException::withMessages([
                        'pr_id' => ['Purchase Requisition harus berstatus Submitted sebelum dikonversi menjadi Purchase Order.'],
                    ]);
                }
            }

            $supplier = Supplier::query()->findOrFail((int) $data['supplier_id']);

            if ($supplier->status !== 'active') {
                throw ValidationException::withMessages([
                    'supplier_id' => ['Supplier yang dipilih tidak berstatus aktif.'],
                ]);
            }

            $items = $data['items'] ?? [];
            $productIds = array_values(array_unique(array_map(
                static fn (array $item): int => (int) $item['product_id'],
                $items
            )));

            $products = Product::query()
                ->whereIn('id', $productIds)
                ->get()
                ->keyBy('id');

            $totalAmountHighPrecision = '0.0000';
            $preparedItems = [];

            foreach ($items as $index => $item) {
                $productId = (int) $item['product_id'];
                $product = $products->get($productId);

                if ($product === null || ! $product->is_active) {
                    throw ValidationException::withMessages([
                        "items.{$index}.product_id" => ['Produk tidak ditemukan atau tidak aktif.'],
                    ]);
                }

                $qtyOrdered = $this->normalizeDecimal((string) $item['qty_ordered'], 2);
                $unitPrice = $this->normalizeDecimal((string) $item['unit_price'], 2);

                if (bccomp($qtyOrdered, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        "items.{$index}.qty_ordered" => ['Kuantitas pemesanan harus lebih dari 0.'],
                    ]);
                }

                if (bccomp($unitPrice, '0.00', 2) <= 0) {
                    throw ValidationException::withMessages([
                        "items.{$index}.unit_price" => ['Harga satuan harus lebih dari 0.'],
                    ]);
                }

                $lineTotal = bcmul($qtyOrdered, $unitPrice, 4);
                $totalAmountHighPrecision = bcadd($totalAmountHighPrecision, $lineTotal, 4);

                $preparedItems[] = [
                    'product_id' => $productId,
                    'qty_ordered' => $qtyOrdered,
                    'unit_price' => $unitPrice,
                ];
            }

            $totalAmount = $this->roundDecimal($totalAmountHighPrecision, 2);
            $poNumber = ! empty($data['po_number'])
                ? (string) $data['po_number']
                : $this->generatePoNumber();

            $purchaseOrder = PurchaseOrder::create([
                'po_number' => $poNumber,
                'pr_id' => $lockedPr?->id,
                'supplier_id' => $supplier->id,
                'total_amount' => $totalAmount,
                'status' => PurchaseOrder::STATUS_PENDING_APPROVAL,
                'approver_id' => null,
            ]);

            $purchaseOrder->items()->createMany($preparedItems);

            if ($lockedPr !== null) {
                $oldPrPayload = $this->purchaseRequisitionPayload($lockedPr);

                $lockedPr->update([
                    'status' => PurchaseRequisition::STATUS_CONVERTED,
                ]);

                $this->recordAuditLog(
                    actor: $actor,
                    action: 'purchase_requisition.converted',
                    modelType: PurchaseRequisition::class,
                    modelId: $lockedPr->id,
                    oldPayload: $oldPrPayload,
                    newPayload: array_merge($this->purchaseRequisitionPayload($lockedPr), [
                        'converted_to_po_id' => $purchaseOrder->id,
                        'converted_to_po_number' => $purchaseOrder->po_number,
                    ]),
                    ipAddress: $ipAddress
                );
            }

            $purchaseOrder->load(['purchaseRequisition', 'supplier', 'approver', 'items.product']);

            $this->recordAuditLog(
                actor: $actor,
                action: 'purchase_order.created',
                modelType: PurchaseOrder::class,
                modelId: $purchaseOrder->id,
                oldPayload: null,
                newPayload: array_merge($this->purchaseOrderPayload($purchaseOrder), [
                    'items_count' => $purchaseOrder->items->count(),
                ]),
                ipAddress: $ipAddress
            );

            return $purchaseOrder;
        });
    }

    /**
     * Menyetujui Purchase Order dengan menerapkan Tiered Approval Matrix dan mencatat audit_logs.
     */
    public function approvePurchaseOrder(
        PurchaseOrder $purchaseOrder,
        User $actor,
        ?string $notes = null,
        ?string $ipAddress = null
    ): PurchaseOrder {
        return DB::transaction(function () use ($purchaseOrder, $actor, $notes, $ipAddress): PurchaseOrder {
            $lockedPo = PurchaseOrder::query()
                ->lockForUpdate()
                ->findOrFail($purchaseOrder->id);

            $this->assertCanApproveOrReject($lockedPo, $actor);

            if ($lockedPo->status !== PurchaseOrder::STATUS_PENDING_APPROVAL) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Purchase Order berstatus Pending Approval yang dapat di-approve.'],
                ]);
            }

            $oldPayload = $this->purchaseOrderPayload($lockedPo);

            $lockedPo->update([
                'status' => PurchaseOrder::STATUS_APPROVED,
                'approver_id' => $actor->id,
            ]);

            $newPayload = $this->purchaseOrderPayload($lockedPo);
            if ($notes !== null && trim($notes) !== '') {
                $newPayload['notes'] = trim($notes);
            }

            $this->recordAuditLog(
                actor: $actor,
                action: 'purchase_order.approved',
                modelType: PurchaseOrder::class,
                modelId: $lockedPo->id,
                oldPayload: $oldPayload,
                newPayload: $newPayload,
                ipAddress: $ipAddress
            );

            return $lockedPo->fresh(['purchaseRequisition', 'supplier', 'approver', 'items.product']);
        });
    }

    /**
     * Menolak Purchase Order dengan menerapkan Tiered Approval Matrix dan mencatat audit_logs.
     */
    public function rejectPurchaseOrder(
        PurchaseOrder $purchaseOrder,
        User $actor,
        ?string $reason = null,
        ?string $ipAddress = null
    ): PurchaseOrder {
        return DB::transaction(function () use ($purchaseOrder, $actor, $reason, $ipAddress): PurchaseOrder {
            $lockedPo = PurchaseOrder::query()
                ->lockForUpdate()
                ->findOrFail($purchaseOrder->id);

            $this->assertCanApproveOrReject($lockedPo, $actor);

            if ($lockedPo->status !== PurchaseOrder::STATUS_PENDING_APPROVAL) {
                throw ValidationException::withMessages([
                    'status' => ['Hanya Purchase Order berstatus Pending Approval yang dapat di-reject.'],
                ]);
            }

            $oldPayload = $this->purchaseOrderPayload($lockedPo);

            $lockedPo->update([
                'status' => PurchaseOrder::STATUS_REJECTED,
                'approver_id' => $actor->id,
            ]);

            $newPayload = $this->purchaseOrderPayload($lockedPo);
            if ($reason !== null && trim($reason) !== '') {
                $newPayload['reason'] = trim($reason);
            }

            $this->recordAuditLog(
                actor: $actor,
                action: 'purchase_order.rejected',
                modelType: PurchaseOrder::class,
                modelId: $lockedPo->id,
                oldPayload: $oldPayload,
                newPayload: $newPayload,
                ipAddress: $ipAddress
            );

            return $lockedPo->fresh(['purchaseRequisition', 'supplier', 'approver', 'items.product']);
        });
    }

    /**
     * Soft-delete Purchase Order yang masih Pending Approval atau Rejected.
     */
    public function deletePurchaseOrder(
        PurchaseOrder $purchaseOrder,
        User $actor,
        ?string $ipAddress = null
    ): void {
        DB::transaction(function () use ($purchaseOrder, $actor, $ipAddress): void {
            $lockedPo = PurchaseOrder::query()
                ->lockForUpdate()
                ->findOrFail($purchaseOrder->id);

            if (! in_array($lockedPo->status, [
                PurchaseOrder::STATUS_PENDING_APPROVAL,
                PurchaseOrder::STATUS_REJECTED,
            ], true)) {
                throw ValidationException::withMessages([
                    'status' => ['Purchase Order yang sudah diproses atau disetujui tidak dapat dihapus.'],
                ]);
            }

            $oldPayload = $this->purchaseOrderPayload($lockedPo);

            $lockedPo->items()->delete();
            $lockedPo->delete();

            $this->recordAuditLog(
                actor: $actor,
                action: 'purchase_order.deleted',
                modelType: PurchaseOrder::class,
                modelId: $lockedPo->id,
                oldPayload: $oldPayload,
                newPayload: null,
                ipAddress: $ipAddress
            );
        });
    }

    public function requiresManagerApproval(PurchaseOrder $purchaseOrder): bool
    {
        return bccomp((string) $purchaseOrder->total_amount, self::APPROVAL_LIMIT, 2) > 0;
    }

    /**
     * Tiered Approval Matrix:
     * - total_amount <= Rp10.000.000: Purchasing, Manajer, atau Super Admin.
     * - total_amount >  Rp10.000.000: HANYA Manajer atau Super Admin (tolak 403 untuk role lain).
     */
    private function assertCanApproveOrReject(PurchaseOrder $purchaseOrder, User $actor): void
    {
        if ($this->requiresManagerApproval($purchaseOrder)) {
            if (! $actor->hasAnyRole(['Manajer', 'Super Admin'])) {
                throw new AuthorizationException(
                    'Purchase Order di atas Rp10.000.000 hanya dapat di-approve atau di-reject oleh Manajer atau Super Admin.'
                );
            }

            return;
        }

        if (! $actor->hasAnyRole(['Purchasing', 'Manajer', 'Super Admin'])) {
            throw new AuthorizationException(
                'Anda tidak memiliki wewenang untuk melakukan approval atau rejection pada Purchase Order ini.'
            );
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function purchaseRequisitionPayload(PurchaseRequisition $pr): array
    {
        return [
            'id' => $pr->id,
            'pr_number' => $pr->pr_number,
            'requestor_id' => $pr->requestor_id,
            'status' => $pr->status,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function purchaseOrderPayload(PurchaseOrder $po): array
    {
        return [
            'id' => $po->id,
            'po_number' => $po->po_number,
            'pr_id' => $po->pr_id,
            'supplier_id' => $po->supplier_id,
            'total_amount' => (string) $po->total_amount,
            'status' => $po->status,
            'approver_id' => $po->approver_id,
        ];
    }

    /**
     * @param  array<string, mixed>|null  $oldPayload
     * @param  array<string, mixed>|null  $newPayload
     */
    private function recordAuditLog(
        User $actor,
        string $action,
        string $modelType,
        int $modelId,
        ?array $oldPayload,
        ?array $newPayload,
        ?string $ipAddress
    ): AuditLog {
        return AuditLog::create([
            'user_id' => $actor->id,
            'action' => $action,
            'model_type' => $modelType,
            'model_id' => $modelId,
            'old_payload' => $oldPayload,
            'new_payload' => $newPayload,
            'ip_address' => $ipAddress,
        ]);
    }

    private function generatePrNumber(): string
    {
        $prefix = 'PR-' . now()->format('Ym') . '-';

        $latestNumber = PurchaseRequisition::withTrashed()
            ->where('pr_number', 'like', $prefix . '%')
            ->orderByDesc('pr_number')
            ->value('pr_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (PurchaseRequisition::withTrashed()->where('pr_number', $candidate)->exists());

        return $candidate;
    }

    private function generatePoNumber(): string
    {
        $prefix = 'PO-' . now()->format('Ym') . '-';

        $latestNumber = PurchaseOrder::withTrashed()
            ->where('po_number', 'like', $prefix . '%')
            ->orderByDesc('po_number')
            ->value('po_number');

        $sequence = $latestNumber !== null
            ? ((int) substr($latestNumber, strlen($prefix))) + 1
            : 1;

        do {
            $candidate = $prefix . str_pad((string) $sequence, 4, '0', STR_PAD_LEFT);
            $sequence++;
        } while (PurchaseOrder::withTrashed()->where('po_number', $candidate)->exists());

        return $candidate;
    }

    private function normalizeDecimal(string $value, int $scale = 2): string
    {
        return bcadd(trim($value), '0', $scale);
    }

    private function roundDecimal(string $value, int $scale = 2): string
    {
        $isNegative = str_starts_with($value, '-');
        $half = '0.' . str_repeat('0', $scale) . '5';

        $adjusted = $isNegative
            ? bcsub($value, $half, $scale + 2)
            : bcadd($value, $half, $scale + 2);

        return bcadd($adjusted, '0', $scale);
    }
}
