"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  KeyRound,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import {
  AgingBucketBadge,
  InvoiceStatusBadge,
  PaymentMethodBadge,
  PoStatusBadge,
} from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRupiah,
  generateIdempotencyKey,
  getOffsetDateString,
  getTodayDateString,
  parseDecimal,
  type ParsedApiError,
} from "@/lib/format";
import type {
  AgingBucketKey,
  ApAgingInvoiceEntry,
  ApAgingSummary,
  ApiMessageResponse,
  ApiResourceResponse,
  CreatePurchaseInvoicePayload,
  InvoiceStatus,
  PaginatedResponse,
  PaginationMeta,
  Product,
  PurchaseInvoice,
  PurchaseOrder,
  Supplier,
} from "@/types/erp";

type ActiveTab = "invoices" | "aging";
type InvoiceStatusFilter = "all" | InvoiceStatus;
type BucketFilter = "all" | AgingBucketKey;

const INVOICE_STATUS_OPTIONS: InvoiceStatus[] = [
  "Unpaid",
  "Partially Paid",
  "Paid",
];

const BUCKET_META: Array<{
  key: AgingBucketKey;
  title: string;
  subtitle: string;
  cardClass: string;
  accentClass: string;
}> = [
  {
    key: "current",
    title: "Current",
    subtitle: "Belum jatuh tempo / jatuh tempo hari ini",
    cardClass: "border-emerald-200/80 bg-emerald-50/40 hover:border-emerald-300",
    accentClass: "text-emerald-700",
  },
  {
    key: "1_30_days",
    title: "1-30 Days",
    subtitle: "Lewat jatuh tempo 1 s.d. 30 hari",
    cardClass: "border-sky-200/80 bg-sky-50/40 hover:border-sky-300",
    accentClass: "text-sky-700",
  },
  {
    key: "31_60_days",
    title: "31-60 Days",
    subtitle: "Lewat jatuh tempo 31 s.d. 60 hari",
    cardClass: "border-amber-200/80 bg-amber-50/40 hover:border-amber-300",
    accentClass: "text-amber-800",
  },
  {
    key: "over_60_days",
    title: ">60 Days",
    subtitle: "Lewat jatuh tempo lebih dari 60 hari",
    cardClass: "border-rose-200/80 bg-rose-50/40 hover:border-rose-300",
    accentClass: "text-rose-700",
  },
];

interface InvoiceItemDraft {
  key: string;
  product_id: string;
  qty_billed: string;
  unit_price: string;
  po_price_hint?: string;
  po_qty_hint?: string;
}

function createEmptyItem(key: string): InvoiceItemDraft {
  return {
    key,
    product_id: "",
    qty_billed: "1",
    unit_price: "",
  };
}

function toFixedDecimalString(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0.00";
  }
  return value.toFixed(2);
}

