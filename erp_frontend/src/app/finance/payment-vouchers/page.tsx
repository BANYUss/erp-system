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
  CreatePaymentVoucherPayload,
  PaginatedResponse,
  PaginationMeta,
  PaymentMethod,
  PaymentVoucher,
  PurchaseInvoice,
} from "@/types/erp";

type PaymentMethodFilter = "all" | PaymentMethod;

export default function PaymentVouchersPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("payments.view");
  const canCreate = hasPermission("payments.create");
  const canViewInvoices = hasPermission("invoices.view");

  const [vouchers, setVouchers] = useState<PaymentVoucher[]>([]);
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
  const [selectedVoucher, setSelectedVoucher] = useState<PaymentVoucher | null>(
    null
  );
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [payableInvoices, setPayableInvoices] = useState<PurchaseInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [invoicesLoadError, setInvoicesLoadError] = useState<string | null>(
    null
  );

  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [voucherNumberInput, setVoucherNumberInput] = useState("");
  const [amountPaidInput, setAmountPaidInput] = useState("");
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

    const loadVouchers = async () => {
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

        const res = await api.get<PaginatedResponse<PaymentVoucher>>(
          "/payment-vouchers",
          { params }
        );
        if (!cancelled) {
          setVouchers(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat daftar Payment Voucher.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadVouchers();

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

  const loadPayableInvoices = useCallback(async () => {
    if (!canViewInvoices) {
      setPayableInvoices([]);
      return;
    }

    setLoadingInvoices(true);
    setInvoicesLoadError(null);
    try {
      const [unpaidRes, partialRes] = await Promise.all([
        api.get<PaginatedResponse<PurchaseInvoice>>("/purchase-invoices", {
          params: { status: "Unpaid", per_page: 100 },
        }),
        api.get<PaginatedResponse<PurchaseInvoice>>("/purchase-invoices", {
          params: { status: "Partially Paid", per_page: 100 },
        }),
      ]);
      const combined = [...unpaidRes.data.data, ...partialRes.data.data];
      const unique = Array.from(
        new Map(combined.map((inv) => [inv.id, inv])).values()
      ).sort((a, b) => b.id - a.id);
      setPayableInvoices(unique);
    } catch (error) {
      setInvoicesLoadError(
        extractApiError(error, "Gagal memuat daftar Purchase Invoice terbuka.")
          .message
      );
    } finally {
      setLoadingInvoices(false);
    }
  }, [canViewInvoices]);

  const selectedInvoiceObj = useMemo(
    () =>
      payableInvoices.find(
        (inv) => String(inv.id) === selectedInvoiceId.trim()
      ) ?? null,
    [payableInvoices, selectedInvoiceId]
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
    if (selectedRemainingBalance === null || amountPaidInput.trim() === "") {
      return false;
    }
    return parseDecimal(amountPaidInput) > selectedRemainingBalance + 0.0001;
  }, [selectedRemainingBalance, amountPaidInput]);

  const openCreateModal = () => {
    setSelectedInvoiceId("");
    setVoucherNumberInput("");
    setAmountPaidInput("");
    setPaymentDateInput(getTodayDateString());
    setPaymentMethodInput("bank_transfer");
    setIdempotencyKey(generateIdempotencyKey());
    setCreateError(null);
    setCreateModalOpen(true);
    void loadPayableInvoices();
  };

  const handleSelectInvoice = (invId: string) => {
    setSelectedInvoiceId(invId);
    setCreateError(null);
    const found = payableInvoices.find((inv) => String(inv.id) === invId);
    if (found) {
      const rem = found.remaining_balance ?? found.total_billed;
      setAmountPaidInput(rem);
    } else {
      setAmountPaidInput("");
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    const parsedInvId = Number(selectedInvoiceId.trim());
    if (!Number.isInteger(parsedInvId) || parsedInvId <= 0) {
      setCreateError({
        message: "Silakan pilih atau masukkan ID Purchase Invoice yang valid.",
        fieldErrors: {},
      });
      return;
    }

    if (parseDecimal(amountPaidInput) <= 0) {
      setCreateError({
        message: "Jumlah pembayaran (amount_paid) harus lebih dari 0.",
        fieldErrors: {},
      });
      return;
    }

    if (!paymentDateInput) {
      setCreateError({
        message: "Tanggal pembayaran (payment_date) wajib diisi.",
        fieldErrors: {},
      });
      return;
    }

    const activeKey = idempotencyKey.trim() || generateIdempotencyKey();
    if (activeKey !== idempotencyKey) {
      setIdempotencyKey(activeKey);
    }

    const payload: CreatePaymentVoucherPayload = {
      purchase_invoice_id: parsedInvId,
      amount_paid: amountPaidInput.trim(),
      payment_date: paymentDateInput,
      payment_method: paymentMethodInput,
      idempotency_key: activeKey,
    };

    if (voucherNumberInput.trim() !== "") {
      payload.voucher_number = voucherNumberInput.trim();
    }

    setIsCreating(true);

    try {
      const res = await api.post<ApiResourceResponse<PaymentVoucher>>(
        "/payment-vouchers",
        payload,
        {
          headers: {
            "Idempotency-Key": activeKey,
          },
        }
      );
      setSuccessMessage(
        res.data.message ||
          `Payment Voucher ${res.data.data.voucher_number} berhasil diproses dan jurnal AP dicatat.`
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(error, "Gagal memproses Payment Voucher.")
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenDetail = async (voucher: PaymentVoucher) => {
    setSelectedVoucher(voucher);
    setIsLoadingDetail(true);
    try {
      const res = await api.get<ApiResourceResponse<PaymentVoucher>>(
        `/payment-vouchers/${voucher.id}`
      );
      setSelectedVoucher(res.data.data);
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

  const columns = useMemo<DataTableColumn<PaymentVoucher>[]>(
    () => [
      {
        key: "voucher_number",
        header: "Nomor Voucher & Tanggal",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-indigo-700">
              {row.voucher_number}
            </p>
            <p className="text-[11px] text-slate-500">
              Bayar: {formatDate(row.payment_date)}
            </p>
          </div>
        ),
      },
      {
        key: "purchase_invoice",
        header: "Purchase Invoice & Supplier",
        render: (row) => (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-slate-900">
                {row.purchase_invoice?.invoice_number ??
                  `Invoice #${row.purchase_invoice_id}`}
              </span>
              {row.purchase_invoice?.status && (
                <InvoiceStatusBadge status={row.purchase_invoice.status} />
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {row.purchase_invoice?.supplier?.name ??
                (row.purchase_invoice
                  ? `Supplier #${row.purchase_invoice.supplier_id}`
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
        key: "amount_paid",
        header: "Jumlah Dibayar",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-rose-700">
            {formatRupiah(row.amount_paid)}
          </span>
        ),
      },
      {
        key: "remaining_balance",
        header: "Sisa Utang Invoice",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-semibold text-slate-700">
            {row.purchase_invoice?.remaining_balance !== undefined
              ? formatRupiah(row.purchase_invoice.remaining_balance)
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
      title="Payment Vouchers (AP)"
      subtitle="Pencatatan pembayaran utang usaha ke supplier dengan proteksi double-spend 409 & anti-overpayment 422"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Payment Vouchers (AP)"
          requiredPermission="payments.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Policy Banner */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
            <p className="leading-relaxed">
              <strong className="font-semibold">
                Proteksi Double-Spend &amp; Overpayment:
              </strong>{" "}
              Setiap transaksi Payment Voucher memakai{" "}
              <strong>UUID idempotency_key</strong> (duplikat ditolak{" "}
              <strong>HTTP 409</strong>) dan mengunci invoice untuk menolak
              pembayaran melebihi sisa utang (<strong>HTTP 422</strong>). Status
              Purchase Invoice diperbarui otomatis (Unpaid &rarr; Partially Paid
              &rarr; Paid) dengan jurnal{" "}
              <code className="font-mono font-semibold">2101-AP</code> (D) /{" "}
              <code className="font-mono font-semibold">1101-CASH-BANK</code>{" "}
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
                  placeholder="Cari nomor voucher (PV-...)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter metode pembayaran"
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
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                  Catat Pembayaran AP
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
              title="Gagal memuat Payment Vouchers"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={vouchers}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada Payment Voucher"
            emptyDescription="Catat pembayaran utang usaha supplier untuk melunasi Purchase Invoice."
          />
        </div>
      )}

      {/* CREATE PAYMENT VOUCHER MODAL */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Catat Pembayaran Utang Supplier (Payment Voucher)"
        subtitle="Dilindungi UUID idempotency_key untuk mencegah double-spend & validasi sisa utang"
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
              form="create-payment-voucher-form"
              disabled={isCreating}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Proses Pembayaran AP
            </button>
          </>
        }
      >
        <form
          id="create-payment-voucher-form"
          onSubmit={handleCreateSubmit}
          className="space-y-4"
        >
          {createError && (
            <AlertBanner
              variant="error"
              title={
                createError.status === 409
                  ? "Double-Spend Ditolak (Idempotency Conflict)"
                  : createError.status === 422
                    ? "Pembayaran Ditolak (Validasi / Overpayment)"
                    : "Gagal Mencatat Pembayaran"
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
          <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                Idempotency Key (UUID Proteksi Double-Spend 409)
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

          {/* Purchase Invoice Selection */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Purchase Invoice (AP Terbuka){" "}
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
                    ? "Memuat daftar Purchase Invoice..."
                    : "-- Pilih Purchase Invoice (Unpaid / Partially Paid) --"}
                </option>
                {payableInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} —{" "}
                    {inv.supplier?.name ?? `Supplier #${inv.supplier_id}`} (
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
                placeholder="Masukkan ID Purchase Invoice..."
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            )}
          </div>

          {/* Selected Invoice Summary Box */}
          {selectedInvoiceObj && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-slate-500">Supplier</p>
                <p className="mt-0.5 font-semibold text-slate-900">
                  {selectedInvoiceObj.supplier?.name ??
                    `Supplier #${selectedInvoiceObj.supplier_id}`}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Total Tagihan</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-800">
                  {formatRupiah(selectedInvoiceObj.total_billed)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sudah Dibayar</p>
                <p className="mt-0.5 font-mono font-semibold text-emerald-700">
                  {formatRupiah(selectedInvoiceObj.total_paid ?? "0.00")}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sisa Hutang</p>
                <p className="mt-0.5 font-mono font-bold text-rose-700">
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
                  Jumlah Pembayaran (Rp){" "}
                  <span className="text-rose-600">*</span>
                </label>
                {selectedInvoiceObj && (
                  <button
                    type="button"
                    onClick={() =>
                      setAmountPaidInput(
                        selectedInvoiceObj.remaining_balance ??
                          selectedInvoiceObj.total_billed
                      )
                    }
                    className="text-[11px] font-semibold text-indigo-600 hover:underline"
                  >
                    Bayar Penuh
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amountPaidInput}
                onChange={(e) => setAmountPaidInput(e.target.value)}
                placeholder="0.00"
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              {isClientOverpayment && selectedRemainingBalance !== null && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Nominal melebihi sisa tagihan (
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                Nomor Voucher{" "}
                <span className="font-normal text-slate-400">(opsional)</span>
              </label>
              <input
                type="text"
                value={voucherNumberInput}
                onChange={(e) => setVoucherNumberInput(e.target.value)}
                placeholder="Auto-generate (PV-YYYYMM-XXXX)"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* DETAIL MODAL */}
      <Modal
        open={Boolean(selectedVoucher)}
        onClose={() => setSelectedVoucher(null)}
        title={
          selectedVoucher
            ? `Detail Payment Voucher ${selectedVoucher.voucher_number}`
            : "Detail Payment Voucher"
        }
        size="lg"
      >
        {selectedVoucher && (
          <div className="space-y-4">
            {isLoadingDetail && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                Memuat jurnal akuntansi terkait...
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-slate-500">Jumlah Dibayar</p>
                <p className="mt-1 flex items-center gap-1 font-mono text-sm font-bold text-rose-700">
                  <Banknote className="h-4 w-4" />
                  {formatRupiah(selectedVoucher.amount_paid)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Tanggal Bayar</p>
                <p className="mt-1 font-semibold text-slate-900">
                  {formatDate(selectedVoucher.payment_date)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Metode</p>
                <div className="mt-1">
                  <PaymentMethodBadge method={selectedVoucher.payment_method} />
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Purchase Invoice</p>
                <p className="mt-0.5 font-mono font-semibold text-indigo-700">
                  {selectedVoucher.purchase_invoice?.invoice_number ??
                    `Invoice #${selectedVoucher.purchase_invoice_id}`}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Status Invoice</p>
                <div className="mt-0.5">
                  {selectedVoucher.purchase_invoice?.status ? (
                    <InvoiceStatusBadge
                      status={selectedVoucher.purchase_invoice.status}
                    />
                  ) : (
                    "-"
                  )}
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Sisa Hutang</p>
                <p className="mt-0.5 font-mono font-semibold text-slate-800">
                  {selectedVoucher.purchase_invoice?.remaining_balance !==
                  undefined
                    ? formatRupiah(
                        selectedVoucher.purchase_invoice.remaining_balance
                      )
                    : "-"}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <p className="text-[11px] text-slate-500">Idempotency Key</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-slate-700">
                  {selectedVoucher.idempotency_key}
                </p>
              </div>
            </div>

            {selectedVoucher.general_ledgers &&
              selectedVoucher.general_ledgers.length > 0 && (
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
                        {selectedVoucher.general_ledgers.map((gl) => (
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
              Dicatat pada {formatDateTime(selectedVoucher.created_at)}
            </p>
          </div>
        )}
      </Modal>
    </DashboardShell>
  );
}
