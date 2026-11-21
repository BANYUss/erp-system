"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Layers,
  Loader2,
  PackageSearch,
  Play,
  RotateCcw,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
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
  ApiResourceResponse,
  FefoPickingResult,
  PaginatedResponse,
  Product,
} from "@/types/erp";

export default function FefoPickingPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission([
    "inventory.view_available",
    "inventory.view_physical",
  ]);
  const canViewCost = hasPermission("inventory.view_cost");
  const canViewProducts = hasPermission("products.view");

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [qtyInput, setQtyInput] = useState("10");

  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError] = useState<ParsedApiError | null>(null);
  const [result, setResult] = useState<FefoPickingResult | null>(null);

  useEffect(() => {
    if (authLoading || !canView || !canViewProducts) {
      return;
    }

    let cancelled = false;

    const loadProducts = async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      setLoadingProducts(true);
      try {
        const res = await api.get<PaginatedResponse<Product>>("/products", {
          params: { is_active: "1", per_page: 100 },
        });
        if (!cancelled) {
          setProducts(res.data.data);
        }
      } catch {
        // Optional product list
      } finally {
        if (!cancelled) {
          setLoadingProducts(false);
        }
      }
    };

    void loadProducts();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, canViewProducts]);

  const handleSimulate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSimError(null);

    const parsedProductId = Number(selectedProductId);
    const parsedQty = parseDecimal(qtyInput);

    if (!Number.isInteger(parsedProductId) || parsedProductId <= 0) {
      setSimError({
        message: "Silakan pilih produk terlebih dahulu.",
        fieldErrors: {},
      });
      return;
    }

    if (parsedQty <= 0) {
      setSimError({
        message: "Kuantitas permintaan (qty) harus lebih dari 0.",
        fieldErrors: {},
      });
      return;
    }

    setIsSimulating(true);

    try {
      const res = await api.get<ApiResourceResponse<FefoPickingResult>>(
        "/inventory/fefo-picking",
        {
          params: {
            product_id: parsedProductId,
            qty: qtyInput.trim(),
          },
        }
      );
      setResult(res.data.data);
    } catch (error) {
      setResult(null);
      setSimError(
        extractApiError(error, "Gagal menjalankan simulasi FEFO Picking.")
      );
    } finally {
      setIsSimulating(false);
    }
  };

  const handleReset = () => {
    setSelectedProductId("");
    setQtyInput("10");
    setResult(null);
    setSimError(null);
  };

  const showCostColumn = useMemo(() => {
    if (!canViewCost || !result) {
      return false;
    }
    return result.picking_list.some((item) => item.cost_price !== undefined);
  }, [canViewCost, result]);

  const selectedProductInfo = useMemo(
    () => products.find((p) => String(p.id) === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  return (
    <DashboardShell
      title="FEFO Picking Simulator"
      subtitle="Simulasi & saran pengambilan barang otomatis (First Expired, First Out) berdasarkan expiry date terdekat"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="FEFO Picking"
          requiredPermission="inventory.view_available | inventory.view_physical"
        />
      ) : (
        <div className="space-y-6">
          {/* Explanation Banner */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-950">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
            <p className="leading-relaxed">
              <strong className="font-semibold">
                Algoritma FEFO (First Expired, First Out):
              </strong>{" "}
              Sistem hanya mengalokasikan batch berstatus{" "}
              <code className="font-mono font-semibold">available</code> yang
              belum kedaluwarsa, diurutkan dari{" "}
              <strong>expiry_date terdekat</strong>. Simulasi ini bersifat
              read-only (tidak memotong stok fisik) dan menampilkan{" "}
              <code className="font-mono font-semibold">shortage_qty</code> jika
              stok tersedia tidak mencukupi.
            </p>
          </div>

          {/* Simulation Form */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-6">
            <form
              onSubmit={handleSimulate}
              className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end"
            >
              <div className="md:col-span-6">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Pilih Produk <span className="text-rose-500">*</span>
                </label>
                {canViewProducts ? (
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    disabled={loadingProducts || isSimulating}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">
                      {loadingProducts
                        ? "Memuat daftar produk aktif..."
                        : "-- Pilih Produk untuk Simulasi FEFO --"}
                    </option>
                    {products.map((prod) => (
                      <option key={prod.id} value={prod.id}>
                        {prod.sku} — {prod.name} ({prod.uom})
                        {prod.available_qty !== undefined
                          ? ` • Avail: ${formatNumber(prod.available_qty)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    placeholder="Masukkan ID Produk"
                    required
                    disabled={isSimulating}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                )}
              </div>

              <div className="md:col-span-3">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Kuantitas Picking{" "}
                  {selectedProductInfo ? `(${selectedProductInfo.uom})` : ""}{" "}
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  placeholder="Mis. 25"
                  required
                  disabled={isSimulating}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex items-center gap-2 md:col-span-3">
                <button
                  type="submit"
                  disabled={isSimulating || loadingProducts}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSimulating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Hitung Saran FEFO
                </button>
                {result && (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={isSimulating}
                    title="Reset simulasi"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>
            </form>
          </section>

          {simError && (
            <AlertBanner
              variant="error"
              title="Simulasi FEFO Gagal"
              message={simError.message}
              httpStatus={simError.status}
              fieldErrors={simError.fieldErrors}
              onDismiss={() => setSimError(null)}
            />
          )}

          {/* Simulation Result */}
          {result ? (
            <div className="space-y-5">
              {/* Fulfillment / Shortage Banner */}
              {result.is_fulfilled ? (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-xs text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <p className="font-bold text-emerald-900">
                      Alokasi Terpenuhi Penuh (Fulfilled)
                    </p>
                    <p className="mt-0.5 leading-relaxed">
                      Permintaan{" "}
                      <strong className="font-mono">
                        {formatNumber(result.requested_qty)}{" "}
                        {result.product.uom}
                      </strong>{" "}
                      untuk{" "}
                      <strong>
                        {result.product.sku} &mdash; {result.product.name}
                      </strong>{" "}
                      dapat dipenuhi menggunakan{" "}
                      <strong>{result.picking_list.length} batch</strong>{" "}
                      berstatus available tanpa kekurangan stok.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-xs text-rose-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <div>
                    <p className="font-bold text-rose-900">
                      Peringatan Shortage Stok (Kekurangan:{" "}
                      <span className="font-mono">
                        {formatNumber(result.shortage_qty)} {result.product.uom}
                      </span>
                      )
                    </p>
                    <p className="mt-0.5 leading-relaxed">
                      Stok available non-expired untuk{" "}
                      <strong>
                        {result.product.sku} &mdash; {result.product.name}
                      </strong>{" "}
                      hanya mencukupi{" "}
                      <strong className="font-mono">
                        {formatNumber(result.allocated_qty)}{" "}
                        {result.product.uom}
                      </strong>{" "}
                      dari permintaan{" "}
                      <strong className="font-mono">
                        {formatNumber(result.requested_qty)}{" "}
                        {result.product.uom}
                      </strong>
                      . Kekurangan sebesar{" "}
                      <strong className="font-mono">
                        {formatNumber(result.shortage_qty)} {result.product.uom}
                      </strong>{" "}
                      tidak dapat dialokasikan (proteksi anti-overselling).
                    </p>
                  </div>
                </div>
              )}

              {/* Summary KPI Grid */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                  <p className="text-xs font-medium text-slate-500">
                    Diminta (Requested Qty)
                  </p>
                  <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
                    {formatNumber(result.requested_qty)}{" "}
                    <span className="font-sans text-xs font-normal text-slate-500">
                      {result.product.uom}
                    </span>
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                  <p className="text-xs font-medium text-slate-500">
                    Total Available (Non-Expired)
                  </p>
                  <p className="mt-2 font-mono text-2xl font-bold text-sky-700">
                    {formatNumber(result.total_available_qty)}{" "}
                    <span className="font-sans text-xs font-normal text-slate-500">
                      {result.product.uom}
                    </span>
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                  <p className="text-xs font-medium text-slate-500">
                    Dialokasikan (Allocated Qty)
                  </p>
                  <p className="mt-2 font-mono text-2xl font-bold text-emerald-700">
                    {formatNumber(result.allocated_qty)}{" "}
                    <span className="font-sans text-xs font-normal text-slate-500">
                      {result.product.uom}
                    </span>
                  </p>
                </div>

                <div
                  className={`rounded-2xl border p-4 shadow-2xs ${
                    parseDecimal(result.shortage_qty) > 0
                      ? "border-rose-200 bg-rose-50/70"
                      : "border-emerald-200 bg-emerald-50/60"
                  }`}
                >
                  <p className="text-xs font-medium text-slate-600">
                    Kekurangan (Shortage Qty)
                  </p>
                  <p
                    className={`mt-2 font-mono text-2xl font-bold ${
                      parseDecimal(result.shortage_qty) > 0
                        ? "text-rose-700"
                        : "text-emerald-700"
                    }`}
                  >
                    {formatNumber(result.shortage_qty)}{" "}
                    <span className="font-sans text-xs font-normal text-slate-500">
                      {result.product.uom}
                    </span>
                  </p>
                </div>
              </div>

              {/* Picking List Table */}
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Saran Urutan Picking Batch (FEFO)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Produk:{" "}
                        <span className="font-mono font-semibold text-slate-700">
                          {result.product.sku}
                        </span>{" "}
                        &mdash; {result.product.name}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {result.picking_list.length} Batch Dialokasikan
                  </span>
                </div>

                {result.picking_list.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <PackageSearch className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      Tidak ada batch available yang dapat dialokasikan
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Pastikan produk ini sudah memiliki stok berstatus{" "}
                      <code className="font-mono">available</code> yang belum
                      kedaluwarsa.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50/90">
                        <tr>
                          <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Urutan
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Batch Number
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Expiry Date
                          </th>
                          <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            State
                          </th>
                          <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Available Qty
                          </th>
                          <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Saran Pick Qty
                          </th>
                          <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Sisa Batch
                          </th>
                          {showCostColumn && (
                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                              HPP MWA
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {result.picking_list.map((entry, idx) => {
                          const days = daysUntilDate(entry.expiry_date);
                          return (
                            <tr
                              key={entry.inventory_ledger_id}
                              className="hover:bg-slate-50/80"
                            >
                              <td className="px-4 py-3.5 text-center">
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 font-mono text-[11px] font-bold text-indigo-700">
                                  {idx + 1}
                                </span>
                              </td>
                              <td className="px-4 py-3.5 font-mono font-bold text-indigo-700">
                                {entry.batch_number}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium text-slate-800">
                                    {formatDate(entry.expiry_date)}
                                  </span>
                                  {days !== null && (
                                    <span
                                      className={`text-[10px] font-semibold ${
                                        days <= 30
                                          ? "text-amber-700"
                                          : "text-slate-400"
                                      }`}
                                    >
                                      {days >= 0
                                        ? `${days} hari lagi`
                                        : "Sudah kedaluwarsa"}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3.5 text-center">
                                <InventoryStateBadge state={entry.state} />
                              </td>
                              <td className="px-4 py-3.5 text-right font-mono text-slate-700">
                                {formatNumber(entry.available_qty)}{" "}
                                {result.product.uom}
                              </td>
                              <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-700">
                                {formatNumber(entry.pick_qty)}{" "}
                                {result.product.uom}
                              </td>
                              <td className="px-4 py-3.5 text-right font-mono text-slate-600">
                                {formatNumber(entry.remaining_batch_qty)}{" "}
                                {result.product.uom}
                              </td>
                              {showCostColumn && (
                                <td className="px-4 py-3.5 text-right font-mono text-slate-800">
                                  {entry.cost_price !== undefined
                                    ? formatRupiah(entry.cost_price)
                                    : "-"}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <PackageSearch className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-900">
                Belum Ada Simulasi FEFO
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                Pilih produk dan masukkan jumlah kuantitas di formulir atas,
                lalu klik <strong>Hitung Saran FEFO</strong> untuk melihat
                alokasi batch otomatis berdasarkan tanggal kedaluwarsa terdekat.
              </p>
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
