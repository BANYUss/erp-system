export type ModuleIconKey =
  | "dashboard"
  | "master-data"
  | "procurement"
  | "inventory"
  | "sales"
  | "finance";

export interface ModuleSubItem {
  id: string;
  label: string;
  href: string;
  description: string;
  requiredPermissions: string[];
  writePermissions?: string[];
  implemented?: boolean;
}

export interface ErpModuleConfig {
  id: ModuleIconKey;
  label: string;
  href: string;
  description: string;
  icon: ModuleIconKey;
  /** Empty array means accessible to all authenticated users */
  requiredPermissions: string[];
  writePermissions?: string[];
  implemented?: boolean;
  subItems?: ModuleSubItem[];
}

export const ERP_MODULES: ErpModuleConfig[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    description:
      "Ringkasan profil akun, peran RBAC aktif, dan status akses modul ERP Distribusi.",
    icon: "dashboard",
    requiredPermissions: [],
    implemented: true,
  },
  {
    id: "master-data",
    label: "Master Data",
    href: "/master-data/products",
    description:
      "Pengelolaan data induk produk, supplier, dan pelanggan termasuk batas kredit.",
    icon: "master-data",
    requiredPermissions: ["products.view", "suppliers.view", "customers.view"],
    writePermissions: [
      "products.manage",
      "suppliers.manage",
      "customers.manage",
      "customers.override_credit_limit",
    ],
    subItems: [
      {
        id: "products",
        label: "Produk",
        href: "/master-data/products",
        description: "Katalog SKU, kategori, dan kontrol visibilitas harga.",
        requiredPermissions: ["products.view"],
        writePermissions: ["products.manage"],
        implemented: true,
      },
      {
        id: "suppliers",
        label: "Supplier",
        href: "/master-data/suppliers",
        description: "Direktori pemasok dan termin pembelian.",
        requiredPermissions: ["suppliers.view"],
        writePermissions: ["suppliers.manage"],
        implemented: true,
      },
      {
        id: "customers",
        label: "Customer",
        href: "/master-data/customers",
        description: "Data pelanggan, credit limit, dan otorisasi override.",
        requiredPermissions: ["customers.view"],
        writePermissions: [
          "customers.manage",
          "customers.override_credit_limit",
        ],
        implemented: true,
      },
    ],
  },
  {
    id: "procurement",
    label: "Procurement",
    href: "/procurement/purchase-orders",
    description:
      "Alur Procure-to-Pay (P2P): PR, approval PO berjenjang, dan validasi Goods Receipt.",
    icon: "procurement",
    requiredPermissions: [
      "purchase_requisitions.view",
      "purchase_orders.view",
      "goods_receipts.view",
    ],
    writePermissions: [
      "purchase_requisitions.create",
      "purchase_requisitions.submit",
      "purchase_orders.create",
      "purchase_orders.update",
      "purchase_orders.approve",
      "goods_receipts.create",
      "goods_receipts.validate",
    ],
    subItems: [
      {
        id: "purchase-requisitions",
        label: "Purchase Requisitions",
        href: "/procurement/purchase-requisitions",
        description: "Permintaan pembelian dan konversi ke PO.",
        requiredPermissions: ["purchase_requisitions.view"],
        writePermissions: [
          "purchase_requisitions.create",
          "purchase_requisitions.submit",
        ],
        implemented: true,
      },
      {
        id: "purchase-orders",
        label: "Purchase Orders",
        href: "/procurement/purchase-orders",
        description: "Pemesanan pembelian & approval limit di atas Rp10 Juta.",
        requiredPermissions: ["purchase_orders.view"],
        writePermissions: [
          "purchase_orders.create",
          "purchase_orders.update",
          "purchase_orders.approve",
        ],
        implemented: true,
      },
      {
        id: "goods-receipts",
        label: "Goods Receipts",
        href: "/procurement/goods-receipts",
        description: "Penerimaan fisik barang dan validasi batch gudang.",
        requiredPermissions: ["goods_receipts.view"],
        writePermissions: ["goods_receipts.create", "goods_receipts.validate"],
        implemented: true,
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    href: "/inventory/ledgers",
    description:
      "Kontrol persediaan level batch, mutasi stok immutable, dan alokasi FEFO.",
    icon: "inventory",
    requiredPermissions: [
      "inventory.view_available",
      "inventory.view_physical",
      "inventory.view_cost",
      "stock_movements.view",
    ],
    writePermissions: ["stock_opname.manage"],
    subItems: [
      {
        id: "inventory-ledgers",
        label: "Inventory Ledgers",
        href: "/inventory/ledgers",
        description: "Ringkasan stok available, fisik, dan valuasi HPP.",
        requiredPermissions: [
          "inventory.view_available",
          "inventory.view_physical",
          "inventory.view_cost",
        ],
        implemented: true,
      },
      {
        id: "stock-movements",
        label: "Stock Movements",
        href: "/inventory/stock-movements",
        description: "Buku besar mutasi stok debit/kredit yang tidak dapat diubah.",
        requiredPermissions: ["stock_movements.view"],
        implemented: true,
      },
      {
        id: "fefo-picking",
        label: "FEFO Picking",
        href: "/inventory/fefo-picking",
        description: "Rekomendasi pengambilan barang berdasarkan tanggal kedaluwarsa terdekat.",
        requiredPermissions: [
          "inventory.view_available",
          "inventory.view_physical",
        ],
        implemented: true,
      },
    ],
  },
  {
    id: "sales",
    label: "Sales O2C",
    href: "/sales/sales-orders",
    description:
      "Siklus Order-to-Cash: pembuatan Sales Order, reservasi stok, dan Delivery Order.",
    icon: "sales",
    requiredPermissions: ["sales_orders.view", "delivery_orders.view"],
    writePermissions: [
      "sales_orders.create",
      "sales_orders.update",
      "customers.override_credit_limit",
      "delivery_orders.create",
      "delivery_orders.process",
    ],
    subItems: [
      {
        id: "sales-orders",
        label: "Sales Orders",
        href: "/sales/sales-orders",
        description: "Pesanan penjualan, pengecekan credit limit, dan konfirmasi SO.",
        requiredPermissions: ["sales_orders.view"],
        writePermissions: [
          "sales_orders.create",
          "sales_orders.update",
          "customers.override_credit_limit",
        ],
        implemented: true,
      },
      {
        id: "delivery-orders",
        label: "Delivery Orders",
        href: "/sales/delivery-orders",
        description: "Surat jalan, dispatch pengiriman, dan konfirmasi terima barang.",
        requiredPermissions: ["delivery_orders.view"],
        writePermissions: ["delivery_orders.create", "delivery_orders.process"],
        implemented: true,
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    href: "/finance/general-ledger",
    description:
      "Manajemen AP/AR, 3-Way Matching invoice, pembayaran, dan General Ledger.",
    icon: "finance",
    requiredPermissions: [
      "invoices.view",
      "payments.view",
      "general_ledger.view",
      "financial_reports.view",
    ],
    writePermissions: [
      "invoices.create",
      "invoices.manage",
      "payments.create",
      "payments.manage",
      "general_ledger.manage",
      "ap.manage",
      "ar.manage",
      "bank_reconciliation.manage",
    ],
    subItems: [
      {
        id: "purchase-invoices",
        label: "Purchase Invoices & AP Aging",
        href: "/finance/purchase-invoices",
        description: "Faktur pembelian (3-Way Matching) dan analisis umur utang.",
        requiredPermissions: ["invoices.view", "financial_reports.view"],
        writePermissions: ["invoices.create", "invoices.manage"],
        implemented: true,
      },
      {
        id: "payment-vouchers",
        label: "Payment Vouchers (AP)",
        href: "/finance/payment-vouchers",
        description: "Pembayaran utang ke supplier dengan proteksi idempotency.",
        requiredPermissions: ["payments.view"],
        writePermissions: ["payments.create", "payments.manage"],
        implemented: true,
      },
      {
        id: "sales-invoices",
        label: "Sales Invoices & AR Aging",
        href: "/finance/sales-invoices",
        description: "Faktur penjualan dan monitoring umur piutang pelanggan.",
        requiredPermissions: ["invoices.view", "financial_reports.view"],
        writePermissions: ["invoices.create", "invoices.manage"],
        implemented: true,
      },
      {
        id: "customer-payments",
        label: "Customer Payments (AR)",
        href: "/finance/customer-payments",
        description: "Pencatatan pelunasan piutang pelanggan.",
        requiredPermissions: ["payments.view"],
        writePermissions: ["payments.create", "payments.manage"],
        implemented: true,
      },
      {
        id: "general-ledger",
        label: "General Ledger",
        href: "/finance/general-ledger",
        description: "Jurnal akuntansi real-time dan ringkasan saldo buku besar.",
        requiredPermissions: ["general_ledger.view"],
        writePermissions: ["general_ledger.manage"],
        implemented: true,
      },
    ],
  },
];

export interface RoleBadgeStyle {
  badgeClass: string;
  dotClass: string;
  summary: string;
}

export const ROLE_STYLE_MAP: Record<string, RoleBadgeStyle> = {
  "Super Admin": {
    badgeClass: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
    dotClass: "bg-indigo-600",
    summary: "Akses penuh seluruh modul, MDM, konfigurasi sistem, dan bypass otorisasi.",
  },
  "Staf Gudang": {
    badgeClass: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20",
    dotClass: "bg-amber-500",
    summary: "Fokus operasional fisik barang (GR, DO, FEFO, Stock Opname). Terbatas dari data harga & keuangan.",
  },
  "Admin Sales": {
    badgeClass: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
    dotClass: "bg-sky-600",
    summary: "Mengelola Sales Order, melihat stok available & credit limit pelanggan.",
  },
  Purchasing: {
    badgeClass: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    dotClass: "bg-emerald-600",
    summary: "Mengelola PR, PO, data supplier/produk, harga beli, dan approval PO sesuai limit.",
  },
  Finance: {
    badgeClass: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20",
    dotClass: "bg-violet-600",
    summary: "Mengelola AP/AR, invoicing, pembayaran, rekonsiliasi bank, dan General Ledger.",
  },
  Manajer: {
    badgeClass: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
    dotClass: "bg-rose-600",
    summary: "Approver PO di atas limit, override credit limit pelanggan, serta monitoring lintas modul.",
  },
};

export function getRoleBadgeStyle(role: string): RoleBadgeStyle {
  return (
    ROLE_STYLE_MAP[role] ?? {
      badgeClass: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-600/20",
      dotClass: "bg-slate-500",
      summary: "Peran aktif pada sistem ERP Distribusi.",
    }
  );
}

export function filterAccessibleModules(
  hasPermission: (permission: string | string[], requireAll?: boolean) => boolean
): ErpModuleConfig[] {
  return ERP_MODULES.reduce<ErpModuleConfig[]>((acc, mod) => {
    const canViewModule =
      mod.requiredPermissions.length === 0 ||
      hasPermission(mod.requiredPermissions);

    if (!canViewModule) {
      return acc;
    }

    if (!mod.subItems) {
      acc.push(mod);
      return acc;
    }

    const visibleSubItems = mod.subItems.filter(
      (item) =>
        item.requiredPermissions.length === 0 ||
        hasPermission(item.requiredPermissions)
    );

    if (visibleSubItems.length > 0) {
      acc.push({
        ...mod,
        href: visibleSubItems[0].href,
        subItems: visibleSubItems,
      });
    }

    return acc;
  }, []);
}
