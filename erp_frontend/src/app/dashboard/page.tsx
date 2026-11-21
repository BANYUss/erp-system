"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Boxes,
  CheckCircle2,
  Database,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Lock,
  Mail,
  Search,
  Shield,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuth } from "@/context/AuthContext";
import {
  ERP_MODULES,
  filterAccessibleModules,
  getRoleBadgeStyle,
  type ModuleIconKey,
} from "@/lib/rbac";

const MODULE_ICONS: Record<ModuleIconKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  "master-data": Database,
  procurement: ShoppingCart,
  inventory: Boxes,
  sales: TrendingUp,
  finance: Landmark,
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DashboardPage() {
  const { user, roles, permissions, hasPermission } = useAuth();
  const [permissionSearch, setPermissionSearch] = useState("");

  const accessibleModules = useMemo(
    () => filterAccessibleModules(hasPermission),
    [hasPermission]
  );

  const operationalModules = useMemo(
    () => accessibleModules.filter((mod) => mod.id !== "dashboard"),
    [accessibleModules]
  );

  const restrictedModules = useMemo(() => {
    const allowedIds = new Set(accessibleModules.map((mod) => mod.id));
    return ERP_MODULES.filter((mod) => !allowedIds.has(mod.id));
  }, [accessibleModules]);

  const filteredPermissions = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    if (!query) {
      return permissions;
    }
    return permissions.filter((perm) => perm.toLowerCase().includes(query));
  }, [permissions, permissionSearch]);

  const primaryRole = roles[0] ?? "Pengguna";
  const primaryRoleStyle = getRoleBadgeStyle(primaryRole);

  return (
    <DashboardShell
      title="Dashboard"
      subtitle="Ringkasan profil pengguna, peran RBAC aktif, dan modul operasional"
    >
      <div className="space-y-6">
        {/* User Profile & Active Role Overview */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 px-6 py-6 text-white sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/20 text-lg font-bold text-indigo-200 ring-1 ring-inset ring-indigo-400/30">
                  {user ? getInitials(user.name) : "ER"}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold tracking-tight text-white">
                      {user?.name}
                    </h2>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        user?.is_active
                          ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30"
                          : "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30"
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {user?.is_active ? "Akun Aktif" : "Nonaktif"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      {user?.email}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-slate-400">
                      ID #{user?.id}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {roles.map((role) => {
                  const style = getRoleBadgeStyle(role);
                  return (
                    <span
                      key={role}
                      className={`inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold shadow-sm ${style.badgeClass}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${style.dotClass}`} />
                      {role}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
            <div className="p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Role Aktif</span>
                <UserCheck className="h-4 w-4 text-indigo-600" />
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900">
                {roles.length > 0 ? roles.join(", ") : "-"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {primaryRoleStyle.summary}
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Modul Dapat Diakses</span>
                <LayoutDashboard className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {accessibleModules.length}{" "}
                <span className="text-sm font-medium text-slate-400">
                  / {ERP_MODULES.length}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {operationalModules.length} modul operasional + Dashboard
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Permission Spatie RBAC</span>
                <KeyRound className="h-4 w-4 text-violet-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {permissions.length}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Disinkronkan langsung dari endpoint <code className="font-mono">/auth/me</code>
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Proteksi Sesi</span>
                <ShieldCheck className="h-4 w-4 text-sky-600" />
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900">
                Sanctum Bearer
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Auto-redirect ke <code className="font-mono">/login</code> saat HTTP 401
              </p>
            </div>
          </div>
        </section>

        {/* Accessible Modules Summary Grid */}
        <section className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Ringkasan Modul yang Bisa Diakses
              </h3>
              <p className="text-xs text-slate-500">
                Menu sidebar dan fitur di bawah ini disesuaikan otomatis
                berdasarkan permission role Anda.
              </p>
            </div>
            {restrictedModules.length > 0 && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                {restrictedModules.length} modul dibatasi oleh kebijakan RBAC
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {operationalModules.map((mod) => {
              const Icon = MODULE_ICONS[mod.icon];
              const hasWriteAccess = Boolean(
                mod.writePermissions && hasPermission(mod.writePermissions)
              );

              return (
                <div
                  key={mod.id}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs transition-shadow hover:shadow-md"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-600/15">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">
                            {mod.label}
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            {mod.subItems?.length ?? 0} sub-modul tersedia
                          </p>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          hasWriteAccess
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                            : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20"
                        }`}
                      >
                        {hasWriteAccess ? "Kelola / Aksi" : "Lihat Saja"}
                      </span>
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-slate-600">
                      {mod.description}
                    </p>

                    {mod.subItems && mod.subItems.length > 0 && (
                      <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3.5">
                        {mod.subItems.map((sub) => {
                          const canWriteSub = Boolean(
                            sub.writePermissions &&
                              hasPermission(sub.writePermissions)
                          );

                          return (
                            <li
                              key={sub.id}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <Link
                                href={sub.href}
                                className="flex min-w-0 items-center gap-2 font-medium text-slate-700 hover:text-indigo-600"
                              >
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                                <span className="truncate">{sub.label}</span>
                              </Link>
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                {canWriteSub ? "Read/Write" : "Read"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Active Permissions Detail */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-6">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Daftar Permission Aktif ({permissions.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Hak akses granular yang diberikan kepada akun Anda oleh backend
                  Spatie RBAC.
                </p>
              </div>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={permissionSearch}
                onChange={(e) => setPermissionSearch(e.target.value)}
                placeholder="Filter permission..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          {filteredPermissions.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {filteredPermissions.map((perm) => (
                <span
                  key={perm}
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-700"
                >
                  {perm}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">
              Tidak ada permission yang cocok dengan filter{" "}
              <span className="font-mono font-semibold text-slate-700">
                {permissionSearch}
              </span>
              .
            </p>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
