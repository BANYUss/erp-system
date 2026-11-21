"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
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
import { SupplierStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDateTime,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiMessageResponse,
  ApiResourceResponse,
  PaginatedResponse,
  PaginationMeta,
  Supplier,
  SupplierPayload,
  SupplierStatus,
} from "@/types/erp";

type SupplierStatusFilter = "all" | SupplierStatus;

interface SupplierFormState {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  address: string;
  status: SupplierStatus;
}

const INITIAL_FORM: SupplierFormState = {
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  address: "",
  status: "active",
};

export default function SuppliersPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("suppliers.view");
  const canManage = hasPermission("suppliers.manage");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters & Pagination
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SupplierStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Form Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formState, setFormState] = useState<SupplierFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<ParsedApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Confirmation Modal
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(
    null
  );
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

    const loadSuppliers = async () => {
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

        const response = await api.get<PaginatedResponse<Supplier>>(
          "/suppliers",
          { params }
        );
        if (!cancelled) {
          setSuppliers(response.data.data);
          setMeta(response.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(extractApiError(error, "Gagal memuat daftar supplier."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSuppliers();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canView, page, appliedSearch, statusFilter, reloadTick]);

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
    setEditingSupplier(null);
    setFormState(INITIAL_FORM);
    setFormError(null);
    setFormModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormState({
      name: supplier.name,
      contact_name: supplier.contact_name ?? "",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      address: supplier.address ?? "",
      status: supplier.status,
    });
    setFormError(null);
    setFormModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const payload: SupplierPayload = {
      name: formState.name.trim(),
      contact_name: formState.contact_name.trim() || null,
      email: formState.email.trim() || null,
      phone: formState.phone.trim() || null,
      address: formState.address.trim() || null,
      status: formState.status,
    };

    try {
      if (editingSupplier) {
        const res = await api.put<ApiResourceResponse<Supplier>>(
          `/suppliers/${editingSupplier.id}`,
          payload
        );
        setSuccessMessage(
          res.data.message || `Supplier ${payload.name} berhasil diperbarui.`
        );
      } else {
        const res = await api.post<ApiResourceResponse<Supplier>>(
          "/suppliers",
          payload
        );
        setSuccessMessage(
          res.data.message || `Supplier ${payload.name} berhasil ditambahkan.`
        );
      }

      setFormModalOpen(false);
      triggerReload();
    } catch (error) {
      setFormError(
        extractApiError(
          error,
          "Gagal menyimpan data supplier. Periksa isian Anda."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingSupplier) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      const res = await api.delete<ApiMessageResponse>(
        `/suppliers/${deletingSupplier.id}`
      );
      setSuccessMessage(
        res.data.message || `Supplier ${deletingSupplier.name} berhasil dihapus.`
      );
      setDeletingSupplier(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus supplier."));
    } finally {
      setIsDeleting(false);
    }
  };

  const columns = useMemo<DataTableColumn<Supplier>[]>(() => {
    const baseCols: DataTableColumn<Supplier>[] = [
      {
        key: "name",
        header: "Supplier",
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-900">{row.name}</p>
            <p className="text-[11px] text-slate-400">
              ID #{row.id} &bull; Diperbarui {formatDateTime(row.updated_at)}
            </p>
          </div>
        ),
      },
      {
        key: "contact_name",
        header: "PIC / Kontak",
        render: (row) => (
          <span className="font-medium text-slate-700">
            {row.contact_name || <span className="text-slate-400">-</span>}
          </span>
        ),
      },
      {
        key: "contact_info",
        header: "Email & Telepon",
        render: (row) => (
          <div className="space-y-0.5 text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-700">
              <Mail className="h-3 w-3 shrink-0 text-slate-400" />
              <span>{row.email || "-"}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-500">
              <Phone className="h-3 w-3 shrink-0 text-slate-400" />
              <span>{row.phone || "-"}</span>
            </div>
          </div>
        ),
      },
      {
        key: "address",
        header: "Alamat",
        className: "max-w-xs",
        render: (row) =>
          row.address ? (
            <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
              <span className="line-clamp-2">{row.address}</span>
            </div>
          ) : (
            <span className="text-slate-400">-</span>
          ),
      },
      {
        key: "status",
        header: "Status",
        align: "center",
        render: (row) => <SupplierStatusBadge status={row.status} />,
      },
    ];

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
                setDeletingSupplier(row);
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
  }, [canManage]);

  return (
    <DashboardShell
      title="Master Data Supplier"
      subtitle="Direktori pemasok barang, kontak person, alamat, dan status kelayakan pengadaan"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Master Data Supplier"
          requiredPermission="suppliers.view"
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
                  placeholder="Cari nama, PIC, atau email supplier..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status supplier"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as SupplierStatusFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blacklisted">Blacklisted</option>
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

              {canManage && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" />
                  Tambah Supplier
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
              title="Gagal Memuat Supplier"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          <DataTable
            columns={columns}
            data={suppliers}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada data supplier"
            emptyDescription="Tambahkan supplier baru atau sesuaikan filter status dan pencarian."
          />

          {/* Create / Edit Modal */}
          <Modal
            open={formModalOpen}
            onClose={() => setFormModalOpen(false)}
            title={editingSupplier ? "Edit Supplier" : "Tambah Supplier Baru"}
            subtitle={
              editingSupplier
                ? `Memperbarui profil ${editingSupplier.name}`
                : "Isi detail pemasok untuk digunakan pada modul Procurement (PO)."
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
                  form="supplier-form"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Building2 className="h-3.5 w-3.5" />
                  )}
                  {editingSupplier ? "Simpan Perubahan" : "Simpan Supplier"}
                </button>
              </>
            }
          >
            <form
              id="supplier-form"
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

              <div>
                <label
                  htmlFor="supplier-name"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Nama Supplier <span className="text-rose-500">*</span>
                </label>
                <input
                  id="supplier-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={255}
                  value={formState.name}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Contoh: PT Sumber Makmur Distribusi"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="supplier-contact"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Nama PIC / Kontak
                  </label>
                  <input
                    id="supplier-contact"
                    type="text"
                    maxLength={255}
                    value={formState.contact_name}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        contact_name: e.target.value,
                      }))
                    }
                    placeholder="Contoh: Budi Santoso"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label
                    htmlFor="supplier-status"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Status <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id="supplier-status"
                    value={formState.status}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        status: e.target.value as SupplierStatus,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="blacklisted">Blacklisted</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="supplier-email"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Email
                  </label>
                  <input
                    id="supplier-email"
                    type="email"
                    maxLength={255}
                    value={formState.email}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    placeholder="sales@supplier.co.id"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label
                    htmlFor="supplier-phone"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    No. Telepon
                  </label>
                  <input
                    id="supplier-phone"
                    type="text"
                    maxLength={50}
                    value={formState.phone}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        phone: e.target.value,
                      }))
                    }
                    placeholder="+62 21 555-0192"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="supplier-address"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Alamat Lengkap
                </label>
                <textarea
                  id="supplier-address"
                  rows={3}
                  maxLength={1000}
                  value={formState.address}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      address: e.target.value,
                    }))
                  }
                  placeholder="Jl. Industri Raya No. 88, Kawasan Pergudangan..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </form>
          </Modal>

          {/* Soft Delete Confirmation */}
          <ConfirmDialog
            open={Boolean(deletingSupplier)}
            onClose={() => setDeletingSupplier(null)}
            onConfirm={handleConfirmDelete}
            title="Hapus Supplier"
            confirmLabel="Ya, Hapus Supplier"
            isLoading={isDeleting}
            errorMessage={deleteError?.message}
            errorStatus={deleteError?.status}
            description={
              deletingSupplier ? (
                <span>
                  Apakah Anda yakin ingin menghapus supplier{" "}
                  <strong className="font-semibold text-slate-900">
                    {deletingSupplier.name}
                  </strong>
                  ? Supplier akan di-soft-delete dari daftar pemasok aktif.
                </span>
              ) : null
            }
          />
        </div>
      )}
    </DashboardShell>
  );
}
