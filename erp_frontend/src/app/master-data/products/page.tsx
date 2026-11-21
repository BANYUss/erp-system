"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  EyeOff,
  Loader2,
  Package,
  Pencil,
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
import { ActiveStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDateTime,
  formatNumber,
  formatRupiah,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiMessageResponse,
  ApiResourceResponse,
  PaginatedResponse,
  PaginationMeta,
  Product,
  ProductPayload,
} from "@/types/erp";

type ActiveFilter = "all" | "1" | "0";

interface ProductFormState {
  sku: string;
  name: string;
  category_id: string;
  uom: string;
  is_active: boolean;
}

const INITIAL_FORM: ProductFormState = {
  sku: "",
  name: "",
  category_id: "",
  uom: "PCS",
  is_active: true,
};

export default function ProductsPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("products.view");
  const canManage = hasPermission("products.manage");

  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters & Pagination
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Create/Edit Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formState, setFormState] = useState<ProductFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<ParsedApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Confirmation Modal
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [deleteError, setDeleteError] = useState<ParsedApiError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const triggerReload = useCallback(() => {
    setReloadTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    const loadProducts = async () => {
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
        if (activeFilter !== "all") {
          params.is_active = activeFilter;
        }

        const response = await api.get<PaginatedResponse<Product>>(
          "/products",
          {
            params,
          }
        );

        if (!cancelled) {
          setProducts(response.data.data);
          setMeta(response.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(extractApiError(error, "Gagal memuat daftar produk."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadProducts();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, page, appliedSearch, activeFilter, reloadTick]);

  // Respect backend data masking strictly by checking field presence in API JSON response
  const hasAvailableQtyField = useMemo(
    () =>
      products.some((item) =>
        Object.prototype.hasOwnProperty.call(item, "available_qty")
      ),
    [products]
  );

  const hasCostPriceField = useMemo(
    () =>
      products.some((item) =>
        Object.prototype.hasOwnProperty.call(item, "cost_price")
      ),
    [products]
  );

  const hasInventoryValueField = useMemo(
    () =>
      products.some((item) =>
        Object.prototype.hasOwnProperty.call(item, "inventory_value")
      ),
    [products]
  );

  const isFinancialMasked =
    !isLoading &&
    products.length > 0 &&
    !hasCostPriceField &&
    !hasInventoryValueField;

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput);
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setAppliedSearch("");
    setActiveFilter("all");
    setPage(1);
  };

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormState(INITIAL_FORM);
    setFormError(null);
    setFormModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setFormState({
      sku: product.sku,
      name: product.name,
      category_id:
        product.category_id !== null ? String(product.category_id) : "",
      uom: product.uom,
      is_active: product.is_active,
    });
    setFormError(null);
    setFormModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const parsedCategoryId =
      formState.category_id.trim() !== ""
        ? Number(formState.category_id.trim())
        : null;

    const payload: ProductPayload = {
      sku: formState.sku.trim(),
      name: formState.name.trim(),
      category_id:
        parsedCategoryId !== null && Number.isFinite(parsedCategoryId)
          ? parsedCategoryId
          : null,
      uom: formState.uom.trim(),
      is_active: formState.is_active,
    };

    try {
      if (editingProduct) {
        const res = await api.put<ApiResourceResponse<Product>>(
          `/products/${editingProduct.id}`,
          payload
        );
        setSuccessMessage(
          res.data.message || `Produk ${payload.sku} berhasil diperbarui.`
        );
      } else {
        const res = await api.post<ApiResourceResponse<Product>>(
          "/products",
          payload
        );
        setSuccessMessage(
          res.data.message || `Produk ${payload.sku} berhasil ditambahkan.`
        );
      }

      setFormModalOpen(false);
      triggerReload();
    } catch (error) {
      setFormError(
        extractApiError(error, "Gagal menyimpan data produk. Periksa isian Anda.")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingProduct) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      const res = await api.delete<ApiMessageResponse>(
        `/products/${deletingProduct.id}`
      );
      setSuccessMessage(
        res.data.message || `Produk ${deletingProduct.sku} berhasil dihapus.`
      );
      setDeletingProduct(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus produk."));
    } finally {
      setIsDeleting(false);
    }
  };

  const columns = useMemo<DataTableColumn<Product>[]>(() => {
    const baseCols: DataTableColumn<Product>[] = [
      {
        key: "sku",
        header: "SKU",
        render: (row) => (
          <span className="font-mono text-xs font-semibold text-indigo-700">
            {row.sku}
          </span>
        ),
      },
      {
        key: "name",
        header: "Nama Produk",
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-900">{row.name}</p>
            <p className="text-[11px] text-slate-400">
              Diperbarui {formatDateTime(row.updated_at)}
            </p>
          </div>
        ),
      },
      {
        key: "category_id",
        header: "Kategori",
        render: (row) =>
          row.category_id !== null ? (
            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
              CAT-{row.category_id}
            </span>
          ) : (
            <span className="text-slate-400">-</span>
          ),
      },
      {
        key: "uom",
        header: "UOM",
        render: (row) => (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
            {row.uom}
          </span>
        ),
      },
    ];

    if (hasAvailableQtyField) {
      baseCols.push({
        key: "available_qty",
        header: "Stok Tersedia",
        align: "right",
        render: (row) => (
          <span className="font-mono font-semibold text-slate-800">
            {formatNumber(row.available_qty)} {row.uom}
          </span>
        ),
      });
    }

    if (hasCostPriceField) {
      baseCols.push({
        key: "cost_price",
        header: "Harga Pokok (Avg)",
        align: "right",
        render: (row) => (
          <span className="font-mono font-medium text-slate-800">
            {row.cost_price !== null && row.cost_price !== undefined
              ? formatRupiah(row.cost_price)
              : "-"}
          </span>
        ),
      });
    }

    if (hasInventoryValueField) {
      baseCols.push({
        key: "inventory_value",
        header: "Nilai Persediaan",
        align: "right",
        render: (row) => (
          <span className="font-mono font-semibold text-emerald-700">
            {formatRupiah(row.inventory_value)}
          </span>
        ),
      });
    }

    baseCols.push({
      key: "is_active",
      header: "Status",
      align: "center",
      render: (row) => <ActiveStatusBadge isActive={row.is_active} />,
    });

    if (canManage) {
      baseCols.push({
        key: "actions",
        header: "Aksi",
        align: "right",
        render: (row) => (
          <div className="inline-flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => openEditModal(row)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDeletingProduct(row);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Hapus
            </button>
          </div>
        ),
      });
    }

    return baseCols;
  }, [
    canManage,
    hasAvailableQtyField,
    hasCostPriceField,
    hasInventoryValueField,
  ]);

  return (
    <DashboardShell
      title="Master Data Produk"
      subtitle="Katalog SKU, satuan ukur (UOM), status aktif, serta kontrol visibilitas nilai persediaan"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Master Data Produk"
          requiredPermission="products.view"
        />
      ) : (
        <div className="space-y-5">
          {/* Header Action Bar */}
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
                  placeholder="Cari SKU atau nama produk..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status aktif produk"
                value={activeFilter}
                onChange={(e) => {
                  setActiveFilter(e.target.value as ActiveFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                <option value="1">Aktif Saja</option>
                <option value="0">Nonaktif Saja</option>
              </select>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  Cari
                </button>
                {(appliedSearch !== "" || activeFilter !== "all") && (
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

              {canManage && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                  Tambah Produk
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
              title="Gagal Memuat Produk"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          {isFinancialMasked && (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-100/80 px-4 py-2.5 text-xs text-slate-600">
              <EyeOff className="h-4 w-4 shrink-0 text-slate-500" />
              <span>
                Kolom finansial (<code className="font-mono">cost_price</code>{" "}
                &amp; <code className="font-mono">inventory_value</code>)
                disembunyikan otomatis sesuai kebijakan data masking backend
                untuk peran Anda.
              </span>
            </div>
          )}

          {/* Table */}
          <DataTable
            columns={columns}
            data={products}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada data produk"
            emptyDescription="Tambahkan produk baru atau ubah kata kunci pencarian dan filter status."
          />

          {/* Create / Edit Modal */}
          <Modal
            open={formModalOpen}
            onClose={() => setFormModalOpen(false)}
            title={editingProduct ? "Edit Produk" : "Tambah Produk Baru"}
            subtitle={
              editingProduct
                ? `Memperbarui data SKU ${editingProduct.sku}`
                : "Lengkapi identitas SKU, nama produk, dan satuan ukur (UOM)."
            }
            disableClose={isSubmitting}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  disabled={isSubmitting}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  form="product-form"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Package className="h-3.5 w-3.5" />
                  )}
                  {editingProduct ? "Simpan Perubahan" : "Simpan Produk"}
                </button>
              </>
            }
          >
            <form
              id="product-form"
              onSubmit={handleFormSubmit}
              className="space-y-4"
            >
              {formError && (
                <AlertBanner
                  variant="error"
                  title="Validasi / Permintaan Gagal"
                  message={formError.message}
                  httpStatus={formError.status}
                  fieldErrors={formError.fieldErrors}
                />
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="product-sku"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    SKU <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="product-sku"
                    type="text"
                    required
                    value={formState.sku}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, sku: e.target.value }))
                    }
                    placeholder="Contoh: SKU-OBT-001"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Hanya huruf, angka, titik, garis bawah, atau tanda hubung.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="product-uom"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Satuan (UOM) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="product-uom"
                    type="text"
                    required
                    maxLength={50}
                    value={formState.uom}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, uom: e.target.value }))
                    }
                    placeholder="Contoh: BOX, PCS, KG, LITER"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="product-name"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Nama Produk <span className="text-rose-500">*</span>
                </label>
                <input
                  id="product-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={255}
                  value={formState.name}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Contoh: Susu UHT Full Cream 1 Liter"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="product-category-id"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Category ID{" "}
                    <span className="font-normal text-slate-400">(Opsional)</span>
                  </label>
                  <input
                    id="product-category-id"
                    type="number"
                    min={1}
                    step={1}
                    value={formState.category_id}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        category_id: e.target.value,
                      }))
                    }
                    placeholder="Kosongkan jika belum ada"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                    <div>
                      <p className="text-xs font-semibold text-slate-800">
                        Status Produk Aktif
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Produk nonaktif tidak dapat dipesan di PO/SO
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={formState.is_active}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          is_active: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </label>
                </div>
              </div>
            </form>
          </Modal>

          {/* Soft Delete Confirmation */}
          <ConfirmDialog
            open={Boolean(deletingProduct)}
            onClose={() => setDeletingProduct(null)}
            onConfirm={handleConfirmDelete}
            title="Hapus Produk (Soft Delete)"
            confirmLabel="Ya, Hapus Produk"
            isLoading={isDeleting}
            errorMessage={deleteError?.message}
            errorStatus={deleteError?.status}
            description={
              deletingProduct ? (
                <span>
                  Apakah Anda yakin ingin menghapus produk{" "}
                  <strong className="font-semibold text-slate-900">
                    {deletingProduct.name} ({deletingProduct.sku})
                  </strong>
                  ? Data akan di-soft-delete dan tidak muncul lagi di katalog
                  aktif.
                </span>
              ) : null
            }
          />
        </div>
      )}
    </DashboardShell>
  );
}
