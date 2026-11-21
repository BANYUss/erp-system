"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  ExternalLink,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { PoStatusBadge, PrStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDateTime,
  formatRupiah,
  parseDecimal,
  PO_MANAGER_APPROVAL_LIMIT,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiResourceResponse,
  ConvertPrToPoPayload,
  CreatePurchaseRequisitionPayload,
  PaginatedResponse,
  PaginationMeta,
  Product,
  PurchaseOrder,
  PurchaseRequisition,
  PurchaseRequisitionStatus,
  Supplier,
} from "@/types/erp";

type PrStatusFilter = "all" | PurchaseRequisitionStatus;

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

export default function PurchaseRequisitionsPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("purchase_requisitions.view");
  const canCreate = hasPermission("purchase_requisitions.create");
  const canSubmit = hasPermission("purchase_requisitions.submit");
  const canCreatePo = hasPermission("purchase_orders.create");

  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [createdPoNumber, setCreatedPoNumber] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PrStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Create PR Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [prNumberInput, setPrNumberInput] = useState("");
  const [prStatusInput, setPrStatusInput] = useState<"Draft" | "Submitted">(
    "Draft"
  );
  const [createError, setCreateError] = useState<ParsedApiError | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Submit PR Confirmation
  const [submittingPr, setSubmittingPr] = useState<PurchaseRequisition | null>(
    null
  );
  const [submitPrError, setSubmitPrError] = useState<ParsedApiError | null>(
    null
  );
  const [isSubmittingPr, setIsSubmittingPr] = useState(false);

  // Convert to PO Modal
  const itemKeySeqRef = useRef(1);
  const nextItemDraft = useCallback((): PoItemDraft => {
    const key = `pr-item-${itemKeySeqRef.current}`;
    itemKeySeqRef.current += 1;
    return createEmptyItemDraft(key);
  }, []);

  const [convertingPr, setConvertingPr] = useState<PurchaseRequisition | null>(
    null
  );
  const [poNumberInput, setPoNumberInput] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [itemDrafts, setItemDrafts] = useState<PoItemDraft[]>([
    createEmptyItemDraft("pr-item-0"),
  ]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingMasterOptions, setLoadingMasterOptions] = useState(false);
  const [masterOptionsError, setMasterOptionsError] = useState<string | null>(
    null
  );
  const [convertError, setConvertError] = useState<ParsedApiError | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const triggerReload = useCallback(() => {
    setReloadTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    const loadRequisitions = async () => {
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

        const response = await api.get<PaginatedResponse<PurchaseRequisition>>(
          "/purchase-requisitions",
          { params }
        );
        if (!cancelled) {
          setRequisitions(response.data.data);
          setMeta(response.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Purchase Requisition.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadRequisitions();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, page, appliedSearch, statusFilter, reloadTick]);

  const loadMasterOptionsForConvert = useCallback(async () => {
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

  const openCreateModal = () => {
    setPrNumberInput("");
    setPrStatusInput("Draft");
    setCreateError(null);
    setCreateModalOpen(true);
  };

  const handleCreatePr = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    const payload: CreatePurchaseRequisitionPayload = {
      status: canSubmit ? prStatusInput : "Draft",
    };
    if (prNumberInput.trim() !== "") {
      payload.pr_number = prNumberInput.trim();
    }

    try {
      const res = await api.post<ApiResourceResponse<PurchaseRequisition>>(
        "/purchase-requisitions",
        payload
      );
      setCreatedPoNumber(null);
      setSuccessMessage(
        res.data.message ||
          `Purchase Requisition ${res.data.data.pr_number} berhasil dibuat.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(error, "Gagal membuat Purchase Requisition.")
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmSubmitPr = async () => {
    if (!submittingPr) {
      return;
    }

    setSubmitPrError(null);
    setIsSubmittingPr(true);

    try {
      const res = await api.post<ApiResourceResponse<PurchaseRequisition>>(
        `/purchase-requisitions/${submittingPr.id}/submit`
      );
      setCreatedPoNumber(null);
      setSuccessMessage(
        res.data.message ||
          `PR ${submittingPr.pr_number} berhasil disubmit (Draft → Submitted).`
      );
      setSubmittingPr(null);
      triggerReload();
    } catch (error) {
      setSubmitPrError(
        extractApiError(error, "Gagal melakukan submit Purchase Requisition.")
      );
    } finally {
      setIsSubmittingPr(false);
    }
  };

  const openConvertModal = useCallback(
    (pr: PurchaseRequisition) => {
      setConvertingPr(pr);
      setPoNumberInput("");
      setSelectedSupplierId("");
      setItemDrafts([nextItemDraft()]);
      setConvertError(null);
      void loadMasterOptionsForConvert();
    },
    [loadMasterOptionsForConvert, nextItemDraft]
  );

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

  const handleConvertToPo = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!convertingPr) {
      return;
    }

    setConvertError(null);

    if (!selectedSupplierId) {
      setConvertError({
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
      setConvertError({
        message:
          "Setiap baris item wajib memilih produk serta mengisi kuantitas (> 0) dan harga satuan (> 0).",
        fieldErrors: {},
      });
      return;
    }

    const payload: ConvertPrToPoPayload = {
      supplier_id: Number(selectedSupplierId),
      items: preparedItems,
    };

    if (poNumberInput.trim() !== "") {
      payload.po_number = poNumberInput.trim();
    }

    setIsConverting(true);

    try {
      const res = await api.post<ApiResourceResponse<PurchaseOrder>>(
        `/purchase-requisitions/${convertingPr.id}/convert-to-po`,
        payload
      );
      const poNum = res.data.data.po_number;
      setCreatedPoNumber(poNum);
      setSuccessMessage(
        res.data.message ||
          `PR ${convertingPr.pr_number} berhasil dikonversi menjadi PO ${poNum}.`
      );
      setConvertingPr(null);
      triggerReload();
    } catch (error) {
      setConvertError(
        extractApiError(
          error,
          "Gagal mengonversi Purchase Requisition menjadi Purchase Order."
        )
      );
    } finally {
      setIsConverting(false);
    }
  };

  const columns = useMemo<DataTableColumn<PurchaseRequisition>[]>(
    () => [
      {
        key: "pr_number",
        header: "Nomor PR",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.pr_number}
            </p>
            <p className="text-[11px] text-slate-400">PR #{row.id}</p>
          </div>
        ),
      },
      {
        key: "requestor",
        header: "Requestor",
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-800">
              {row.requestor?.name ?? `User #${row.requestor_id}`}
            </p>
            {row.requestor?.email && (
              <p className="text-[11px] text-slate-400">{row.requestor.email}</p>
            )}
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        align: "center",
        render: (row) => <PrStatusBadge status={row.status} />,
      },
      {
        key: "purchase_orders",
        header: "PO Terkait",
        render: (row) =>
          row.purchase_orders && row.purchase_orders.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {row.purchase_orders.map((po) => (
                <div
                  key={po.id}
                  className="flex flex-wrap items-center gap-1.5 text-[11px]"
                >
                  <Link
                    href="/procurement/purchase-orders"
                    className="inline-flex items-center gap-1 font-mono font-semibold text-indigo-600 hover:underline"
                  >
                    {po.po_number}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  <PoStatusBadge status={po.status} />
                  <span className="font-mono text-slate-500">
                    ({formatRupiah(po.total_amount)})
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-slate-400">Belum dikonversi</span>
          ),
      },
      {
        key: "created_at",
        header: "Dibuat Pada",
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
        render: (row) => (
          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {row.status === "Draft" && canSubmit && (
              <button
                type="button"
                onClick={() => {
                  setSubmitPrError(null);
                  setSubmittingPr(row);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-2xs transition-colors hover:bg-sky-700"
              >
                <Send className="h-3.5 w-3.5" />
                Submit PR
              </button>
            )}

            {row.status === "Submitted" && canCreatePo && (
              <button
                type="button"
                onClick={() => openConvertModal(row)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-2xs transition-colors hover:bg-indigo-700"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Convert to PO
              </button>
            )}

            {row.status === "Converted" && (
              <Link
                href="/procurement/purchase-orders"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                Lihat PO
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}

            {((row.status === "Draft" && !canSubmit) ||
              (row.status === "Submitted" && !canCreatePo)) && (
              <span className="text-[11px] text-slate-400">Tidak ada aksi</span>
            )}
          </div>
        ),
      },
    ],
    [canSubmit, canCreatePo, openConvertModal]
  );

  return (
    <DashboardShell
      title="Purchase Requisitions (PR)"
      subtitle="Pengajuan permintaan pembelian (Draft → Submitted) dan konversi menjadi Purchase Order"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Purchase Requisitions"
          requiredPermission="purchase_requisitions.view"
        />
      ) : (
        <div className="space-y-5">
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
                  placeholder="Cari nomor PR (mis. PR-2026...)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status PR"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as PrStatusFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                <option value="Draft">Draft</option>
                <option value="Submitted">Submitted</option>
                <option value="Converted">Converted</option>
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
                  Buat PR Baru
                </button>
              )}
            </div>
          </div>

          {successMessage && (
            <div className="space-y-2">
              <AlertBanner
                variant="success"
                message={successMessage}
                onDismiss={() => {
                  setSuccessMessage(null);
                  setCreatedPoNumber(null);
                }}
              />
              {createdPoNumber && (
                <div className="flex justify-end">
                  <Link
                    href="/procurement/purchase-orders"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline"
                  >
                    Buka halaman Purchase Orders untuk meninjau{" "}
                    <span className="font-mono">{createdPoNumber}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </div>
          )}

          {pageError && (
            <AlertBanner
              variant="error"
              title="Gagal Memuat Purchase Requisition"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={requisitions}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada Purchase Requisition"
            emptyDescription="Buat PR baru untuk memulai proses pengadaan barang (Procure-to-Pay)."
          />

          {/* Create PR Modal */}
          <Modal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            title="Buat Purchase Requisition Baru"
            subtitle="Nomor PR akan di-generate otomatis oleh sistem jika dikosongkan."
            size="sm"
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
                  form="create-pr-form"
                  disabled={isCreating}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isCreating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FilePlus2 className="h-3.5 w-3.5" />
                  )}
                  Buat PR
                </button>
              </>
            }
          >
            <form
              id="create-pr-form"
              onSubmit={handleCreatePr}
              className="space-y-4"
            >
              {createError && (
                <AlertBanner
                  variant="error"
                  title="Gagal Membuat PR"
                  message={createError.message}
                  httpStatus={createError.status}
                  fieldErrors={createError.fieldErrors}
                />
              )}

              <div>
                <label
                  htmlFor="pr-number"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Nomor PR{" "}
                  <span className="font-normal text-slate-400">(Opsional)</span>
                </label>
                <input
                  id="pr-number"
                  type="text"
                  maxLength={50}
                  value={prNumberInput}
                  onChange={(e) => setPrNumberInput(e.target.value)}
                  placeholder="Otomatis: PR-YYYYMM-0001"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="pr-status"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Status Awal
                </label>
                <select
                  id="pr-status"
                  value={prStatusInput}
                  onChange={(e) =>
                    setPrStatusInput(e.target.value as "Draft" | "Submitted")
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="Draft">Draft (Simpan sebagai draf)</option>
                  {canSubmit && (
                    <option value="Submitted">
                      Submitted (Langsung ajukan ke Purchasing)
                    </option>
                  )}
                </select>
              </div>
            </form>
          </Modal>

          {/* Submit PR Confirmation */}
          <ConfirmDialog
            open={Boolean(submittingPr)}
            onClose={() => setSubmittingPr(null)}
            onConfirm={handleConfirmSubmitPr}
            title="Submit Purchase Requisition"
            confirmLabel="Ya, Submit PR"
            variant="primary"
            isLoading={isSubmittingPr}
            errorMessage={submitPrError?.message}
            errorStatus={submitPrError?.status}
            description={
              submittingPr ? (
                <span>
                  Ubah status{" "}
                  <strong className="font-mono font-semibold text-slate-900">
                    {submittingPr.pr_number}
                  </strong>{" "}
                  dari <strong>Draft</strong> menjadi <strong>Submitted</strong>
                  ? Setelah disubmit, PR siap dikonversi menjadi Purchase Order.
                </span>
              ) : null
            }
          />

          {/* Convert to PO Modal */}
          <Modal
            open={Boolean(convertingPr)}
            onClose={() => setConvertingPr(null)}
            title={`Convert PR ke Purchase Order`}
            subtitle={
              convertingPr
                ? `Mengonversi ${convertingPr.pr_number} menjadi Purchase Order (status awal: Pending Approval).`
                : undefined
            }
            size="xl"
            disableClose={isConverting}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setConvertingPr(null)}
                  disabled={isConverting}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="convert-pr-form"
                  disabled={isConverting || loadingMasterOptions}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isConverting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  )}
                  Konversi ke PO
                </button>
              </>
            }
          >
            <form
              id="convert-pr-form"
              onSubmit={handleConvertToPo}
              className="space-y-5"
            >
              {convertError && (
                <AlertBanner
                  variant="error"
                  title="Konversi PR Gagal"
                  message={convertError.message}
                  httpStatus={convertError.status}
                  fieldErrors={convertError.fieldErrors}
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
                        htmlFor="convert-supplier"
                        className="mb-1.5 block text-xs font-semibold text-slate-700"
                      >
                        Supplier Aktif <span className="text-rose-500">*</span>
                      </label>
                      <select
                        id="convert-supplier"
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
                        htmlFor="convert-po-number"
                        className="mb-1.5 block text-xs font-semibold text-slate-700"
                      >
                        Nomor PO{" "}
                        <span className="font-normal text-slate-400">
                          (Opsional)
                        </span>
                      </label>
                      <input
                        id="convert-po-number"
                        type="text"
                        maxLength={50}
                        value={poNumberInput}
                        onChange={(e) => setPoNumberInput(e.target.value)}
                        placeholder="Otomatis: PO-YYYYMM-0001"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  </div>

                  {/* Line Items */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-bold text-slate-900">
                          Daftar Item Pesanan{" "}
                          <span className="text-rose-500">*</span>
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Minimal 1 produk aktif dengan kuantitas dan harga beli
                          satuan lebih dari 0.
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

                  {/* Summary & Tiered Approval Info */}
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
                            &gt; Rp10.000.000 &bull; Memerlukan Approval Manajer
                            / Super Admin
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </form>
          </Modal>
        </div>
      )}
    </DashboardShell>
  );
}
