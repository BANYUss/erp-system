"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDate,
  formatDateTime,
  formatMorphReference,
  formatRupiah,
  getCoaAccountMeta,
  getTodayDateString,
  parseDecimal,
  STANDARD_COA_ACCOUNTS,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiResourceResponse,
  CreateGeneralLedgerPayload,
  GeneralLedgerEntry,
  PaginatedResponse,
  PaginationMeta,
  TrialBalanceSummary,
} from "@/types/erp";

const REFERENCE_TYPE_OPTIONS = [
  { value: "App\\Models\\GoodsReceipt", label: "Goods Receipt (GR)" },
  { value: "App\\Models\\PurchaseInvoice", label: "Purchase Invoice (AP)" },
  { value: "App\\Models\\PaymentVoucher", label: "Payment Voucher (AP)" },
  { value: "App\\Models\\DeliveryOrder", label: "Delivery Order (COGS)" },
  { value: "App\\Models\\SalesInvoice", label: "Sales Invoice (AR)" },
  { value: "App\\Models\\CustomerPayment", label: "Customer Payment (AR)" },
];

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  Aset: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  Liabilitas: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  Pendapatan: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  Beban: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
};

interface JournalLineDraft {
  key: string;
  account_code: string;
  debit: string;
  credit: string;
  description: string;
}

function createEmptyJournalLine(key: string): JournalLineDraft {
  return {
    key,
    account_code: "",
    debit: "0.00",
    credit: "0.00",
    description: "",
  };
}

