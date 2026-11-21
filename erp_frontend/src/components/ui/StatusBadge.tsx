"use client";

import React from "react";
import type {
  AgingBucketLabel,
  CustomerStatus,
  DeliveryOrderStatus,
  GoodsReceiptStatus,
  InventoryLedgerState,
  InvoiceStatus,
  PaymentMethod,
  PurchaseOrderStatus,
  PurchaseRequisitionStatus,
  SalesOrderStatus,
  StockMovementType,
  SupplierStatus,
} from "@/types/erp";

interface BadgeStyle {
  label: string;
  badgeClass: string;
  dotClass: string;
}

function StatusPill({ style }: { style: BadgeStyle }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${style.badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dotClass}`} />
      {style.label}
    </span>
  );
}

export function ActiveStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <StatusPill
      style={
        isActive
          ? {
              label: "Aktif",
              badgeClass:
                "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
              dotClass: "bg-emerald-500",
            }
          : {
              label: "Nonaktif",
              badgeClass:
                "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
              dotClass: "bg-slate-400",
            }
      }
    />
  );
}

const SUPPLIER_STATUS_STYLES: Record<SupplierStatus, BadgeStyle> = {
  active: {
    label: "Active",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  inactive: {
    label: "Inactive",
    badgeClass:
      "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  blacklisted: {
    label: "Blacklisted",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
};

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  return (
    <StatusPill
      style={
        SUPPLIER_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const CUSTOMER_STATUS_STYLES: Record<CustomerStatus, BadgeStyle> = {
  active: {
    label: "Active",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  inactive: {
    label: "Inactive",
    badgeClass:
      "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  suspended: {
    label: "Suspended",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
};

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return (
    <StatusPill
      style={
        CUSTOMER_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const PR_STATUS_STYLES: Record<PurchaseRequisitionStatus, BadgeStyle> = {
  Draft: {
    label: "Draft",
    badgeClass:
      "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  Submitted: {
    label: "Submitted",
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    dotClass: "bg-sky-500",
  },
  Converted: {
    label: "Converted",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
};

export function PrStatusBadge({
  status,
}: {
  status: PurchaseRequisitionStatus;
}) {
  return (
    <StatusPill
      style={
        PR_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const PO_STATUS_STYLES: Record<PurchaseOrderStatus, BadgeStyle> = {
  Draft: {
    label: "Draft",
    badgeClass:
      "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  "Pending Approval": {
    label: "Pending Approval",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
  Approved: {
    label: "Approved",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  Rejected: {
    label: "Rejected",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
  "Partially Received": {
    label: "Partially Received",
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    dotClass: "bg-sky-500",
  },
  Completed: {
    label: "Completed",
    badgeClass:
      "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
    dotClass: "bg-indigo-600",
  },
};

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <StatusPill
      style={
        PO_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const GR_STATUS_STYLES: Record<GoodsReceiptStatus, BadgeStyle> = {
  Draft: {
    label: "Draft",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
  Validated: {
    label: "Validated",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
};

export function GrStatusBadge({ status }: { status: GoodsReceiptStatus }) {
  return (
    <StatusPill
      style={
        GR_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const INVENTORY_STATE_STYLES: Record<InventoryLedgerState, BadgeStyle> = {
  available: {
    label: "Available",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  reserved: {
    label: "Reserved",
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    dotClass: "bg-sky-500",
  },
  in_transit: {
    label: "In Transit",
    badgeClass:
      "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
    dotClass: "bg-indigo-500",
  },
  in_qc: {
    label: "In QC (Karantina)",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
};

export function InventoryStateBadge({
  state,
}: {
  state: InventoryLedgerState;
}) {
  return (
    <StatusPill
      style={
        INVENTORY_STATE_STYLES[state] ?? {
          label: state,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const STOCK_MOVEMENT_TYPE_STYLES: Record<StockMovementType, BadgeStyle> = {
  IN: {
    label: "IN (Masuk)",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  OUT: {
    label: "OUT (Keluar)",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
  ADJ: {
    label: "ADJ (Penyesuaian)",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
};

export function StockMovementTypeBadge({
  type,
}: {
  type: StockMovementType;
}) {
  return (
    <StatusPill
      style={
        STOCK_MOVEMENT_TYPE_STYLES[type] ?? {
          label: type,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const SO_STATUS_STYLES: Record<SalesOrderStatus, BadgeStyle> = {
  Draft: {
    label: "Draft",
    badgeClass:
      "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  Confirmed: {
    label: "Confirmed",
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    dotClass: "bg-sky-500",
  },
  "Partially Delivered": {
    label: "Partially Delivered",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
  Completed: {
    label: "Completed",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  Cancelled: {
    label: "Cancelled",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
};

export function SoStatusBadge({ status }: { status: SalesOrderStatus }) {
  return (
    <StatusPill
      style={
        SO_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const DO_STATUS_STYLES: Record<DeliveryOrderStatus, BadgeStyle> = {
  Draft: {
    label: "Draft",
    badgeClass:
      "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
    dotClass: "bg-slate-400",
  },
  Dispatched: {
    label: "Dispatched",
    badgeClass:
      "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
    dotClass: "bg-indigo-500",
  },
  Delivered: {
    label: "Delivered",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  Cancelled: {
    label: "Cancelled",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
};

export function DoStatusBadge({ status }: { status: DeliveryOrderStatus }) {
  return (
    <StatusPill
      style={
        DO_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const INVOICE_STATUS_STYLES: Record<InvoiceStatus, BadgeStyle> = {
  Unpaid: {
    label: "Unpaid",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
  "Partially Paid": {
    label: "Partially Paid",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
  Paid: {
    label: "Paid",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <StatusPill
      style={
        INVOICE_STATUS_STYLES[status] ?? {
          label: status,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const PAYMENT_METHOD_STYLES: Record<PaymentMethod, BadgeStyle> = {
  bank_transfer: {
    label: "Bank Transfer",
    badgeClass: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
    dotClass: "bg-indigo-500",
  },
  virtual_account: {
    label: "Virtual Account",
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    dotClass: "bg-sky-500",
  },
  cash: {
    label: "Cash",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  giro: {
    label: "Giro",
    badgeClass: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20",
    dotClass: "bg-violet-500",
  },
  cheque: {
    label: "Cheque",
    badgeClass: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
};

export function PaymentMethodBadge({ method }: { method: PaymentMethod }) {
  return (
    <StatusPill
      style={
        PAYMENT_METHOD_STYLES[method] ?? {
          label: method,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}

const AGING_BUCKET_STYLES: Record<AgingBucketLabel, BadgeStyle> = {
  Current: {
    label: "Current",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-500",
  },
  "1-30 Days": {
    label: "1-30 Days",
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    dotClass: "bg-sky-500",
  },
  "31-60 Days": {
    label: "31-60 Days",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
  },
  ">60 Days": {
    label: ">60 Days",
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-500",
  },
};

export function AgingBucketBadge({ bucket }: { bucket: AgingBucketLabel }) {
  return (
    <StatusPill
      style={
        AGING_BUCKET_STYLES[bucket] ?? {
          label: bucket,
          badgeClass:
            "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-500/20",
          dotClass: "bg-slate-400",
        }
      }
    />
  );
}
