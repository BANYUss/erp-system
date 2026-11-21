"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  SoStatusBadge,
} from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDate,
  formatDateTime,
  formatRupiah,
  generateIdempotencyKey,
  getOffsetDateString,
  getTodayDateString,
  parseDecimal,
  type ParsedApiError,
} from "@/lib/format";
import type {
  AgingBucketKey,
  ApiMessageResponse,
  ApiResourceResponse,
  ArAgingInvoiceEntry,
  ArAgingSummary,
  CreateSalesInvoicePayload,
  Customer,
  DeliveryOrder,
  InvoiceStatus,
  PaginatedResponse,
  PaginationMeta,
  SalesInvoice,
  SalesOrder,
} from "@/types/erp";

type ActiveTab = "invoices" | "aging";
type InvoiceStatusFilter = "all" | InvoiceStatus;
type BucketFilter = "all" | AgingBucketKey;
type SourceMode = "so" | "do";

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

export default function SalesInvoicesPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canViewInvoices = hasPermission("invoices.view");
  const canViewAging = hasPermission(["invoices.view", "financial_reports.view"]);
  const canCreate = hasPermission("invoices.create");
  const canManage = hasPermission("invoices.manage");
  const canViewSo = hasPermission("sales_orders.view");
  const canViewDo = hasPermission("delivery_orders.view");
  const canViewCustomers = hasPermission("customers.view");

  const [activeTab, setActiveTab] = useState<ActiveTab>("invoices");

  // Invoices state
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [customerFilter, setCustomerFilter] = useState("");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // AR Aging state
  const [agingSummary, setAgingSummary] = useState<ArAgingSummary | null>(null);
  const [isLoadingAging, setIsLoadingAging] = useState(false);
  const [agingError, setAgingError] = useState<ParsedApiError | null>(null);
  const [asOfDate, setAsOfDate] = useState("");
  const [agingCustomerFilter, setAgingCustomerFilter] = useState("");
  const [selectedBucket, setSelectedBucket] = useState<BucketFilter>("all");
  const [agingReloadTick, setAgingReloadTick] = useState(0);

  // Detail modal
  const [selectedInvoice, setSelectedInvoice] = useState<SalesInvoice | null>(
    null
  );
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Delete modal
  const [deletingInvoice, setDeletingInvoice] = useState<SalesInvoice | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<ParsedApiError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("so");
  const [eligibleSos, setEligibleSos] = useState<SalesOrder[]>([]);
  const [eligibleDos, setEligibleDos] = useState<DeliveryOrder[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [selectedSoId, setSelectedSoId] = useState("");
  const [selectedDoId, setSelectedDoId] = useState("");
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");
  const [invoiceDateInput, setInvoiceDateInput] = useState("");
  const [dueDateInput, setDueDateInput] = useState("");
  const [totalBilledInput, setTotalBilledInput] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [createError, setCreateError] = useState<ParsedApiError | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const resolvedTab: ActiveTab =
    !canViewInvoices && canViewAging ? "aging" : activeTab;

  const triggerReload = useCallback(() => {
    setReloadTick((prev) => prev + 1);
    setAgingReloadTick((prev) => prev + 1);
  }, []);

  // Load customers for filter dropdown
  useEffect(() => {
    if (
      authLoading ||
      !canViewCustomers ||
      (!canViewInvoices && !canViewAging)
    ) {
      return;
    }

    let cancelled = false;
    api
      .get<PaginatedResponse<Customer>>("/customers", {
        params: { per_page: 100 },
      })
      .then((res) => {
        if (!cancelled) {
          setCustomers(res.data.data);
        }
      })
      .catch(() => {
        // Optional dropdown
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, canViewCustomers, canViewInvoices, canViewAging]);

  // Load Sales Invoices list
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
        if (customerFilter !== "") {
          params.customer_id = Number(customerFilter);
        }

        const res = await api.get<PaginatedResponse<SalesInvoice>>(
          "/sales-invoices",
          { params }
        );
        if (!cancelled) {
          setInvoices(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Sales Invoice.")
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
    customerFilter,
    reloadTick,
  ]);

  // Load AR Aging Summary
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
        if (agingCustomerFilter !== "") {
          params.customer_id = Number(agingCustomerFilter);
        }

        const res = await api.get<ApiResourceResponse<ArAgingSummary>>(
          "/sales-invoices/ar-aging",
          { params }
        );
        if (!cancelled) {
          setAgingSummary(res.data.data);
        }
      } catch (error) {
        if (!cancelled) {
          setAgingError(
            extractApiError(error, "Gagal memuat ringkasan AR Aging.")
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
    agingCustomerFilter,
    agingReloadTick,
  ]);

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
            api.get<PaginatedResponse<SalesOrder>>("/sales-orders", {
              params: { status: "Completed", per_page: 100 },
            }),
          ]).then(([confRes, partRes, compRes]) => {
            const combined = [
              ...confRes.data.data,
              ...partRes.data.data,
              ...compRes.data.data,
            ];
            const unique = Array.from(
              new Map(combined.map((so) => [so.id, so])).values()
            ).sort((a, b) => b.id - a.id);
            setEligibleSos(unique);
          })
        );
      } else {
        setEligibleSos([]);
      }

      if (canViewDo) {
        tasks.push(
          Promise.all([
            api.get<PaginatedResponse<DeliveryOrder>>("/delivery-orders", {
              params: { status: "Dispatched", per_page: 100 },
            }),
            api.get<PaginatedResponse<DeliveryOrder>>("/delivery-orders", {
              params: { status: "Delivered", per_page: 100 },
            }),
          ]).then(([dispRes, delivRes]) => {
            const combined = [...dispRes.data.data, ...delivRes.data.data];
            const unique = Array.from(
              new Map(combined.map((d) => [d.id, d])).values()
            ).sort((a, b) => b.id - a.id);
            setEligibleDos(unique);
          })
        );
      } else {
        setEligibleDos([]);
      }

      await Promise.all(tasks);
    } catch (error) {
      setOptionsError(
        extractApiError(
          error,
          "Gagal memuat daftar Sales Order atau Delivery Order."
        ).message
      );
    } finally {
      setLoadingOptions(false);
    }
  }, [canViewSo, canViewDo]);

  const selectedSoObj = useMemo(
    () =>
      eligibleSos.find((so) => String(so.id) === selectedSoId.trim()) ?? null,
    [eligibleSos, selectedSoId]
  );

  const selectedDoObj = useMemo(
    () =>
      eligibleDos.find((d) => String(d.id) === selectedDoId.trim()) ?? null,
    [eligibleDos, selectedDoId]
  );

  const filteredDosForSelectedSo = useMemo(() => {
    if (!selectedSoId) {
      return eligibleDos;
    }
    return eligibleDos.filter(
      (d) => String(d.sales_order_id) === selectedSoId
    );
  }, [eligibleDos, selectedSoId]);

  const openCreateModal = () => {
    setSourceMode("so");
    setSelectedSoId("");
    setSelectedDoId("");
    setInvoiceNumberInput("");
    setInvoiceDateInput(getTodayDateString());
    setDueDateInput(getOffsetDateString(30));
    setTotalBilledInput("");
    setIdempotencyKey(generateIdempotencyKey());
    setCreateError(null);
    setCreateModalOpen(true);
    void loadCreateOptions();
  };

  const handleSelectSo = (soId: string) => {
    setSelectedSoId(soId);
    setSelectedDoId("");
    setCreateError(null);
  };

  const handleSelectDo = (doId: string) => {
    setSelectedDoId(doId);
    setCreateError(null);
    const foundDo = eligibleDos.find((d) => String(d.id) === doId);
    if (foundDo) {
      setSelectedSoId(String(foundDo.sales_order_id));
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    const parsedSoId =
      selectedSoId.trim() !== "" ? Number(selectedSoId.trim()) : null;
    const parsedDoId =
      selectedDoId.trim() !== "" ? Number(selectedDoId.trim()) : null;

    if (
      (!parsedSoId || !Number.isInteger(parsedSoId) || parsedSoId <= 0) &&
      (!parsedDoId || !Number.isInteger(parsedDoId) || parsedDoId <= 0)
    ) {
      setCreateError({
        message: "Pilih Sales Order atau Delivery Order sebagai sumber faktur.",
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

    const activeKey = idempotencyKey.trim() || generateIdempotencyKey();
    if (activeKey !== idempotencyKey) {
      setIdempotencyKey(activeKey);
    }

    const payload: CreateSalesInvoicePayload = {
      due_date: dueDateInput,
      idempotency_key: activeKey,
    };

    if (parsedSoId && parsedSoId > 0) {
      payload.sales_order_id = parsedSoId;
    }
    if (parsedDoId && parsedDoId > 0) {
      payload.delivery_order_id = parsedDoId;
    }
    if (selectedSoObj?.customer_id) {
      payload.customer_id = selectedSoObj.customer_id;
    }
    if (invoiceNumberInput.trim() !== "") {
      payload.invoice_number = invoiceNumberInput.trim();
    }
    if (invoiceDateInput.trim() !== "") {
      payload.invoice_date = invoiceDateInput.trim();
    }
    if (totalBilledInput.trim() !== "") {
      payload.total_billed = totalBilledInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<SalesInvoice>>(
        "/sales-invoices",
        payload,
        {
          headers: {
            "Idempotency-Key": activeKey,
          },
        }
      );
      setSuccessMessage(
        res.data.message ||
          `Sales Invoice ${res.data.data.invoice_number} berhasil diterbitkan dan jurnal pendapatan telah dicatat.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(error, "Gagal menerbitkan Sales Invoice.")
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenDetail = async (invoice: SalesInvoice) => {
    setSelectedInvoice(invoice);
    setIsLoadingDetail(true);
    try {
      const res = await api.get<ApiResourceResponse<SalesInvoice>>(
        `/sales-invoices/${invoice.id}`
      );
      setSelectedInvoice(res.data.data);
    } catch {
      // Keep summary data
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
        `/sales-invoices/${deletingInvoice.id}`
      );
      setSuccessMessage(
        res.data.message ||
          `Sales Invoice ${deletingInvoice.invoice_number} berhasil dihapus dan jurnal balik dicatat.`
      );
      if (selectedInvoice?.id === deletingInvoice.id) {
        setSelectedInvoice(null);
      }
      setDeletingInvoice(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus Sales Invoice."));
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
    setCustomerFilter("");
    setPage(1);
  };

  const agingInvoicesList = useMemo<ArAgingInvoiceEntry[]>(() => {
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

  const invoiceColumns = useMemo<DataTableColumn<SalesInvoice>[]>(
    () => [
      {
        key: "invoice_number",
        header: "Nomor Invoice & SO",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.invoice_number}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-slate-500">
                {row.sales_order?.so_number ?? `SO #${row.sales_order_id}`}
              </span>
              {row.sales_order?.status && (
                <SoStatusBadge status={row.sales_order.status} />
              )}
            </div>
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
            {row.customer?.email && (
              <p className="text-[11px] text-slate-400">{row.customer.email}</p>
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
        key: "total_received",
        header: "Kas Masuk",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-medium text-emerald-700">
            {row.total_received !== undefined
              ? formatRupiah(row.total_received)
              : "-"}
          </span>
        ),
      },
      {
        key: "remaining_balance",
        header: "Sisa Piutang",
        align: "right",
        render: (row) => {
          const rem = parseDecimal(row.remaining_balance ?? row.total_billed);
          return (
            <span
              className={`font-mono text-xs font-bold ${
                rem > 0 ? "text-amber-700" : "text-emerald-700"
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
              Terbit {formatDate(row.created_at)}
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
            (row.customer_payments?.length ?? 0) === 0;

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

  const agingInvoiceColumns = useMemo<DataTableColumn<ArAgingInvoiceEntry>[]>(
    () => [
      {
        key: "invoice_number",
        header: "Invoice & SO",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.invoice_number}
            </p>
            <p className="font-mono text-[11px] text-slate-400">
              {row.so_number ?? `SO #${row.sales_order_id}`}
            </p>
          </div>
        ),
      },
      {
        key: "customer_name",
        header: "Customer",
        render: (row) => (
          <span className="font-semibold text-slate-900">
            {row.customer_name ?? `Customer #${row.customer_id}`}
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
        key: "total_received",
        header: "Diterima",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs text-emerald-700">
            {formatRupiah(row.total_received)}
          </span>
        ),
      },
      {
        key: "outstanding_amount",
        header: "Outstanding AR",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-amber-800">
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
      title="Sales Invoices (AR) & AR Aging"
      subtitle="Penerbitan faktur penjualan dari Sales Order / Delivery Order serta monitoring umur piutang pelanggan"
    >
      {!hasAnyAccess ? (
        <AccessDeniedCard
          moduleName="Sales Invoices & AR Aging"
          requiredPermission="invoices.view atau financial_reports.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Policy Notice */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
            <p className="leading-relaxed">
              <strong className="font-semibold">
                Account Receivable &amp; Revenue Recognition:
              </strong>{" "}
              Faktur penjualan dapat diterbitkan dari{" "}
              <strong>Sales Order (Confirmed / Partially Delivered / Completed)</strong>{" "}
              atau <strong>Delivery Order (Dispatched / Delivered)</strong>{" "}
              dengan proteksi anti-overbilling (<strong>HTTP 422</strong>) dan{" "}
              <strong>UUID idempotency_key</strong> (<strong>HTTP 409</strong>).
              Jurnal otomatis:{" "}
              <code className="font-mono font-semibold">1102-AR</code> (D) /{" "}
              <code className="font-mono font-semibold">
                4101-SALES-REVENUE
              </code>{" "}
              (K).
            </p>
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
                  Sales Invoices (AR)
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
                  AR Aging Summary
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
                Terbitkan Sales Invoice
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

          {/* TAB 1: SALES INVOICES LIST */}
          {resolvedTab === "invoices" && canViewInvoices && (
            <div className="space-y-4">
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
                      placeholder="Cari nomor invoice (INV-AR-...)..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <select
                    aria-label="Filter status sales invoice"
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

                  {canViewCustomers && (
                    <select
                      aria-label="Filter customer"
                      value={customerFilter}
                      onChange={(e) => {
                        setCustomerFilter(e.target.value);
                        setPage(1);
                      }}
                      className="max-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Semua Customer</option>
                      {customers.map((cust) => (
                        <option key={cust.id} value={cust.id}>
                          {cust.name}
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

                  {(appliedSearch || statusFilter !== "all" || customerFilter) && (
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
                  title="Gagal memuat Sales Invoices"
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
                emptyTitle="Belum ada Sales Invoice"
                emptyDescription="Terbitkan Sales Invoice dari Sales Order terkonfirmasi atau Delivery Order yang telah dikirim."
              />
            </div>
          )}

          {/* TAB 2: AR AGING SUMMARY */}
          {resolvedTab === "aging" && canViewAging && (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="ar-aging-as-of"
                      className="text-xs font-semibold text-slate-600"
                    >
                      Tanggal Referensi:
                    </label>
                    <input
                      id="ar-aging-as-of"
                      type="date"
                      value={asOfDate || agingSummary?.as_of_date || ""}
                      onChange={(e) => setAsOfDate(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  {canViewCustomers && (
                    <select
                      aria-label="Filter customer AR Aging"
                      value={agingCustomerFilter}
                      onChange={(e) => setAgingCustomerFilter(e.target.value)}
                      className="max-w-[240px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Semua Customer</option>
                      {customers.map((cust) => (
                        <option key={cust.id} value={cust.id}>
                          {cust.name}
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
                  title="Gagal memuat AR Aging Summary"
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
                      Menghitung AR Aging Summary...
                    </span>
                  </div>
                </div>
              ) : agingSummary ? (
                <>
                  {/* Overall AR Banner */}
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-sky-950 p-5 text-white shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-medium text-slate-300">
                          Total Outstanding Account Receivable (Per{" "}
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
                            Customer Terdampak
                          </p>
                          <p className="mt-0.5 font-mono text-lg font-bold text-white">
                            {agingSummary.by_customer.length}
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

                  {/* Breakdown per Customer */}
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
                        <h3 className="text-sm font-bold text-slate-900">
                          Rincian AR Aging per Customer
                        </h3>
                      </div>
                      <span className="text-xs text-slate-500">
                        {agingSummary.by_customer.length} customer
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              Customer
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
                          {agingSummary.by_customer.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="px-4 py-10 text-center text-xs text-slate-500"
                              >
                                Tidak ada piutang usaha (AR) yang belum lunas
                                pada tanggal referensi ini.
                              </td>
                            </tr>
                          ) : (
                            agingSummary.by_customer.map((cust) => (
                              <tr
                                key={cust.customer_id}
                                className="hover:bg-slate-50/80"
                              >
                                <td className="px-4 py-3 font-semibold text-slate-900">
                                  {cust.customer_name ??
                                    `Customer #${cust.customer_id}`}
                                </td>
                                <td className="px-4 py-3 text-center font-mono text-slate-600">
                                  {cust.invoice_count}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-emerald-700">
                                  {formatRupiah(cust.current)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-sky-700">
                                  {formatRupiah(cust["1_30_days"])}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-amber-800">
                                  {formatRupiah(cust["31_60_days"])}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-semibold text-rose-700">
                                  {formatRupiah(cust.over_60_days)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                                  {formatRupiah(cust.total_outstanding)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                        {agingSummary.by_customer.length > 0 && (
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
                        Daftar Piutang Belum Lunas (
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
                      emptyTitle="Tidak ada piutang pada bucket ini"
                      emptyDescription="Semua tagihan AR pada kategori umur ini sudah lunas atau kosong."
                    />
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* CREATE SALES INVOICE MODAL */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Terbitkan Sales Invoice (AR)"
        subtitle="Dari Sales Order (Confirmed/Delivered) atau Delivery Order (Dispatched/Delivered)"
        size="lg"
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
              form="create-sales-invoice-form"
              disabled={isCreating}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Terbitkan Sales Invoice
            </button>
          </>
        }
      >
        <form
          id="create-sales-invoice-form"
          onSubmit={handleCreateSubmit}
          className="space-y-4"
        >
          {createError && (
            <AlertBanner
              variant="error"
              title={
                createError.status === 409
                  ? "Duplikasi Request Ditolak (Idempotency Conflict)"
                  : createError.status === 422
                    ? "Validasi Sales Invoice Gagal"
                    : "Gagal Menerbitkan Sales Invoice"
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

          {/* Idempotency Key */}
          <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                Idempotency Key (UUID Proteksi Duplikat 409)
              </span>
              <button
                type="button"
                onClick={() => {
                  setIdempotencyKey(generateIdempotencyKey());
                  setCreateError(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
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
              className="mt-2 w-full rounded-lg border border-indigo-200 bg-white px-3 py-1.5 font-mono text-[11px] text-slate-700 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Source Mode Toggle */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Sumber Penagihan
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSourceMode("so");
                  setSelectedDoId("");
                }}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                  sourceMode === "so"
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Dari Sales Order (SO)
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("do")}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                  sourceMode === "do"
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Dari Delivery Order (DO)
              </button>
            </div>
          </div>

          {sourceMode === "do" ? (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Delivery Order (Dispatched / Delivered){" "}
                <span className="text-rose-600">*</span>
              </label>
              {canViewDo ? (
                <select
                  value={selectedDoId}
                  onChange={(e) => handleSelectDo(e.target.value)}
                  required
                  disabled={loadingOptions}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">
                    {loadingOptions
                      ? "Memuat daftar DO..."
                      : "-- Pilih Delivery Order --"}
                  </option>
                  {eligibleDos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.do_number} &rarr;{" "}
                      {d.sales_order?.so_number ?? `SO #${d.sales_order_id}`} —{" "}
                      {d.sales_order?.customer?.name ?? "Customer"} ({d.status})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={selectedDoId}
                  onChange={(e) => setSelectedDoId(e.target.value)}
                  placeholder="Masukkan ID Delivery Order..."
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                />
              )}
              {selectedDoObj && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Terhubung ke{" "}
                  <strong className="font-mono text-slate-800">
                    {selectedDoObj.sales_order?.so_number ??
                      `SO #${selectedDoObj.sales_order_id}`}
                  </strong>
                  . Kosongkan Total Tagihan agar backend menghitung otomatis
                  berdasarkan item DO &times; harga SO.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Sales Order (Confirmed / Partially Delivered / Completed){" "}
                  <span className="text-rose-600">*</span>
                </label>
                {canViewSo ? (
                  <select
                    value={selectedSoId}
                    onChange={(e) => handleSelectSo(e.target.value)}
                    required
                    disabled={loadingOptions}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">
                      {loadingOptions
                        ? "Memuat daftar SO..."
                        : "-- Pilih Sales Order --"}
                    </option>
                    {eligibleSos.map((so) => (
                      <option key={so.id} value={so.id}>
                        {so.so_number} —{" "}
                        {so.customer?.name ?? `Customer #${so.customer_id}`} (
                        {so.status}
                        {so.total_amount
                          ? ` • ${formatRupiah(so.total_amount)}`
                          : ""}
                        )
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={1}
                    value={selectedSoId}
                    onChange={(e) => setSelectedSoId(e.target.value)}
                    placeholder="Masukkan ID Sales Order..."
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                  />
                )}
              </div>

              {canViewDo && filteredDosForSelectedSo.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Tautkan Delivery Order{" "}
                    <span className="font-normal text-slate-400">
                      (opsional)
                    </span>
                  </label>
                  <select
                    value={selectedDoId}
                    onChange={(e) => setSelectedDoId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                  >
                    <option value="">
                      -- Tanpa DO spesifik (tagih sisa nilai SO) --
                    </option>
                    {filteredDosForSelectedSo.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.do_number} ({d.status} &bull;{" "}
                        {formatDate(d.delivery_date)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Nomor Invoice{" "}
                <span className="font-normal text-slate-400">(opsional)</span>
              </label>
              <input
                type="text"
                value={invoiceNumberInput}
                onChange={(e) => setInvoiceNumberInput(e.target.value)}
                placeholder="Auto-generate (INV-AR-YYYYMM-XXXX)"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Total Tagihan (Rp){" "}
                <span className="font-normal text-slate-400">
                  (opsional — auto jika kosong)
                </span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={totalBilledInput}
                onChange={(e) => setTotalBilledInput(e.target.value)}
                placeholder="Kosongkan untuk kalkulasi otomatis SO/DO"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-semibold text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
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
            ? `Detail Sales Invoice ${selectedInvoice.invoice_number}`
            : "Detail Sales Invoice"
        }
        subtitle={
          selectedInvoice?.customer?.name
            ? `Customer: ${selectedInvoice.customer.name}`
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
                <p className="text-[11px] text-slate-500">Kas Masuk</p>
                <p className="mt-1 font-mono font-bold text-emerald-700">
                  {formatRupiah(selectedInvoice.total_received ?? "0.00")}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sisa Piutang</p>
                <p className="mt-1 font-mono font-bold text-amber-800">
                  {formatRupiah(
                    selectedInvoice.remaining_balance ??
                      selectedInvoice.total_billed
                  )}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Referensi SO</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-800">
                  {selectedInvoice.sales_order?.so_number ??
                    `SO #${selectedInvoice.sales_order_id}`}
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

            {/* Customer Payments History */}
            <div>
              <h4 className="mb-2 text-xs font-bold text-slate-900">
                Riwayat Penerimaan Kas (Customer Payments)
              </h4>
              {selectedInvoice.customer_payments &&
              selectedInvoice.customer_payments.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                          Nomor Receipt
                        </th>
                        <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
                          Tanggal
                        </th>
                        <th className="px-3 py-2 text-center text-[11px] font-semibold text-slate-500">
                          Metode
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-semibold text-slate-500">
                          Kas Masuk
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {selectedInvoice.customer_payments.map((cp) => (
                        <tr key={cp.id}>
                          <td className="px-3 py-2 font-mono font-semibold text-indigo-700">
                            {cp.receipt_number}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {formatDate(cp.payment_date)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <PaymentMethodBadge method={cp.payment_method} />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                            {formatRupiah(cp.amount_received)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                  Belum ada pembayaran customer yang diterima untuk invoice ini.
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
              Diterbitkan pada {formatDateTime(selectedInvoice.created_at)}
            </p>
          </div>
        )}
      </Modal>

      {/* DELETE CONFIRM DIALOG */}
      <ConfirmDialog
        open={Boolean(deletingInvoice)}
        onClose={() => setDeletingInvoice(null)}
        onConfirm={handleConfirmDelete}
        title="Hapus Sales Invoice?"
        description={
          deletingInvoice ? (
            <>
              Sales Invoice{" "}
              <strong className="font-mono text-slate-900">
                {deletingInvoice.invoice_number}
              </strong>{" "}
              senilai{" "}
              <strong className="font-mono text-slate-900">
                {formatRupiah(deletingInvoice.total_billed)}
              </strong>{" "}
              akan dihapus (soft delete) dan jurnal balik (Debit{" "}
              <code className="font-mono">4101-SALES-REVENUE</code> / Credit{" "}
              <code className="font-mono">1102-AR</code>) akan dicatat otomatis.
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
