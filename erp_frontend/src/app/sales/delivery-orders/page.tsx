"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  Info,
  Loader2,
  Lock,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Truck,
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
  CreateDeliveryOrderPayload,
  DeliveryOrder,
  DeliveryOrderStatus,
  PaginatedResponse,
  PaginationMeta,
  Product,
  SalesOrder,
} from "@/types/erp";

type DoStatusFilter = "all" | DeliveryOrderStatus;

const DO_STATUS_OPTIONS: DeliveryOrderStatus[] = [
  "Draft",
  "Dispatched",
  "Delivered",
  "Cancelled",
];

interface DoItemDraft {
  key: string;
  product_id: string;
  ordered_qty_hint?: string;
  qty_dispatched: string;
}

function createEmptyDoItem(key: string): DoItemDraft {
  return {
    key,
    product_id: "",
    qty_dispatched: "1",
  };
}

export default function DeliveryOrdersPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("delivery_orders.view");
  const canCreate = hasPermission("delivery_orders.create");
  const canProcess = hasPermission("delivery_orders.process");
  const canViewCost = hasPermission("inventory.view_cost");
  const canViewSo = hasPermission("sales_orders.view");
  const canViewProducts = hasPermission("products.view");

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DoStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Detail modal
  const [selectedDo, setSelectedDo] = useState<DeliveryOrder | null>(null);

  // Dispatch modal
  const [dispatchingDo, setDispatchingDo] = useState<DeliveryOrder | null>(
    null
  );
  const [dispatchError, setDispatchError] = useState<ParsedApiError | null>(
    null
  );
  const [isDispatching, setIsDispatching] = useState(false);

  // Deliver modal
  const [deliveringDo, setDeliveringDo] = useState<DeliveryOrder | null>(null);
  const [deliverError, setDeliverError] = useState<ParsedApiError | null>(null);
  const [isDelivering, setIsDelivering] = useState(false);

  // Delete modal
  const [deletingDo, setDeletingDo] = useState<DeliveryOrder | null>(null);
  const [deleteError, setDeleteError] = useState<ParsedApiError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create DO modal
  const itemKeySeqRef = useRef(1);
  const nextItemKey = useCallback(() => {
    const key = `do-item-${itemKeySeqRef.current}`;
    itemKeySeqRef.current += 1;
    return key;
  }, []);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deliverableSos, setDeliverableSos] = useState<SalesOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [selectedSoId, setSelectedSoId] = useState("");
  const [doNumberInput, setDoNumberInput] = useState("");
  const [deliveryDateInput, setDeliveryDateInput] = useState("");
  const [itemDrafts, setItemDrafts] = useState<DoItemDraft[]>([
    createEmptyDoItem("do-item-0"),
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

        const res = await api.get<PaginatedResponse<DeliveryOrder>>(
          "/delivery-orders",
          { params }
        );
        if (!cancelled) {
          setOrders(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Delivery Order.")
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

  const loadCreateOptions = useCallback(async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const tasks: Promise<void>[] = [];

      if (canViewSo) {
        tasks.push(
          Promise.all([
            api.get<PaginatedResponse<SalesOrder>>("/sales-orders", {
              params: { status: "Confirmed", per_page: 100 },
            }),
            api.get<PaginatedResponse<SalesOrder>>("/sales-orders", {
              params: { status: "Partially Delivered", per_page: 100 },
            }),
          ]).then(([confirmedRes, partialRes]) => {
            const combined = [
              ...confirmedRes.data.data,
              ...partialRes.data.data,
            ];
            const uniqueById = Array.from(
              new Map(combined.map((so) => [so.id, so])).values()
            ).sort((a, b) => b.id - a.id);
            setDeliverableSos(uniqueById);
          })
        );
      } else {
        setDeliverableSos([]);
      }

      if (canViewProducts) {
        tasks.push(
          api
            .get<PaginatedResponse<Product>>("/products", {
              params: { per_page: 100 },
            })
            .then((prodRes) => {
              setProducts(prodRes.data.data);
            })
        );
      }

      await Promise.all(tasks);
    } catch (error) {
      const parsed = extractApiError(
        error,
        "Gagal memuat daftar Sales Order atau Produk."
      );
      setOptionsError(parsed.message);
    } finally {
      setLoadingOptions(false);
    }
  }, [canViewSo, canViewProducts]);

  const selectedSoObj = useMemo(
    () =>
      deliverableSos.find((so) => String(so.id) === selectedSoId.trim()) ??
      null,
    [deliverableSos, selectedSoId]
  );

  const selectableProducts = useMemo(() => {
    if (selectedSoObj?.items && selectedSoObj.items.length > 0) {
      const map = new Map<
        number,
        { id: number; sku: string; name: string; uom: string; ordered: string }
      >();
      for (const item of selectedSoObj.items) {
        const existing = map.get(item.product_id);
        const qtyNum = parseDecimal(item.qty_ordered);
        if (existing) {
          existing.ordered = String(parseDecimal(existing.ordered) + qtyNum);
        } else {
          map.set(item.product_id, {
            id: item.product_id,
            sku: item.product?.sku ?? `PRD-${item.product_id}`,
            name: item.product?.name ?? `Produk #${item.product_id}`,
            uom: item.product?.uom ?? "pcs",
            ordered: item.qty_ordered,
          });
        }
      }
      return Array.from(map.values());
    }

    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      uom: p.uom,
      ordered: "",
    }));
  }, [selectedSoObj, products]);

  const openCreateModal = () => {
    setSelectedSoId("");
    setDoNumberInput("");
    setDeliveryDateInput(getTodayDateString());
    setItemDrafts([createEmptyDoItem(nextItemKey())]);
    setCreateError(null);
    setCreateModalOpen(true);
    void loadCreateOptions();
  };

  const handleSelectSo = (soIdValue: string) => {
    setSelectedSoId(soIdValue);
    setCreateError(null);

    const foundSo = deliverableSos.find((so) => String(so.id) === soIdValue);
    if (foundSo?.items && foundSo.items.length > 0) {
      const grouped = new Map<number, number>();
      for (const item of foundSo.items) {
        grouped.set(
          item.product_id,
          (grouped.get(item.product_id) ?? 0) + parseDecimal(item.qty_ordered)
        );
      }

      const prefilled: DoItemDraft[] = Array.from(grouped.entries()).map(
        ([productId, qty]) => ({
          key: nextItemKey(),
          product_id: String(productId),
          ordered_qty_hint: String(qty),
          qty_dispatched: String(qty),
        })
      );
      setItemDrafts(prefilled);
    } else if (!soIdValue) {
      setItemDrafts([createEmptyDoItem(nextItemKey())]);
    }
  };

  const handleAddItemRow = () => {
    setItemDrafts((prev) => [...prev, createEmptyDoItem(nextItemKey())]);
  };

  const handleRemoveItemRow = (key: string) => {
    setItemDrafts((prev) =>
      prev.length > 1 ? prev.filter((item) => item.key !== key) : prev
    );
  };

  const handleUpdateItemRow = (
    key: string,
    field: "product_id" | "qty_dispatched",
    value: string
  ) => {
    setItemDrafts((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  };

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    const parsedSoId = Number(selectedSoId.trim());
    if (!Number.isInteger(parsedSoId) || parsedSoId <= 0) {
      setCreateError({
        message: "Silakan pilih atau masukkan ID Sales Order yang valid.",
        fieldErrors: {},
      });
      return;
    }

    if (!deliveryDateInput) {
      setCreateError({
        message: "Tanggal pengiriman (delivery_date) wajib diisi.",
        fieldErrors: {},
      });
      return;
    }

    const preparedItems = itemDrafts.map((row) => ({
      product_id: Number(row.product_id),
      qty_dispatched: row.qty_dispatched.trim(),
    }));

    const hasInvalid = preparedItems.some(
      (item) => !item.product_id || parseDecimal(item.qty_dispatched) <= 0
    );

    if (hasInvalid) {
      setCreateError({
        message:
          "Setiap baris item wajib memilih produk serta mengisi kuantitas pengiriman (> 0).",
        fieldErrors: {},
      });
      return;
    }

    const payload: CreateDeliveryOrderPayload = {
      sales_order_id: parsedSoId,
      delivery_date: deliveryDateInput,
      items: preparedItems,
    };

    if (doNumberInput.trim() !== "") {
      payload.do_number = doNumberInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<DeliveryOrder>>(
        "/delivery-orders",
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Delivery Order ${res.data.data.do_number} berhasil dibuat dengan status Draft.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(error, "Gagal membuat Delivery Order baru.")
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDispatch = async () => {
    if (!dispatchingDo) {
      return;
    }

    setDispatchError(null);
    setIsDispatching(true);

    try {
      const res = await api.post<ApiResourceResponse<DeliveryOrder>>(
        `/delivery-orders/${dispatchingDo.id}/dispatch`,
        {}
      );
      setSuccessMessage(
        res.data.message ||
          `Delivery Order ${dispatchingDo.do_number} berhasil di-dispatch dengan alokasi FEFO.`
      );
      if (selectedDo?.id === dispatchingDo.id) {
        setSelectedDo(res.data.data);
      }
      setDispatchingDo(null);
      triggerReload();
    } catch (error) {
      setDispatchError(
        extractApiError(error, "Gagal melakukan dispatch Delivery Order.")
      );
    } finally {
      setIsDispatching(false);
    }
  };

  const handleConfirmDeliver = async () => {
    if (!deliveringDo) {
      return;
    }

    setDeliverError(null);
    setIsDelivering(true);

    try {
      const res = await api.post<ApiResourceResponse<DeliveryOrder>>(
        `/delivery-orders/${deliveringDo.id}/deliver`,
        {}
      );
      setSuccessMessage(
        res.data.message ||
          `Delivery Order ${deliveringDo.do_number} berhasil ditandai Delivered.`
      );
      if (selectedDo?.id === deliveringDo.id) {
        setSelectedDo(res.data.data);
      }
      setDeliveringDo(null);
      triggerReload();
    } catch (error) {
      setDeliverError(
        extractApiError(error, "Gagal memperbarui status Delivered.")
      );
    } finally {
      setIsDelivering(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingDo) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      const res = await api.delete<ApiMessageResponse>(
        `/delivery-orders/${deletingDo.id}`
      );
      setSuccessMessage(
        res.data.message ||
          `Delivery Order ${deletingDo.do_number} berhasil dihapus.`
      );
      if (selectedDo?.id === deletingDo.id) {
        setSelectedDo(null);
      }
      setDeletingDo(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus Delivery Order."));
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

  // Sembunyikan total_cogs / unit_cost / cogs_total sepenuhnya dari Admin Sales & Staf Gudang
  const showTotalCogsColumn = useMemo(() => {
    if (!canViewCost || orders.length === 0) {
      return false;
    }
    return orders.some(
      (row) => row.total_cogs !== undefined && row.total_cogs !== null
    );
  }, [canViewCost, orders]);

  const detailShowsCogs = useMemo(() => {
    if (!canViewCost || !selectedDo) {
      return false;
    }
    return (
      (selectedDo.total_cogs !== undefined && selectedDo.total_cogs !== null) ||
      Boolean(
        selectedDo.items?.some(
          (item) =>
            item.unit_cost !== undefined || item.cogs_total !== undefined
        )
      )
    );
  }, [canViewCost, selectedDo]);

  const columns = useMemo<DataTableColumn<DeliveryOrder>[]>(() => {
    const cols: DataTableColumn<DeliveryOrder>[] = [
      {
        key: "do_number",
        header: "Nomor DO",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.do_number}
            </p>
            <p className="text-[11px] text-slate-400">
              Tgl Kirim: {formatDate(row.delivery_date)}
            </p>
          </div>
        ),
      },
      {
        key: "sales_order",
        header: "Referensi SO & Customer",
        render: (row) => (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-slate-900">
                {row.sales_order?.so_number ?? `SO #${row.sales_order_id}`}
              </span>
              {row.sales_order?.status && (
                <SoStatusBadge status={row.sales_order.status} />
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.sales_order?.customer?.name ??
                (row.sales_order
                  ? `Customer #${row.sales_order.customer_id}`
                  : "-")}
            </p>
          </div>
        ),
      },
      {
        key: "items",
        header: "Alokasi Batch FEFO",
        render: (row) => {
          const items = row.items ?? [];
          return (
            <div className="space-y-0.5">
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                {items.length} baris alokasi
              </span>
              {items.slice(0, 2).map((item) => (
                <p
                  key={item.id}
                  className="max-w-xs truncate text-[11px] text-slate-500"
                >
                  {item.product?.sku ?? `#${item.product_id}`} &bull; Batch{" "}
                  <span className="font-mono font-medium text-slate-700">
                    {item.batch?.batch_number ?? "-"}
                  </span>{" "}
                  ({formatNumber(item.qty_dispatched)}{" "}
                  {item.product?.uom ?? ""})
                </p>
              ))}
              {items.length > 2 && (
                <p className="text-[10px] text-slate-400">
                  +{items.length - 2} baris lainnya
                </p>
              )}
            </div>
          );
        },
      },
    ];

    if (showTotalCogsColumn) {
      cols.push({
        key: "total_cogs",
        header: "Total HPP (COGS)",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-slate-900">
            {row.total_cogs !== undefined && row.total_cogs !== null
              ? formatRupiah(row.total_cogs)
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
        render: (row) => <DoStatusBadge status={row.status} />,
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
          const isDispatched = row.status === "Dispatched";
          const canDeleteRow =
            canCreate &&
            (row.status === "Draft" || row.status === "Cancelled");

          return (
            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedDo(row)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Eye className="h-3.5 w-3.5" />
                Detail
              </button>

              {isDraft && canProcess && (
                <button
                  type="button"
                  onClick={() => {
                    setDispatchError(null);
                    setDispatchingDo(row);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-2xs transition-colors hover:bg-indigo-700"
                >
                  <Send className="h-3.5 w-3.5" />
                  Dispatch DO
                </button>
              )}

              {isDispatched && canProcess && (
                <button
                  type="button"
                  onClick={() => {
                    setDeliverError(null);
                    setDeliveringDo(row);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-2xs transition-colors hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Mark Delivered
                </button>
              )}

              {canDeleteRow && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingDo(row);
                  }}
                  aria-label={`Hapus DO ${row.do_number}`}
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
  }, [canCreate, canProcess, showTotalCogsColumn]);

  return (
    <DashboardShell
      title="Delivery Orders (DO)"
      subtitle="Surat jalan & pengiriman barang dari Sales Order (Confirmed / Partially Delivered) dengan pemotongan stok FEFO otomatis"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Delivery Orders"
          requiredPermission="delivery_orders.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Operational Policy & RBAC Notice */}
          <div className="flex flex-col gap-2 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <p className="leading-relaxed">
                <strong className="font-semibold">
                  Auto-FEFO Dispatch &amp; Anti-Overselling:
                </strong>{" "}
                Saat <strong>Dispatch DO</strong> (Draft &rarr; Dispatched),
                sistem memotong stok available berdasarkan{" "}
                <strong>expiry_date terdekat (FEFO)</strong>, mencatat mutasi{" "}
                <strong>OUT</strong>, dan menolak dengan{" "}
                <strong>HTTP 422</strong> jika stok tidak mencukupi.
              </p>
            </div>
            {!canViewCost && (
              <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                <Lock className="h-3 w-3" />
                HPP / Unit Cost Disembunyikan
              </span>
            )}
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
                  placeholder="Cari nomor DO (mis. DO-2026...)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status DO"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as DoStatusFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                {DO_STATUS_OPTIONS.map((st) => (
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
                  Buat Delivery Order
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
              title="Gagal memuat Delivery Orders"
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
            emptyTitle="Belum ada Delivery Order"
            emptyDescription="Buat Delivery Order dari Sales Order berstatus Confirmed atau Partially Delivered untuk mengirim barang."
          />

          {/* Detail DO Modal */}
          <Modal
            open={Boolean(selectedDo)}
            onClose={() => setSelectedDo(null)}
            title={
              selectedDo
                ? `Detail Delivery Order ${selectedDo.do_number}`
                : "Detail Delivery Order"
            }
            subtitle={
              selectedDo?.sales_order
                ? `Referensi ${selectedDo.sales_order.so_number} • ${selectedDo.sales_order.customer?.name ?? ""}`
                : undefined
            }
            size="xl"
            footer={
              <>
                {selectedDo?.status === "Draft" && canProcess && (
                  <button
                    type="button"
                    onClick={() => {
                      setDispatchError(null);
                      setDispatchingDo(selectedDo);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Dispatch DO Sekarang
                  </button>
                )}
                {selectedDo?.status === "Dispatched" && canProcess && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeliverError(null);
                      setDeliveringDo(selectedDo);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Tandai Delivered
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedDo(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Tutup
                </button>
              </>
            }
          >
            {selectedDo && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Status DO
                    </p>
                    <div className="mt-1">
                      <DoStatusBadge status={selectedDo.status} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Tanggal Pengiriman
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-900">
                      {formatDate(selectedDo.delivery_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Sales Order &amp; Customer
                    </p>
                    <p className="mt-1 font-mono text-xs font-bold text-indigo-700">
                      {selectedDo.sales_order?.so_number ??
                        `SO #${selectedDo.sales_order_id}`}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {selectedDo.sales_order?.customer?.name ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {detailShowsCogs &&
                      selectedDo.total_cogs !== undefined &&
                      selectedDo.total_cogs !== null
                        ? "Total HPP (COGS)"
                        : "Status SO"}
                    </p>
                    <div className="mt-1">
                      {detailShowsCogs &&
                      selectedDo.total_cogs !== undefined &&
                      selectedDo.total_cogs !== null ? (
                        <p className="font-mono text-sm font-bold text-emerald-700">
                          {formatRupiah(selectedDo.total_cogs)}
                        </p>
                      ) : selectedDo.sales_order?.status ? (
                        <SoStatusBadge status={selectedDo.sales_order.status} />
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Daftar Item &amp; Alokasi Batch FEFO (
                    {selectedDo.items?.length ?? 0})
                  </h3>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3.5 py-2.5 text-left font-semibold text-slate-500">
                              Produk
                            </th>
                            <th className="px-3.5 py-2.5 text-left font-semibold text-slate-500">
                              Batch FEFO
                            </th>
                            <th className="px-3.5 py-2.5 text-left font-semibold text-slate-500">
                              Expiry Date
                            </th>
                            <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                              Qty Kirim
                            </th>
                            {detailShowsCogs && (
                              <>
                                <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                                  Unit Cost (HPP)
                                </th>
                                <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                                  Total COGS
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {(selectedDo.items ?? []).map((item) => (
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
                              <td className="px-3.5 py-2.5 font-mono font-semibold text-indigo-700">
                                {item.batch?.batch_number ??
                                  `Batch #${item.product_batch_id}`}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-700">
                                {formatDate(item.batch?.expiry_date)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900">
                                {formatNumber(item.qty_dispatched)}{" "}
                                <span className="font-sans text-[11px] font-normal text-slate-500">
                                  {item.product?.uom ?? ""}
                                </span>
                              </td>
                              {detailShowsCogs && (
                                <>
                                  <td className="px-3.5 py-2.5 text-right font-mono text-slate-700">
                                    {item.unit_cost !== undefined
                                      ? formatRupiah(item.unit_cost)
                                      : "-"}
                                  </td>
                                  <td className="px-3.5 py-2.5 text-right font-mono font-bold text-emerald-700">
                                    {item.cogs_total !== undefined
                                      ? formatRupiah(item.cogs_total)
                                      : "-"}
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
              </div>
            )}
          </Modal>

          {/* Create Delivery Order Modal */}
          <Modal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            title="Buat Delivery Order (Draft)"
            subtitle="Buat surat jalan dari Sales Order berstatus Confirmed atau Partially Delivered. Batch FEFO dialokasikan otomatis oleh sistem."
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
                  form="create-do-form"
                  disabled={isCreating || loadingOptions}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isCreating && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <PackageCheck className="h-3.5 w-3.5" />
                  Simpan Delivery Order (Draft)
                </button>
              </>
            }
          >
            <form
              id="create-do-form"
              onSubmit={handleCreateSubmit}
              className="space-y-5"
            >
              {optionsError && (
                <AlertBanner variant="warning" message={optionsError} />
              )}

              {createError && (
                <AlertBanner
                  variant="error"
                  title={
                    createError.status === 422
                      ? "Gagal Validasi Pengiriman / Stok Tidak Mencukupi"
                      : "Gagal membuat Delivery Order"
                  }
                  message={createError.message}
                  httpStatus={createError.status}
                  fieldErrors={createError.fieldErrors}
                />
              )}

              {!canViewSo && (
                <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <p>
                    Peran Anda tidak memiliki izin{" "}
                    <code className="font-mono font-semibold">
                      sales_orders.view
                    </code>
                    . Masukkan <strong>ID Sales Order</strong> (Confirmed /
                    Partially Delivered) secara manual sesuai instruksi tim
                    Sales, lalu pilih produk &amp; kuantitas yang dikirim.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Sales Order <span className="text-rose-500">*</span>
                  </label>
                  {canViewSo ? (
                    <select
                      value={selectedSoId}
                      onChange={(e) => handleSelectSo(e.target.value)}
                      disabled={loadingOptions || isCreating}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">
                        {loadingOptions
                          ? "Memuat SO Confirmed / Partial..."
                          : "-- Pilih Sales Order --"}
                      </option>
                      {deliverableSos.map((so) => (
                        <option key={so.id} value={so.id}>
                          {so.so_number} ({so.status}) —{" "}
                          {so.customer?.name ?? `Customer #${so.customer_id}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={selectedSoId}
                      onChange={(e) => setSelectedSoId(e.target.value)}
                      placeholder="Masukkan ID SO (mis. 1)"
                      required
                      disabled={isCreating}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Tanggal Pengiriman <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={deliveryDateInput}
                    onChange={(e) => setDeliveryDateInput(e.target.value)}
                    required
                    disabled={isCreating}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Nomor DO{" "}
                    <span className="font-normal text-slate-400">
                      (Opsional / Auto)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={doNumberInput}
                    onChange={(e) => setDoNumberInput(e.target.value)}
                    placeholder="Kosongkan untuk auto-generate"
                    disabled={isCreating}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {selectedSoObj && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-xs text-emerald-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      SO Terpilih:{" "}
                      <strong className="font-mono">
                        {selectedSoObj.so_number}
                      </strong>{" "}
                      &bull; Customer:{" "}
                      <strong>
                        {selectedSoObj.customer?.name ??
                          `#${selectedSoObj.customer_id}`}
                      </strong>
                    </span>
                    <SoStatusBadge status={selectedSoObj.status} />
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-800">
                    Anda dapat mengurangi Qty Kirim untuk melakukan{" "}
                    <strong>Partial Delivery</strong>. Alokasi batch FEFO
                    ditentukan otomatis oleh backend sesuai expiry date
                    terdekat.
                  </p>
                </div>
              )}

              {/* Items Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900">
                    Item Pengiriman ({itemDrafts.length})
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    disabled={isCreating}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Baris Item
                  </button>
                </div>

                <div className="space-y-2.5">
                  {itemDrafts.map((row, idx) => (
                    <div
                      key={row.key}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-600">
                          Item Pengiriman #{idx + 1}
                          {row.ordered_qty_hint && (
                            <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                              Qty SO: {formatNumber(row.ordered_qty_hint)}
                            </span>
                          )}
                        </span>
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

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                        <div className="sm:col-span-8">
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            Produk *
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
                            {selectableProducts.map((prod) => (
                              <option key={prod.id} value={prod.id}>
                                {prod.sku} — {prod.name} ({prod.uom})
                                {prod.ordered
                                  ? ` [SO: ${formatNumber(prod.ordered)}]`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            Qty Dikirim *
                          </label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.qty_dispatched}
                            onChange={(e) =>
                              handleUpdateItemRow(
                                row.key,
                                "qty_dispatched",
                                e.target.value
                              )
                            }
                            required
                            disabled={isCreating}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right font-mono text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </form>
          </Modal>

          {/* Dispatch DO Modal (with detailed 422 stock shortage error) */}
          <Modal
            open={Boolean(dispatchingDo)}
            onClose={() => setDispatchingDo(null)}
            title="Dispatch Delivery Order?"
            subtitle={
              dispatchingDo
                ? `${dispatchingDo.do_number} • Status: Draft → Dispatched`
                : undefined
            }
            size="md"
            disableClose={isDispatching}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setDispatchingDo(null)}
                  disabled={isDispatching}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDispatch()}
                  disabled={isDispatching}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isDispatching && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <Send className="h-3.5 w-3.5" />
                  Ya, Dispatch &amp; Potong Stok FEFO
                </button>
              </>
            }
          >
            {dispatchingDo && (
              <div className="space-y-4">
                {dispatchError && (
                  <AlertBanner
                    variant="error"
                    title={
                      dispatchError.status === 422
                        ? "Dispatch Ditolak: Stok Tidak Mencukupi / Validasi Gagal"
                        : "Gagal Dispatch Delivery Order"
                    }
                    message={dispatchError.message}
                    httpStatus={dispatchError.status}
                    fieldErrors={dispatchError.fieldErrors}
                  />
                )}

                <p className="text-xs leading-relaxed text-slate-600">
                  Anda akan melakukan dispatch untuk dokumen{" "}
                  <strong className="font-mono text-slate-900">
                    {dispatchingDo.do_number}
                  </strong>
                  . Sistem akan secara atomik:
                </p>

                <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                  <li>
                    Memotong stok <strong>available</strong> secara otomatis
                    mengikuti urutan <strong>FEFO</strong> (expiry terdekat).
                  </li>
                  <li>
                    Mencatat log mutasi keluar (<strong>OUT</strong>) di{" "}
                    <em>Stock Movements</em> yang bersifat immutable.
                  </li>
                  <li>
                    Memperbarui status Sales Order terkait menjadi{" "}
                    <strong>Partially Delivered</strong> atau{" "}
                    <strong>Completed</strong>.
                  </li>
                  <li>
                    Menolak transaksi dengan <strong>HTTP 422</strong> jika stok
                    tersedia tidak mencukupi (anti-overselling).
                  </li>
                </ul>
              </div>
            )}
          </Modal>

          {/* Mark Delivered Confirm Dialog */}
          <ConfirmDialog
            open={Boolean(deliveringDo)}
            onClose={() => setDeliveringDo(null)}
            onConfirm={handleConfirmDeliver}
            title="Tandai Delivery Order Delivered?"
            variant="primary"
            confirmLabel="Ya, Tandai Delivered"
            isLoading={isDelivering}
            errorMessage={deliverError?.message}
            errorStatus={deliverError?.status}
            description={
              deliveringDo && (
                <p>
                  Status Delivery Order{" "}
                  <strong className="font-mono text-slate-900">
                    {deliveringDo.do_number}
                  </strong>{" "}
                  akan diperbarui dari <strong>Dispatched</strong> menjadi{" "}
                  <strong>Delivered</strong> sebagai konfirmasi barang telah
                  diterima customer.
                </p>
              )
            }
          />

          {/* Delete DO Confirm Dialog */}
          <ConfirmDialog
            open={Boolean(deletingDo)}
            onClose={() => setDeletingDo(null)}
            onConfirm={handleConfirmDelete}
            title="Hapus Delivery Order?"
            variant="danger"
            confirmLabel="Ya, Hapus DO"
            isLoading={isDeleting}
            errorMessage={deleteError?.message}
            errorStatus={deleteError?.status}
            description={
              deletingDo && (
                <p>
                  Delivery Order{" "}
                  <strong className="font-mono text-slate-900">
                    {deletingDo.do_number}
                  </strong>{" "}
                  berstatus <strong>{deletingDo.status}</strong> akan dihapus
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
