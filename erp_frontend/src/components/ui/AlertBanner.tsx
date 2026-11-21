"use client";

import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";

type AlertVariant = "error" | "success" | "warning" | "info";

interface AlertBannerProps {
  variant: AlertVariant;
  title?: string;
  message: string;
  httpStatus?: number;
  fieldErrors?: Record<string, string[]>;
  onDismiss?: () => void;
}

const VARIANT_CONFIG: Record<
  AlertVariant,
  {
    container: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    badge: string;
  }
> = {
  error: {
    container: "border-rose-200 bg-rose-50 text-rose-900",
    icon: AlertCircle,
    iconClass: "text-rose-600",
    badge: "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  },
  success: {
    container: "border-emerald-200 bg-emerald-50 text-emerald-900",
    icon: CheckCircle2,
    iconClass: "text-emerald-600",
    badge:
      "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  },
  warning: {
    container: "border-amber-200 bg-amber-50 text-amber-900",
    icon: AlertTriangle,
    iconClass: "text-amber-600",
    badge: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-600/20",
  },
  info: {
    container: "border-sky-200 bg-sky-50 text-sky-900",
    icon: Info,
    iconClass: "text-sky-600",
    badge: "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  },
};

export function AlertBanner({
  variant,
  title,
  message,
  httpStatus,
  fieldErrors,
  onDismiss,
}: AlertBannerProps) {
  const cfg = VARIANT_CONFIG[variant];
  const Icon = cfg.icon;
  const errorEntries = fieldErrors ? Object.entries(fieldErrors) : [];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-xs ${cfg.container}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.iconClass}`} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {title && <p className="font-semibold">{title}</p>}
          {httpStatus && (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${cfg.badge}`}
            >
              HTTP {httpStatus}
            </span>
          )}
        </div>
        <p className="leading-relaxed">{message}</p>
        {errorEntries.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] opacity-90">
            {errorEntries.map(([field, messages]) =>
              messages.map((msg, idx) => (
                <li key={`${field}-${idx}`}>
                  <span className="font-mono font-semibold">{field}</span>:{" "}
                  {msg}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Tutup notifikasi"
          className="rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
