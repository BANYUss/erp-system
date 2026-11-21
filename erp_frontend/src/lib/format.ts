import axios from "axios";
import type { ApiErrorResponse } from "@/types/auth";

export const PO_MANAGER_APPROVAL_LIMIT = 10_000_000;

export function parseDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatRupiah(
  value: string | number | null | undefined,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const num = parseDecimal(value);
  const hasFraction = Math.abs(num % 1) > 0.0001;
  const minFrac = options?.minimumFractionDigits ?? (hasFraction ? 2 : 0);
  const maxFrac = options?.maximumFractionDigits ?? 2;

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(num);
}

export function formatNumber(
  value: string | number | null | undefined,
  maximumFractionDigits = 2
): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const num = parseDecimal(value);
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(num);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) {
    return "-";
  }
  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getOffsetDateString(daysOffset: number): string {
  const target = new Date();
  target.setDate(target.getDate() + daysOffset);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function generateIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const val = char === "x" ? rand : (rand & 0x3) | 0x8;
    return val.toString(16);
  });
}

export const PAYMENT_METHOD_OPTIONS: Array<{
  value: "bank_transfer" | "cash" | "giro" | "cheque" | "virtual_account";
  label: string;
}> = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "virtual_account", label: "Virtual Account" },
  { value: "cash", label: "Tunai (Cash)" },
  { value: "giro", label: "Giro" },
  { value: "cheque", label: "Cek (Cheque)" },
];

export function formatPaymentMethod(method: string | null | undefined): string {
  if (!method) {
    return "-";
  }
  const found = PAYMENT_METHOD_OPTIONS.find((opt) => opt.value === method);
  return found ? found.label : method;
}

export interface CoaAccountMeta {
  code: string;
  name: string;
  category: "Aset" | "Liabilitas" | "Pendapatan" | "Beban";
}

export const STANDARD_COA_ACCOUNTS: CoaAccountMeta[] = [
  {
    code: "1101-CASH-BANK",
    name: "Kas & Bank",
    category: "Aset",
  },
  {
    code: "1102-AR",
    name: "Piutang Usaha (Accounts Receivable)",
    category: "Aset",
  },
  {
    code: "1201-INVENTORY",
    name: "Persediaan Barang Dagang",
    category: "Aset",
  },
  {
    code: "2101-AP",
    name: "Hutang Usaha (Accounts Payable)",
    category: "Liabilitas",
  },
  {
    code: "2102-GRIR",
    name: "Hutang Sementara (GR/IR Clearing)",
    category: "Liabilitas",
  },
  {
    code: "4101-SALES-REVENUE",
    name: "Pendapatan Penjualan",
    category: "Pendapatan",
  },
  {
    code: "5101-COGS",
    name: "Harga Pokok Penjualan (COGS)",
    category: "Beban",
  },
];

export function getCoaAccountMeta(accountCode: string): CoaAccountMeta | null {
  return (
    STANDARD_COA_ACCOUNTS.find((acc) => acc.code === accountCode) ?? null
  );
}

export function daysUntilDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) {
    return null;
  }
  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const target = new Date(normalized);
  if (Number.isNaN(target.getTime())) {
    return null;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function formatMorphReference(
  referenceType: string | null | undefined,
  referenceId: number | null | undefined
): string {
  if (!referenceType && !referenceId) {
    return "-";
  }
  const shortName = referenceType
    ? referenceType.split("\\").pop() || referenceType
    : "Ref";
  return referenceId ? `${shortName} #${referenceId}` : shortName;
}

export interface ParsedApiError {
  message: string;
  status?: number;
  fieldErrors: Record<string, string[]>;
}

export function extractApiError(
  error: unknown,
  fallbackMessage = "Terjadi kesalahan saat memproses permintaan."
): ParsedApiError {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    const fieldErrors = data?.errors ?? {};

    let message = data?.message?.trim() || "";

    if (!message) {
      const firstFieldError = Object.values(fieldErrors).flat()[0];
      if (firstFieldError) {
        message = firstFieldError;
      } else if (status === 403) {
        message = "Anda tidak memiliki izin untuk melakukan tindakan ini (HTTP 403).";
      } else if (status === 409) {
        message =
          "Permintaan duplikat ditolak oleh proteksi idempotency (HTTP 409 Conflict).";
      } else if (status === 422) {
        message = "Data yang dikirim tidak valid. Periksa kembali isian formulir Anda (HTTP 422).";
      } else if (status === 404) {
        message = "Data yang diminta tidak ditemukan (HTTP 404).";
      } else {
        message = error.message || fallbackMessage;
      }
    }

    return {
      message,
      status,
      fieldErrors,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message || fallbackMessage,
      fieldErrors: {},
    };
  }

  return {
    message: fallbackMessage,
    fieldErrors: {},
  };
}
