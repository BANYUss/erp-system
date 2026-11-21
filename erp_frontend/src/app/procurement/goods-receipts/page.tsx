"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Info,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { GrStatusBadge, PoStatusBadge } from "@/components/ui/StatusBadge";
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
  CreateGoodsReceiptPayload,
  GoodsReceipt,
  GoodsReceiptStatus,
  PaginatedResponse,
  PaginationMeta,
  Product,
  PurchaseOrder,
} from "@/types/erp";

type GrStatusFilter = "all" | GoodsReceiptStatus;

interface GrItemDraft {
  key: string;
  product_id: string;
  ordered_qty_hint?: string;
  product_label_hint?: string;
  batch_number: string;
  expiry_date: string;
  qty_received: string;
}

const BATCH_REGEX = /^[A-Za-z0-9._-]+$/;

function createEmptyItemDraft(key: string): GrItemDraft {
  return {
    key,
    product_id: "",
    batch_number: "",
    expiry_date: "",
    qty_received: "1",
  };
}

export default function GoodsReceiptsPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("goods_receipts.view");
  const canCreate = hasPermission("goods_receipts.create");
  const canValidate = hasPermission("goods_receipts.validate");
  const canViewPo = hasPermission("purchase_orders.view");
  const canViewProducts = hasPermission("products.view");

  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<GrStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Detail modal
  const [selectedGr, setSelectedGr] = useState<GoodsReceipt | null>(null);

  // Validate modal
  const [validatingGr, setValidatingGr] = useState<GoodsReceipt | null>(null);
  const [validateError, setValidateError] = useState<ParsedApiError | null>(
    null
  );
  const [isValidating, setIsValidating] = useState(false);

  // Delete modal
  const [deletingGr, setDeletingGr] = useState<GoodsReceipt | null>(null);
  const [deleteError, setDeleteError] = useState<ParsedApiError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create GR modal
  const itemKeySeqRef = useRef(1);
  const nextItemKey = useCallback(() => {
    const key = `gr-item-${itemKeySeqRef.current}`;
    itemKeySeqRef.current += 1;
    return key;
  }, []);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [receivablePos, setReceivablePos] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [selectedPoId, setSelectedPoId] = useState("");
  const [receiptNumberInput, setReceiptNumberInput] = useState("");
  const [receivedDateInput, setReceivedDateInput] = useState("");
  const [itemDrafts, setItemDrafts] = useState<GrItemDraft[]>([
    createEmptyItemDraft("gr-item-0"),
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

    const loadReceipts = async () => {
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

        const res = await api.get<PaginatedResponse<GoodsReceipt>>(
          "/goods-receipts",
          { params }
        );
        if (!cancelled) {
          setReceipts(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Goods Receipt.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadReceipts();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, page, appliedSearch, statusFilter, reloadTick]);

  const loadCreateOptions = useCallback(async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const promises: Promise<void>[] = [];

      if (canViewPo) {
        promises.push(
          Promise.all([
            api.get<PaginatedResponse<PurchaseOrder>>("/purchase-orders", {
              params: { status: "Approved", per_page: 100 },
            }),
            api.get<PaginatedResponse<PurchaseOrder>>("/purchase-orders", {
              params: { status: "Partially Received", per_page: 100 },
            }),
          ]).then(([approvedRes, partialRes]) => {
            const combined = [...approvedRes.data.data, ...partialRes.data.data];
            const uniqueById = Array.from(
              new Map(combined.map((po) => [po.id, po])).values()
            ).sort((a, b) => b.id - a.id);
            setReceivablePos(uniqueById);
          })
        );
      } else {
        setReceivablePos([]);
      }

      if (canViewProducts) {
        promises.push(
          api
            .get<PaginatedResponse<Product>>("/products", {
              params: { per_page: 100 },
            })
            .then((prodRes) => {
              setProducts(prodRes.data.data);
            })
        );
      }

      await Promise.all(promises);
    } catch (error) {
      const parsed = extractApiError(
        error,
        "Gagal memuat data Purchase Order atau Produk."
      );
      setOptionsError(parsed.message);
    } finally {
      setLoadingOptions(false);
    }
  }, [canViewPo, canViewProducts]);

  const selectedPoObject = useMemo(
    () =>
      receivablePos.find((po) => String(po.id) === selectedPoId.trim()) ?? null,
    [receivablePos, selectedPoId]
  );

  // Products available for item rows: if PO is selected, restrict to PO's products; otherwise all products
  const selectableProducts = useMemo(() => {
    if (selectedPoObject?.items && selectedPoObject.items.length > 0) {
      const map = new Map<
        number,
        { id: number; sku: string; name: string; uom: string; ordered: string }
      >();
      for (const item of selectedPoObject.items) {
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
  }, [selectedPoObject, products]);

  const openCreateModal = () => {
    setSelectedPoId("");
    setReceiptNumberInput("");
    setReceivedDateInput(getTodayDateString());
    setItemDrafts([createEmptyItemDraft(nextItemKey())]);
    setCreateError(null);
    setCreateModalOpen(true);
    void loadCreateOptions();
  };

  const handleSelectPo = (poIdValue: string) => {
    setSelectedPoId(poIdValue);
    setCreateError(null);

    const foundPo = receivablePos.find((po) => String(po.id) === poIdValue);
    if (foundPo?.items && foundPo.items.length > 0) {
      // Aggregate PO items by product_id to prefill rows cleanly (supports partial receipt editing)
      const grouped = new Map<
        number,
        { qty: number; label: string }
      >();
      for (const poItem of foundPo.items) {
        const prev = grouped.get(poItem.product_id);
        const label = poItem.product
          ? `${poItem.product.sku} — ${poItem.product.name} (${poItem.product.uom})`
          : `Produk #${poItem.product_id}`;
        if (prev) {
          prev.qty += parseDecimal(poItem.qty_ordered);
        } else {
          grouped.set(poItem.product_id, {
            qty: parseDecimal(poItem.qty_ordered),
            label,
          });
        }
      }

      const prefilled: GrItemDraft[] = Array.from(grouped.entries()).map(
        ([productId, info]) => ({
          key: nextItemKey(),
          product_id: String(productId),
          ordered_qty_hint: String(info.qty),
          product_label_hint: info.label,
          batch_number: "",
          expiry_date: "",
          qty_received: String(info.qty),
        })
      );
      setItemDrafts(prefilled);
    } else if (!poIdValue) {
      setItemDrafts([createEmptyItemDraft(nextItemKey())]);
    }
  };

  const handleAddItemRow = () => {
    setItemDrafts((prev) => [...prev, createEmptyItemDraft(nextItemKey())]);
  };

  const handleRemoveItemRow = (key: string) => {
    setItemDrafts((prev) =>
      prev.length > 1 ? prev.filter((item) => item.key !== key) : prev
    );
  };

  const handleUpdateItemRow = (
    key: string,
    field: "product_id" | "batch_number" | "expiry_date" | "qty_received",
    value: string
  ) => {
    setItemDrafts((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  };

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    const parsedPoId = Number(selectedPoId.trim());
    if (!Number.isInteger(parsedPoId) || parsedPoId <= 0) {
      setCreateError({
        message: "Silakan pilih atau masukkan ID Purchase Order yang valid.",
        fieldErrors: {},
      });
      return;
    }

    if (!receivedDateInput) {
      setCreateError({
        message: "Tanggal penerimaan barang (received_date) wajib diisi.",
        fieldErrors: {},
      });
      return;
    }

    const preparedItems = itemDrafts.map((row) => ({
      product_id: Number(row.product_id),
      batch_number: row.batch_number.trim(),
      expiry_date: row.expiry_date.trim(),
      qty_received: row.qty_received.trim(),
    }));

    for (let i = 0; i < preparedItems.length; i += 1) {
      const item = preparedItems[i];
      const rowNum = i + 1;
      if (!item.product_id) {
        setCreateError({
          message: `Baris #${rowNum}: Produk wajib dipilih.`,
          fieldErrors: {},
        });
        return;
      }
      if (!item.batch_number || !BATCH_REGEX.test(item.batch_number)) {
        setCreateError({
          message: `Baris #${rowNum}: Batch number wajib diisi (hanya huruf, angka, titik, underscore, atau strip tanpa spasi).`,
          fieldErrors: {},
        });
        return;
      }
      if (!item.expiry_date) {
        setCreateError({
          message: `Baris #${rowNum}: Tanggal kedaluwarsa (expiry_date) wajib diisi.`,
          fieldErrors: {},
        });
        return;
      }
      if (item.expiry_date < receivedDateInput) {
        setCreateError({
          message: `Baris #${rowNum}: Tanggal kedaluwarsa harus sama atau setelah tanggal penerimaan (${receivedDateInput}).`,
          fieldErrors: {},
        });
        return;
      }
      if (parseDecimal(item.qty_received) <= 0) {
        setCreateError({
          message: `Baris #${rowNum}: Kuantitas diterima harus lebih dari 0.`,
          fieldErrors: {},
        });
        return;
      }
    }

    const payload: CreateGoodsReceiptPayload = {
      po_id: parsedPoId,
      received_date: receivedDateInput,
      items: preparedItems,
    };

    if (receiptNumberInput.trim() !== "") {
      payload.receipt_number = receiptNumberInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<GoodsReceipt>>(
        "/goods-receipts",
        payload
      );
      setSuccessMessage(
        res.data.message ||
          `Goods Receipt ${res.data.data.receipt_number} berhasil dibuat dengan status Draft.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(error, "Gagal membuat Goods Receipt baru.")
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmValidate = async () => {
    if (!validatingGr) {
      return;
    }

    setValidateError(null);
    setIsValidating(true);

    try {
      const res = await api.post<ApiResourceResponse<GoodsReceipt>>(
        `/goods-receipts/${validatingGr.id}/validate`,
        {}
      );
      setSuccessMessage(
        res.data.message ||
          `Goods Receipt ${validatingGr.receipt_number} berhasil divalidasi dan stok diperbarui.`
      );
      if (selectedGr?.id === validatingGr.id) {
        setSelectedGr(res.data.data);
      }
      setValidatingGr(null);
      triggerReload();
    } catch (error) {
      setValidateError(
        extractApiError(error, "Gagal memvalidasi Goods Receipt.")
      );
    } finally {
      setIsValidating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingGr) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      const res = await api.delete<ApiMessageResponse>(
        `/goods-receipts/${deletingGr.id}`
      );
      setSuccessMessage(
        res.data.message ||
          `Goods Receipt ${deletingGr.receipt_number} berhasil dihapus.`
      );
      if (selectedGr?.id === deletingGr.id) {
        setSelectedGr(null);
      }
      setDeletingGr(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus Goods Receipt."));
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

  const columns = useMemo<DataTableColumn<GoodsReceipt>[]>(
    () => [
      {
        key: "receipt_number",
        header: "Nomor GR",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.receipt_number}
            </p>
            <p className="text-[11px] text-slate-400">
              Diterima: {formatDate(row.received_date)}
            </p>
          </div>
        ),
      },
      {
        key: "purchase_order",
        header: "Referensi PO & Supplier",
        render: (row) => (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-slate-900">
                {row.purchase_order?.po_number ?? `PO #${row.po_id}`}
              </span>
              {row.purchase_order?.status && (
                <PoStatusBadge status={row.purchase_order.status} />
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.purchase_order?.supplier?.name ??
                (row.purchase_order
                  ? `Supplier #${row.purchase_order.supplier_id}`
                  : "-")}
            </p>
          </div>
        ),
      },
      {
        key: "items",
        header: "Rincian Batch",
        render: (row) => {
          const items = row.items ?? [];
          return (
            <div className="space-y-0.5">
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                {items.length} baris batch
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
                  ({formatNumber(item.qty_received)} {item.product?.uom ?? ""})
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
      {
        key: "status",
        header: "Status",
        align: "center",
        render: (row) => <GrStatusBadge status={row.status} />,
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
          return (
            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedGr(row)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Eye className="h-3.5 w-3.5" />
                Detail
              </button>

              {isDraft && canValidate && (
                <button
                  type="button"
                  onClick={() => {
                    setValidateError(null);
                    setValidatingGr(row);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-2xs transition-colors hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Validate GR
                </button>
              )}

              {isDraft && canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingGr(row);
                  }}
                  aria-label={`Hapus GR ${row.receipt_number}`}
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
    [canCreate, canValidate]
  );

  const selectedGrShowsCost = useMemo(() => {
    if (!selectedGr?.items) {
      return false;
    }
    return selectedGr.items.some((item) => item.cost_price !== undefined);
  }, [selectedGr]);

  return (
    <DashboardShell
      title="Goods Receipts (GR)"
      subtitle="Penerimaan fisik barang dari Purchase Order (Approved / Partially Received) dengan pencatatan Batch & Expiry Date"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Goods Receipts"
          requiredPermission="goods_receipts.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Info Banner */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950">
            <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
            <p className="leading-relaxed">
              <strong className="font-semibold">
                Alur Penerimaan &amp; Validasi Gudang:
              </strong>{" "}
              Buat GR berstatus <strong>Draft</strong> dari PO berstatus{" "}
              <code className="font-mono font-semibold">Approved</code> atau{" "}
              <code className="font-mono font-semibold">
                Partially Received
              </code>{" "}
              dengan wajib mengisi <strong>Batch Number</strong> &amp;{" "}
              <strong>Expiry Date</strong>. Klik <strong>Validate GR</strong>{" "}
              untuk menambahkan stok ke Inventory Ledger, menghitung ulang HPP
              MWA, mencatat Stock Movement <strong>IN</strong>, dan memperbarui
              status PO secara otomatis.
            </p>
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
                  placeholder="Cari nomor GR (mis. GR-2026...)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status GR"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as GrStatusFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                <option value="Draft">Draft</option>
                <option value="Validated">Validated</option>
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
                  Buat Goods Receipt
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
              title="Gagal memuat Goods Receipts"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={receipts}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada dokumen Goods Receipt"
            emptyDescription="Buat Goods Receipt dari Purchase Order berstatus Approved atau Partially Received untuk menerima stok ke gudang."
          />

          {/* Detail Modal */}
          <Modal
            open={Boolean(selectedGr)}
            onClose={() => setSelectedGr(null)}
            title={
              selectedGr
                ? `Detail Goods Receipt ${selectedGr.receipt_number}`
                : "Detail Goods Receipt"
            }
            subtitle={
              selectedGr?.purchase_order
                ? `Referensi ${selectedGr.purchase_order.po_number} • ${selectedGr.purchase_order.supplier?.name ?? ""}`
                : undefined
            }
            size="xl"
            footer={
              <>
                {selectedGr?.status === "Draft" && canValidate && (
                  <button
                    type="button"
                    onClick={() => {
                      setValidateError(null);
                      setValidatingGr(selectedGr);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Validate GR Sekarang
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedGr(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Tutup
                </button>
              </>
            }
          >
            {selectedGr && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Status GR
                    </p>
                    <div className="mt-1">
                      <GrStatusBadge status={selectedGr.status} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Tanggal Penerimaan
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-900">
                      {formatDate(selectedGr.received_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      Nomor PO
                    </p>
                    <p className="mt-1 font-mono text-xs font-bold text-indigo-700">
                      {selectedGr.purchase_order?.po_number ??
                        `PO #${selectedGr.po_id}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {selectedGr.purchase_order?.total_amount !== undefined
                        ? "Total Nilai PO"
                        : "Status PO"}
                    </p>
                    <div className="mt-1">
                      {selectedGr.purchase_order?.total_amount !== undefined ? (
                        <p className="font-mono text-xs font-bold text-slate-900">
                          {formatRupiah(selectedGr.purchase_order.total_amount)}
                        </p>
                      ) : selectedGr.purchase_order?.status ? (
                        <PoStatusBadge
                          status={selectedGr.purchase_order.status}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Daftar Item &amp; Batch Diterima (
                    {selectedGr.items?.length ?? 0})
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
                              Batch Number
                            </th>
                            <th className="px-3.5 py-2.5 text-left font-semibold text-slate-500">
                              Expiry Date
                            </th>
                            <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                              Qty Diterima
                            </th>
                            {selectedGrShowsCost && (
                              <th className="px-3.5 py-2.5 text-right font-semibold text-slate-500">
                                HPP MWA (Cost Price)
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {(selectedGr.items ?? []).map((item) => (
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
                              <td className="px-3.5 py-2.5 font-mono font-semibold text-slate-800">
                                {item.batch?.batch_number ??
                                  `Batch #${item.product_batch_id}`}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-700">
                                {formatDate(item.batch?.expiry_date)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-mono font-bold text-slate-900">
                                {formatNumber(item.qty_received)}{" "}
                                <span className="font-sans text-[11px] font-normal text-slate-500">
                                  {item.product?.uom ?? ""}
                                </span>
                              </td>
                              {selectedGrShowsCost && (
                                <td className="px-3.5 py-2.5 text-right font-mono text-slate-800">
                                  {item.cost_price !== null &&
                                  item.cost_price !== undefined
                                    ? formatRupiah(item.cost_price)
                                    : "-"}
                                </td>
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

          {/* Create Goods Receipt Modal */}
          <Modal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            title="Buat Goods Receipt (Draft)"
            subtitle="Terima barang fisik dari PO berstatus Approved atau Partially Received. Mendukung partial receipt & multi-batch."
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
                  form="create-gr-form"
                  disabled={isCreating || loadingOptions}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isCreating && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Simpan GR (Draft)
                </button>
              </>
            }
          >
            <form
              id="create-gr-form"
              onSubmit={handleCreateSubmit}
              className="space-y-5"
            >
              {optionsError && (
                <AlertBanner variant="warning" message={optionsError} />
              )}

              {createError && (
                <AlertBanner
                  variant="error"
                  title="Gagal menyimpan Goods Receipt"
                  message={createError.message}
                  httpStatus={createError.status}
                  fieldErrors={createError.fieldErrors}
                />
              )}

              {!canViewPo && (
                <div className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <p>
                    Peran Anda tidak memiliki izin{" "}
                    <code className="font-mono font-semibold">
                      purchase_orders.view
                    </code>
                    . Masukkan <strong>ID Purchase Order</strong> secara manual
                    sesuai dokumen surat jalan/PO dari tim Purchasing, lalu
                    pilih produk dan input batch yang diterima.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Purchase Order <span className="text-rose-500">*</span>
                  </label>
                  {canViewPo ? (
                    <select
                      value={selectedPoId}
                      onChange={(e) => handleSelectPo(e.target.value)}
                      disabled={loadingOptions || isCreating}
                      required
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">
                        {loadingOptions
                          ? "Memuat PO Approved / Partial..."
                          : "-- Pilih Purchase Order --"}
                      </option>
                      {receivablePos.map((po) => (
                        <option key={po.id} value={po.id}>
                          {po.po_number} ({po.status}) —{" "}
                          {po.supplier?.name ?? `Supplier #${po.supplier_id}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={selectedPoId}
                      onChange={(e) => setSelectedPoId(e.target.value)}
                      placeholder="Masukkan ID PO (mis. 1)"
                      required
                      disabled={isCreating}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Tanggal Penerimaan <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={receivedDateInput}
                    onChange={(e) => setReceivedDateInput(e.target.value)}
                    required
                    disabled={isCreating}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Nomor GR{" "}
                    <span className="font-normal text-slate-400">
                      (Opsional / Auto)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={receiptNumberInput}
                    onChange={(e) => setReceiptNumberInput(e.target.value)}
                    placeholder="Kosongkan untuk auto-generate"
                    disabled={isCreating}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {selectedPoObject && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-xs text-emerald-900">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      PO Terpilih:{" "}
                      <strong className="font-mono">
                        {selectedPoObject.po_number}
                      </strong>{" "}
                      &bull; Supplier:{" "}
                      <strong>
                        {selectedPoObject.supplier?.name ??
                          `#${selectedPoObject.supplier_id}`}
                      </strong>
                    </span>
                    <PoStatusBadge status={selectedPoObject.status} />
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-800">
                    Anda dapat mengurangi Qty Diterima atau menghapus baris item
                    yang belum dikirim untuk melakukan{" "}
                    <strong>Partial Receipt</strong>, atau menambah baris untuk
                    memecah penerimaan ke beberapa batch berbeda.
                  </p>
                </div>
              )}

              {/* Items Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      Item &amp; Batch Diterima ({itemDrafts.length})
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Wajib isi <code>batch_number</code> (tanpa spasi) dan{" "}
                      <code>expiry_date</code> (&ge; tanggal terima) per item.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    disabled={isCreating}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Baris / Split Batch
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
                          Baris Item #{idx + 1}
                          {row.ordered_qty_hint && (
                            <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                              Qty PO: {formatNumber(row.ordered_qty_hint)}
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
                        <div className="sm:col-span-4">
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
                                  ? ` [PO: ${formatNumber(prod.ordered)}]`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            Batch Number *
                          </label>
                          <input
                            type="text"
                            value={row.batch_number}
                            onChange={(e) =>
                              handleUpdateItemRow(
                                row.key,
                                "batch_number",
                                e.target.value
                              )
                            }
                            placeholder="Mis. BATCH-2026-01"
                            required
                            disabled={isCreating}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            Expiry Date *
                          </label>
                          <input
                            type="date"
                            min={receivedDateInput}
                            value={row.expiry_date}
                            onChange={(e) =>
                              handleUpdateItemRow(
                                row.key,
                                "expiry_date",
                                e.target.value
                              )
                            }
                            required
                            disabled={isCreating}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-[11px] font-medium text-slate-600">
                            Qty Terima *
                          </label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.qty_received}
                            onChange={(e) =>
                              handleUpdateItemRow(
                                row.key,
                                "qty_received",
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

          {/* Validate GR Confirmation Dialog */}
          <ConfirmDialog
            open={Boolean(validatingGr)}
            onClose={() => setValidatingGr(null)}
            onConfirm={handleConfirmValidate}
            title="Validasi Goods Receipt?"
            variant="primary"
            confirmLabel="Ya, Validate GR"
            isLoading={isValidating}
            errorMessage={validateError?.message}
            errorStatus={validateError?.status}
            description={
              validatingGr && (
                <div className="space-y-2">
                  <p>
                    Anda akan memvalidasi dokumen{" "}
                    <strong className="font-mono text-slate-900">
                      {validatingGr.receipt_number}
                    </strong>{" "}
                    (status <strong>Draft &rarr; Validated</strong>).
                  </p>
                  <p className="text-xs text-slate-500">
                    Tindakan ini akan menambahkan stok ke{" "}
                    <strong>Inventory Ledger (available)</strong>, menghitung
                    ulang HPP MWA, mencatat mutasi stok <strong>IN</strong> yang
                    immutable, dan memperbarui status PO terkait. Dokumen GR
                    yang sudah divalidasi tidak dapat diubah atau dihapus.
                  </p>
                </div>
              )
            }
          />

          {/* Delete GR Confirmation Dialog */}
          <ConfirmDialog
            open={Boolean(deletingGr)}
            onClose={() => setDeletingGr(null)}
            onConfirm={handleConfirmDelete}
            title="Hapus Draft Goods Receipt?"
            variant="danger"
            confirmLabel="Ya, Hapus GR"
            isLoading={isDeleting}
            errorMessage={deleteError?.message}
            errorStatus={deleteError?.status}
            description={
              deletingGr && (
                <p>
                  Dokumen Draft{" "}
                  <strong className="font-mono text-slate-900">
                    {deletingGr.receipt_number}
                  </strong>{" "}
                  akan dihapus (soft-delete). Hanya GR berstatus Draft yang
                  dapat dihapus.
                </p>
              )
            }
          />
        </div>
      )}
    </DashboardShell>
  );
}
