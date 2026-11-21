"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { DoStatusBadge, SoStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRupiah,
  getTodayDateString,
  parseDecimal,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiMessageResponse,
  ApiResourceResponse,
  CancelSalesOrderPayload,
  ConfirmSalesOrderPayload,
  CreateSalesOrderPayload,
  Customer,
  PaginatedResponse,
  PaginationMeta,
  Product,
  SalesOrder,
  SalesOrderStatus,
} from "@/types/erp";

type SoStatusFilter = "all" | SalesOrderStatus;

const SO_STATUS_OPTIONS: SalesOrderStatus[] = [
  "Draft",
  "Confirmed",
  "Partially Delivered",
  "Completed",
  "Cancelled",
];

interface SoItemDraft {
  key: string;
  product_id: string;
  qty_ordered: string;
  unit_price: string;
}

function createEmptySoItem(key: string): SoItemDraft {
  return {
    key,
    product_id: "",
    qty_ordered: "1",
    unit_price: "",
  };
}

export default function SalesOrdersPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("sales_orders.view");
  const canCreate = hasPermission("sales_orders.create");
  const canUpdate = hasPermission("sales_orders.update");
  const canOverrideCreditLimit = hasPermission(
    "customers.override_credit_limit"
  );
  const canConfirm = canUpdate || canOverrideCreditLimit;
  const canViewSellingPrice = hasPermission("products.view_selling_price");

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SoStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Detail modal
  const [selectedSo, setSelectedSo] = useState<SalesOrder | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Confirm SO modal (including Credit Limit 422 & Override)
  const [confirmingSo, setConfirmingSo] = useState<SalesOrder | null>(null);
  const [overrideCreditLimit, setOverrideCreditLimit] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmError, setConfirmError] = useState<ParsedApiError | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // Cancel SO modal
  const [cancellingSo, setCancellingSo] = useState<SalesOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<ParsedApiError | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Delete SO modal
  const [deletingSo, setDeletingSo] = useState<SalesOrder | null>(null);
  const [deleteError, setDeleteError] = useState<ParsedApiError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create SO modal
  const itemKeySeqRef = useRef(1);
  const nextItemDraft = useCallback((): SoItemDraft => {
    const key = `so-item-${itemKeySeqRef.current}`;
    itemKeySeqRef.current += 1;
    return createEmptySoItem(key);
  }, []);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [soNumberInput, setSoNumberInput] = useState("");
  const [orderDateInput, setOrderDateInput] = useState("");
  const [itemDrafts, setItemDrafts] = useState<SoItemDraft[]>([
    createEmptySoItem("so-item-0"),
  ]);
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

        const res = await api.get<PaginatedResponse<SalesOrder>>(
          "/sales-orders",
          { params }
        );
        if (!cancelled) {
          setOrders(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Sales Order.")
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

  const loadMasterOptions = useCallback(async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const [custRes, prodRes] = await Promise.all([
        api.get<PaginatedResponse<Customer>>("/customers", {
          params: { status: "active", per_page: 100 },
        }),
        api.get<PaginatedResponse<Product>>("/products", {
          params: { is_active: "1", per_page: 100 },
        }),
      ]);
      setCustomers(custRes.data.data);
      setProducts(prodRes.data.data);
    } catch (error) {
      const parsed = extractApiError(
        error,
        "Gagal memuat daftar customer aktif dan produk aktif."
      );
      setOptionsError(parsed.message);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  const openDetailModal = async (so: SalesOrder) => {
    setSelectedSo(so);
    setLoadingDetail(true);
    try {
      const res = await api.get<ApiResourceResponse<SalesOrder>>(
        `/sales-orders/${so.id}`
      );
      setSelectedSo(res.data.data);
    } catch {
      // Keep list data if detail fetch fails
    } finally {
      setLoadingDetail(false);
    }
  };

  const openCreateModal = () => {
    setSelectedCustomerId("");
    setSoNumberInput("");
    setOrderDateInput(getTodayDateString());
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
    field: keyof Omit<SoItemDraft, "key">,
    value: string
  ) => {
    setItemDrafts((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  };

  const selectedCustomerObj = useMemo(
    () => customers.find((c) => String(c.id) === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

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

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    if (!selectedCustomerId) {
      setCreateError({
        message: "Silakan pilih customer aktif terlebih dahulu.",
        fieldErrors: {},
      });
      return;
    }

    const preparedItems = itemDrafts.map((row) => ({
      product_id: Number(row.product_id),
      qty_ordered: row.qty_ordered.trim(),
      unit_price: row.unit_price.trim(),
    }));

    const hasInvalid = preparedItems.some(
      (item) =>
        !item.product_id ||
        parseDecimal(item.qty_ordered) <= 0 ||
        parseDecimal(item.unit_price) <= 0
    );

    if (hasInvalid) {
      setCreateError({
        message:
          "Setiap baris item wajib memilih produk serta mengisi kuantitas (> 0) dan harga jual satuan (> 0).",
        fieldErrors: {},
      });
      return;
    }

    const payload: CreateSalesOrderPayload = {
      customer_id: Number(selectedCustomerId),
      order_date: orderDateInput || undefined,
      items: preparedItems,
    };

    if (soNumberInput.trim() !== "") {
      payload.so_number = soNumberInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<SalesOrder>>(
        "/sales-orders",
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Sales Order ${res.data.data.so_number} berhasil dibuat dengan status Draft.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(extractApiError(error, "Gagal membuat Sales Order baru."));
    } finally {
      setIsCreating(false);
    }
  };

  const openConfirmModal = (so: SalesOrder) => {
    setConfirmingSo(so);
    setOverrideCreditLimit(false);
    setOverrideReason("");
    setConfirmError(null);
  };

  const isCreditLimit422 = useMemo(() => {
    if (!confirmError || confirmError.status !== 422) {
      return false;
    }
    if (confirmError.fieldErrors.credit_limit) {
      return true;
    }
    return (
      confirmError.message.toLowerCase().includes("kredit") ||
      confirmError.message.toLowerCase().includes("credit")
    );
  }, [confirmError]);

  const handleConfirmSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!confirmingSo) {
      return;
    }

    setConfirmError(null);
    setIsConfirming(true);

    const payload: ConfirmSalesOrderPayload = {};
    if (canOverrideCreditLimit && overrideCreditLimit) {
      payload.override_credit_limit = true;
      if (overrideReason.trim() !== "") {
        payload.override_reason = overrideReason.trim();
      }
    }

    try {
      const res = await api.post<ApiResourceResponse<SalesOrder>>(
        `/sales-orders/${confirmingSo.id}/confirm`,
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Sales Order ${confirmingSo.so_number} berhasil dikonfirmasi.`
      );
      if (selectedSo?.id === confirmingSo.id) {
        setSelectedSo(res.data.data);
      }
      setConfirmingSo(null);
      triggerReload();
    } catch (error) {
      setConfirmError(
        extractApiError(error, "Gagal mengonfirmasi Sales Order.")
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const openCancelModal = (so: SalesOrder) => {
    setCancellingSo(so);
    setCancelReason("");
    setCancelError(null);
  };

  const handleCancelSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!cancellingSo) {
      return;
    }

    setCancelError(null);
    setIsCancelling(true);

    const payload: CancelSalesOrderPayload = {};
    if (cancelReason.trim() !== "") {
      payload.reason = cancelReason.trim();
    }

    try {
      const res = await api.post<ApiResourceResponse<SalesOrder>>(
        `/sales-orders/${cancellingSo.id}/cancel`,
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Sales Order ${cancellingSo.so_number} berhasil dibatalkan.`
      );
      if (selectedSo?.id === cancellingSo.id) {
        setSelectedSo(res.data.data);
      }
      setCancellingSo(null);
      triggerReload();
    } catch (error) {
      setCancelError(extractApiError(error, "Gagal membatalkan Sales Order."));
    } finally {
      setIsCancelling(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingSo) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      const res = await api.delete<ApiMessageResponse>(
        `/sales-orders/${deletingSo.id}`
      );
      setSuccessMessage(
        res.data.message ||
          `Sales Order ${deletingSo.so_number} berhasil dihapus.`
      );
      if (selectedSo?.id === deletingSo.id) {
        setSelectedSo(null);
      }
      setDeletingSo(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus Sales Order."));
    } finally {
      setIsDeleting(false);
    }
  };

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

  const showTotalAmountColumn = useMemo(() => {
    if (!canViewSellingPrice) {
      return false;
    }
    if (orders.length === 0) {
      return true;
    }
    return orders.some((row) => row.total_amount !== undefined);
  }, [canViewSellingPrice, orders]);

  const columns = useMemo<DataTableColumn<SalesOrder>[]>(() => {
    const cols: DataTableColumn<SalesOrder>[] = [
      {
        key: "so_number",
        header: "Nomor SO",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.so_number}
            </p>
            <p className="text-[11px] text-slate-400">
              Tgl: {formatDate(row.order_date)}
            </p>
          </div>
        ),
      },
      {
        key: "customer",
        header: "Customer",
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-900">
              {row.customer?.name ?? `Customer #${row.customer_id}`}
            </p>
            {row.customer?.credit_limit !== undefined && (
              <p className="font-mono text-[11px] text-slate-500">
                Limit: {formatRupiah(row.customer.credit_limit)}
              </p>
            )}
          </div>
        ),
      },
      {
        key: "salesperson",
        header: "Salesperson",
        render: (row) =>
          row.salesperson ? (
            <div>
              <p className="font-medium text-slate-800">
                {row.salesperson.name}
              </p>
              <p className="text-[11px] text-slate-400">
                {row.salesperson.email}
              </p>
            </div>
          ) : (
            <span className="text-slate-400">-</span>
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
    ];

    if (showTotalAmountColumn) {
      cols.push({
        key: "total_amount",
        header: "Total SO",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-slate-900">
            {row.total_amount !== undefined
              ? formatRupiah(row.total_amount)
              : "-"}
          </span>
        ),
      });
    }

    cols.push(
      {
        key: "status",
        header: "Status",
        align: "center",
        render: (row) => <SoStatusBadge status={row.status} />,
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
          const isDraft = row.status === "Draft";
          const canCancelRow =
            canUpdate && (row.status === "Draft" || row.status === "Confirmed");
          const canDeleteRow =
            canUpdate &&
            (row.status === "Draft" || row.status === "Cancelled");

          return (
            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => void openDetailModal(row)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Eye className="h-3.5 w-3.5" />
                Detail
              </button>

              {isDraft && canConfirm && (
                <button
                  type="button"
                  onClick={() => openConfirmModal(row)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-2xs transition-colors hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Confirm SO
                </button>
              )}

              {canCancelRow && (
                <button
                  type="button"
                  onClick={() => openCancelModal(row)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </button>
              )}

              {canDeleteRow && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingSo(row);
                  }}
                  aria-label={`Hapus SO ${row.so_number}`}
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1.5 text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        },
      }
    );

    return cols;
  }, [canConfirm, canUpdate, showTotalAmountColumn]);

  const detailShowsPrices = useMemo(() => {
    if (!selectedSo) {
      return false;
    }
    return (
      selectedSo.total_amount !== undefined ||
      Boolean(selectedSo.items?.some((i) => i.unit_price !== undefined))
    );
  }, [selectedSo]);

  return (
    <DashboardShell
      title="Sales Orders (SO)"
      subtitle="Pesanan penjualan, pengecekan otomatis Credit Limit customer, serta konfirmasi & pembatalan SO"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Sales Orders"
          requiredPermission="sales_orders.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Credit Limit Policy Banner */}
          <div className="flex flex-col gap-2 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <p className="leading-relaxed">
                <strong className="font-semibold">
                  Validasi Credit Limit (O2C):
                </strong>{" "}
                Konfirmasi SO (<strong>Draft &rarr; Confirmed</strong>) akan
                ditolak dengan <strong>HTTP 422</strong> apabila{" "}
                <em>Piutang Belum Lunas + Total SO Baru</em> melebihi{" "}
                <code className="font-mono font-semibold">credit_limit</code>{" "}
                customer, kecuali di-override oleh peran berizin{" "}
                <code className="font-mono font-semibold">
                  customers.override_credit_limit
                </code>
                .
              </p>
            </div>
            <span
              className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                canOverrideCreditLimit
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {canOverrideCreditLimit
                ? "Izin Override Credit Limit: Aktif"
                : "Izin Override: Tidak Aktif"}
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
                  placeholder="Cari nomor SO (mis. SO-2026...)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status SO"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as SoStatusFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                {SO_STATUS_OPTIONS.map((st) => (
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
                  Buat Sales Order
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
              title="Gagal memuat Sales Orders"
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
            emptyTitle="Belum ada Sales Order"
            emptyDescription="Buat Sales Order baru untuk memulai proses penjualan Order-to-Cash (O2C)."
          />

          {/* Detail SO Modal */}
          <Modal
            open={Boolean(selectedSo)}
            onClose={() => setSelectedSo(null)}
            title={
              selectedSo
                ? `Detail Sales Order ${selectedSo.so_number}`
                : "Detail Sales Order"
            }
            subtitle={
              selectedSo?.customer
                ? `Customer: ${selectedSo.customer.name}`
                : undefined
            }
            size="xl"
            footer={
              <>
                {selectedSo?.status === "Draft" && canConfirm && (
                  <button
                    type="button"
                    onClick={() => openConfirmModal(selectedSo)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Confirm SO
                  </button>
                )}
                {selectedSo &&
                  canUpdate &&
                  (selectedSo.status === "Draft" ||
                    selectedSo.status === "Confirmed") && (
                    <button
                      type="button"
                      onClick={() => openCancelModal(selectedSo)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel SO
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setSelectedSo(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Tutup
                </button>
              </>
            }
          >
            {selectedSo && (
              <div className="space-y-5">
                {loadingDetail && (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                    Memperbarui rincian relasi SO...
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Status SO
                    </p>
                    <div className="mt-1">
                      <SoStatusBadge status={selectedSo.status} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Tanggal Order
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-900">
                      {formatDate(selectedSo.order_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Customer &amp; Credit Limit
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-900">
                      {selectedSo.customer?.name ??
                        `Customer #${selectedSo.customer_id}`}
                    </p>
                    {selectedSo.customer?.credit_limit !== undefined && (
                      <p className="font-mono text-[11px] text-slate-500">
                        Limit: {formatRupiah(selectedSo.customer.credit_limit)}
                      </p>
                    )}
                  </div>
                  {detailShowsPrices && (
                    <div>
                      <p className="text-[11px] font-medium text-slate-500">
                        Total Nilai SO
                      </p>
                      <p className="mt-1 font-mono text-sm font-bold text-indigo-700">
                        {formatRupiah(selectedSo.total_amount)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Items Table */}
                <div>
                  <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Rincian Item Pesanan ({selectedSo.items?.length ?? 0})
                  </h3>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3.5 py-2.5 text-left font-semibold text-slate-500">
                              Produk
                            </th>
                            <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                              Qty Order
                            </th>
                            {detailShowsPrices && (
                              <>
                                <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                                  Harga Satuan
                                </th>
                                <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                                  Subtotal
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {(selectedSo.items ?? []).map((item) => (
                            <tr key={item.id}>
                              <td className="px-3.5 py-2.5">
                                <p className="font-semibold text-slate-900">
                                  {item.product?.name ??
                                    `Produk #${item.product_id}`}
                                </p>
                                <p className="font-mono text-[11px] text-slate-400">
                                  {item.product?.sku ?? "-"}
                                </p>
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-slate-800">
                                {formatNumber(item.qty_ordered)}{" "}
                                <span className="font-sans text-[11px] font-normal text-slate-500">
                                  {item.product?.uom ?? ""}
                                </span>
                              </td>
                              {detailShowsPrices && (
                                <>
                                  <td className="px-3.5 py-2.5 text-right font-mono text-slate-700">
                                    {formatRupiah(item.unit_price)}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900">
                                    {formatRupiah(item.line_total)}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Linked Delivery Orders */}
                {selectedSo.delivery_orders &&
                  selectedSo.delivery_orders.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                        Delivery Orders Terkait (
                        {selectedSo.delivery_orders.length})
                      </h3>
                      <div className="space-y-2">
                        {selectedSo.delivery_orders.map((doItem) => (
                          <div
                            key={doItem.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs"
                          >
                            <div>
                              <span className="font-mono font-bold text-indigo-700">
                                {doItem.do_number}
                              </span>
                              <span className="ml-2 text-slate-500">
                                Tgl Kirim: {formatDate(doItem.delivery_date)}
                              </span>
                            </div>
                            <DoStatusBadge status={doItem.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </Modal>

          {/* Create Sales Order Modal */}
          <Modal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            title="Buat Sales Order (Draft)"
            subtitle="Pilih customer aktif serta tambahkan item produk dan harga jual satuan."
            size="2xl"
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
                  form="create-so-form"
                  disabled={isCreating || loadingOptions}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isCreating && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Simpan Sales Order (Draft)
                </button>
              </>
            }
          >
            <form
              id="create-so-form"
              onSubmit={handleCreateSubmit}
              className="space-y-5"
            >
              {optionsError && (
                <AlertBanner variant="warning" message={optionsError} />
              )}

              {createError && (
                <AlertBanner
                  variant="error"
                  title="Gagal membuat Sales Order"
                  message={createError.message}
                  httpStatus={createError.status}
                  fieldErrors={createError.fieldErrors}
                />
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Customer Aktif <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    disabled={loadingOptions || isCreating}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">
                      {loadingOptions
                        ? "Memuat customer aktif..."
                        : "-- Pilih Customer --"}
                    </option>
                    {customers.map((cust) => (
                      <option key={cust.id} value={cust.id}>
                        {cust.name}
                        {cust.credit_limit !== undefined
                          ? ` (Limit: ${formatRupiah(cust.credit_limit)})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Tanggal Order
                  </label>
                  <input
                    type="date"
                    value={orderDateInput}
                    onChange={(e) => setOrderDateInput(e.target.value)}
                    disabled={isCreating}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Nomor SO{" "}
                    <span className="font-normal text-slate-400">
                      (Opsional / Auto)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={soNumberInput}
                    onChange={(e) => setSoNumberInput(e.target.value)}
                    placeholder="Kosongkan untuk auto-generate"
                    disabled={isCreating}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {selectedCustomerObj?.credit_limit !== undefined && (
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                    estimatedTotal >
                    parseDecimal(selectedCustomerObj.credit_limit)
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-sky-200 bg-sky-50 text-sky-900"
                  }`}
                >
                  <span>
                    Credit Limit <strong>{selectedCustomerObj.name}</strong>:{" "}
                    <strong className="font-mono">
                      {formatRupiah(selectedCustomerObj.credit_limit)}
                    </strong>
                  </span>
                  {estimatedTotal >
                    parseDecimal(selectedCustomerObj.credit_limit) && (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Estimasi SO melebihi credit limit (akan divalidasi saat
                      Confirm SO)
                    </span>
                  )}
                </div>
              )}

              {/* Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900">
                    Item Produk ({itemDrafts.length})
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    disabled={isCreating}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Item
                  </button>
                </div>

                <div className="space-y-2.5">
                  {itemDrafts.map((row, idx) => {
                    const lineSubtotal =
                      parseDecimal(row.qty_ordered) *
                      parseDecimal(row.unit_price);
                    return (
                      <div
                        key={row.key}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-600">
                            Item #{idx + 1}
                          </span>
                          <div className="flex items-center gap-3">
                            {lineSubtotal > 0 && (
                              <span className="font-mono text-[11px] font-semibold text-slate-700">
                                Subtotal: {formatRupiah(lineSubtotal)}
                              </span>
                            )}
                            {itemDrafts.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveItemRow(row.key)}
                                disabled={isCreating}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Hapus
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                          <div className="sm:col-span-6">
                            <label className="mb-1 block text-[11px] font-medium text-slate-600">
                              Produk Aktif *
                            </label>
                            <select
                              value={row.product_id}
                              onChange={(e) =>
                                handleUpdateItemRow(
                                  row.key,
                                  "product_id",
                                  e.target.value
                                )
                              }
                              required
                              disabled={isCreating}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            >
                              <option value="">-- Pilih Produk --</option>
                              {products.map((prod) => (
                                <option key={prod.id} value={prod.id}>
                                  {prod.sku} — {prod.name} ({prod.uom})
                                  {prod.available_qty !== undefined
                                    ? ` [Stok Avail: ${formatNumber(prod.available_qty)}]`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-[11px] font-medium text-slate-600">
                              Qty Order *
                            </label>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={row.qty_ordered}
                              onChange={(e) =>
                                handleUpdateItemRow(
                                  row.key,
                                  "qty_ordered",
                                  e.target.value
                                )
                              }
                              required
                              disabled={isCreating}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right font-mono text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                          </div>

                          <div className="sm:col-span-4">
                            <label className="mb-1 block text-[11px] font-medium text-slate-600">
                              Harga Jual Satuan (Rp) *
                            </label>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={row.unit_price}
                              onChange={(e) =>
                                handleUpdateItemRow(
                                  row.key,
                                  "unit_price",
                                  e.target.value
                                )
                              }
                              placeholder="Mis. 50000"
                              required
                              disabled={isCreating}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Grand Total */}
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-900 px-4 py-3 text-white">
                  <span className="text-xs font-medium text-slate-300">
                    Estimasi Total Sales Order
                  </span>
                  <span className="font-mono text-base font-bold">
                    {formatRupiah(estimatedTotal)}
                  </span>
                </div>
              </div>
            </form>
          </Modal>

          {/* Confirm SO Modal (with HTTP 422 Credit Limit & Override Option) */}
          <Modal
            open={Boolean(confirmingSo)}
            onClose={() => setConfirmingSo(null)}
            title="Konfirmasi Sales Order"
            subtitle={
              confirmingSo
                ? `${confirmingSo.so_number} • ${confirmingSo.customer?.name ?? ""}`
                : undefined
            }
            size="md"
            disableClose={isConfirming}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingSo(null)}
                  disabled={isConfirming}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="confirm-so-form"
                  disabled={isConfirming}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors disabled:opacity-50 ${
                    overrideCreditLimit
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {isConfirming && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {overrideCreditLimit
                    ? "Confirm SO (Override Credit Limit)"
                    : "Confirm SO Sekarang"}
                </button>
              </>
            }
          >
            {confirmingSo && (
              <form
                id="confirm-so-form"
                onSubmit={handleConfirmSubmit}
                className="space-y-4"
              >
                {confirmError && (
                  <AlertBanner
                    variant="error"
                    title={
                      isCreditLimit422
                        ? "Konfirmasi Ditolak: Melebihi Credit Limit Customer"
                        : "Gagal mengonfirmasi Sales Order"
                    }
                    message={confirmError.message}
                    httpStatus={confirmError.status}
                    fieldErrors={confirmError.fieldErrors}
                  />
                )}

                {isCreditLimit422 && !canOverrideCreditLimit && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="leading-relaxed">
                      Akun Anda tidak memiliki izin{" "}
                      <code className="font-mono font-semibold">
                        customers.override_credit_limit
                      </code>
                      . Hubungi <strong>Manajer</strong> atau{" "}
                      <strong>Super Admin</strong> untuk melakukan konfirmasi
                      dengan override credit limit, atau selesaikan piutang
                      customer terlebih dahulu.
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-500">Nomor SO</span>
                    <span className="font-mono font-bold text-indigo-700">
                      {confirmingSo.so_number}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-500">Customer</span>
                    <span className="font-semibold text-slate-900">
                      {confirmingSo.customer?.name ??
                        `Customer #${confirmingSo.customer_id}`}
                    </span>
                  </div>
                  {confirmingSo.total_amount !== undefined && (
                    <div className="flex items-center justify-between py-1">
                      <span className="text-slate-500">Total SO Baru</span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatRupiah(confirmingSo.total_amount)}
                      </span>
                    </div>
                  )}
                  {confirmingSo.customer?.credit_limit !== undefined && (
                    <div className="flex items-center justify-between py-1">
                      <span className="text-slate-500">
                        Credit Limit Customer
                      </span>
                      <span className="font-mono font-semibold text-slate-700">
                        {formatRupiah(confirmingSo.customer.credit_limit)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Override Credit Limit Section (Only for customers.override_credit_limit) */}
                {canOverrideCreditLimit && (
                  <div
                    className={`space-y-3 rounded-xl border p-3.5 transition-colors ${
                      isCreditLimit422 || overrideCreditLimit
                        ? "border-amber-300 bg-amber-50/80"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                      <input
                        type="checkbox"
                        checked={overrideCreditLimit}
                        onChange={(e) =>
                          setOverrideCreditLimit(e.target.checked)
                        }
                        disabled={isConfirming}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                      />
                      <div>
                        <span className="font-bold text-slate-900">
                          Override Credit Limit (Otorisasi Khusus)
                        </span>
                        <p className="mt-0.5 text-[11px] text-slate-600">
                          Aktifkan opsi ini untuk menyetujui konfirmasi SO meski
                          eksposur piutang melampaui batas kredit customer.
                          Tercatat di Audit Log.
                        </p>
                      </div>
                    </label>

                    {overrideCreditLimit && (
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-700">
                          Alasan Override{" "}
                          <span className="font-normal text-slate-400">
                            (Opsional, maks. 500 karakter)
                          </span>
                        </label>
                        <textarea
                          rows={2}
                          maxLength={500}
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="Mis. Persetujuan Manajer karena giro pembayaran sedang kliring..."
                          disabled={isConfirming}
                          className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        />
                      </div>
                    )}
                  </div>
                )}
              </form>
            )}
          </Modal>

          {/* Cancel SO Modal */}
          <Modal
            open={Boolean(cancellingSo)}
            onClose={() => setCancellingSo(null)}
            title="Batalkan Sales Order?"
            subtitle={
              cancellingSo
                ? `${cancellingSo.so_number} • Status saat ini: ${cancellingSo.status}`
                : undefined
            }
            size="sm"
            disableClose={isCancelling}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setCancellingSo(null)}
                  disabled={isCancelling}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Kembali
                </button>
                <button
                  type="submit"
                  form="cancel-so-form"
                  disabled={isCancelling}
                  className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-50"
                >
                  {isCancelling && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <XCircle className="h-3.5 w-3.5" />
                  Ya, Cancel SO
                </button>
              </>
            }
          >
            {cancellingSo && (
              <form
                id="cancel-so-form"
                onSubmit={handleCancelSubmit}
                className="space-y-4"
              >
                {cancelError && (
                  <AlertBanner
                    variant="error"
                    title="Gagal membatalkan SO"
                    message={cancelError.message}
                    httpStatus={cancelError.status}
                    fieldErrors={cancelError.fieldErrors}
                  />
                )}

                <p className="text-xs leading-relaxed text-slate-600">
                  Sales Order{" "}
                  <strong className="font-mono text-slate-900">
                    {cancellingSo.so_number}
                  </strong>{" "}
                  akan diubah statusnya menjadi <strong>Cancelled</strong>. SO
                  tidak dapat dibatalkan jika sudah memiliki Delivery Order atau
                  Sales Invoice aktif.
                </p>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Alasan Pembatalan{" "}
                    <span className="font-normal text-slate-400">
                      (Opsional)
                    </span>
                  </label>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Contoh: Customer meminta pembatalan atau revisi pesanan..."
                    disabled={isCancelling}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-rose-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                </div>
              </form>
            )}
          </Modal>

          {/* Delete SO Confirm Dialog */}
          <ConfirmDialog
            open={Boolean(deletingSo)}
            onClose={() => setDeletingSo(null)}
            onConfirm={handleConfirmDelete}
            title="Hapus Sales Order?"
            variant="danger"
            confirmLabel="Ya, Hapus SO"
            isLoading={isDeleting}
            errorMessage={deleteError?.message}
            errorStatus={deleteError?.status}
            description={
              deletingSo && (
                <p>
                  Sales Order{" "}
                  <strong className="font-mono text-slate-900">
                    {deletingSo.so_number}
                  </strong>{" "}
                  berstatus <strong>{deletingSo.status}</strong> akan dihapus
                  (soft-delete).
                </p>
              )
            }
          />
        </div>
      )}
    </DashboardShell>
  );
}
