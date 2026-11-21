"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";

interface AccessDeniedCardProps {
  moduleName: string;
  requiredPermission: string;
}

export function AccessDeniedCard({
  moduleName,
  requiredPermission,
}: AccessDeniedCardProps) {
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xs">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-600/20">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-base font-bold text-slate-900">
        Akses Ditolak &mdash; {moduleName}
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Peran akun Anda tidak memiliki izin{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-700">
          {requiredPermission}
        </code>{" "}
        yang dibutuhkan untuk membuka halaman ini.
      </p>
      <div className="mt-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke Dashboard
        </Link>
      </div>
    </div>
  );
}
