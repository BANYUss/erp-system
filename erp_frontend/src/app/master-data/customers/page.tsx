"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  EyeOff,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccessDeniedCard } from "@/components/ui/AccessDeniedCard";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { CustomerStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  extractApiError,
  formatDateTime,
  formatRupiah,
  type ParsedApiError,
} from "@/lib/format";
import type {
  ApiMessageResponse,
  ApiResourceResponse,
  Customer,
  CustomerPayload,
  CustomerStatus,
  PaginatedResponse,
  PaginationMeta,
} from "@/types/erp";

type CustomerStatusFilter = "all" | CustomerStatus;

interface CustomerFormState {
  name: string;
  email: string;
  credit_limit: string;
  status: CustomerStatus;
}

const INITIAL_FORM: CustomerFormState = {
  name: "",
  email: "",
  credit_limit: "0",
  status: "active",
};

export default function CustomersPage() {
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canView = hasPermission("customers.view");
  const canManage = hasPermission("customers.manage");
  const canViewCreditLimit = hasPermission("customers.view_credit_limit");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<ParsedApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters & Pagination
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [reloadTick, setReloadTick] = useState(0);

  // Create / Edit Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formState, setFormState] = useState<CustomerFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<ParsedApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Modal
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(
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

    const loadCustomers = async () => {
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

        const response = await api.get<PaginatedResponse<Customer>>(
          "/customers",
          { params }
        );
        if (!cancelled) {
          setCustomers(response.data.data);
          setMeta(response.data.meta);
        }
      } catch (error) {
        if (!cancelled) {
          setPageError(extractApiError(error, "Gagal memuat daftar customer."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadCustomers();

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
    setEditingCustomer(null);
    setFormState(INITIAL_FORM);
    setFormError(null);
    setFormModalOpen(true);
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormState({
      name: customer.name,
      email: customer.email ?? "",
      credit_limit:
        customer.credit_limit !== undefined ? String(customer.credit_limit) : "",
      status: customer.status,
    });
    setFormError(null);
    setFormModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const payload: CustomerPayload = {
      name: formState.name.trim(),
      email: formState.email.trim() || null,
      status: formState.status,
    };

    if (!editingCustomer) {
      payload.credit_limit =
        formState.credit_limit.trim() !== "" ? formState.credit_limit.trim() : "0";
    } else if (formState.credit_limit.trim() !== "") {
      payload.credit_limit = formState.credit_limit.trim();
    }

    try {
      if (editingCustomer) {
        const res = await api.put<ApiResourceResponse<Customer>>(
          `/customers/${editingCustomer.id}`,
          payload
        );
        setSuccessMessage(
          res.data.message || `Customer ${payload.name} berhasil diperbarui.`
        );
      } else {
        const res = await api.post<ApiResourceResponse<Customer>>(
          "/customers",
          payload
        );
        setSuccessMessage(
          res.data.message || `Customer ${payload.name} berhasil ditambahkan.`
        );
      }

      setFormModalOpen(false);
      triggerReload();
    } catch (error) {
      setFormError(
        extractApiError(
          error,
          "Gagal menyimpan data customer. Periksa kembali isian Anda."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingCustomer) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      const res = await api.delete<ApiMessageResponse>(
        `/customers/${deletingCustomer.id}`
      );
      setSuccessMessage(
        res.data.message ||
          `Customer ${deletingCustomer.name} berhasil dihapus.`
      );
      setDeletingCustomer(null);
      triggerReload();
    } catch (error) {
      setDeleteError(extractApiError(error, "Gagal menghapus customer."));
    } finally {
      setIsDeleting(false);
    }
  };

  const columns = useMemo<DataTableColumn<Customer>[]>(() => {
    const baseCols: DataTableColumn<Customer>[] = [
      {
        key: "name",
        header: "Nama Customer",
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
        key: "email",
        header: "Email",
        render: (row) =>
          row.email ? (
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              {row.email}
            </span>
          ) : (
            <span className="text-slate-400">-</span>
          ),
      },
    ];

    if (canViewCreditLimit) {
      baseCols.push({
        key: "credit_limit",
        header: "Credit Limit",
        align: "right",
        render: (row) => (
          <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-900">
            <CreditCard className="h-3.5 w-3.5 text-indigo-500" />
            {row.credit_limit !== undefined
              ? formatRupiah(row.credit_limit)
              : "-"}
          </span>
        ),
      });
    }

    baseCols.push({
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => <CustomerStatusBadge status={row.status} />,
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
                setDeletingCustomer(row);
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
  }, [canManage, canViewCreditLimit]);

  return (
    <DashboardShell
      title="Master Data Customer"
      subtitle="Manajemen data pelanggan, status akun, serta plafon kredit (credit limit)"
    >
      {!canView ? (
        <AccessDeniedCard
          moduleName="Master Data Customer"
          requiredPermission="customers.view"
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
                  placeholder="Cari nama atau email customer..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <select
                aria-label="Filter status customer"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as CustomerStatusFilter);
                  setPage(1);
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Semua Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
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
                  Tambah Customer
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
              title="Gagal Memuat Customer"
              message={pageError.message}
              httpStatus={pageError.status}
              fieldErrors={pageError.fieldErrors}
              onDismiss={() => setPageError(null)}
            />
          )}

          {!canViewCreditLimit && (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-100/80 px-4 py-2.5 text-xs text-slate-600">
              <EyeOff className="h-4 w-4 shrink-0 text-slate-500" />
              <span>
                Kolom <code className="font-mono">credit_limit</code>{" "}
                disembunyikan karena akun Anda tidak memiliki izin{" "}
                <code className="font-mono font-semibold">
                  customers.view_credit_limit
                </code>
                .
              </span>
            </div>
          )}

          <DataTable
            columns={columns}
            data={customers}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="Belum ada data customer"
            emptyDescription="Tambahkan customer baru atau ubah filter pencarian."
          />

          {/* Create / Edit Modal */}
          <Modal
            open={formModalOpen}
            onClose={() => setFormModalOpen(false)}
            title={editingCustomer ? "Edit Customer" : "Tambah Customer Baru"}
            subtitle={
              editingCustomer
                ? `Memperbarui data pelanggan ${editingCustomer.name}`
                : "Lengkapi data pelanggan dan batas kredit (credit limit)."
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
                  form="customer-form"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Users className="h-3.5 w-3.5" />
                  )}
                  {editingCustomer ? "Simpan Perubahan" : "Simpan Customer"}
                </button>
              </>
            }
          >
            <form
              id="customer-form"
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
                  htmlFor="customer-name"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Nama Customer <span className="text-rose-500">*</span>
                </label>
                <input
                  id="customer-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={255}
                  value={formState.name}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Contoh: CV Retail Nusantara Jaya"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="customer-email"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Email
                  </label>
                  <input
                    id="customer-email"
                    type="email"
                    maxLength={255}
                    value={formState.email}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    placeholder="purchasing@customer.co.id"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label
                    htmlFor="customer-status"
                    className="mb-1.5 block text-xs font-semibold text-slate-700"
                  >
                    Status <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id="customer-status"
                    value={formState.status}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        status: e.target.value as CustomerStatus,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="customer-credit-limit"
                  className="mb-1.5 block text-xs font-semibold text-slate-700"
                >
                  Credit Limit (IDR){" "}
                  {!editingCustomer && <span className="text-rose-500">*</span>}
                </label>
                <input
                  id="customer-credit-limit"
                  type="number"
                  required={!editingCustomer}
                  min={0}
                  max={9999999999999.99}
                  step="0.01"
                  value={formState.credit_limit}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      credit_limit: e.target.value,
                    }))
                  }
                  placeholder="Contoh: 50000000"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                {formState.credit_limit.trim() !== "" &&
                  !Number.isNaN(Number(formState.credit_limit)) && (
                    <p className="mt-1 text-[11px] font-medium text-indigo-600">
                      Format Rupiah: {formatRupiah(formState.credit_limit)}
                    </p>
                  )}
              </div>
            </form>
          </Modal>

          {/* Soft Delete Confirmation */}
          <ConfirmDialog
            open={Boolean(deletingCustomer)}
            onClose={() => setDeletingCustomer(null)}
            onConfirm={handleConfirmDelete}
            title="Hapus Customer"
            confirmLabel="Ya, Hapus Customer"
            isLoading={isDeleting}
            errorMessage={deleteError?.message}
            errorStatus={deleteError?.status}
            description={
              deletingCustomer ? (
                <span>
                  Apakah Anda yakin ingin menghapus customer{" "}
                  <strong className="font-semibold text-slate-900">
                    {deletingCustomer.name}
                  </strong>
                  ? Data akan di-soft-delete dan tidak muncul lagi di daftar
                  pelanggan aktif.
                </span>
              ) : null
            }
          />
        </div>
      )}
    </DashboardShell>
  );
}
