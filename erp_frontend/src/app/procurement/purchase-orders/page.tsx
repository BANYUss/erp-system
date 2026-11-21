"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  XCircle,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { PoStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDateTime,
  formatNumber,
  formatRupiah,
  parseDecimal,
  PO_MANAGER_APPROVAL_LIMIT,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiMessageResponse,
  ApiResourceResponse,
  ApprovePurchaseOrderPayload,
  CreatePurchaseOrderPayload,
  PaginatedResponse,
  PaginationMeta,
  Product,
  PurchaseOrder,
  PurchaseOrderStatus,
  RejectPurchaseOrderPayload,
  Supplier,
} from "@/types/erp";

type PoStatusFilter = "all" | PurchaseOrderStatus;

const PO_STATUS_OPTIONS: PurchaseOrderStatus[] = [
  "Draft",
  "Pending Approval",
  "Approved",
  "Rejected",
  "Partially Received",
  "Completed",
];

interface PoItemDraft {
  key: string;
  product_id: string;
  qty_ordered: string;
  unit_price: string;
}

function createEmptyItemDraft(key: string): PoItemDraft {
  return {
    key,
    product_id: "",
    qty_ordered: "1",
    unit_price: "",
  };
}

export default function PurchaseOrdersPage() {
  const { hasPermission, hasRole, isLoading: authLoading } = useAuth();
  const canView = hasPermission("purchase_orders.view");
  const canCreate = hasPermission("purchase_orders.create");
  const canApprove = hasPermission("purchase_orders.approve");
  const canUpdate = hasPermission("purchase_orders.update");
  const isManagerOrAdmin = hasRole(["Manajer", "Super Admin"]);

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PoStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Detail Modal
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);

  // Approve Modal
  const [approvingPo, setApprovingPo] = useState<PurchaseOrder | null>(null);
  const [approveNotes, setApproveNotes] = useState("");
  const [approveError, setApproveError] = useState<ParsedApiError | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  // Reject Modal
  const [rejectingPo, setRejectingPo] = useState<PurchaseOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<ParsedApiError | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);

  // Delete Modal
  const [deletingPo, setDeletingPo] = useState<PurchaseOrder | null>(null);
  const [deleteError, setDeleteError] = useState<ParsedApiError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create Direct PO Modal
  const itemKeySeqRef = useRef(1);
  const nextItemDraft = useCallback((): PoItemDraft => {
    const key = `po-item-${itemKeySeqRef.current}`;
    itemKeySeqRef.current += 1;
    return createEmptyItemDraft(key);
  }, []);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [poNumberInput, setPoNumberInput] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [itemDrafts, setItemDrafts] = useState<PoItemDraft[]>([
    createEmptyItemDraft("po-item-0"),
  ]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingMasterOptions, setLoadingMasterOptions] = useState(false);
  const [masterOptionsError, setMasterOptionsError] = useState<string | null>(
    null
  );
  const [createError, setCreateError] = useState<ParsedApiError | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const triggerReload = useCallback(() => {
    setReloadTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    const loadOrders = async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      if (!canView) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setPageError(null);

      try {
        const params: Record<string, string | number> = {
          page,
          per_page: 15,
        };
        if (appliedSearch.trim() !== "") {
          params.search = appliedSearch.trim();
        }
        if (statusFilter !== "all") {
          params.status = statusFilter;
        }

        const response = await api.get<PaginatedResponse<PurchaseOrder>>(
          "/purchase-orders",
          { params }
        );
        if (!cancelled) {
          setOrders(response.data.data);
          setMeta(response.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Purchase Order.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadOrders();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, page, appliedSearch, statusFilter, reloadTick]);

  const canUserApprovePo = useCallback(
    (po: PurchaseOrder): boolean => {
      if (!canApprove || po.status !== "Pending Approval") {
        return false;
      }
      if (po.requires_manager_approval && !isManagerOrAdmin) {
        return false;
      }
      return true;
    },
    [canApprove, isManagerOrAdmin]
  );

  const loadMasterOptions = useCallback(async () => {
    setLoadingMasterOptions(true);
    setMasterOptionsError(null);
    try {
      const [supRes, prodRes] = await Promise.all([
        api.get<PaginatedResponse<Supplier>>("/suppliers", {
          params: { status: "active", per_page: 100 },
        }),
        api.get<PaginatedResponse<Product>>("/products", {
          params: { is_active: "1", per_page: 100 },
        }),
      ]);
      setSuppliers(supRes.data.data);
      setProducts(prodRes.data.data);
    } catch (error) {
      const parsed = extractApiError(
        error,
        "Gagal memuat daftar supplier aktif dan produk aktif."
      );
      setMasterOptionsError(parsed.message);
    } finally {
      setLoadingMasterOptions(false);
    }
  }, []);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput);
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setAppliedSearch("");
    setStatusFilter("all");
    setPage(1);
  };

  const openApproveModal = (po: PurchaseOrder) => {
    setApprovingPo(po);
    setApproveNotes("");
    setApproveError(null);
  };

  const openRejectModal = (po: PurchaseOrder) => {
    setRejectingPo(po);
    setRejectReason("");
    setRejectError(null);
  };

  const handleApproveSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!approvingPo) {
      return;
    }

    setApproveError(null);
    setIsApproving(true);

    const payload: ApprovePurchaseOrderPayload = {};
    if (approveNotes.trim() !== "") {
      payload.notes = approveNotes.trim();
    }

    try {
      const res = await api.post<ApiResourceResponse<PurchaseOrder>>(
        `/purchase-orders/${approvingPo.id}/approve`,
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Purchase Order ${approvingPo.po_number} berhasil di-approve.`
      );
      setApprovingPo(null);
      if (selectedPo?.id === approvingPo.id) {
        setSelectedPo(res.data.data);
      }
      triggerReload();
    } catch (error) {
      setApproveError(
        extractApiError(error, "Gagal menyetujui Purchase Order.")
      );
    } finally {
      setIsApproving(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!rejectingPo) {
      return;
    }

    setRejectError(null);

    const trimmedReason = rejectReason.trim();
    if (trimmedReason.length < 3) {
      setRejectError({
        message: "Alasan penolakan wajib diisi minimal 3 karakter.",
        fieldErrors: {},
      });
      return;
    }

    setIsRejecting(true);

    const payload: RejectPurchaseOrderPayload = {
      reason: trimmedReason,
    };

    try {
      const res = await api.post<ApiResourceResponse<PurchaseOrder>>(
        `/purchase-orders/${rejectingPo.id}/reject`,
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Purchase Order ${rejectingPo.po_number} berhasil di-reject.`
      );
      setRejectingPo(null);
      if (selectedPo?.id === rejectingPo.id) {
        setSelectedPo(res.data.data);
      }
      triggerReload();
    } catch (error) {
      setRejectError(extractApiError(error, "Gagal menolak Purchase Order."));
    } finally {
      setIsRejecting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPo) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      const res = await api.delete<ApiMessageResponse>(
        `/purchase-orders/${deletingPo.id}`
      );
      setSuccessMessage(
        res.data.message ||
          `Purchase Order ${deletingPo.po_number} berhasil dihapus.`
      );
      if (selectedPo?.id === deletingPo.id) {
        setSelectedPo(null);
      }
      setDeletingPo(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus Purchase Order."));
    } finally {
      setIsDeleting(false);
    }
  };

  const openCreateModal = () => {
    setPoNumberInput("");
    setSelectedSupplierId("");
    setItemDrafts([nextItemDraft()]);
    setCreateError(null);
    setCreateModalOpen(true);
    void loadMasterOptions();
  };

  const handleAddItemRow = () => {
    setItemDrafts((prev) => [...prev, nextItemDraft()]);
  };

  const handleRemoveItemRow = (key: string) => {
    setItemDrafts((prev) =>
      prev.length > 1 ? prev.filter((item) => item.key !== key) : prev
    );
  };

  const handleUpdateItemRow = (
    key: string,
    field: keyof Omit<PoItemDraft, "key">,
    value: string
  ) => {
    setItemDrafts((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  };

  const estimatedTotal = useMemo(() => {
    return itemDrafts.reduce((sum, item) => {
      const qty = parseDecimal(item.qty_ordered);
      const price = parseDecimal(item.unit_price);
      if (qty > 0 && price > 0) {
        return sum + qty * price;
      }
      return sum;
    }, 0);
  }, [itemDrafts]);

  const handleCreatePoSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    if (!selectedSupplierId) {
      setCreateError({
        message: "Silakan pilih supplier aktif terlebih dahulu.",
        fieldErrors: {},
      });
      return;
    }

    const preparedItems = itemDrafts.map((item) => ({
      product_id: Number(item.product_id),
      qty_ordered: item.qty_ordered.trim(),
      unit_price: item.unit_price.trim(),
    }));

    const hasInvalidItem = preparedItems.some(
      (item) =>
        !item.product_id ||
        parseDecimal(item.qty_ordered) <= 0 ||
        parseDecimal(item.unit_price) <= 0
    );

    if (hasInvalidItem) {
      setCreateError({
        message:
          "Setiap baris item wajib memilih produk serta mengisi kuantitas (> 0) dan harga satuan (> 0).",
        fieldErrors: {},
      });
      return;
    }

    const payload: CreatePurchaseOrderPayload = {
      supplier_id: Number(selectedSupplierId),
      items: preparedItems,
    };

    if (poNumberInput.trim() !== "") {
      payload.po_number = poNumberInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<PurchaseOrder>>(
        "/purchase-orders",
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Purchase Order ${res.data.data.po_number} berhasil dibuat.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(error, "Gagal membuat Purchase Order baru.")
      );
    } finally {
      setIsCreating(false);
    }
  };

  const columns = useMemo<DataTableColumn<PurchaseOrder>[]>(
    () => [
      {
        key: "po_number",
        header: "Nomor PO",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.po_number}
            </p>
            <p className="text-[11px] text-slate-400">
              {row.purchase_requisition
                ? `Ref: ${row.purchase_requisition.pr_number}`
                : "PO Langsung"}
            </p>
          </div>
        ),
      },
      {
        key: "supplier",
        header: "Supplier",
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-900">
              {row.supplier?.name ?? `Supplier #${row.supplier_id}`}
            </p>
            {row.supplier?.contact_name && (
              <p className="text-[11px] text-slate-400">
                PIC: {row.supplier.contact_name}
              </p>
            )}
          </div>
        ),
      },
      {
        key: "items",
        header: "Item",
        align: "center",
        render: (row) => (
          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
            {row.items?.length ?? 0} item
          </span>
        ),
      },
      {
        key: "total_amount",
        header: "Total Nilai",
        align: "right",
        render: (row) => (
          <div className="flex flex-col items-end gap-1">
            <span className="font-mono text-xs font-bold text-slate-900">
              {formatRupiah(row.total_amount)}
            </span>
            {row.requires_manager_approval && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">
                <ShieldAlert className="h-3 w-3" />
                &gt; Rp10 Jt &bull; Manajer
              </span>
            )}
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        align: "center",
        render: (row) => <PoStatusBadge status={row.status} />,
      },
      {
        key: "approver",
        header: "Approver",
        render: (row) =>
          row.approver ? (
            <div>
              <p className="font-medium text-slate-800">{row.approver.name}</p>
              <p className="text-[11px] text-slate-400">{row.approver.email}</p>
            </div>
          ) : (
            <span className="text-slate-400">-</span>
          ),
      },
      {
        key: "created_at",
        header: "Dibuat",
        render: (row) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Aksi",
        align: "right",
        render: (row) => {
          const isPending = row.status === "Pending Approval";
          const allowedByTier = canUserApprovePo(row);
          const lockedByTier =
            isPending &&
            canApprove &&
            row.requires_manager_approval &&
            !isManagerOrAdmin;
          const canDeleteRow =
            canUpdate &&
            (row.status === "Pending Approval" || row.status === "Rejected");

          return (
            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedPo(row)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Eye className="h-3.5 w-3.5" />
                Detail
              </button>

              {isPending && canApprove && (
                <>
                  <button
                    type="button"
                    onClick={() => openApproveModal(row)}
                    disabled={!allowedByTier}
                    title={
                      lockedByTier
                        ? "Tiered Approval: PO di atas Rp10.000.000 hanya dapat di-approve oleh Manajer atau Super Admin."
                        : "Setujui Purchase Order ini"
                    }
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                      allowedByTier
                        ? "bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700"
                        : "cursor-not-allowed border border-amber-200 bg-amber-50 text-amber-700 opacity-75"
                    }`}
                  >
                    {lockedByTier ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Approve
                  </button>

                  <button
                    type="button"
                    onClick={() => openRejectModal(row)}
                    disabled={!allowedByTier}
                    title={
                      lockedByTier
                        ? "Tiered Approval: PO di atas Rp10.000.000 hanya dapat di-reject oleh Manajer atau Super Admin."
                        : "Tolak Purchase Order ini"
                    }
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                      allowedByTier
                        ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                        : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </>
              )}

              {canDeleteRow && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingPo(row);
                  }}
                  aria-label={`Hapus PO ${row.po_number}`}
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1.5 text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [canApprove, canUpdate, canUserApprovePo, isManagerOrAdmin]
  );

  return (
    <DashboardShell
      title="Purchase Orders (PO)"
      subtitle="Monitoring pesanan pembelian, rincian item, dan persetujuan berjenjang (Tiered Approval > Rp10.000.000)"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Purchase Orders"
          requiredPermission="purchase_orders.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Tiered Approval Policy Banner */}
          <div className="flex flex-col gap-2 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <p className="leading-relaxed">
                <strong className="font-semibold">
                  Aturan Tiered Approval:
                </strong>{" "}
                PO bernilai{" "}
                <span className="font-mono font-semibold">
                  &le; Rp10.000.000
                </span>{" "}
                dapat di-approve oleh Purchasing, Manajer, atau Super Admin. PO
                bernilai{" "}
                <span className="font-mono font-semibold">
                  &gt; Rp10.000.000
                </span>{" "}
                <strong>wajib</strong> di-approve / di-reject oleh{" "}
                <strong>Manajer</strong> atau <strong>Super Admin</strong>.
              </p>
            </div>
            <span
              className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                isManagerOrAdmin
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {isManagerOrAdmin
                ? "Wewenang Anda: Semua Limit"
                : canApprove
                  ? "Wewenang Anda: Maks. Rp10 Jt"
                  : "Wewenang Anda: Lihat Saja"}
            </span>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
            <form
              onSubmit={handleSearchSubmit}
              className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:items-center"
            >
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Cari nomor PO (mis. PO-2026...)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status PO"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as PoStatusFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                {PO_STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  Cari
                </button>
                {(appliedSearch !== "" || statusFilter !== "all") && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={triggerReload}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
                />
                Muat Ulang
              </button>

              {canCreate && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                  Buat PO Langsung
                </button>
              )}
            </div>
          </div>

          {successMessage && (
            <AlertBanner
              variant="success"
              message={successMessage}
              onDismiss={() => setSuccessMessage(null)}
            />
          )}

          {pageError && (
            <AlertBanner
              variant="error"
              title="Gagal Memuat Purchase Order"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={orders}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada Purchase Order"
            emptyDescription="Buat PO baru atau konversi dari Purchase Requisition berstatus Submitted."
          />

          {/* PO Detail Modal */}
          <Modal
            open={Boolean(selectedPo)}
            onClose={() => setSelectedPo(null)}
            title={
              selectedPo ? `Detail PO ${selectedPo.po_number}` : "Detail PO"
            }
            subtitle={
              selectedPo
                ? `Dibuat pada ${formatDateTime(selectedPo.created_at)}`
                : undefined
            }
            size="xl"
            footer={
              selectedPo && (
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedPo.status === "Pending Approval" && canApprove && (
                      <>
                        <button
                          type="button"
                          onClick={() => openApproveModal(selectedPo)}
                          disabled={!canUserApprovePo(selectedPo)}
                          title={
                            selectedPo.requires_manager_approval &&
                            !isManagerOrAdmin
                              ? "PO di atas Rp10.000.000 hanya dapat di-approve oleh Manajer atau Super Admin."
                              : "Approve PO"
                          }
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                            canUserApprovePo(selectedPo)
                              ? "bg-emerald-600 text-white hover:bg-emerald-700"
                              : "cursor-not-allowed border border-amber-200 bg-amber-50 text-amber-800 opacity-75"
                          }`}
                        >
                          {selectedPo.requires_manager_approval &&
                          !isManagerOrAdmin ? (
                            <Lock className="h-3.5 w-3.5" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Approve PO
                        </button>
                        <button
                          type="button"
                          onClick={() => openRejectModal(selectedPo)}
                          disabled={!canUserApprovePo(selectedPo)}
                          title={
                            selectedPo.requires_manager_approval &&
                            !isManagerOrAdmin
                              ? "PO di atas Rp10.000.000 hanya dapat di-reject oleh Manajer atau Super Admin."
                              : "Reject PO"
                          }
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                            canUserApprovePo(selectedPo)
                              ? "bg-rose-600 text-white hover:bg-rose-700"
                              : "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                          }`}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject PO
                        </button>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPo(null)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    Tutup
                  </button>
                </div>
              )
            }
          >
            {selectedPo && (
              <div className="space-y-5">
                {/* Summary Grid */}
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Status PO
                    </p>
                    <div className="mt-1">
                      <PoStatusBadge status={selectedPo.status} />
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Supplier
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-900">
                      {selectedPo.supplier?.name ??
                        `Supplier #${selectedPo.supplier_id}`}
                    </p>
                    {selectedPo.supplier?.email && (
                      <p className="text-[11px] text-slate-500">
                        {selectedPo.supplier.email}
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Referensi PR
                    </p>
                    <p className="mt-1 font-mono text-xs font-semibold text-slate-800">
                      {selectedPo.purchase_requisition?.pr_number ?? "-"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Approver
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-800">
                      {selectedPo.approver?.name ?? "Belum diproses"}
                    </p>
                  </div>
                </div>

                {selectedPo.requires_manager_approval && (
                  <AlertBanner
                    variant="warning"
                    title="Tiered Approval (> Rp10.000.000)"
                    message={
                      isManagerOrAdmin
                        ? "Nilai PO ini melebihi batas Rp10.000.000. Anda memiliki peran Manajer / Super Admin sehingga berwenang melakukan approval atau rejection."
                        : "Nilai PO ini melebihi batas Rp10.000.000 sehingga hanya dapat di-approve atau di-reject oleh Manajer atau Super Admin."
                    }
                  />
                )}

                {/* Items Table */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    <h3 className="text-xs font-bold text-slate-900">
                      Rincian Item Purchase Order (
                      {selectedPo.items?.length ?? 0} item)
                    </h3>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500">
                              SKU
                            </th>
                            <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase text-slate-500">
                              Produk
                            </th>
                            <th className="px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase text-slate-500">
                              Qty
                            </th>
                            <th className="px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase text-slate-500">
                              Harga Satuan
                            </th>
                            <th className="px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase text-slate-500">
                              Subtotal
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {(selectedPo.items ?? []).map((item) => (
                            <tr key={item.id}>
                              <td className="whitespace-nowrap px-3.5 py-2.5 font-mono font-semibold text-indigo-700">
                                {item.product?.sku ?? `#${item.product_id}`}
                              </td>
                              <td className="px-3.5 py-2.5 font-medium text-slate-900">
                                {item.product?.name ??
                                  `Produk #${item.product_id}`}
                              </td>
                              <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-slate-800">
                                {formatNumber(item.qty_ordered)}{" "}
                                <span className="text-slate-400">
                                  {item.product?.uom ?? ""}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-slate-700">
                                {formatRupiah(item.unit_price)}
                              </td>
                              <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono font-semibold text-slate-900">
                                {formatRupiah(item.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-50">
                          <tr>
                            <td
                              colSpan={4}
                              className="px-3.5 py-3 text-right text-xs font-bold text-slate-700"
                            >
                              Grand Total
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-3 text-right font-mono text-sm font-bold text-indigo-700">
                              {formatRupiah(selectedPo.total_amount)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Modal>

          {/* Approve PO Modal */}
          <Modal
            open={Boolean(approvingPo)}
            onClose={() => setApprovingPo(null)}
            title="Approve Purchase Order"
            subtitle={
              approvingPo
                ? `Konfirmasi persetujuan untuk ${approvingPo.po_number}`
                : undefined
            }
            size="sm"
            disableClose={isApproving}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setApprovingPo(null)}
                  disabled={isApproving}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="approve-po-form"
                  disabled={isApproving}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isApproving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Setujui PO
                </button>
              </>
            }
          >
            {approvingPo && (
              <form
                id="approve-po-form"
                onSubmit={handleApproveSubmit}
                className="space-y-4"
              >
                {approveError && (
                  <AlertBanner
                    variant="error"
                    title="Approval Ditolak oleh Server"
                    message={approveError.message}
                    httpStatus={approveError.status}
                    fieldErrors={approveError.fieldErrors}
                  />
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Nomor PO</span>
                    <span className="font-mono font-bold text-slate-900">
                      {approvingPo.po_number}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-slate-500">Supplier</span>
                    <span className="font-semibold text-slate-800">
                      {approvingPo.supplier?.name ??
                        `#${approvingPo.supplier_id}`}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between border-t border-slate-200 pt-1.5">
                    <span className="text-slate-500">Total Nilai</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {formatRupiah(approvingPo.total_amount)}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="approve-notes"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Catatan Approval{" "}
                    <span className="font-normal text-slate-400">
                      (Opsional)
                    </span>
                  </label>
                  <textarea
                    id="approve-notes"
                    rows={3}
                    maxLength={500}
                    value={approveNotes}
                    onChange={(e) => setApproveNotes(e.target.value)}
                    placeholder="Tambahkan catatan persetujuan untuk audit log..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </form>
            )}
          </Modal>

          {/* Reject PO Modal */}
          <Modal
            open={Boolean(rejectingPo)}
            onClose={() => setRejectingPo(null)}
            title="Reject Purchase Order"
            subtitle={
              rejectingPo
                ? `Berikan alasan penolakan untuk ${rejectingPo.po_number}`
                : undefined
            }
            size="sm"
            disableClose={isRejecting}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setRejectingPo(null)}
                  disabled={isRejecting}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="reject-po-form"
                  disabled={isRejecting}
                  className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-50"
                >
                  {isRejecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  Tolak PO
                </button>
              </>
            }
          >
            {rejectingPo && (
              <form
                id="reject-po-form"
                onSubmit={handleRejectSubmit}
                className="space-y-4"
              >
                {rejectError && (
                  <AlertBanner
                    variant="error"
                    title="Penolakan Gagal"
                    message={rejectError.message}
                    httpStatus={rejectError.status}
                    fieldErrors={rejectError.fieldErrors}
                  />
                )}

                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-rose-700">Nomor PO</span>
                    <span className="font-mono font-bold text-rose-950">
                      {rejectingPo.po_number}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-rose-700">Total Nilai</span>
                    <span className="font-mono font-bold text-rose-950">
                      {formatRupiah(rejectingPo.total_amount)}
                    </span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reject-reason"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Alasan Penolakan <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    id="reject-reason"
                    required
                    minLength={3}
                    maxLength={500}
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Contoh: Harga satuan melebihi kontrak supplier / anggaran kuartal ini..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Minimal 3 karakter, maksimal 500 karakter. Tercatat ke audit
                    log.
                  </p>
                </div>
              </form>
            )}
          </Modal>

          {/* Direct Create PO Modal */}
          <Modal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            title="Buat Purchase Order Langsung"
            subtitle="PO yang dibuat akan otomatis masuk antrean status Pending Approval."
            size="xl"
            disableClose={isCreating}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={isCreating}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="create-po-form"
                  disabled={isCreating || loadingMasterOptions}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isCreating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-3.5 w-3.5" />
                  )}
                  Simpan Purchase Order
                </button>
              </>
            }
          >
            <form
              id="create-po-form"
              onSubmit={handleCreatePoSubmit}
              className="space-y-5"
            >
              {createError && (
                <AlertBanner
                  variant="error"
                  title="Gagal Membuat PO"
                  message={createError.message}
                  httpStatus={createError.status}
                  fieldErrors={createError.fieldErrors}
                />
              )}

              {masterOptionsError && (
                <AlertBanner
                  variant="warning"
                  title="Gagal Memuat Referensi Master Data"
                  message={masterOptionsError}
                />
              )}

              {loadingMasterOptions ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                  Memuat daftar supplier &amp; produk aktif...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="po-supplier"
                        className="mb-1.5 block text-xs font-semibold text-slate-700"
                      >
                        Supplier Aktif <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="po-supplier"
                        required
                        value={selectedSupplierId}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">-- Pilih Supplier --</option>
                        {suppliers.map((sup) => (
                          <option key={sup.id} value={sup.id}>
                            {sup.name}
                            {sup.contact_name ? ` (${sup.contact_name})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="po-number-direct"
                        className="mb-1.5 block text-xs font-semibold text-slate-700"
                      >
                        Nomor PO{" "}
                        <span className="font-normal text-slate-400">
                          (Opsional)
                        </span>
                      </label>
                      <input
                        id="po-number-direct"
                        type="text"
                        maxLength={50}
                        value={poNumberInput}
                        onChange={(e) => setPoNumberInput(e.target.value)}
                        placeholder="Otomatis: PO-YYYYMM-0001"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900">
                          Daftar Item PO <span className="text-rose-500">*</span>
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Pilih produk aktif beserta kuantitas dan harga beli
                          satuan.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddItemRow}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Tambah Item
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {itemDrafts.map((item, idx) => {
                        const rowSubtotal =
                          parseDecimal(item.qty_ordered) *
                          parseDecimal(item.unit_price);

                        return (
                          <div
                            key={item.key}
                            className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-12 sm:items-end"
                          >
                            <div className="sm:col-span-5">
                              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                                Produk #{idx + 1}
                              </label>
                              <select
                                required
                                value={item.product_id}
                                onChange={(e) =>
                                  handleUpdateItemRow(
                                    item.key,
                                    "product_id",
                                    e.target.value
                                  )
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              >
                                <option value="">-- Pilih Produk --</option>
                                {products.map((prod) => (
                                  <option key={prod.id} value={prod.id}>
                                    [{prod.sku}] {prod.name} ({prod.uom})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="sm:col-span-2">
                              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                                Qty
                              </label>
                              <input
                                type="number"
                                required
                                min="0.01"
                                step="0.01"
                                value={item.qty_ordered}
                                onChange={(e) =>
                                  handleUpdateItemRow(
                                    item.key,
                                    "qty_ordered",
                                    e.target.value
                                  )
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                            </div>

                            <div className="sm:col-span-3">
                              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                                Harga Satuan (Rp)
                              </label>
                              <input
                                type="number"
                                required
                                min="0.01"
                                step="0.01"
                                placeholder="0"
                                value={item.unit_price}
                                onChange={(e) =>
                                  handleUpdateItemRow(
                                    item.key,
                                    "unit_price",
                                    e.target.value
                                  )
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                            </div>

                            <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
                              <div className="text-right">
                                <p className="text-[10px] font-medium text-slate-400">
                                  Subtotal
                                </p>
                                <p className="font-mono text-xs font-bold text-slate-800">
                                  {formatRupiah(rowSubtotal)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveItemRow(item.key)}
                                disabled={itemDrafts.length <= 1}
                                aria-label="Hapus baris item"
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-3.5 text-white">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[11px] font-medium text-slate-400">
                          Estimasi Total Nilai Purchase Order
                        </p>
                        <p className="font-mono text-lg font-bold text-white">
                          {formatRupiah(estimatedTotal)}
                        </p>
                      </div>
                      {estimatedTotal > PO_MANAGER_APPROVAL_LIMIT && (
                        <div className="inline-flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-1.5 text-[11px] font-medium text-amber-300 ring-1 ring-inset ring-amber-400/30">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>
                            &gt; Rp10.000.000 &bull; Wajib Approval Manajer /
                            Super Admin
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </form>
          </Modal>

          {/* Soft Delete PO Confirmation */}
          <ConfirmDialog
            open={Boolean(deletingPo)}
            onClose={() => setDeletingPo(null)}
            onConfirm={handleConfirmDelete}
            title="Hapus Purchase Order"
            confirmLabel="Ya, Hapus PO"
            isLoading={isDeleting}
            errorMessage={deleteError?.message}
            errorStatus={deleteError?.status}
            description={
              deletingPo ? (
                <span>
                  Hapus Purchase Order{" "}
                  <strong className="font-mono font-semibold text-slate-900">
                    {deletingPo.po_number}
                  </strong>
                  ? Hanya PO berstatus Pending Approval atau Rejected yang dapat
                  dihapus.
                </span>
              ) : null
            }
          />
        </div>
      )}
    </DashboardShell>
  );
}
