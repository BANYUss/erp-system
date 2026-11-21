"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Eye,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import {
  InvoiceStatusBadge,
  PaymentMethodBadge,
} from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDate,
  formatDateTime,
  formatRupiah,
  generateIdempotencyKey,
  getTodayDateString,
  parseDecimal,
  PAYMENT_METHOD_OPTIONS,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiResourceResponse,
  CreateCustomerPaymentPayload,
  CustomerPayment,
  PaginatedResponse,
  PaginationMeta,
  PaymentMethod,
  SalesInvoice,
} from "@/types/erp";

type PaymentMethodFilter = "all" | PaymentMethod;

export default function CustomerPaymentsPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("payments.view");
  const canCreate = hasPermission("payments.create");
  const canViewInvoices = hasPermission("invoices.view");

  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<PaymentMethodFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Detail modal
  const [selectedPayment, setSelectedPayment] =
    useState<CustomerPayment | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [receivableInvoices, setReceivableInvoices] = useState<SalesInvoice[]>(
    []
  );
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoicesLoadError, setInvoicesLoadError] = useState<string | null>(
    null
  );

  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [receiptNumberInput, setReceiptNumberInput] = useState("");
  const [amountReceivedInput, setAmountReceivedInput] = useState("");
  const [paymentDateInput, setPaymentDateInput] = useState("");
  const [paymentMethodInput, setPaymentMethodInput] =
    useState<PaymentMethod>("bank_transfer");
  const [idempotencyKey, setIdempotencyKey] = useState("");
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

    const loadPayments = async () => {
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
        if (methodFilter !== "all") {
          params.payment_method = methodFilter;
        }
        if (dateFrom !== "") {
          params.date_from = dateFrom;
        }
        if (dateTo !== "") {
          params.date_to = dateTo;
        }

        const res = await api.get<PaginatedResponse<CustomerPayment>>(
          "/customer-payments",
          { params }
        );
        if (!cancelled) {
          setPayments(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Customer Payments.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPayments();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    canView,
    page,
    appliedSearch,
    methodFilter,
    dateFrom,
    dateTo,
    reloadTick,
  ]);

  const loadReceivableInvoices = useCallback(async () => {
    if (!canViewInvoices) {
      setReceivableInvoices([]);
      return;
    }

    setLoadingInvoices(true);
    setInvoicesLoadError(null);
    try {
      const [unpaidRes, partialRes] = await Promise.all([
        api.get<PaginatedResponse<SalesInvoice>>("/sales-invoices", {
          params: { status: "Unpaid", per_page: 100 },
        }),
        api.get<PaginatedResponse<SalesInvoice>>("/sales-invoices", {
          params: { status: "Partially Paid", per_page: 100 },
        }),
      ]);
      const combined = [...unpaidRes.data.data, ...partialRes.data.data];
      const unique = Array.from(
        new Map(combined.map((inv) => [inv.id, inv])).values()
      ).sort((a, b) => b.id - a.id);
      setReceivableInvoices(unique);
    } catch (error) {
      setInvoicesLoadError(
        extractApiError(error, "Gagal memuat daftar Sales Invoice terbuka.")
          .message
      );
    } finally {
      setLoadingInvoices(false);
    }
  }, [canViewInvoices]);

  const selectedInvoiceObj = useMemo(
    () =>
      receivableInvoices.find(
        (inv) => String(inv.id) === selectedInvoiceId.trim()
      ) ?? null,
    [receivableInvoices, selectedInvoiceId]
  );

  const selectedRemainingBalance = useMemo(() => {
    if (!selectedInvoiceObj) {
      return null;
    }
    return parseDecimal(
      selectedInvoiceObj.remaining_balance ?? selectedInvoiceObj.total_billed
    );
  }, [selectedInvoiceObj]);

  const isClientOverpayment = useMemo(() => {
    if (selectedRemainingBalance === null || amountReceivedInput.trim() === "") {
      return false;
    }
    return (
      parseDecimal(amountReceivedInput) > selectedRemainingBalance + 0.0001
    );
  }, [selectedRemainingBalance, amountReceivedInput]);

  const openCreateModal = () => {
    setSelectedInvoiceId("");
    setReceiptNumberInput("");
    setAmountReceivedInput("");
    setPaymentDateInput(getTodayDateString());
    setPaymentMethodInput("bank_transfer");
    setIdempotencyKey(generateIdempotencyKey());
    setCreateError(null);
    setCreateModalOpen(true);
    void loadReceivableInvoices();
  };

  const handleSelectInvoice = (invId: string) => {
    setSelectedInvoiceId(invId);
    setCreateError(null);
    const found = receivableInvoices.find((inv) => String(inv.id) === invId);
    if (found) {
      const rem = found.remaining_balance ?? found.total_billed;
      setAmountReceivedInput(rem);
    } else {
      setAmountReceivedInput("");
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    const parsedInvId = Number(selectedInvoiceId.trim());
    if (!Number.isInteger(parsedInvId) || parsedInvId <= 0) {
      setCreateError({
        message: "Silakan pilih atau masukkan ID Sales Invoice yang valid.",
        fieldErrors: {},
      });
      return;
    }

    if (parseDecimal(amountReceivedInput) <= 0) {
      setCreateError({
        message: "Jumlah kas masuk (amount_received) harus lebih dari 0.",
        fieldErrors: {},
      });
      return;
    }

    if (!paymentDateInput) {
      setCreateError({
        message: "Tanggal penerimaan kas (payment_date) wajib diisi.",
        fieldErrors: {},
      });
      return;
    }

    const activeKey = idempotencyKey.trim() || generateIdempotencyKey();
    if (activeKey !== idempotencyKey) {
      setIdempotencyKey(activeKey);
    }

    const payload: CreateCustomerPaymentPayload = {
      sales_invoice_id: parsedInvId,
      amount_received: amountReceivedInput.trim(),
      payment_date: paymentDateInput,
      payment_method: paymentMethodInput,
      idempotency_key: activeKey,
    };

    if (receiptNumberInput.trim() !== "") {
      payload.receipt_number = receiptNumberInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<CustomerPayment>>(
        "/customer-payments",
        payload,
        {
          headers: {
            "Idempotency-Key": activeKey,
          },
        }
      );
      setSuccessMessage(
        res.data.message ||
          `Penerimaan kas ${res.data.data.receipt_number} berhasil dicatat dan jurnal AR telah dibuat.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(error, "Gagal mencatat pembayaran customer.")
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenDetail = async (payment: CustomerPayment) => {
    setSelectedPayment(payment);
    setIsLoadingDetail(true);
    try {
      const res = await api.get<ApiResourceResponse<CustomerPayment>>(
        `/customer-payments/${payment.id}`
      );
      setSelectedPayment(res.data.data);
    } catch {
      // Keep summary data
    } finally {
      setIsLoadingDetail(false);
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
    setMethodFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasActiveFilters =
    appliedSearch !== "" ||
    methodFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "";

  const columns = useMemo<DataTableColumn<CustomerPayment>[]>(
    () => [
      {
        key: "receipt_number",
        header: "Nomor Receipt & Tanggal",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-emerald-700">
              {row.receipt_number}
            </p>
            <p className="text-[11px] text-slate-500">
              Terima: {formatDate(row.payment_date)}
            </p>
          </div>
        ),
      },
      {
        key: "sales_invoice",
        header: "Sales Invoice & Customer",
        render: (row) => (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-slate-900">
                {row.sales_invoice?.invoice_number ??
                  `Invoice #${row.sales_invoice_id}`}
              </span>
              {row.sales_invoice?.status && (
                <InvoiceStatusBadge status={row.sales_invoice.status} />
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.sales_invoice?.customer?.name ??
                (row.sales_invoice
                  ? `Customer #${row.sales_invoice.customer_id}`
                  : "-")}
            </p>
          </div>
        ),
      },
      {
        key: "payment_method",
        header: "Metode",
        align: "center",
        render: (row) => <PaymentMethodBadge method={row.payment_method} />,
      },
      {
        key: "amount_received",
        header: "Kas Masuk",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-emerald-700">
            {formatRupiah(row.amount_received)}
          </span>
        ),
      },
      {
        key: "remaining_balance",
        header: "Sisa Piutang",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-semibold text-slate-700">
            {row.sales_invoice?.remaining_balance !== undefined
              ? formatRupiah(row.sales_invoice.remaining_balance)
              : "-"}
          </span>
        ),
      },
      {
        key: "idempotency_key",
        header: "Idempotency Key",
        render: (row) => (
          <span
            title={row.idempotency_key}
            className="inline-block max-w-[140px] truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600"
          >
            {row.idempotency_key}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Aksi",
        align: "right",
        render: (row) => (
          <button
            type="button"
            onClick={() => void handleOpenDetail(row)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
          >
            <Eye className="h-3.5 w-3.5" />
            Detail
          </button>
        ),
      },
    ],
    []
  );

  return (
    <DashboardShell
      title="Customer Payments (AR)"
      subtitle="Daftar kas masuk & pencatatan pelunasan piutang dari customer dengan proteksi idempotency UUID"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Customer Payments (AR)"
          requiredPermission="payments.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Policy Banner */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-950">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="leading-relaxed">
              <strong className="font-semibold">
                Pencatatan Kas Masuk &amp; Pelunasan AR:
              </strong>{" "}
              Dilindungi <strong>UUID idempotency_key</strong> terhadap duplikat
              (<strong>HTTP 409</strong>) dan menolak overpayment melebihi sisa
              piutang (<strong>HTTP 422</strong>). Status Sales Invoice otomatis
              diperbarui (Unpaid &rarr; Partially Paid &rarr; Paid) dengan
              jurnal{" "}
              <code className="font-mono font-semibold">1101-CASH-BANK</code>{" "}
              (D) / <code className="font-mono font-semibold">1102-AR</code>{" "}
              (K).
            </p>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs xl:flex-row xl:items-center xl:justify-between">
            <form
              onSubmit={handleSearchSubmit}
              className="flex flex-1 flex-wrap items-center gap-2.5"
            >
              <div className="relative min-w-[210px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Cari nomor receipt (RCP-...)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter metode pembayaran customer"
                value={methodFilter}
                onChange={(e) => {
                  setMethodFilter(e.target.value as PaymentMethodFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Metode</option>
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Tanggal mulai"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
                <span className="text-xs text-slate-400">s/d</span>
                <input
                  type="date"
                  aria-label="Tanggal akhir"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
              >
                Cari
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Reset
                </button>
              )}
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
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" />
                  Catat Pembayaran Customer
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
              title="Gagal memuat Customer Payments"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={payments}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada pencatatan kas masuk"
            emptyDescription="Catat pembayaran dari customer untuk melunasi piutang Sales Invoice."
          />
        </div>
      )}

      {/* CREATE CUSTOMER PAYMENT MODAL */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Catat Pembayaran Customer (Kas Masuk AR)"
        subtitle="Dilindungi UUID idempotency_key untuk mencegah pencatatan ganda & validasi overpayment"
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
              form="create-customer-payment-form"
              disabled={isCreating}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Simpan Kas Masuk
            </button>
          </>
        }
      >
        <form
          id="create-customer-payment-form"
          onSubmit={handleCreateSubmit}
          className="space-y-4"
        >
          {createError && (
            <AlertBanner
              variant="error"
              title={
                createError.status === 409
                  ? "Pembayaran Duplikat Ditolak (Idempotency Conflict)"
                  : createError.status === 422
                    ? "Pencatatan Ditolak (Validasi / Overpayment)"
                    : "Gagal Mencatat Pembayaran Customer"
              }
              message={createError.message}
              httpStatus={createError.status}
              fieldErrors={createError.fieldErrors}
              onDismiss={() => setCreateError(null)}
            />
          )}

          {invoicesLoadError && (
            <AlertBanner
              variant="warning"
              message={invoicesLoadError}
              onDismiss={() => setInvoicesLoadError(null)}
            />
          )}

          {/* Idempotency Key */}
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-950">
                <KeyRound className="h-4 w-4 text-emerald-600" />
                Idempotency Key (UUID Proteksi Duplikat 409)
              </span>
              <button
                type="button"
                onClick={() => {
                  setIdempotencyKey(generateIdempotencyKey());
                  setCreateError(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
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
              className="mt-2 w-full rounded-lg border border-emerald-200 bg-white px-3 py-1.5 font-mono text-[11px] text-slate-700 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Sales Invoice Selection */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Sales Invoice (Piutang Terbuka){" "}
              <span className="text-rose-600">*</span>
            </label>
            {canViewInvoices ? (
              <select
                value={selectedInvoiceId}
                onChange={(e) => handleSelectInvoice(e.target.value)}
                required
                disabled={loadingInvoices}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">
                  {loadingInvoices
                    ? "Memuat daftar Sales Invoice..."
                    : "-- Pilih Sales Invoice (Unpaid / Partially Paid) --"}
                </option>
                {receivableInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} —{" "}
                    {inv.customer?.name ?? `Customer #${inv.customer_id}`} (
                    {inv.status} &bull; Sisa:{" "}
                    {formatRupiah(inv.remaining_balance ?? inv.total_billed)})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={selectedInvoiceId}
                onChange={(e) => setSelectedInvoiceId(e.target.value)}
                placeholder="Masukkan ID Sales Invoice..."
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              />
            )}
          </div>

          {/* Selected Invoice Summary */}
          {selectedInvoiceObj && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-slate-500">Customer</p>
                <p className="mt-0.5 font-semibold text-slate-900">
                  {selectedInvoiceObj.customer?.name ??
                    `Customer #${selectedInvoiceObj.customer_id}`}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Total Tagihan</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-800">
                  {formatRupiah(selectedInvoiceObj.total_billed)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sudah Diterima</p>
                <p className="mt-0.5 font-mono font-semibold text-emerald-700">
                  {formatRupiah(selectedInvoiceObj.total_received ?? "0.00")}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sisa Piutang</p>
                <p className="mt-0.5 font-mono font-bold text-amber-800">
                  {formatRupiah(
                    selectedInvoiceObj.remaining_balance ??
                      selectedInvoiceObj.total_billed
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  Jumlah Kas Masuk (Rp) <span className="text-rose-600">*</span>
                </label>
                {selectedInvoiceObj && (
                  <button
                    type="button"
                    onClick={() =>
                      setAmountReceivedInput(
                        selectedInvoiceObj.remaining_balance ??
                          selectedInvoiceObj.total_billed
                      )
                    }
                    className="text-[11px] font-semibold text-emerald-700 hover:underline"
                  >
                    Terima Penuh
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amountReceivedInput}
                onChange={(e) => setAmountReceivedInput(e.target.value)}
                placeholder="0.00"
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              {isClientOverpayment && selectedRemainingBalance !== null && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Nominal melebihi sisa piutang (
                  {formatRupiah(selectedRemainingBalance)}) &mdash; akan ditolak
                  backend dengan HTTP 422.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Tanggal Pembayaran <span className="text-rose-600">*</span>
              </label>
              <input
                type="date"
                value={paymentDateInput}
                onChange={(e) => setPaymentDateInput(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Metode Pembayaran <span className="text-rose-600">*</span>
              </label>
              <select
                value={paymentMethodInput}
                onChange={(e) =>
                  setPaymentMethodInput(e.target.value as PaymentMethod)
                }
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
              >
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Nomor Receipt{" "}
                <span className="font-normal text-slate-400">(opsional)</span>
              </label>
              <input
                type="text"
                value={receiptNumberInput}
                onChange={(e) => setReceiptNumberInput(e.target.value)}
                placeholder="Auto-generate (RCP-YYYYMM-XXXX)"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* DETAIL MODAL */}
      <Modal
        open={Boolean(selectedPayment)}
        onClose={() => setSelectedPayment(null)}
        title={
          selectedPayment
            ? `Detail Customer Payment ${selectedPayment.receipt_number}`
            : "Detail Customer Payment"
        }
        size="lg"
      >
        {selectedPayment && (
          <div className="space-y-4">
            {isLoadingDetail && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                Memuat jurnal akuntansi terkait...
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-slate-500">Kas Masuk</p>
                <p className="mt-1 flex items-center gap-1 font-mono text-sm font-bold text-emerald-700">
                  <Banknote className="h-4 w-4" />
                  {formatRupiah(selectedPayment.amount_received)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Tanggal Terima</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {formatDate(selectedPayment.payment_date)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Metode</p>
                <div className="mt-1">
                  <PaymentMethodBadge method={selectedPayment.payment_method} />
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sales Invoice</p>
                <p className="mt-0.5 font-mono font-semibold text-indigo-700">
                  {selectedPayment.sales_invoice?.invoice_number ??
                    `Invoice #${selectedPayment.sales_invoice_id}`}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Status Invoice</p>
                <div className="mt-0.5">
                  {selectedPayment.sales_invoice?.status ? (
                    <InvoiceStatusBadge
                      status={selectedPayment.sales_invoice.status}
                    />
                  ) : (
                    "-"
                  )}
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sisa Piutang</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-800">
                  {selectedPayment.sales_invoice?.remaining_balance !==
                  undefined
                    ? formatRupiah(
                        selectedPayment.sales_invoice.remaining_balance
                      )
                    : "-"}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="text-[11px] text-slate-500">Idempotency Key</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-slate-700">
                  {selectedPayment.idempotency_key}
                </p>
              </div>
            </div>

            {selectedPayment.general_ledgers &&
              selectedPayment.general_ledgers.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Jurnal General Ledger Double-Entry
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50">
                        <tr>
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
                        {selectedPayment.general_ledgers.map((gl) => (
                          <tr key={gl.id}>
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
              Dicatat pada {formatDateTime(selectedPayment.created_at)}
            </p>
          </div>
        )}
      </Modal>
    </DashboardShell>
  );
}