export default function GeneralLedgerPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("general_ledger.view");
  const canManage = hasPermission("general_ledger.manage");

  // Journal entries
  const [entries, setEntries] = useState<GeneralLedgerEntry[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoadingEntries, setIsLoadingEntries] = useState(true);
  const [entriesError, setEntriesError] = useState<ParsedApiError | null>(null);

  // Trial balance summary
  const [trialBalance, setTrialBalance] = useState<TrialBalanceSummary | null>(
    null
  );
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters (date_from & date_to sync both Trial Balance & Journal Table)
  const [accountFilter, setAccountFilter] = useState("");
  const [referenceTypeFilter, setReferenceTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Manual journal entry modal
  const lineKeySeqRef = useRef(2);
  const nextLineKey = useCallback(() => {
    const key = `gl-line-${lineKeySeqRef.current}`;
    lineKeySeqRef.current += 1;
    return key;
  }, []);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [txDateInput, setTxDateInput] = useState("");
  const [journalLines, setJournalLines] = useState<JournalLineDraft[]>([
    createEmptyJournalLine("gl-line-0"),
    createEmptyJournalLine("gl-line-1"),
  ]);
  const [createError, setCreateError] = useState<ParsedApiError | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const triggerReload = useCallback(() => {
    setReloadTick((prev) => prev + 1);
  }, []);

  // Load Trial Balance Summary
  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    const loadSummary = async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      if (!canView) {
        setIsLoadingSummary(false);
        return;
      }

      setIsLoadingSummary(true);
      setSummaryError(null);

      try {
        const params: Record<string, string> = {};
        if (dateFrom !== "") {
          params.date_from = dateFrom;
        }
        if (dateTo !== "") {
          params.date_to = dateTo;
        }

        const res = await api.get<ApiResourceResponse<TrialBalanceSummary>>(
          "/general-ledgers/summary",
          { params }
        );
        if (!cancelled) {
          setTrialBalance(res.data.data);
        }
      } catch (error) {
        if (!cancelled) {
          setSummaryError(
            extractApiError(error, "Gagal memuat ringkasan Trial Balance.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSummary(false);
        }
      }
    };

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, dateFrom, dateTo, reloadTick]);

  // Load Journal Entries
  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    const loadEntries = async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      if (!canView) {
        setIsLoadingEntries(false);
        return;
      }

      setIsLoadingEntries(true);
      setEntriesError(null);

      try {
        const params: Record<string, string | number> = {
          page,
          per_page: 20,
        };
        if (accountFilter !== "") {
          params.account_code = accountFilter;
        }
        if (referenceTypeFilter !== "") {
          params.reference_type = referenceTypeFilter;
        }
        if (dateFrom !== "") {
          params.date_from = dateFrom;
        }
        if (dateTo !== "") {
          params.date_to = dateTo;
        }

        const res = await api.get<PaginatedResponse<GeneralLedgerEntry>>(
          "/general-ledgers",
          { params }
        );
        if (!cancelled) {
          setEntries(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setEntriesError(
            extractApiError(error, "Gagal memuat jurnal General Ledger.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEntries(false);
        }
      }
    };

    void loadEntries();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    canView,
    page,
    accountFilter,
    referenceTypeFilter,
    dateFrom,
    dateTo,
    reloadTick,
  ]);

  // Merge standard COA codes with any dynamic codes from Trial Balance
  const availableAccountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of STANDARD_COA_ACCOUNTS) {
      map.set(acc.code, `${acc.code} — ${acc.name}`);
    }
    if (trialBalance?.accounts) {
      for (const acc of trialBalance.accounts) {
        if (!map.has(acc.account_code)) {
          map.set(acc.account_code, acc.account_code);
        }
      }
    }
    return Array.from(map.entries()).map(([code, label]) => ({ code, label }));
  }, [trialBalance]);

  const draftTotals = useMemo(() => {
    const debit = journalLines.reduce(
      (sum, line) => sum + parseDecimal(line.debit),
      0
    );
    const credit = journalLines.reduce(
      (sum, line) => sum + parseDecimal(line.credit),
      0
    );
    return {
      debit,
      credit,
      diff: Math.abs(debit - credit),
      isBalanced: debit > 0 && Math.abs(debit - credit) < 0.005,
    };
  }, [journalLines]);

  const openCreateModal = () => {
    setTxDateInput(getTodayDateString());
    setJournalLines([
      {
        key: nextLineKey(),
        account_code: "1101-CASH-BANK",
        debit: "",
        credit: "0",
        description: "",
      },
      {
        key: nextLineKey(),
        account_code: "4101-SALES-REVENUE",
        debit: "0",
        credit: "",
        description: "",
      },
    ]);
    setCreateError(null);
    setCreateModalOpen(true);
  };

  const handleAddLine = () => {
    setJournalLines((prev) => [...prev, createEmptyJournalLine(nextLineKey())]);
  };

  const handleRemoveLine = (key: string) => {
    setJournalLines((prev) =>
      prev.length > 2 ? prev.filter((l) => l.key !== key) : prev
    );
  };

  const handleUpdateLine = (
    key: string,
    field: keyof Omit<JournalLineDraft, "key">,
    value: string
  ) => {
    setJournalLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [field]: value } : l))
    );
  };

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);

    if (!txDateInput) {
      setCreateError({
        message: "Tanggal transaksi wajib diisi.",
        fieldErrors: {},
      });
      return;
    }

    const payload: CreateGeneralLedgerPayload = {
      transaction_date: txDateInput,
      lines: journalLines.map((line) => ({
        account_code: line.account_code.trim(),
        debit: line.debit.trim() === "" ? "0.00" : line.debit.trim(),
        credit: line.credit.trim() === "" ? "0.00" : line.credit.trim(),
        description: line.description.trim() || null,
      })),
    };

    setIsCreating(true);
    try {
      const res = await api.post<ApiResourceResponse<GeneralLedgerEntry[]>>(
        "/general-ledgers",
        payload
      );
      setSuccessMessage(
        res.data.message || "Entri jurnal General Ledger berhasil dicatat."
      );
      setCreateModalOpen(false);
      triggerReload();
    } catch (error) {
      setCreateError(
        extractApiError(
          error,
          "Gagal mencatat entri jurnal. Pastikan Total Debit = Total Credit."
        )
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleResetFilters = () => {
    setAccountFilter("");
    setReferenceTypeFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasActiveFilters =
    accountFilter !== "" ||
    referenceTypeFilter !== "" ||
    dateFrom !== "" ||
    dateTo !== "";

  const columns = useMemo<DataTableColumn<GeneralLedgerEntry>[]>(
    () => [
      {
        key: "id",
        header: "ID & Tanggal",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-slate-900">
              #{row.id}
            </p>
            <p className="whitespace-nowrap text-[11px] font-medium text-slate-600">
              {formatDate(row.transaction_date)}
            </p>
          </div>
        ),
      },
      {
        key: "account_code",
        header: "Kode Akun (COA)",
        render: (row) => {
          const coa = getCoaAccountMeta(row.account_code);
          return (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                  {row.account_code}
                </span>
                {coa && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      CATEGORY_BADGE_CLASS[coa.category] ??
                      "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {coa.category}
                  </span>
                )}
              </div>
              {coa && (
                <p className="mt-0.5 text-[11px] text-slate-500">{coa.name}</p>
              )}
            </div>
          );
        },
      },
      {
        key: "description",
        header: "Keterangan Jurnal",
        render: (row) => (
          <p className="max-w-md text-xs leading-relaxed text-slate-700">
            {row.description ?? "-"}
          </p>
        ),
      },
      {
        key: "reference",
        header: "Referensi Dokumen",
        render: (row) => (
          <span className="inline-flex items-center whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
            {formatMorphReference(row.reference_type, row.reference_id)}
          </span>
        ),
      },
      {
        key: "debit",
        header: "Debit (Rp)",
        align: "right",
        render: (row) => {
          const val = parseDecimal(row.debit);
          return val > 0 ? (
            <span className="whitespace-nowrap font-mono text-xs font-bold text-emerald-700">
              {formatRupiah(row.debit)}
            </span>
          ) : (
            <span className="font-mono text-xs text-slate-300">-</span>
          );
        },
      },
      {
        key: "credit",
        header: "Credit (Rp)",
        align: "right",
        render: (row) => {
          const val = parseDecimal(row.credit);
          return val > 0 ? (
            <span className="whitespace-nowrap font-mono text-xs font-bold text-sky-700">
              {formatRupiah(row.credit)}
            </span>
          ) : (
            <span className="font-mono text-xs text-slate-300">-</span>
          );
        },
      },
      {
        key: "created_at",
        header: "Dicatat",
        render: (row) => (
          <span className="whitespace-nowrap text-[11px] text-slate-500">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <DashboardShell
      title="General Ledger & Trial Balance"
      subtitle="Buku besar jurnal akuntansi double-entry immutable dengan ringkasan Neraca Saldo real-time"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="General Ledger"
          requiredPermission="general_ledger.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Immutable Ledger Notice */}
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="leading-relaxed">
                <strong className="font-semibold text-slate-900">
                  Immutable Event-Driven General Ledger:
                </strong>{" "}
                Jurnal tercatat otomatis pada setiap event operasional (
                <code className="font-mono font-semibold">1201-INVENTORY</code>,{" "}
                <code className="font-mono font-semibold">2102-GRIR</code>,{" "}
                <code className="font-mono font-semibold">2101-AP</code>,{" "}
                <code className="font-mono font-semibold">1101-CASH-BANK</code>,{" "}
                <code className="font-mono font-semibold">1102-AR</code>,{" "}
                <code className="font-mono font-semibold">
                  4101-SALES-REVENUE
                </code>
                , <code className="font-mono font-semibold">5101-COGS</code>)
                dan bersifat <strong>append-only</strong> (tidak dapat diubah
                atau dihapus).
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Jurnal Manual
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

          {summaryError && (
            <AlertBanner
              variant="error"
              title="Gagal memuat Trial Balance"
              message={summaryError.message}
              httpStatus={summaryError.status}
              onDismiss={() => setSummaryError(null)}
            />
          )}

          {/* TRIAL BALANCE SUMMARY CARDS */}
          <section className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-emerald-200/80 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Total Debit (Trial Balance)</span>
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    DEBIT
                  </span>
                </div>
                <p className="mt-2 font-mono text-xl font-bold text-emerald-700">
                  {isLoadingSummary && !trialBalance
                    ? "..."
                    : formatRupiah(trialBalance?.grand_total_debit ?? "0.00")}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {dateFrom || dateTo
                    ? `Periode ${dateFrom || "awal"} s/d ${dateTo || "sekarang"}`
                    : "Seluruh periode tercatat"}
                </p>
              </div>

              <div className="rounded-2xl border border-sky-200/80 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Total Credit (Trial Balance)</span>
                  <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                    CREDIT
                  </span>
                </div>
                <p className="mt-2 font-mono text-xl font-bold text-sky-700">
                  {isLoadingSummary && !trialBalance
                    ? "..."
                    : formatRupiah(trialBalance?.grand_total_credit ?? "0.00")}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Kalkulasi presisi BCMath backend
                </p>
              </div>

              <div
                className={`rounded-2xl border p-4 shadow-2xs ${
                  trialBalance?.is_balanced ?? true
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-rose-200 bg-rose-50/50"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Status Neraca Saldo</span>
                  <Scale
                    className={`h-4 w-4 ${
                      trialBalance?.is_balanced ?? true
                        ? "text-emerald-600"
                        : "text-rose-600"
                    }`}
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {trialBalance?.is_balanced ?? true ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      <span className="text-base font-bold text-emerald-800">
                        Balanced (Seimbang)
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-5 w-5 text-rose-600" />
                      <span className="text-base font-bold text-rose-800">
                        Tidak Seimbang
                      </span>
                    </>
                  )}
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-600">
                  Selisih:{" "}
                  {formatRupiah(
                    Math.abs(
                      parseDecimal(trialBalance?.grand_total_debit) -
                        parseDecimal(trialBalance?.grand_total_credit)
                    )
                  )}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Akun COA Aktif</span>
                  <Landmark className="h-4 w-4 text-indigo-600" />
                </div>
                <p className="mt-2 font-mono text-xl font-bold text-slate-900">
                  {trialBalance?.accounts.length ?? 0}{" "}
                  <span className="font-sans text-xs font-normal text-slate-400">
                    akun
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {meta?.total ?? entries.length} baris entri jurnal
                </p>
              </div>
            </div>

            {/* Trial Balance Table per COA Account */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Ringkasan Trial Balance per Akun COA
                  </h3>
                </div>
                <span className="text-[11px] text-slate-500">
                  Klik baris akun untuk memfilter tabel jurnal di bawah
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Kode Akun COA
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Nama Akun &amp; Kategori
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                        Total Debit
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-sky-700">
                        Total Credit
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                        Net Balance (D - K)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {isLoadingSummary && !trialBalance ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-xs text-slate-500"
                        >
                          Memuat Trial Balance...
                        </td>
                      </tr>
                    ) : !trialBalance || trialBalance.accounts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-xs text-slate-500"
                        >
                          Belum ada transaksi jurnal tercatat pada periode ini.
                        </td>
                      </tr>
                    ) : (
                      trialBalance.accounts.map((acc) => {
                        const coa = getCoaAccountMeta(acc.account_code);
                        const isSelected = accountFilter === acc.account_code;
                        const net = parseDecimal(acc.net_balance);

                        return (
                          <tr
                            key={acc.account_code}
                            onClick={() => {
                              setAccountFilter(
                                isSelected ? "" : acc.account_code
                              );
                              setPage(1);
                            }}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-indigo-50/70"
                                : "hover:bg-slate-50/80"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                                {acc.account_code}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900">
                                  {coa?.name ?? "Akun General Ledger"}
                                </span>
                                {coa && (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      CATEGORY_BADGE_CLASS[coa.category] ??
                                      "bg-slate-100 text-slate-600"
                                    }`}
                                  >
                                    {coa.category}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700">
                              {formatRupiah(acc.total_debit)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-sky-700">
                              {formatRupiah(acc.total_credit)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono font-bold ${
                                net > 0
                                  ? "text-emerald-700"
                                  : net < 0
                                    ? "text-sky-700"
                                    : "text-slate-500"
                              }`}
                            >
                              {formatRupiah(acc.net_balance)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {trialBalance && trialBalance.accounts.length > 0 && (
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                      <tr>
                        <td colSpan={2} className="px-4 py-3 text-slate-900">
                          Grand Total Trial Balance
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700">
                          {formatRupiah(trialBalance.grand_total_debit)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sky-700">
                          {formatRupiah(trialBalance.grand_total_credit)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-900">
                          {trialBalance.is_balanced ? "Rp0 (Balanced)" : "Selisih"}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </section>

          {/* FILTER TOOLBAR FOR JOURNAL ENTRIES */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2.5">
              <select
                aria-label="Filter kode akun COA"
                value={accountFilter}
                onChange={(e) => {
                  setAccountFilter(e.target.value);
                  setPage(1);
                }}
                className="max-w-[260px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Semua Kode Akun (COA)</option>
                {availableAccountOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter jenis dokumen referensi"
                value={referenceTypeFilter}
                onChange={(e) => {
                  setReferenceTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Semua Referensi</option>
                {REFERENCE_TYPE_OPTIONS.map((opt) => (
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

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Reset
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={triggerReload}
              disabled={isLoadingEntries || isLoadingSummary}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isLoadingEntries || isLoadingSummary ? "animate-spin" : ""
                }`}
              />
              Muat Ulang
            </button>
          </div>

          {entriesError && (
            <AlertBanner
              variant="error"
              title="Gagal memuat Jurnal General Ledger"
              message={entriesError.message}
              httpStatus={entriesError.status}
              fieldErrors={entriesError.fieldErrors}
              onDismiss={() => setEntriesError(null)}
            />
          )}

          {/* IMMUTABLE JOURNAL TABLE */}
          <DataTable
            columns={columns}
            data={entries}
            rowKey={(row) => row.id}
            isLoading={isLoadingEntries}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada entri jurnal General Ledger"
            emptyDescription="Jurnal akan tercatat otomatis saat Goods Receipt, Invoice, Delivery Order, atau Pembayaran diproses."
          />
        </div>
      )}

      {/* MANUAL JOURNAL ENTRY MODAL (general_ledger.manage) */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Catat Entri Jurnal Manual (Double-Entry)"
        subtitle="Total Debit harus sama persis dengan Total Credit — entri bersifat immutable setelah tersimpan"
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
              form="create-manual-journal-form"
              disabled={isCreating}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Posting Jurnal
            </button>
          </>
        }
      >
        <form
          id="create-manual-journal-form"
          onSubmit={handleCreateSubmit}
          className="space-y-4"
        >
          {createError && (
            <AlertBanner
              variant="error"
              title="Validasi Jurnal Gagal"
              message={createError.message}
              httpStatus={createError.status}
              fieldErrors={createError.fieldErrors}
              onDismiss={() => setCreateError(null)}
            />
          )}

          <div className="max-w-xs">
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Tanggal Transaksi <span className="text-rose-600">*</span>
            </label>
            <input
              type="date"
              value={txDateInput}
              onChange={(e) => setTxDateInput(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900">
                Baris Jurnal Double-Entry (Min. 2 Baris)
              </h4>
              <button
                type="button"
                onClick={handleAddLine}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Baris
              </button>
            </div>

            <datalist id="coa-account-suggestions">
              {STANDARD_COA_ACCOUNTS.map((acc) => (
                <option key={acc.code} value={acc.code}>
                  {acc.name}
                </option>
              ))}
            </datalist>

            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              {journalLines.map((line, idx) => (
                <div
                  key={line.key}
                  className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-3">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                      Kode Akun #{idx + 1}
                    </label>
                    <input
                      type="text"
                      list="coa-account-suggestions"
                      value={line.account_code}
                      onChange={(e) =>
                        handleUpdateLine(
                          line.key,
                          "account_code",
                          e.target.value
                        )
                      }
                      placeholder="mis. 1101-CASH-BANK"
                      required
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] font-semibold text-emerald-700">
                      Debit (Rp)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.debit}
                      onChange={(e) =>
                        handleUpdateLine(line.key, "debit", e.target.value)
                      }
                      required
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] font-semibold text-sky-700">
                      Credit (Rp)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.credit}
                      onChange={(e) =>
                        handleUpdateLine(line.key, "credit", e.target.value)
                      }
                      required
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                      Keterangan
                    </label>
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) =>
                        handleUpdateLine(
                          line.key,
                          "description",
                          e.target.value
                        )
                      }
                      placeholder="Deskripsi penyesuaian jurnal..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end sm:col-span-1">
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(line.key)}
                      disabled={journalLines.length <= 2}
                      className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                      aria-label="Hapus baris jurnal"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Balance Check Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    Total Debit:{" "}
                    <strong className="font-mono text-emerald-700">
                      {formatRupiah(draftTotals.debit)}
                    </strong>
                  </span>
                  <span>
                    Total Credit:{" "}
                    <strong className="font-mono text-sky-700">
                      {formatRupiah(draftTotals.credit)}
                    </strong>
                  </span>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    draftTotals.isBalanced
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                      : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20"
                  }`}
                >
                  {draftTotals.isBalanced ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Seimbang (Siap Posting)
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Selisih {formatRupiah(draftTotals.diff)}
                    </>
                  )}
                </span>
              </div>
            </div>
          </div>
        </form>
      </Modal>
    </DashboardShell>
  );
}
