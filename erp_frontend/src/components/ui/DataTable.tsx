"use client";

import React from "react";
import { ChevronLeft, ChevronRight, Inbox, Loader2 } from "lucide-react";
import type { PaginationMeta } from "@/types/erp";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  meta?: PaginationMeta | null;
  onPageChange?: (page: number) => void;
}

const ALIGN_CLASS: Record<"left" | "center" | "right", string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function DataTable<T>({
  columns,
  data,
  rowKey,
  isLoading = false,
  emptyTitle = "Belum ada data",
  emptyDescription = "Data tidak ditemukan atau belum tersedia untuk filter saat ini.",
  meta,
  onPageChange,
}: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50/90">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${
                    ALIGN_CLASS[col.align ?? "left"]
                  } ${col.headerClassName ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center">
                  <div className="inline-flex flex-col items-center gap-2.5 text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                    <span className="text-xs font-medium">Memuat data...</span>
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-slate-500">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                      <Inbox className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800">
                      {emptyTitle}
                    </p>
                    <p className="text-xs text-slate-500">{emptyDescription}</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="transition-colors hover:bg-slate-50/80"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3.5 align-middle text-xs text-slate-700 ${
                        ALIGN_CLASS[col.align ?? "left"]
                      } ${col.className ?? ""}`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.total > 0 && onPageChange && (
        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:flex-row">
          <p className="text-xs text-slate-500">
            Menampilkan{" "}
            <span className="font-semibold text-slate-800">
              {meta.from ?? 0}
            </span>{" "}
            &ndash;{" "}
            <span className="font-semibold text-slate-800">{meta.to ?? 0}</span>{" "}
            dari{" "}
            <span className="font-semibold text-slate-800">{meta.total}</span>{" "}
            data
          </p>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Halaman{" "}
              <span className="font-semibold text-slate-800">
                {meta.current_page}
              </span>{" "}
              / {meta.last_page}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onPageChange(meta.current_page - 1)}
                disabled={meta.current_page <= 1 || isLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Sebelumnya
              </button>
              <button
                type="button"
                onClick={() => onPageChange(meta.current_page + 1)}
                disabled={meta.current_page >= meta.last_page || isLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Berikutnya
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
