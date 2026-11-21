"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { ApiErrorResponse } from "@/types/auth";

interface DemoAccount {
  label: string;
  email: string;
  role: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { label: "Super Admin", email: "superadmin@erp.test", role: "Akses Penuh" },
  { label: "Staf Gudang", email: "gudang@erp.test", role: "Fisik & FEFO" },
  { label: "Admin Sales", email: "sales@erp.test", role: "Sales O2C" },
  { label: "Purchasing", email: "purchasing@erp.test", role: "PR, PO & Supplier" },
  { label: "Finance", email: "finance@erp.test", role: "AP/AR & GL" },
  { label: "Manajer", email: "manajer@erp.test", role: "Approver" },
];

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDemoAccounts, setShowDemoAccounts] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setErrorCode(null);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await login({ email, password });
      router.replace("/dashboard");
    } catch (error: unknown) {
      if (axios.isAxiosError<ApiErrorResponse>(error)) {
        const status = error.response?.status ?? null;
        const data = error.response?.data;
        setErrorCode(status);

        if (status === 422) {
          setFieldErrors(data?.errors ?? {});
          setFormError(
            data?.message ||
              "Periksa kembali data login yang Anda masukkan."
          );
        } else if (status === 401) {
          setFormError(
            data?.message || "Email atau password tidak valid."
          );
        } else if (status === 403) {
          setFormError(
            data?.message || "Akun pengguna tidak aktif. Hubungi Super Admin."
          );
        } else if (!error.response) {
          setFormError(
            "Tidak dapat terhubung ke server API ERP. Pastikan backend Laravel berjalan."
          );
        } else {
          setFormError(
            data?.message || "Terjadi kesalahan pada server. Silakan coba lagi."
          );
        }
      } else {
        setFormError("Terjadi kesalahan tak terduga saat memproses login.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const applyDemoAccount = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("password");
    setFormError(null);
    setErrorCode(null);
    setFieldErrors({});
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          <span className="text-sm font-medium text-slate-700">
            Memeriksa status autentikasi...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-slate-50 lg:grid-cols-12">
      {/* Enterprise Brand Panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-12 text-white lg:col-span-5 lg:flex xl:col-span-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(79,70,229,0.28),transparent_55%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.18),transparent_50%)]" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight">ERP Distribusi</p>
            <p className="text-xs text-slate-400">
              Enterprise Resource Planning Platform
            </p>
          </div>
        </div>

        <div className="relative z-10 max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-medium text-indigo-300">
            <ShieldCheck className="h-4 w-4" />
            Dilindungi Laravel Sanctum &amp; Spatie RBAC
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white xl:text-4xl">
            Kontrol Terpadu Distribusi, Persediaan, dan Keuangan.
          </h1>
          <p className="text-sm leading-relaxed text-slate-300">
            Satu platform operasional untuk Procure-to-Pay (3-Way Matching),
            manajemen stok batch FEFO, Order-to-Cash dengan kontrol credit
            limit, serta pencatatan General Ledger secara real-time.
          </p>

          <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
            {[
              {
                title: "Strict RBAC Enforcement",
                desc: "Pemisahan hak akses ketat antara Gudang, Sales, Purchasing, Finance & Manajer.",
              },
              {
                title: "Immutable Audit & Ledger",
                desc: "Mutasi stok dan jurnal keuangan tercatat presisi dengan proteksi idempotency.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur-xs"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  {item.title}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-slate-800/80 pt-6 text-xs text-slate-400">
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-400" />
            ERP Distribusi &bull; Laravel 11 &amp; Next.js
          </span>
          <span>Laravel 11 &bull; Next.js App Router</span>
        </div>
      </section>

      {/* Login Form Panel */}
      <section className="flex flex-col items-center justify-center px-4 py-10 sm:px-8 lg:col-span-7 xl:col-span-6">
        <div className="w-full max-w-md">
          {/* Mobile Brand Header */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-900">ERP Distribusi</p>
              <p className="text-xs text-slate-500">Enterprise Portal</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-7 shadow-sm sm:p-9">
            <div className="mb-7">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Masuk ke Akun Anda
              </h2>
              <p className="mt-1.5 text-sm text-slate-500">
                Gunakan kredensial perusahaan untuk mengakses modul sesuai peran
                RBAC Anda.
              </p>
            </div>

            {formError && (
              <div
                role="alert"
                className="mb-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {errorCode === 401
                      ? "Autentikasi Gagal (401)"
                      : errorCode === 422
                        ? "Validasi Gagal (422)"
                        : errorCode === 403
                          ? "Akses Ditolak (403)"
                          : "Gagal Masuk"}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-rose-700">
                    {formError}
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Alamat Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.email;
                          return next;
                        });
                      }
                    }}
                    placeholder="nama@erp.test"
                    aria-invalid={Boolean(fieldErrors.email?.length)}
                    className={`w-full rounded-xl border bg-white py-2.5 pr-4 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-colors ${
                      fieldErrors.email?.length
                        ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
                        : "border-slate-300 focus:border-indigo-600 focus:ring-indigo-600/20"
                    }`}
                  />
                </div>
                {fieldErrors.email?.map((message) => (
                  <p key={message} className="mt-1.5 text-xs font-medium text-rose-600">
                    {message}
                  </p>
                ))}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next.password;
                          return next;
                        });
                      }
                    }}
                    placeholder="Masukkan password Anda"
                    aria-invalid={Boolean(fieldErrors.password?.length)}
                    className={`w-full rounded-xl border bg-white py-2.5 pr-11 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-colors ${
                      fieldErrors.password?.length
                        ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
                        : "border-slate-300 focus:border-indigo-600 focus:ring-indigo-600/20"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600"
                    aria-label={
                      showPassword ? "Sembunyikan password" : "Tampilkan password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.password?.map((message) => (
                  <p key={message} className="mt-1.5 text-xs font-medium text-rose-600">
                    {message}
                  </p>
                ))}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memproses Autentikasi...
                  </>
                ) : (
                  <>
                    Masuk ke Dashboard
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            {/* Collapsible Demo Accounts Helper for RBAC QA */}
            <div className="mt-6 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={() => setShowDemoAccounts((prev) => !prev)}
                className="flex w-full items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                <span>Akun Demo RBAC</span>
                {showDemoAccounts ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showDemoAccounts && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      onClick={() => applyDemoAccount(account.email)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/60"
                    >
                      <p className="text-xs font-semibold text-slate-800">
                        {account.label}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {account.role}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            &copy; {new Date().getFullYear()} ERP Distribusi. Akses hanya untuk
            personel berwenang.
          </p>
        </div>
      </section>
    </div>
  );
}
