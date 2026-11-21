"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Lock,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { InventoryStateBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  daysUntilDate,
  extractApiError,
  formatDate,
  formatNumber,
  formatRupiah,
  parseDecimal,
  type ParsedApiError,
} from "@/lib/format";
import type {
  InventoryLedger,
  InventoryLedgerState,
  PaginatedResponse,
  PaginationMeta,
  Product,
} from "@/types/erp";

type StateFilter = "all" | InventoryLedgerState;

const STATE_OPTIONS: { value: InventoryLedgerState; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "in_transit", label: "In Transit" },
  { value: "in_qc", label: "In QC (Karantina)" },
];

export default function InventoryLedgersPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission([
    "inventory.view_available",
    "inventory.view_physical",
    "inventory.view_cost",
  ]);
  const canViewAllStates = hasPermission([
    "inventory.view_physical",
    "inventory.view_cost",
  ]);
  const canViewCost = hasPermission("inventory.view_cost");
  const canViewProducts = hasPermission("products.view");

  const [ledgers, setLedgers] = useState<InventoryLedger[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);

  // Filter options & state
  const [products, setProducts] = useState<Product[]>([]);
  const [batchInput, setBatchInput] = useState("");
  const [appliedBatch, setAppliedBatch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [expiringDays, setExpiringDays] = useState("");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  const triggerReload = useCallback(() => {
    setReloadTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (authLoading || !canView || !canViewProducts) {
      return;
    }

    let cancelled = false;
    api
      .get<PaginatedResponse<Product>>("/products", {
        params: { per_page: 100 },
      })
      .then((res) => {
        if (!cancelled) {
          setProducts(res.data.data);
        }
      })
      .catch(() => {
        // Optional filter dropdown; ignore failure silently
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, canViewProducts]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    const loadLedgers = async () => {
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
        if (productFilter !== "") {
          params.product_id = Number(productFilter);
        }
        if (appliedBatch.trim() !== "") {
          params.batch_number = appliedBatch.trim();
        }
        if (canViewAllStates && stateFilter !== "all") {
          params.state = stateFilter;
        }
        if (expiringDays !== "") {
          params.expiring_within_days = Number(expiringDays);
        }

        const res = await api.get<PaginatedResponse<InventoryLedger>>(
          "/inventory/ledgers",
          { params }
        );
        if (!cancelled) {
          setLedgers(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat data Inventory Ledgers.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadLedgers();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    canView,
    canViewAllStates,
    page,
    productFilter,
    appliedBatch,
    stateFilter,
    expiringDays,
    reloadTick,
  ]);

  // Sembunyikan cost_price & inventory_value jika tidak ada di response API atau role tidak berizin
  const hasCostPriceInResponse = useMemo(() => {
    if (!canViewCost) {
      return false;
    }
    if (ledgers.length === 0) {
      return false;
    }
    return ledgers.some((row) => row.cost_price !== undefined);
  }, [canViewCost, ledgers]);

  const hasInventoryValueInResponse = useMemo(() => {
    if (!canViewCost) {
      return false;
    }
    if (ledgers.length === 0) {
      return false;
    }
    return ledgers.some((row) => row.inventory_value !== undefined);
  }, [canViewCost, ledgers]);

  const pageSummary = useMemo(() => {
    let totalQty = 0;
    let totalValue = 0;
    let nearExpiryCount = 0;

    for (const row of ledgers) {
      totalQty += parseDecimal(row.qty);
      if (row.inventory_value !== undefined) {
        totalValue += parseDecimal(row.inventory_value);
      }
      const days = daysUntilDate(row.batch?.expiry_date);
      if (days !== null && days <= 30 && parseDecimal(row.qty) > 0) {
        nearExpiryCount += 1;
      }
    }

    return { totalQty, totalValue, nearExpiryCount };
  }, [ledgers]);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(1);
    setAppliedBatch(batchInput);
  };

  const handleResetFilters = () => {
    setBatchInput("");
    setAppliedBatch("");
    setProductFilter("");
    setStateFilter("all");
    setExpiringDays("");
    setPage(1);
  };

  const hasActiveFilters =
    appliedBatch !== "" ||
    productFilter !== "" ||
    (canViewAllStates && stateFilter !== "all") ||
    expiringDays !== "";

  const columns = useMemo<DataTableColumn<InventoryLedger>[]>(() => {
    const baseCols: DataTableColumn<InventoryLedger>[] = [
      {
        key: "product",
        header: "Produk",
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-900">
              {row.batch?.product?.name ??
                `Produk #${row.batch?.product_id ?? "-"}`}
            </p>
            <p className="font-mono text-[11px] text-slate-400">
              {row.batch?.product?.sku ?? "-"}
            </p>
          </div>
        ),
      },
      {
        key: "batch_number",
        header: "Batch Number",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-indigo-700">
            {row.batch?.batch_number ?? `Batch #${row.product_batch_id}`}
          </span>
        ),
      },
      {
        key: "expiry_date",
        header: "Expiry Date",
        render: (row) => {
          const days = daysUntilDate(row.batch?.expiry_date);
          const isExpired = days !== null && days < 0;
          const isNearExpiry = days !== null && days >= 0 && days <= 30;
          return (
            <div className="flex flex-col gap-0.5">
              <span
                className={`whitespace-nowrap font-medium ${
                  isExpired
                    ? "text-rose-700"
                    : isNearExpiry
                      ? "text-amber-700"
                      : "text-slate-700"
                }`}
              >
                {formatDate(row.batch?.expiry_date)}
              </span>
              {isExpired && (
                <span className="inline-flex w-fit items-center rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
                  Kedaluwarsa ({Math.abs(days)} hr lalu)
                </span>
              )}
              {isNearExpiry && (
                <span className="inline-flex w-fit items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">
                  Sisa {days} hari
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "state",
        header: "State Stok",
        align: "center",
        render: (row) => <InventoryStateBadge state={row.state} />,
      },
      {
        key: "qty",
        header: "Qty",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-slate-900">
            {formatNumber(row.qty)}{" "}
            <span className="font-sans text-[11px] font-normal text-slate-500">
              {row.batch?.product?.uom ?? ""}
            </span>
          </span>
        ),
      },
    ];

    if (hasCostPriceInResponse) {
      baseCols.push({
        key: "cost_price",
        header: "HPP MWA (Cost Price)",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-medium text-slate-800">
            {row.cost_price !== undefined ? formatRupiah(row.cost_price) : "-"}
          </span>
        ),
      });
    }

    if (hasInventoryValueInResponse) {
      baseCols.push({
        key: "inventory_value",
        header: "Valuasi Stok",
        align: "right",
        render: (row) => (
          <span className="font-mono text-xs font-bold text-emerald-700">
            {row.inventory_value !== undefined
              ? formatRupiah(row.inventory_value)
              : "-"}
          </span>
        ),
      });
    }

    return baseCols;
  }, [hasCostPriceInResponse, hasInventoryValueInResponse]);

  return (
    <DashboardShell
      title="Inventory Ledgers"
      subtitle="Monitoring stok persediaan per produk, batch, expiry date, dan status ketersediaan (available / in_qc)"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Inventory Ledgers"
          requiredPermission="inventory.view_available | inventory.view_physical | inventory.view_cost"
        />
      ) : (
        <div className="space-y-5">
          {/* RBAC Visibility Notice */}
          {!canViewCost && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-xs text-amber-900">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="leading-relaxed">
                <strong className="font-semibold">
                  Pembatasan Data Finansial (RBAC):
                </strong>{" "}
                Kolom{" "}
                <code className="font-mono font-semibold">cost_price</code> dan{" "}
                <code className="font-mono font-semibold">inventory_value</code>{" "}
                disembunyikan secara otomatis karena peran Anda tidak memiliki
                izin{" "}
                <code className="font-mono font-semibold">
                  inventory.view_cost
                </code>
                .
                {!canViewAllStates &&
                  " Selain itu, tampilan state stok dikunci khusus pada stok available."}
              </p>
            </div>
          )}

          {/* Summary KPI Cards */}
          <div
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
              hasInventoryValueInResponse ? "lg:grid-cols-4" : "lg:grid-cols-3"
            }`}
          >
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Total Baris Ledger</span>
                <Boxes className="h-4 w-4 text-indigo-600" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
                {meta?.total ?? ledgers.length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Entri stok sesuai filter aktif
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Total Qty (Halaman Ini)</span>
                <Boxes className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
                {formatNumber(pageSummary.totalQty)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Akumulasi kuantitas pada halaman aktif
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Batch Mendekati Expiry (&le; 30 Hr)</span>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-amber-700">
                {pageSummary.nearExpiryCount}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Batch dengan qty &gt; 0 pada halaman ini
              </p>
            </div>

            {hasInventoryValueInResponse && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Total Valuasi (Halaman Ini)</span>
                  <Wallet className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="mt-2 font-mono text-xl font-bold text-emerald-700">
                  {formatRupiah(pageSummary.totalValue)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Berdasarkan HPP MWA (cost_price &times; qty)
                </p>
              </div>
            )}
          </div>

          {/* Filter Toolbar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
            <form
              onSubmit={handleSearchSubmit}
              className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="flex flex-1 flex-wrap items-center gap-2.5">
                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={batchInput}
                    onChange={(e) => setBatchInput(e.target.value)}
                    placeholder="Cari nomor batch..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                {canViewProducts && (
                  <select
                    aria-label="Filter produk"
                    value={productFilter}
                    onChange={(e) => {
                      setProductFilter(e.target.value);
                      setPage(1);
                    }}
                    className="max-w-[230px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">Semua Produk</option>
                    {products.map((prod) => (
                      <option key={prod.id} value={prod.id}>
                        {prod.sku} — {prod.name}
                      </option>
                    ))}
                  </select>
                )}

                {canViewAllStates ? (
                  <select
                    aria-label="Filter state stok"
                    value={stateFilter}
                    onChange={(e) => {
                      setStateFilter(e.target.value as StateFilter);
                      setPage(1);
                    }}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="all">Semua State</option>
                    {STATE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                    State: Available Only
                  </span>
                )}

                <select
                  aria-label="Filter masa kedaluwarsa"
                  value={expiringDays}
                  onChange={(e) => {
                    setExpiringDays(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">Semua Masa Expiry</option>
                  <option value="30">Expired &le; 30 hari</option>
                  <option value="60">Expired &le; 60 hari</option>
                  <option value="90">Expired &le; 90 hari</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  Terapkan
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
              </div>
            </form>
          </div>

          {pageError && (
            <AlertBanner
              variant="error"
              title="Gagal memuat Inventory Ledgers"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={ledgers}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada data Inventory Ledger"
            emptyDescription="Stok akan otomatis muncul setelah dokumen Goods Receipt divalidasi."
          />
        </div>
      )}
    </DashboardShell>
  );
}