export default function PurchaseInvoicesPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canViewInvoices = hasPermission("invoices.view");
  const canViewAging = hasPermission(["invoices.view", "financial_reports.view"]);
  const canCreate = hasPermission("invoices.create");
  const canManage = hasPermission("invoices.manage");
  const canViewPo = hasPermission("purchase_orders.view");
  const canViewSuppliers = hasPermission("suppliers.view");
  const canViewProducts = hasPermission("products.view");

  const [activeTab, setActiveTab] = useState<ActiveTab>("invoices");

  // Invoices state
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // AP Aging state
  const [agingSummary, setAgingSummary] = useState<ApAgingSummary | null>(null);
  const [isLoadingAging, setIsLoadingAging] = useState(false);
  const [agingError, setAgingError] = useState<ParsedApiError | null>(null);
  const [asOfDate, setAsOfDate] = useState("");
  const [agingSupplierFilter, setAgingSupplierFilter] = useState("");
  const [selectedBucket, setSelectedBucket] = useState<BucketFilter>("all");
  const [agingReloadTick, setAgingReloadTick] = useState(0);

  // Detail modal
  const [selectedInvoice, setSelectedInvoice] = useState<PurchaseInvoice | null>(
    null
  );
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Delete modal
  const [deletingInvoice, setDeletingInvoice] = useState<PurchaseInvoice | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<ParsedApiError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create modal (3-Way Matching)
  const itemKeySeqRef = useRef(1);
  const nextItemKey = useCallback(() => {
    const key = `pi-item-${itemKeySeqRef.current}`;
    itemKeySeqRef.current += 1;
    return key;
  }, []);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [billablePos, setBillablePos] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [selectedPoId, setSelectedPoId] = useState("");
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");
  const [invoiceDateInput, setInvoiceDateInput] = useState("");
  const [dueDateInput, setDueDateInput] = useState("");
  const [totalBilledInput, setTotalBilledInput] = useState("");
  const [manualTotalOverride, setManualTotalOverride] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [itemDrafts, setItemDrafts] = useState<InvoiceItemDraft[]>([
    createEmptyItem("pi-item-0"),
  ]);
  const [createError, setCreateError] = useState<ParsedApiError | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const resolvedTab: ActiveTab =
    !canViewInvoices && canViewAging ? "aging" : activeTab;

  const triggerReload = useCallback(() => {
    setReloadTick((prev) => prev + 1);
    setAgingReloadTick((prev) => prev + 1);
  }, []);

  // Load suppliers dropdown for filter
  useEffect(() => {
    if (authLoading || !canViewSuppliers || (!canViewInvoices && !canViewAging)) {
      return;
    }

    let cancelled = false;
    api
      .get<PaginatedResponse<Supplier>>("/suppliers", {
        params: { per_page: 100 },
      })
      .then((res) => {
        if (!cancelled) {
          setSuppliers(res.data.data);
        }
      })
      .catch(() => {
        // Optional filter dropdown
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, canViewSuppliers, canViewInvoices, canViewAging]);

  // Load Purchase Invoices list
  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    const loadInvoices = async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      if (!canViewInvoices) {
        setIsLoadingInvoices(false);
        return;
      }

      setIsLoadingInvoices(true);
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
        if (supplierFilter !== "") {
          params.supplier_id = Number(supplierFilter);
        }

        const res = await api.get<PaginatedResponse<PurchaseInvoice>>(
          "/purchase-invoices",
          { params }
        );
        if (!cancelled) {
          setInvoices(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Purchase Invoice.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingInvoices(false);
        }
      }
    };

    void loadInvoices();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    canViewInvoices,
    page,
    appliedSearch,
    statusFilter,
    supplierFilter,
    reloadTick,
  ]);

  // Load AP Aging Summary
  useEffect(() => {
    if (authLoading || !canViewAging || resolvedTab !== "aging") {
      return;
    }

    let cancelled = false;

    const loadAging = async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      setIsLoadingAging(true);
      setAgingError(null);

      try {
        const params: Record<string, string | number> = {};
        if (asOfDate.trim() !== "") {
          params.as_of_date = asOfDate.trim();
        }
        if (agingSupplierFilter !== "") {
          params.supplier_id = Number(agingSupplierFilter);
        }

        const res = await api.get<ApiResourceResponse<ApAgingSummary>>(
          "/purchase-invoices/ap-aging",
          { params }
        );
        if (!cancelled) {
          setAgingSummary(res.data.data);
        }
      } catch (error) {
        if (!cancelled) {
          setAgingError(
            extractApiError(error, "Gagal memuat ringkasan AP Aging.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAging(false);
        }
      }
    };

    void loadAging();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    canViewAging,
    resolvedTab,
    asOfDate,
    agingSupplierFilter,
    agingReloadTick,
  ]);

  const loadCreateOptions = useCallback(async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const tasks: Promise<void>[] = [];

      if (canViewPo) {
        tasks.push(
          Promise.all([
            api.get<PaginatedResponse<PurchaseOrder>>("/purchase-orders", {
              params: { status: "Partially Received", per_page: 100 },
            }),
            api.get<PaginatedResponse<PurchaseOrder>>("/purchase-orders", {
              params: { status: "Completed", per_page: 100 },
            }),
          ]).then(([partialRes, completedRes]) => {
            const combined = [
              ...partialRes.data.data,
              ...completedRes.data.data,
            ];
            const unique = Array.from(
              new Map(combined.map((po) => [po.id, po])).values()
            ).sort((a, b) => b.id - a.id);
            setBillablePos(unique);
          })
        );
      } else {
        setBillablePos([]);
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
        "Gagal memuat daftar Purchase Order atau Produk."
      );
      setOptionsError(parsed.message);
    } finally {
      setLoadingOptions(false);
    }
  }, [canViewPo, canViewProducts]);

  const selectedPoObj = useMemo(
    () =>
      billablePos.find((po) => String(po.id) === selectedPoId.trim()) ?? null,
    [billablePos, selectedPoId]
  );

  const calculatedItemsTotal = useMemo(() => {
    return itemDrafts.reduce((sum, row) => {
      const qty = parseDecimal(row.qty_billed);
      const price = parseDecimal(row.unit_price);
      if (qty > 0 && price > 0) {
        return sum + qty * price;
      }
      return sum;
    }, 0);
  }, [itemDrafts]);

  const selectableProducts = useMemo(() => {
    if (selectedPoObj?.items && selectedPoObj.items.length > 0) {
      const map = new Map<
        number,
        { id: number; sku: string; name: string; uom: string; unit_price: string }
      >();
      for (const item of selectedPoObj.items) {
        if (!map.has(item.product_id)) {
          map.set(item.product_id, {
            id: item.product_id,
            sku: item.product?.sku ?? `PRD-${item.product_id}`,
            name: item.product?.name ?? `Produk #${item.product_id}`,
            uom: item.product?.uom ?? "pcs",
            unit_price: item.unit_price,
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
      unit_price: "",
    }));
  }, [selectedPoObj, products]);

  const openCreateModal = () => {
    setSelectedPoId("");
    setInvoiceNumberInput("");
    setInvoiceDateInput(getTodayDateString());
    setDueDateInput(getOffsetDateString(30));
    setTotalBilledInput("");
    setManualTotalOverride(false);
    setIdempotencyKey(generateIdempotencyKey());
    setItemDrafts([createEmptyItem(nextItemKey())]);
    setCreateError(null);
    setCreateModalOpen(true);
    void loadCreateOptions();
  };

  const handleSelectPo = async (poIdValue: string) => {
    setSelectedPoId(poIdValue);
    setCreateError(null);
    setManualTotalOverride(false);

    if (!poIdValue) {
      setItemDrafts([createEmptyItem(nextItemKey())]);
      setTotalBilledInput("");
      return;
    }

    let foundPo = billablePos.find((po) => String(po.id) === poIdValue) ?? null;

    if (foundPo && (!foundPo.items || foundPo.items.length === 0) && canViewPo) {
      try {
        const res = await api.get<ApiResourceResponse<PurchaseOrder>>(
          `/purchase-orders/${foundPo.id}`
        );
        foundPo = res.data.data;
        setBillablePos((prev) =>
          prev.map((p) => (p.id === foundPo!.id ? foundPo! : p))
        );
      } catch {
        // Keep existing PO object
      }
    }

    if (foundPo?.items && foundPo.items.length > 0) {
      const grouped = new Map<
        number,
        { qty: number; unit_price: string }
      >();
      for (const item of foundPo.items) {
        const current = grouped.get(item.product_id);
        const qty = parseDecimal(item.qty_ordered);
        if (current) {
          current.qty += qty;
        } else {
          grouped.set(item.product_id, {
            qty,
            unit_price: item.unit_price,
          });
        }
      }

      const prefilled: InvoiceItemDraft[] = Array.from(grouped.entries()).map(
        ([productId, info]) => ({
          key: nextItemKey(),
          product_id: String(productId),
          qty_billed: String(info.qty),
          unit_price: info.unit_price,
          po_qty_hint: String(info.qty),
          po_price_hint: info.unit_price,
        })
      );

      setItemDrafts(prefilled);
      const calcTotal = prefilled.reduce(
        (sum, row) =>
          sum + parseDecimal(row.qty_billed) * parseDecimal(row.unit_price),
        0
      );
      setTotalBilledInput(toFixedDecimalString(calcTotal));
    }
  };

  const handleAddItemRow = () => {
    setItemDrafts((prev) => [...prev, createEmptyItem(nextItemKey())]);
  };

  const handleRemoveItemRow = (key: string) => {
    setItemDrafts((prev) =>
      prev.length > 1 ? prev.filter((item) => item.key !== key) : prev
    );
  };

  const handleUpdateItemRow = (
    key: string,
    field: "product_id" | "qty_billed" | "unit_price",
    value: string
  ) => {
    setItemDrafts((prev) => {
      const next = prev.map((item) => {
        if (item.key !== key) {
          return item;
        }
        const updated = { ...item, [field]: value };
        if (field === "product_id" && value) {
          const match = selectableProducts.find((p) => String(p.id) === value);
          if (match?.unit_price) {
            updated.unit_price = match.unit_price;
            updated.po_price_hint = match.unit_price;
          }
        }
        return updated;
      });

      if (!manualTotalOverride) {
        const calc = next.reduce(
          (sum, row) =>
            sum + parseDecimal(row.qty_billed) * parseDecimal(row.unit_price),
          0
        );
        setTotalBilledInput(calc > 0 ? toFixedDecimalString(calc) : "");
      }
      return next;
    });
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

    if (!dueDateInput) {
      setCreateError({
        message: "Tanggal jatuh tempo (due_date) wajib diisi.",
        fieldErrors: {},
      });
      return;
    }

    const preparedItems = itemDrafts.map((row) => ({
      product_id: Number(row.product_id),
      qty_billed: row.qty_billed.trim(),
      unit_price: row.unit_price.trim(),
    }));

    const hasInvalidItem = preparedItems.some(
      (item) =>
        !item.product_id ||
        parseDecimal(item.qty_billed) <= 0 ||
        parseDecimal(item.unit_price) <= 0
    );

    if (hasInvalidItem) {
      setCreateError({
        message:
          "Setiap baris item wajib memilih produk serta mengisi qty_billed (> 0) dan unit_price (> 0).",
        fieldErrors: {},
      });
      return;
    }

    const effectiveTotal =
      totalBilledInput.trim() !== ""
        ? totalBilledInput.trim()
        : toFixedDecimalString(calculatedItemsTotal);

    if (parseDecimal(effectiveTotal) <= 0) {
      setCreateError({
        message: "Total tagihan (total_billed) harus lebih dari 0.",
        fieldErrors: {},
      });
      return;
    }

    const activeKey = idempotencyKey.trim() || generateIdempotencyKey();
    if (activeKey !== idempotencyKey) {
      setIdempotencyKey(activeKey);
    }

    const payload: CreatePurchaseInvoicePayload = {
      po_id: parsedPoId,
      due_date: dueDateInput,
      total_billed: effectiveTotal,
      idempotency_key: activeKey,
      items: preparedItems,
    };

    if (selectedPoObj?.supplier_id) {
      payload.supplier_id = selectedPoObj.supplier_id;
    }
    if (invoiceNumberInput.trim() !== "") {
      payload.invoice_number = invoiceNumberInput.trim();
    }
    if (invoiceDateInput.trim() !== "") {
      payload.invoice_date = invoiceDateInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<PurchaseInvoice>>(
        "/purchase-invoices",
        payload,
        {
          headers: {
            "Idempotency-Key": activeKey,
          },
        }
      );
      setSuccessMessage(
        res.data.message ||
          `Purchase Invoice ${res.data.data.invoice_number} berhasil dibuat setelah lolos validasi 3-Way Matching.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(
          error,
          "Gagal membuat Purchase Invoice. Periksa validasi 3-Way Matching."
        )
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenDetail = async (invoice: PurchaseInvoice) => {
    setSelectedInvoice(invoice);
    setIsLoadingDetail(true);
    try {
      const res = await api.get<ApiResourceResponse<PurchaseInvoice>>(
        `/purchase-invoices/${invoice.id}`
      );
      setSelectedInvoice(res.data.data);
    } catch {
      // Keep summary data already displayed
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingInvoice) {
      return;
    }
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const res = await api.delete<ApiMessageResponse>(
        `/purchase-invoices/${deletingInvoice.id}`
      );
      setSuccessMessage(
        res.data.message ||
          `Purchase Invoice ${deletingInvoice.invoice_number} berhasil dihapus dan jurnal balik dicatat.`
      );
      if (selectedInvoice?.id === deletingInvoice.id) {
        setSelectedInvoice(null);
      }
      setDeletingInvoice(null);
      triggerReload();
    } catch (error) {
      setDeleteError(
        extractApiError(error, "Gagal menghapus Purchase Invoice.")
      );
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
    setSupplierFilter("");
    setPage(1);
  };

  const agingInvoicesList = useMemo<ApAgingInvoiceEntry[]>(() => {
    if (!agingSummary) {
      return [];
    }
    if (selectedBucket !== "all") {
      return agingSummary.buckets[selectedBucket]?.invoices ?? [];
    }
    return BUCKET_META.flatMap(
      (b) => agingSummary.buckets[b.key]?.invoices ?? []
    );
  }, [agingSummary, selectedBucket]);

  const invoiceColumns = useMemo<DataTableColumn<PurchaseInvoice>[]>(
    () => [
      {
        key: "invoice_number",
        header: "Nomor Invoice & PO",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.invoice_number}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-slate-500">
                {row.purchase_order?.po_number ?? `PO #${row.po_id}`}
              </span>
              {row.purchase_order?.status && (
                <PoStatusBadge status={row.purchase_order.status} />
              )}
            </div>
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
            {row.supplier?.email && (
              <p className="text-[11px] text-slate-400">{row.supplier.email}</p>
            )}
          </div>
        ),
      },
      {
        key: "total_billed",
        header: "Total Tagihan",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-slate-900">
            {formatRupiah(row.total_billed)}
          </span>
        ),
      },
      {
        key: "total_paid",
        header: "Sudah Dibayar",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-medium text-emerald-700">
            {row.total_paid !== undefined ? formatRupiah(row.total_paid) : "-"}
          </span>
        ),
      },
      {
        key: "remaining_balance",
        header: "Sisa Utang",
        align: "right",
        render: (row) => {
          const rem = parseDecimal(row.remaining_balance ?? row.total_billed);
          return (
            <span
              className={`font-mono text-xs font-bold ${
                rem > 0 ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {row.remaining_balance !== undefined
                ? formatRupiah(row.remaining_balance)
                : formatRupiah(row.total_billed)}
            </span>
          );
        },
      },
      {
        key: "due_date",
        header: "Jatuh Tempo",
        render: (row) => (
          <div>
            <p className="whitespace-nowrap font-medium text-slate-800">
              {formatDate(row.due_date)}
            </p>
            <p className="text-[10px] text-slate-400">
              Dibuat {formatDate(row.created_at)}
            </p>
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        align: "center",
        render: (row) => <InvoiceStatusBadge status={row.status} />,
      },
      {
        key: "actions",
        header: "Aksi",
        align: "right",
        render: (row) => {
          const canDeleteRow =
            canManage &&
            row.status === "Unpaid" &&
            (row.payment_vouchers?.length ?? 0) === 0;

          return (
            <div className="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => void handleOpenDetail(row)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Eye className="h-3.5 w-3.5" />
                Detail
              </button>
              {canDeleteRow && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingInvoice(row);
                  }}
                  aria-label={`Hapus invoice ${row.invoice_number}`}
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
    [canManage]
  );

  const agingInvoiceColumns = useMemo<DataTableColumn<ApAgingInvoiceEntry>[]>(
    () => [
      {
        key: "invoice_number",
        header: "Invoice & PO",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.invoice_number}
            </p>
            <p className="font-mono text-[11px] text-slate-400">
              {row.po_number ?? `PO #${row.po_id}`}
            </p>
          </div>
        ),
      },
      {
        key: "supplier_name",
        header: "Supplier",
        render: (row) => (
          <span className="font-semibold text-slate-900">
            {row.supplier_name ?? `Supplier #${row.supplier_id}`}
          </span>
        ),
      },
      {
        key: "due_date",
        header: "Jatuh Tempo",
        render: (row) => (
          <div>
            <p className="whitespace-nowrap font-medium text-slate-800">
              {formatDate(row.due_date)}
            </p>
            <p
              className={`text-[11px] font-semibold ${
                row.days_overdue > 0 ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {row.days_overdue > 0
                ? `Lewat ${row.days_overdue} hari`
                : "Belum jatuh tempo"}
            </p>
          </div>
        ),
      },
      {
        key: "aging_bucket",
        header: "Bucket Umur",
        align: "center",
        render: (row) => <AgingBucketBadge bucket={row.aging_bucket} />,
      },
      {
        key: "status",
        header: "Status",
        align: "center",
        render: (row) => <InvoiceStatusBadge status={row.status} />,
      },
      {
        key: "total_billed",
        header: "Tagihan",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs text-slate-700">
            {formatRupiah(row.total_billed)}
          </span>
        ),
      },
      {
        key: "total_paid",
        header: "Terbayar",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs text-emerald-700">
            {formatRupiah(row.total_paid)}
          </span>
        ),
      },
      {
        key: "outstanding_amount",
        header: "Outstanding AP",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-rose-700">
            {formatRupiah(row.outstanding_amount)}
          </span>
        ),
      },
    ],
    []
  );

  const hasAnyAccess = canViewInvoices || canViewAging;

  return (
    <DashboardShell
      title="Purchase Invoices (AP) & AP Aging"
      subtitle="Faktur pembelian supplier dengan validasi ketat 3-Way Matching (PO, GR Validated, Invoice) dan analisis umur utang"
    >
      {!hasAnyAccess ? (
        <AccessDeniedCard
          moduleName="Purchase Invoices & AP Aging"
          requiredPermission="invoices.view atau financial_reports.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Policy Notice */}
          <div className="flex flex-col gap-2 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              <p className="leading-relaxed">
                <strong className="font-semibold">
                  3-Way Matching &amp; Idempotency Guard:
                </strong>{" "}
                Pembuatan Purchase Invoice hanya diperbolehkan untuk PO yang
                memiliki <strong>Goods Receipt Validated</strong>, harga satuan
                wajib sama dengan PO, kuantitas tidak boleh melebihi sisa fisik
                GR (<strong>HTTP 422</strong>), serta dilindungi{" "}
                <strong>UUID idempotency_key</strong> terhadap duplikasi (
                <strong>HTTP 409</strong>). Jurnal otomatis:{" "}
                <code className="font-mono font-semibold">2102-GRIR</code> (D) /{" "}
                <code className="font-mono font-semibold">2101-AP</code> (K).
              </p>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
              {canViewInvoices && (
                <button
                  type="button"
                  onClick={() => setActiveTab("invoices")}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                    resolvedTab === "invoices"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <ReceiptText className="h-3.5 w-3.5" />
                  Purchase Invoices (AP)
                </button>
              )}
              {canViewAging && (
                <button
                  type="button"
                  onClick={() => setActiveTab("aging")}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                    resolvedTab === "aging"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  AP Aging Summary
                </button>
              )}
            </div>

            {canCreate && resolvedTab === "invoices" && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" />
                Buat Purchase Invoice (3-Way Match)
              </button>
            )}
          </div>

          {successMessage && (
            <AlertBanner
              variant="success"
              message={successMessage}
              onDismiss={() => setSuccessMessage(null)}
            />
          )}

          {/* TAB 1: PURCHASE INVOICES LIST */}
          {resolvedTab === "invoices" && canViewInvoices && (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs lg:flex-row lg:items-center lg:justify-between">
                <form
                  onSubmit={handleSearchSubmit}
                  className="flex flex-1 flex-wrap items-center gap-2.5"
                >
                  <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Cari nomor invoice (INV-AP-...)..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <select
                    aria-label="Filter status invoice"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as InvoiceStatusFilter);
                      setPage(1);
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="all">Semua Status</option>
                    {INVOICE_STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>

                  {canViewSuppliers && (
                    <select
                      aria-label="Filter supplier"
                      value={supplierFilter}
                      onChange={(e) => {
                        setSupplierFilter(e.target.value);
                        setPage(1);
                      }}
                      className="max-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Semua Supplier</option>
                      {suppliers.map((sup) => (
                        <option key={sup.id} value={sup.id}>
                          {sup.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                  >
                    Cari
                  </button>

                  {(appliedSearch || statusFilter !== "all" || supplierFilter) && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      Reset
                    </button>
                  )}
                </form>

                <button
                  type="button"
                  onClick={triggerReload}
                  disabled={isLoadingInvoices}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      isLoadingInvoices ? "animate-spin" : ""
                    }`}
                  />
                  Muat Ulang
                </button>
              </div>

              {pageError && (
                <AlertBanner
                  variant="error"
                  title="Gagal memuat Purchase Invoices"
                  message={pageError.message}
                  httpStatus={pageError.status}
                  fieldErrors={pageError.fieldErrors}
                  onDismiss={() => setPageError(null)}
                />
              )}

              <DataTable
                columns={invoiceColumns}
                data={invoices}
                rowKey={(row) => row.id}
                isLoading={isLoadingInvoices}
                meta={meta}
                onPageChange={setPage}
                emptyTitle="Belum ada Purchase Invoice"
                emptyDescription="Buat Purchase Invoice baru dari PO yang sudah memiliki Goods Receipt tervalidasi."
              />
            </div>
          )}

          {/* TAB 2: AP AGING SUMMARY */}
          {resolvedTab === "aging" && canViewAging && (
            <div className="space-y-5">
              {/* Aging Filter Toolbar */}
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="ap-aging-as-of"
                      className="text-xs font-semibold text-slate-600"
                    >
                      Tanggal Referensi:
                    </label>
                    <input
                      id="ap-aging-as-of"
                      type="date"
                      value={asOfDate || agingSummary?.as_of_date || ""}
                      onChange={(e) => setAsOfDate(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  {canViewSuppliers && (
                    <select
                      aria-label="Filter supplier AP Aging"
                      value={agingSupplierFilter}
                      onChange={(e) => setAgingSupplierFilter(e.target.value)}
                      className="max-w-[240px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Semua Supplier</option>
                      {suppliers.map((sup) => (
                        <option key={sup.id} value={sup.id}>
                          {sup.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setAgingReloadTick((prev) => prev + 1)}
                  disabled={isLoadingAging}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      isLoadingAging ? "animate-spin" : ""
                    }`}
                  />
                  Refresh Aging
                </button>
              </div>

              {agingError && (
                <AlertBanner
                  variant="error"
                  title="Gagal memuat AP Aging Summary"
                  message={agingError.message}
                  httpStatus={agingError.status}
                  fieldErrors={agingError.fieldErrors}
                  onDismiss={() => setAgingError(null)}
                />
              )}

              {isLoadingAging && !agingSummary ? (
                <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-16">
                  <div className="inline-flex flex-col items-center gap-2 text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                    <span className="text-xs font-medium">
                      Menghitung AP Aging Summary...
                    </span>
                  </div>
                </div>
              ) : agingSummary ? (
                <>
                  {/* Overall AP Outstanding Banner */}
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 p-5 text-white shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-medium text-slate-300">
                          Total Outstanding Account Payable (Per{" "}
                          {formatDate(agingSummary.as_of_date)})
                        </p>
                        <p className="mt-1 font-mono text-2xl font-bold tracking-tight sm:text-3xl">
                          {formatRupiah(agingSummary.total_outstanding)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <div className="rounded-xl bg-white/10 px-4 py-2.5 backdrop-blur-xs">
                          <p className="text-[11px] text-slate-300">
                            Invoice Belum Lunas
                          </p>
                          <p className="mt-0.5 font-mono text-lg font-bold text-white">
                            {agingSummary.total_invoices}
                          </p>
                        </div>
                        <div className="rounded-xl bg-white/10 px-4 py-2.5 backdrop-blur-xs">
                          <p className="text-[11px] text-slate-300">
                            Supplier Terdampak
                          </p>
                          <p className="mt-0.5 font-mono text-lg font-bold text-white">
                            {agingSummary.by_supplier.length}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 4 Aging Bucket Cards */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {BUCKET_META.map((b) => {
                      const bucket = agingSummary.buckets[b.key];
                      const totalOut = parseDecimal(
                        agingSummary.total_outstanding
                      );
                      const bucketOut = parseDecimal(
                        bucket?.total_outstanding ?? 0
                      );
                      const pct =
                        totalOut > 0
                          ? Math.round((bucketOut / totalOut) * 100)
                          : 0;
                      const isSelected = selectedBucket === b.key;

                      return (
                        <button
                          key={b.key}
                          type="button"
                          onClick={() =>
                            setSelectedBucket(isSelected ? "all" : b.key)
                          }
                          className={`rounded-2xl border p-4 text-left transition-all ${
                            b.cardClass
                          } ${
                            isSelected
                              ? "ring-2 ring-indigo-600 ring-offset-2"
                              : ""
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-bold uppercase tracking-wider ${b.accentClass}`}
                            >
                              {bucket?.label ?? b.title}
                            </span>
                            <span className="rounded-full bg-white/90 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                              {bucket?.count ?? 0} inv
                            </span>
                          </div>
                          <p
                            className={`mt-2.5 font-mono text-lg font-bold ${b.accentClass}`}
                          >
                            {formatRupiah(bucket?.total_outstanding ?? "0.00")}
                          </p>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                            <span className="truncate">{b.subtitle}</span>
                            <span className="ml-2 shrink-0 font-mono font-semibold text-slate-700">
                              {pct}%
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Breakdown per Supplier */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
                        <h3 className="text-sm font-bold text-slate-900">
                          Rincian AP Aging per Supplier
                        </h3>
                      </div>
                      <span className="text-xs text-slate-500">
                        {agingSummary.by_supplier.length} supplier
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Supplier
                            </th>
                            <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Invoice
                            </th>
                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                              Current
                            </th>
                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-sky-700">
                              1-30 Days
                            </th>
                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-amber-800">
                              31-60 Days
                            </th>
                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-rose-700">
                              &gt;60 Days
                            </th>
                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                              Total Outstanding
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {agingSummary.by_supplier.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="px-4 py-10 text-center text-xs text-slate-500"
                              >
                                Tidak ada utang usaha (AP) yang belum lunas pada
                                tanggal referensi ini.
                              </td>
                            </tr>
                          ) : (
                            agingSummary.by_supplier.map((sup) => (
                              <tr
                                key={sup.supplier_id}
                                className="hover:bg-slate-50/80"
                              >
                                <td className="px-4 py-3 font-semibold text-slate-900">
                                  {sup.supplier_name ??
                                    `Supplier #${sup.supplier_id}`}
                                </td>
                                <td className="px-4 py-3 text-center font-mono text-slate-600">
                                  {sup.invoice_count}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-emerald-700">
                                  {formatRupiah(sup.current)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-sky-700">
                                  {formatRupiah(sup["1_30_days"])}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-amber-800">
                                  {formatRupiah(sup["31_60_days"])}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-semibold text-rose-700">
                                  {formatRupiah(sup.over_60_days)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                                  {formatRupiah(sup.total_outstanding)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                        {agingSummary.by_supplier.length > 0 && (
                          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                            <tr>
                              <td className="px-4 py-3 text-slate-900">
                                Grand Total
                              </td>
                              <td className="px-4 py-3 text-center font-mono text-slate-900">
                                {agingSummary.total_invoices}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-emerald-700">
                                {formatRupiah(
                                  agingSummary.buckets.current
                                    ?.total_outstanding ?? "0.00"
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-sky-700">
                                {formatRupiah(
                                  agingSummary.buckets["1_30_days"]
                                    ?.total_outstanding ?? "0.00"
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-amber-800">
                                {formatRupiah(
                                  agingSummary.buckets["31_60_days"]
                                    ?.total_outstanding ?? "0.00"
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-rose-700">
                                {formatRupiah(
                                  agingSummary.buckets.over_60_days
                                    ?.total_outstanding ?? "0.00"
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-slate-900">
                                {formatRupiah(agingSummary.total_outstanding)}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>

                  {/* Invoice Aging Detail Table */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-900">
                        Daftar Invoice Belum Lunas (
                        {selectedBucket === "all"
                          ? "Semua Bucket"
                          : agingSummary.buckets[selectedBucket]?.label}
                        )
                      </h3>
                      {selectedBucket !== "all" && (
                        <button
                          type="button"
                          onClick={() => setSelectedBucket("all")}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                        >
                          Tampilkan Semua Bucket
                        </button>
                      )}
                    </div>

                    <DataTable
                      columns={agingInvoiceColumns}
                      data={agingInvoicesList}
                      rowKey={(row) => row.id}
                      isLoading={isLoadingAging}
                      emptyTitle="Tidak ada invoice pada bucket ini"
                      emptyDescription="Semua tagihan AP pada kategori umur ini sudah lunas atau kosong."
                    />
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* CREATE PURCHASE INVOICE MODAL (3-WAY MATCHING) */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Buat Purchase Invoice (3-Way Matching)"
        subtitle="Validasi otomatis terhadap Purchase Order & Goods Receipt Validated"
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
              form="create-purchase-invoice-form"
              disabled={isCreating}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Simpan Purchase Invoice
            </button>
          </>
        }
      >
        <form
          id="create-purchase-invoice-form"
          onSubmit={handleCreateSubmit}
          className="space-y-5"
        >
          {createError && (
            <AlertBanner
              variant="error"
              title={
                createError.status === 409
                  ? "Duplikasi Request Ditolak (Idempotency Conflict)"
                  : createError.status === 422
                    ? "Validasi 3-Way Matching Gagal"
                    : "Gagal Membuat Purchase Invoice"
              }
              message={createError.message}
              httpStatus={createError.status}
              fieldErrors={createError.fieldErrors}
              onDismiss={() => setCreateError(null)}
            />
          )}

          {optionsError && (
            <AlertBanner
              variant="warning"
              message={optionsError}
              onDismiss={() => setOptionsError(null)}
            />
          )}

          {/* Idempotency Key Section */}
          <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-950">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                Idempotency Key (UUID Proteksi Duplikat 409)
              </div>
              <button
                type="button"
                onClick={() => {
                  setIdempotencyKey(generateIdempotencyKey());
                  setCreateError(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-50"
              >
                <RefreshCw className="h-3 w-3" />
                Generate UUID Baru
              </button>
            </div>
            <input
              type="text"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              required
              className="mt-2 w-full rounded-lg border border-indigo-200 bg-white px-3 py-1.5 font-mono text-[11px] text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <p className="mt-1 text-[11px] text-indigo-800/80">
              UUID otomatis dibuat setiap pembukaan formulir. Pengiriman ulang
              dengan key yang sama setelah berhasil akan ditolak backend dengan
              HTTP 409.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* PO Selector */}
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Purchase Order (PO dengan GR Validated){" "}
                <span className="text-rose-600">*</span>
              </label>
              {canViewPo ? (
                <select
                  value={selectedPoId}
                  onChange={(e) => void handleSelectPo(e.target.value)}
                  required
                  disabled={loadingOptions}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">
                    {loadingOptions
                      ? "Memuat daftar PO eligible..."
                      : "-- Pilih PO (Partially Received / Completed) --"}
                  </option>
                  {billablePos.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} —{" "}
                      {po.supplier?.name ?? `Supplier #${po.supplier_id}`} (
                      {po.status} &bull; {formatRupiah(po.total_amount)})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={selectedPoId}
                  onChange={(e) => setSelectedPoId(e.target.value)}
                  placeholder="Masukkan ID Purchase Order..."
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Nomor Invoice Supplier{" "}
                <span className="font-normal text-slate-400">(opsional)</span>
              </label>
              <input
                type="text"
                value={invoiceNumberInput}
                onChange={(e) => setInvoiceNumberInput(e.target.value)}
                placeholder="Kosongkan untuk auto-generate (INV-AP-...)"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Tanggal Invoice
              </label>
              <input
                type="date"
                value={invoiceDateInput}
                onChange={(e) => setInvoiceDateInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Tanggal Jatuh Tempo (Due Date){" "}
                <span className="text-rose-600">*</span>
              </label>
              <input
                type="date"
                value={dueDateInput}
                onChange={(e) => setDueDateInput(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  Total Tagihan (total_billed){" "}
                  <span className="text-rose-600">*</span>
                </label>
                {manualTotalOverride && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualTotalOverride(false);
                      setTotalBilledInput(
                        toFixedDecimalString(calculatedItemsTotal)
                      );
                    }}
                    className="text-[11px] font-semibold text-indigo-600 hover:underline"
                  >
                    Sinkronkan ({formatRupiah(calculatedItemsTotal)})
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={totalBilledInput}
                onChange={(e) => {
                  setManualTotalOverride(true);
                  setTotalBilledInput(e.target.value);
                }}
                placeholder="Otomatis dari jumlah item"
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-semibold text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              {Math.abs(parseDecimal(totalBilledInput) - calculatedItemsTotal) >
                0.01 &&
                totalBilledInput !== "" && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Selisih dengan kalkulasi item (
                    {formatRupiah(calculatedItemsTotal)}) akan ditolak 422 oleh
                    3-Way Matching.
                  </p>
                )}
            </div>
          </div>

          {/* Items Table for 3-Way Matching */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-900">
                  Item Tagihan (3-Way Matching)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Harga satuan wajib cocok dengan PO dan qty tidak boleh
                  melebihi sisa GR tervalidasi.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddItemRow}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Baris
              </button>
            </div>

            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              {itemDrafts.map((row, idx) => {
                const lineSubtotal =
                  parseDecimal(row.qty_billed) * parseDecimal(row.unit_price);
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-12 sm:items-end"
                  >
                    <div className="sm:col-span-5">
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Produk #{idx + 1}
                      </label>
                      {selectableProducts.length > 0 ? (
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
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                        >
                          <option value="">-- Pilih Produk --</option>
                          {selectableProducts.map((prod) => (
                            <option key={prod.id} value={prod.id}>
                              {prod.sku} — {prod.name} ({prod.uom})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          min={1}
                          value={row.product_id}
                          onChange={(e) =>
                            handleUpdateItemRow(
                              row.key,
                              "product_id",
                              e.target.value
                            )
                          }
                          placeholder="Product ID"
                          required
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs"
                        />
                      )}
                    </div>

                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Qty Ditagih
                        {row.po_qty_hint && (
                          <span className="ml-1 font-normal text-slate-400">
                            (PO: {formatNumber(row.po_qty_hint)})
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={row.qty_billed}
                        onChange={(e) =>
                          handleUpdateItemRow(
                            row.key,
                            "qty_billed",
                            e.target.value
                          )
                        }
                        required
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Harga Satuan (Rp)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={row.unit_price}
                        onChange={(e) =>
                          handleUpdateItemRow(
                            row.key,
                            "unit_price",
                            e.target.value
                          )
                        }
                        required
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {formatRupiah(lineSubtotal)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveItemRow(row.key)}
                        disabled={itemDrafts.length <= 1}
                        className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                        aria-label="Hapus baris item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between border-t border-slate-200 pt-2.5 text-xs">
                <span className="font-semibold text-slate-600">
                  Total Kalkulasi Item ({itemDrafts.length} baris)
                </span>
                <span className="font-mono text-sm font-bold text-indigo-700">
                  {formatRupiah(calculatedItemsTotal)}
                </span>
              </div>
            </div>
          </div>
        </form>
      </Modal>

      {/* DETAIL MODAL */}
      <Modal
        open={Boolean(selectedInvoice)}
        onClose={() => setSelectedInvoice(null)}
        title={
          selectedInvoice
            ? `Detail Purchase Invoice ${selectedInvoice.invoice_number}`
            : "Detail Purchase Invoice"
        }
        subtitle={
          selectedInvoice?.supplier?.name
            ? `Supplier: ${selectedInvoice.supplier.name}`
            : undefined
        }
        size="xl"
      >
        {selectedInvoice && (
          <div className="space-y-5">
            {isLoadingDetail && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                Memuat detail lengkap &amp; jurnal akuntansi...
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-slate-500">Status</p>
                <div className="mt-1">
                  <InvoiceStatusBadge status={selectedInvoice.status} />
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Total Tagihan</p>
                <p className="mt-1 font-mono font-bold text-slate-900">
                  {formatRupiah(selectedInvoice.total_billed)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sudah Dibayar</p>
                <p className="mt-1 font-mono font-bold text-emerald-700">
                  {formatRupiah(selectedInvoice.total_paid ?? "0.00")}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sisa Hutang</p>
                <p className="mt-1 font-mono font-bold text-rose-700">
                  {formatRupiah(
                    selectedInvoice.remaining_balance ??
                      selectedInvoice.total_billed
                  )}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Referensi PO</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-800">
                  {selectedInvoice.purchase_order?.po_number ??
                    `PO #${selectedInvoice.po_id}`}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Jatuh Tempo</p>
                <p className="mt-0.5 font-semibold text-slate-800">
                  {formatDate(selectedInvoice.due_date)}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[11px] text-slate-500">Idempotency Key</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-700">
                  {selectedInvoice.idempotency_key}
                </p>
              </div>
            </div>

            {/* Items */}
            {selectedInvoice.items && selectedInvoice.items.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-bold text-slate-900">
                  Rincian Item 3-Way Matching ({selectedInvoice.items.length})
                </h4>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                          Produk
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500">
                          Qty Billed
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500">
                          Unit Price
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500">
                          Line Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {selectedInvoice.items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2">
                            <p className="font-semibold text-slate-900">
                              {item.product?.name ??
                                `Produk #${item.product_id}`}
                            </p>
                            <p className="font-mono text-[11px] text-slate-400">
                              {item.product?.sku ?? "-"}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700">
                            {formatNumber(item.qty_billed)}{" "}
                            {item.product?.uom ?? ""}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700">
                            {formatRupiah(item.unit_price)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                            {formatRupiah(item.line_total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Payment Vouchers History */}
            <div>
              <h4 className="mb-2 text-xs font-bold text-slate-900">
                Riwayat Pembayaran (Payment Vouchers)
              </h4>
              {selectedInvoice.payment_vouchers &&
              selectedInvoice.payment_vouchers.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                          Nomor Voucher
                        </th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                          Tanggal
                        </th>
                        <th className="px-3 py-2 text-center text-[11px] font-semibold text-slate-500">
                          Metode
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500">
                          Jumlah Dibayar
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {selectedInvoice.payment_vouchers.map((pv) => (
                        <tr key={pv.id}>
                          <td className="px-3 py-2 font-mono font-semibold text-indigo-700">
                            {pv.voucher_number}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {formatDate(pv.payment_date)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <PaymentMethodBadge method={pv.payment_method} />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                            {formatRupiah(pv.amount_paid)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  Belum ada pembayaran yang dicatat untuk invoice ini.
                </p>
              )}
            </div>

            {/* General Ledger Entries */}
            {selectedInvoice.general_ledgers &&
              selectedInvoice.general_ledgers.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Jurnal General Ledger Otomatis
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                            Tanggal
                          </th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                            Akun COA
                          </th>
                          <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                            Keterangan
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500">
                            Debit
                          </th>
                          <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500">
                            Credit
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {selectedInvoice.general_ledgers.map((gl) => (
                          <tr key={gl.id}>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                              {formatDate(gl.transaction_date)}
                            </td>
                            <td className="px-3 py-2 font-mono font-semibold text-indigo-700">
                              {gl.account_code}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {gl.description ?? "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">
                              {parseDecimal(gl.debit) > 0
                                ? formatRupiah(gl.debit)
                                : "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-sky-700">
                              {parseDecimal(gl.credit) > 0
                                ? formatRupiah(gl.credit)
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            <p className="text-[11px] text-slate-400">
              Dicatat pada {formatDateTime(selectedInvoice.created_at)}
            </p>
          </div>
        )}
      </Modal>

      {/* DELETE CONFIRM DIALOG */}
      <ConfirmDialog
        open={Boolean(deletingInvoice)}
        onClose={() => setDeletingInvoice(null)}
        onConfirm={handleConfirmDelete}
        title="Hapus Purchase Invoice?"
        description={
          deletingInvoice ? (
            <>
              Purchase Invoice{" "}
              <strong className="font-mono text-slate-900">
                {deletingInvoice.invoice_number}
              </strong>{" "}
              senilai{" "}
              <strong className="font-mono text-slate-900">
                {formatRupiah(deletingInvoice.total_billed)}
              </strong>{" "}
              akan dihapus (soft delete) dan jurnal balik (Debit{" "}
              <code className="font-mono">2101-AP</code> / Credit{" "}
              <code className="font-mono">2102-GRIR</code>) akan dicatat
              otomatis.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Ya, Hapus & Catat Jurnal Balik"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteError?.message}
        errorStatus={deleteError?.status}
      />
    </DashboardShell>
  );
}
