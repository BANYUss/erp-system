"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Landmark,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  filterAccessibleModules,
  getRoleBadgeStyle,
  type ErpModuleConfig,
  type ModuleIconKey,
} from "@/lib/rbac";

interface DashboardShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

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

export function DashboardShell({
  title,
  subtitle,
  children,
}: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, roles, permissions, isAuthenticated, isLoading, logout, hasPermission } =
    useAuth();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const accessibleModules = useMemo(
    () => filterAccessibleModules(hasPermission),
    [hasPermission]
  );

  const toggleModule = (moduleId: string) => {
    setExpandedModules((prev) => ({
      ...prev,
      [moduleId]: !prev[moduleId],
    }));
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const isModuleActive = (mod: ErpModuleConfig): boolean => {
    if (mod.id === "dashboard") {
      return pathname === "/dashboard";
    }
    if (mod.subItems) {
      return mod.subItems.some(
        (sub) => pathname === sub.href || pathname.startsWith(`${sub.href}/`)
      );
    }
    return pathname === mod.href || pathname.startsWith(`${mod.href}/`);
  };

  if (isLoading || !isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-900">
              {isLoading
                ? "Memverifikasi sesi & hak akses..."
                : "Mengarahkan ke halaman login..."}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              ERP Distribusi &bull; Dynamic RBAC Guard
            </p>
          </div>
        </div>
      </div>
    );
  }

  const renderNavigation = (onNavigate?: () => void) => (
    <nav aria-label="Navigasi Utama ERP" className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
      <div className="px-3 pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Modul Tersedia ({accessibleModules.length})
        </p>
      </div>

      {accessibleModules.map((mod) => {
        const Icon = MODULE_ICONS[mod.icon];
        const active = isModuleActive(mod);
        const hasChildren = Boolean(mod.subItems && mod.subItems.length > 0);
        const isExpanded = expandedModules[mod.id] ?? active;

        if (!hasChildren) {
          return (
            <Link
              key={mod.id}
              href={mod.href}
              onClick={onNavigate}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  active ? "text-white" : "text-slate-400 group-hover:text-white"
                }`}
              />
              <span className="truncate">{mod.label}</span>
            </Link>
          );
        }

        return (
          <div key={mod.id} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleModule(mod.id)}
              aria-expanded={isExpanded}
              className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-3 truncate">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? "text-indigo-400" : "text-slate-400 group-hover:text-white"
                  }`}
                />
                <span className="truncate">{mod.label}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-200">
                  {mod.subItems?.length ?? 0}
                </span>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                )}
              </span>
            </button>

            {isExpanded && mod.subItems && (
              <div className="ml-4 space-y-0.5 border-l border-slate-800 pl-3">
                {mod.subItems.map((sub) => {
                  const subActive =
                    pathname === sub.href || pathname.startsWith(`${sub.href}/`);

                  return (
                    <Link
                      key={sub.id}
                      href={sub.href}
                      onClick={onNavigate}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        subActive
                          ? "bg-indigo-600/20 text-indigo-300"
                          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                      }`}
                    >
                      <span className="truncate">{sub.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );

  const renderSidebarFooter = () => (
    <div className="border-t border-slate-800 p-3">
      <div className="rounded-xl bg-slate-800/60 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-xs font-bold text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
            {getInitials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-700/70 pt-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            {permissions.length} Izin Aktif
          </span>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-50"
          >
            {isLoggingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Keluar
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-slate-900 text-white shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4">
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold tracking-tight text-white">
                    ERP Distribusi
                  </p>
                  <p className="text-[11px] text-slate-400">Enterprise Suite</p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Tutup menu navigasi"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderNavigation(() => setMobileMenuOpen(false))}
            {renderSidebarFooter()}
          </aside>
        </div>
      )}

      {/* Desktop Fixed Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-slate-800 bg-slate-900 text-white lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-white">
                ERP Distribusi
              </p>
              <p className="text-[11px] text-slate-400">
                Enterprise Suite
              </p>
            </div>
          </Link>
        </div>
        {renderNavigation()}
        {renderSidebarFooter()}
      </aside>

      {/* Main Layout Area */}
      <div className="flex min-h-screen flex-col lg:pl-72">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Buka menu navigasi"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
                {title}
              </h1>
              {subtitle && (
                <p className="hidden truncate text-xs text-slate-500 sm:block">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5 sm:gap-3">
            <div className="hidden flex-wrap items-center gap-1.5 md:flex">
              {roles.map((role) => {
                const style = getRoleBadgeStyle(role);
                return (
                  <span
                    key={role}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.badgeClass}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dotClass}`} />
                    {role}
                  </span>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
            >
              {isLoggingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
