"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, History, RefreshCw, ShieldCheck } from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { StockMovementTypeBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDate,
  formatDateTime,
  formatMorphReference,
  formatNumber,
  parseDecimal,
  type ParsedApiError,
} from "@/lib/format";
import type {
  PaginatedResponse,
  PaginationMeta,
  Product,
  StockMovement,
  StockMovementType,
} from "@/types/erp";

type MovementTypeFilter = "all" | StockMovementType;

export default function StockMovementsPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("stock_movements.view");
  const canViewProducts = hasPermission("products.view");

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);

  // Filters
  const [products, setProducts] = useState<Product[]>([]);
  const [productFilter, setProductFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<MovementTypeFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
        // Optional dropdown
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

    const loadMovements = async () => {
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
        if (typeFilter !== "all") {
          params.type = typeFilter;
        }
        if (dateFrom !== "") {
          params.date_from = dateFrom;
        }
        if (dateTo !== "") {
          params.date_to = dateTo;
        }

        const res = await api.get<PaginatedResponse<StockMovement>>(
          "/inventory/stock-movements",
          { params }
        );
        if (!cancelled) {
          setMovements(res.data.data);
          setMeta(res.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(
            extractApiError(error, "Gagal memuat log Stock Movements.")
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadMovements();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    canView,
    page,
    productFilter,
    typeFilter,
    dateFrom,
    dateTo,
    reloadTick,
  ]);

  const handleResetFilters = () => {
    setProductFilter("");
    setTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasActiveFilters =
    productFilter !== "" ||
    typeFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "";

  const columns = useMemo<DataTableColumn<StockMovement>[]>(
    () => [
      {
        key: "id",
        header: "Log & Waktu",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-bold text-slate-900">
              #{row.id}
            </p>
            <p className="whitespace-nowrap text-[11px] text-slate-500">
              {formatDateTime(row.created_at)}
            </p>
          </div>
        ),
      },
      {
        key: "type",
        header: "Tipe Mutasi",
        align: "center",
        render: (row) => <StockMovementTypeBadge type={row.type} />,
      },
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
        key: "batch",
        header: "Batch & Expiry",
        render: (row) => (
          <div>
            <p className="font-mono text-xs font-semibold text-indigo-700">
              {row.batch?.batch_number ?? `Batch #${row.product_batch_id}`}
            </p>
            <p className="text-[11px] text-slate-500">
              Exp: {formatDate(row.batch?.expiry_date)}
            </p>
          </div>
        ),
      },
      {
        key: "qty_change",
        header: "Perubahan Qty",
        align: "right",
        render: (row) => {
          const val = parseDecimal(row.qty_change);
          const isPositive = val > 0;
          const isNegative = val < 0;
          return (
            <span
              className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${
                isPositive
                  ? "text-emerald-700"
                  : isNegative
                    ? "text-rose-700"
                    : "text-slate-700"
              }`}
            >
              {isPositive ? (
                <ArrowDownLeft className="h-3.5 w-3.5" />
              ) : isNegative ? (
                <ArrowUpRight className="h-3.5 w-3.5" />
              ) : null}
              {isPositive ? "+" : ""}
              {formatNumber(row.qty_change)}{" "}
              <span className="font-sans text-[11px] font-normal text-slate-500">
                {row.batch?.product?.uom ?? ""}
              </span>
            </span>
          );
        },
      },
      {
        key: "reference",
        header: "Dokumen Referensi",
        render: (row) => (
          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
            {formatMorphReference(row.reference_type, row.reference_id)}
          </span>
        ),
      },
      {
        key: "user",
        header: "Aktor",
        render: (row) =>
          row.user ? (
            <div>
              <p className="font-medium text-slate-800">{row.user.name}</p>
              <p className="text-[11px] text-slate-400">{row.user.email}</p>
            </div>
          ) : (
            <span className="text-slate-400">
              {row.user_id ? `User #${row.user_id}` : "Sistem"}
            </span>
          ),
      },
    ],
    []
  );

  return (
    <DashboardShell
      title="Stock Movements"
      subtitle="Buku besar log mutasi stok immutable (IN, OUT, ADJ) berbasis audit trail"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Stock Movements"
          requiredPermission="stock_movements.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Immutable Ledger Banner */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 shadow-2xs">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="leading-relaxed">
              <strong className="font-semibold text-slate-900">
                Immutable Stock Ledger (Append-Only):
              </strong>{" "}
              Setiap transaksi validasi <strong>Goods Receipt (IN)</strong>,
              dispatch <strong>Delivery Order (OUT)</strong>, dan{" "}
              <strong>Karantina / Penyesuaian (ADJ)</strong> dicatat permanen
              dan tidak dapat diubah atau dihapus.
            </p>
          </div>

          {/* Filter Toolbar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2.5">
              {canViewProducts && (
                <select
                  aria-label="Filter produk"
                  value={productFilter}
                  onChange={(e) => {
                    setProductFilter(e.target.value);
                    setPage(1);
                  }}
                  className="max-w-[240px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">Semua Produk</option>
                  {products.map((prod) => (
                    <option key={prod.id} value={prod.id}>
                      {prod.sku} — {prod.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                aria-label="Filter tipe mutasi"
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value as MovementTypeFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Tipe (IN / OUT / ADJ)</option>
                <option value="IN">IN — Stok Masuk</option>
                <option value="OUT">OUT — Stok Keluar</option>
                <option value="ADJ">ADJ — Penyesuaian / Karantina</option>
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
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                <History className="h-3.5 w-3.5 text-slate-500" />
                {meta?.total ?? movements.length} Log
              </span>
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
          </div>

          {pageError && (
            <AlertBanner
              variant="error"
              title="Gagal memuat Stock Movements"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={movements}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada riwayat mutasi stok"
            emptyDescription="Mutasi stok akan tercatat otomatis saat Goods Receipt divalidasi atau Delivery Order di-dispatch."
          />
        </div>
      )}
    </DashboardShell>
  );
}
