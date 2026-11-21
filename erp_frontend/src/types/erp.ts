export interface PaginationLinks {
  first: string | null;
  last: string | null;
  prev: string | null;
  next: string | null;
}

export interface PaginationMeta {
  current_page: number;
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  links: PaginationLinks;
  meta: PaginationMeta;
}

export interface ApiResourceResponse<T> {
  data: T;
  message?: string;
}

export interface ApiMessageResponse {
  message: string;
}

/* ===========================
 * Master Data: Products
 * =========================== */

export interface ProductInventoryLedger {
  id: number;
  state: string;
  qty: string;
  cost_price?: string;
}

export interface ProductBatch {
  id: number;
  batch_number: string;
  expiry_date: string | null;
  inventory_ledgers: ProductInventoryLedger[];
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  category_id: number | null;
  uom: string;
  is_active: boolean;
  /** Only returned by backend when user has inventory.view_available */
  available_qty?: string;
  /** Only returned by backend when user has inventory.view_cost */
  cost_price?: string | null;
  /** Only returned by backend when user has inventory.view_cost */
  inventory_value?: string;
  batches?: ProductBatch[];
  created_at: string | null;
  updated_at: string | null;
}

export interface ProductPayload {
  sku: string;
  name: string;
  category_id?: number | null;
  uom: string;
  is_active: boolean;
}

/* ===========================
 * Master Data: Suppliers
 * =========================== */

export type SupplierStatus = "active" | "inactive" | "blacklisted";

export interface Supplier {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: SupplierStatus;
  created_at: string | null;
  updated_at: string | null;
}

export interface SupplierPayload {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  status: SupplierStatus;
}

/* ===========================
 * Master Data: Customers
 * =========================== */

export type CustomerStatus = "active" | "inactive" | "suspended";

export interface Customer {
  id: number;
  name: string;
  email: string | null;
  /** Only returned by backend when user has customers.view_credit_limit */
  credit_limit?: string;
  status: CustomerStatus;
  created_at: string | null;
  updated_at: string | null;
}

export interface CustomerPayload {
  name: string;
  email?: string | null;
  credit_limit?: number | string;
  status: CustomerStatus;
}

/* ===========================
 * Procurement: Purchase Requisitions
 * =========================== */

export type PurchaseRequisitionStatus = "Draft" | "Submitted" | "Converted";

export interface UserSummary {
  id: number;
  name: string;
  email: string;
}

export interface PurchaseOrderBrief {
  id: number;
  po_number: string;
  supplier_id: number;
  total_amount: string;
  status: PurchaseOrderStatus;
}

export interface PurchaseRequisition {
  id: number;
  pr_number: string;
  requestor_id: number;
  status: PurchaseRequisitionStatus;
  requestor?: UserSummary;
  purchase_orders?: PurchaseOrderBrief[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreatePurchaseRequisitionPayload {
  pr_number?: string | null;
  status?: "Draft" | "Submitted";
}

export interface PurchaseOrderItemInput {
  product_id: number;
  qty_ordered: number | string;
  unit_price: number | string;
}

export interface ConvertPrToPoPayload {
  po_number?: string | null;
  supplier_id: number;
  items: PurchaseOrderItemInput[];
}

/* ===========================
 * Procurement: Purchase Orders
 * =========================== */

export type PurchaseOrderStatus =
  | "Draft"
  | "Pending Approval"
  | "Approved"
  | "Rejected"
  | "Partially Received"
  | "Completed";

export interface PurchaseOrderItemProduct {
  id: number;
  sku: string;
  name: string;
  uom: string;
}

export interface PurchaseOrderItem {
  id: number;
  po_id: number;
  product_id: number;
  qty_ordered: string;
  unit_price: string;
  subtotal: string;
  product?: PurchaseOrderItemProduct;
  created_at: string | null;
  updated_at: string | null;
}

export interface PurchaseRequisitionBrief {
  id: number;
  pr_number: string;
  status: PurchaseRequisitionStatus;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  pr_id: number | null;
  supplier_id: number;
  total_amount: string;
  status: PurchaseOrderStatus;
  requires_manager_approval: boolean;
  approver_id: number | null;
  purchase_requisition?: PurchaseRequisitionBrief | null;
  supplier?: Supplier;
  approver?: UserSummary | null;
  items?: PurchaseOrderItem[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreatePurchaseOrderPayload {
  po_number?: string | null;
  pr_id?: number | null;
  supplier_id: number;
  items: PurchaseOrderItemInput[];
}

export interface ApprovePurchaseOrderPayload {
  notes?: string | null;
}

export interface RejectPurchaseOrderPayload {
  reason?: string | null;
}

/* ===========================
 * Procurement / Warehouse: Goods Receipts
 * =========================== */

export type GoodsReceiptStatus = "Draft" | "Validated";

export interface ProductBrief {
  id: number;
  sku: string;
  name: string;
  uom: string;
}

export interface BatchBrief {
  id: number;
  batch_number: string;
  expiry_date: string | null;
}

export interface GoodsReceiptPurchaseOrderBrief {
  id: number;
  po_number: string;
  supplier_id: number;
  status: PurchaseOrderStatus;
  /** Only returned when user has inventory.view_cost & purchase_orders.view */
  total_amount?: string;
  supplier?: {
    id: number;
    name: string;
  };
}

export interface GoodsReceiptItem {
  id: number;
  goods_receipt_id: number;
  product_id: number;
  product_batch_id: number;
  qty_received: string;
  /** Only returned when user has inventory.view_cost */
  cost_price?: string | null;
  product?: ProductBrief;
  batch?: BatchBrief;
  created_at: string | null;
  updated_at: string | null;
}

export interface GoodsReceipt {
  id: number;
  po_id: number;
  receipt_number: string;
  received_date: string | null;
  status: GoodsReceiptStatus;
  purchase_order?: GoodsReceiptPurchaseOrderBrief;
  items?: GoodsReceiptItem[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateGoodsReceiptItemInput {
  product_id: number;
  batch_number: string;
  expiry_date: string;
  qty_received: number | string;
}

export interface CreateGoodsReceiptPayload {
  po_id: number;
  receipt_number?: string | null;
  received_date: string;
  items: CreateGoodsReceiptItemInput[];
}

/* ===========================
 * Inventory Engine: Ledgers, Stock Movements, FEFO
 * =========================== */

export type InventoryLedgerState =
  | "available"
  | "reserved"
  | "in_transit"
  | "in_qc";

export interface InventoryBatchSummary {
  id: number;
  product_id: number;
  batch_number: string;
  expiry_date: string | null;
  product?: ProductBrief;
}

export interface InventoryLedger {
  id: number;
  product_batch_id: number;
  state: InventoryLedgerState;
  qty: string;
  /** Only returned when user has inventory.view_cost */
  cost_price?: string;
  /** Only returned when user has inventory.view_cost */
  inventory_value?: string;
  batch?: InventoryBatchSummary;
  created_at: string | null;
  updated_at: string | null;
}

export type StockMovementType = "IN" | "OUT" | "ADJ";

export interface StockMovement {
  id: number;
  product_batch_id: number;
  type: StockMovementType;
  qty_change: string;
  reference_type: string | null;
  reference_id: number | null;
  user_id: number | null;
  batch?: InventoryBatchSummary;
  user?: UserSummary | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FefoPickingEntry {
  inventory_ledger_id: number;
  product_batch_id: number;
  batch_number: string;
  expiry_date: string | null;
  state: InventoryLedgerState;
  available_qty: string;
  pick_qty: string;
  remaining_batch_qty: string;
  /** Only returned when user has inventory.view_cost */
  cost_price?: string;
}

export interface FefoPickingResult {
  product: ProductBrief;
  requested_qty: string;
  total_available_qty: string;
  allocated_qty: string;
  shortage_qty: string;
  is_fulfilled: boolean;
  picking_list: FefoPickingEntry[];
}

/* ===========================
 * Sales Operational (O2C): Sales Orders & Delivery Orders
 * =========================== */

export type SalesOrderStatus =
  | "Draft"
  | "Confirmed"
  | "Partially Delivered"
  | "Completed"
  | "Cancelled";

export type DeliveryOrderStatus =
  | "Draft"
  | "Dispatched"
  | "Delivered"
  | "Cancelled";

export interface SalesOrderItem {
  id: number;
  sales_order_id: number;
  product_id: number;
  qty_ordered: string;
  /** Only returned when user has products.view_selling_price */
  unit_price?: string;
  /** Only returned when user has products.view_selling_price */
  line_total?: string;
  product?: ProductBrief;
  created_at: string | null;
  updated_at: string | null;
}

export interface DeliveryOrderSalesOrderBrief {
  id: number;
  so_number: string;
  customer_id: number;
  status: SalesOrderStatus;
  /** Only returned when user has products.view_selling_price */
  total_amount?: string;
  customer?: {
    id: number;
    name: string;
  };
}

export interface DeliveryOrderItem {
  id: number;
  delivery_order_id: number;
  product_id: number;
  product_batch_id: number;
  qty_dispatched: string;
  /** Only returned when user has inventory.view_cost */
  unit_cost?: string;
  /** Only returned when user has inventory.view_cost */
  cogs_total?: string;
  product?: ProductBrief;
  batch?: BatchBrief;
  created_at: string | null;
  updated_at: string | null;
}

export interface GeneralLedgerEntryBrief {
  id: number;
  entry_date: string | null;
  account_code: string;
  debit: string;
  credit: string;
  description: string | null;
}

export interface DeliveryOrder {
  id: number;
  do_number: string;
  sales_order_id: number;
  delivery_date: string | null;
  status: DeliveryOrderStatus;
  /** Only returned when user has inventory.view_cost & items loaded */
  total_cogs?: string | null;
  sales_order?: DeliveryOrderSalesOrderBrief;
  items?: DeliveryOrderItem[];
  general_ledgers?: GeneralLedgerEntryBrief[];
  created_at: string | null;
  updated_at: string | null;
}

export interface SalesInvoiceBrief {
  id: number;
  invoice_number: string;
  total_billed?: string;
  status: string;
}

export interface SalesOrder {
  id: number;
  so_number: string;
  customer_id: number;
  salesperson_id: number | null;
  order_date: string | null;
  /** Only returned when user has products.view_selling_price */
  total_amount?: string;
  status: SalesOrderStatus;
  customer?: Customer;
  salesperson?: UserSummary | null;
  items?: SalesOrderItem[];
  delivery_orders?: DeliveryOrder[];
  sales_invoices?: SalesInvoiceBrief[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateSalesOrderItemInput {
  product_id: number;
  qty_ordered: number | string;
  unit_price: number | string;
}

export interface CreateSalesOrderPayload {
  customer_id: number;
  so_number?: string | null;
  order_date?: string | null;
  items: CreateSalesOrderItemInput[];
}

export interface ConfirmSalesOrderPayload {
  override_credit_limit?: boolean;
  override_reason?: string | null;
}

export interface CancelSalesOrderPayload {
  reason?: string | null;
}

export interface CreateDeliveryOrderItemInput {
  product_id: number;
  qty_dispatched: number | string;
}

export interface CreateDeliveryOrderPayload {
  sales_order_id: number;
  do_number?: string | null;
  delivery_date: string;
  items: CreateDeliveryOrderItemInput[];
}

/* ===========================
 * Finance & Accounting (Fase 4):
 * AP, Payment Vouchers, AR, Customer Payments, General Ledger
 * =========================== */

export type InvoiceStatus = "Unpaid" | "Partially Paid" | "Paid";

export type PaymentMethod =
  | "bank_transfer"
  | "cash"
  | "giro"
  | "cheque"
  | "virtual_account";

export type StandardAccountCode =
  | "1101-CASH-BANK"
  | "1102-AR"
  | "1201-INVENTORY"
  | "2101-AP"
  | "2102-GRIR"
  | "4101-SALES-REVENUE"
  | "5101-COGS";

export interface GeneralLedgerEntry {
  id: number;
  transaction_date: string | null;
  account_code: string;
  debit: string;
  credit: string;
  reference_type: string | null;
  reference_id: number | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TrialBalanceAccount {
  account_code: string;
  total_debit: string;
  total_credit: string;
  net_balance: string;
}

export interface TrialBalanceSummary {
  date_from: string | null;
  date_to: string | null;
  grand_total_debit: string;
  grand_total_credit: string;
  is_balanced: boolean;
  accounts: TrialBalanceAccount[];
}

export interface CreateGeneralLedgerLineInput {
  account_code: string;
  debit: number | string;
  credit: number | string;
  description?: string | null;
}

export interface CreateGeneralLedgerPayload {
  transaction_date: string;
  lines: CreateGeneralLedgerLineInput[];
}

/* --- Purchase Invoices (AP) & AP Aging --- */

export interface PurchaseInvoiceItem {
  id: number;
  purchase_invoice_id: number;
  product_id: number;
  qty_billed: string;
  unit_price: string;
  line_total: string;
  product?: ProductBrief;
}

export interface PurchaseInvoicePurchaseOrderBrief {
  id: number;
  po_number: string;
  total_amount: string;
  status: PurchaseOrderStatus;
}

export interface PurchaseInvoiceSupplierBrief {
  id: number;
  name: string;
  email: string | null;
}

export interface PurchaseInvoice {
  id: number;
  invoice_number: string;
  po_id: number;
  supplier_id: number;
  total_billed: string;
  total_paid?: string;
  remaining_balance?: string;
  due_date: string | null;
  status: InvoiceStatus;
  idempotency_key: string;
  purchase_order?: PurchaseInvoicePurchaseOrderBrief;
  supplier?: PurchaseInvoiceSupplierBrief;
  items?: PurchaseInvoiceItem[];
  payment_vouchers?: PaymentVoucher[];
  general_ledgers?: GeneralLedgerEntry[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreatePurchaseInvoiceItemInput {
  product_id: number;
  qty_billed: number | string;
  unit_price: number | string;
}

export interface CreatePurchaseInvoicePayload {
  po_id: number;
  supplier_id?: number | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date: string;
  total_billed: number | string;
  idempotency_key: string;
  items: CreatePurchaseInvoiceItemInput[];
}

export type AgingBucketKey =
  | "current"
  | "1_30_days"
  | "31_60_days"
  | "over_60_days";

export type AgingBucketLabel =
  | "Current"
  | "1-30 Days"
  | "31-60 Days"
  | ">60 Days";

export interface ApAgingInvoiceEntry {
  id: number;
  invoice_number: string;
  po_id: number;
  po_number: string | null;
  supplier_id: number;
  supplier_name: string | null;
  due_date: string;
  days_overdue: number;
  aging_bucket: AgingBucketLabel;
  status: InvoiceStatus;
  total_billed: string;
  total_paid: string;
  outstanding_amount: string;
}

export interface ApAgingBucket {
  label: AgingBucketLabel;
  count: number;
  total_outstanding: string;
  invoices: ApAgingInvoiceEntry[];
}

export interface ApAgingSupplierSummary {
  supplier_id: number;
  supplier_name: string | null;
  current: string;
  "1_30_days": string;
  "31_60_days": string;
  over_60_days: string;
  total_outstanding: string;
  invoice_count: number;
}

export interface ApAgingSummary {
  as_of_date: string;
  total_outstanding: string;
  total_invoices: number;
  buckets: Record<AgingBucketKey, ApAgingBucket>;
  by_supplier: ApAgingSupplierSummary[];
}

/* --- Payment Vouchers (AP) --- */

export interface PaymentVoucherPurchaseInvoiceBrief {
  id: number;
  invoice_number: string;
  po_id: number;
  supplier_id: number;
  total_billed: string;
  due_date: string | null;
  status: InvoiceStatus;
  total_paid?: string;
  remaining_balance?: string;
  supplier?: {
    id: number;
    name: string;
  };
}

export interface PaymentVoucher {
  id: number;
  voucher_number: string;
  purchase_invoice_id: number;
  amount_paid: string;
  payment_date: string | null;
  payment_method: PaymentMethod;
  idempotency_key: string;
  purchase_invoice?: PaymentVoucherPurchaseInvoiceBrief;
  general_ledgers?: GeneralLedgerEntry[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreatePaymentVoucherPayload {
  purchase_invoice_id: number;
  voucher_number?: string | null;
  amount_paid: number | string;
  payment_date: string;
  payment_method: PaymentMethod;
  idempotency_key: string;
}

/* --- Sales Invoices (AR) & AR Aging --- */

export interface SalesInvoiceSalesOrderBrief {
  id: number;
  so_number: string;
  total_amount: string;
  status: SalesOrderStatus;
}

export interface SalesInvoiceCustomerBrief {
  id: number;
  name: string;
  email: string | null;
}

export interface SalesInvoice {
  id: number;
  invoice_number: string;
  sales_order_id: number;
  customer_id: number;
  total_billed: string;
  total_received?: string;
  remaining_balance?: string;
  due_date: string | null;
  status: InvoiceStatus;
  idempotency_key: string;
  sales_order?: SalesInvoiceSalesOrderBrief;
  customer?: SalesInvoiceCustomerBrief;
  customer_payments?: CustomerPayment[];
  general_ledgers?: GeneralLedgerEntry[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateSalesInvoicePayload {
  sales_order_id?: number | null;
  delivery_order_id?: number | null;
  customer_id?: number | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date: string;
  total_billed?: number | string | null;
  idempotency_key: string;
}

export interface ArAgingInvoiceEntry {
  id: number;
  invoice_number: string;
  sales_order_id: number;
  so_number: string | null;
  customer_id: number;
  customer_name: string | null;
  due_date: string;
  days_overdue: number;
  aging_bucket: AgingBucketLabel;
  status: InvoiceStatus;
  total_billed: string;
  total_received: string;
  outstanding_amount: string;
}

export interface ArAgingBucket {
  label: AgingBucketLabel;
  count: number;
  total_outstanding: string;
  invoices: ArAgingInvoiceEntry[];
}

export interface ArAgingCustomerSummary {
  customer_id: number;
  customer_name: string | null;
  current: string;
  "1_30_days": string;
  "31_60_days": string;
  over_60_days: string;
  total_outstanding: string;
  invoice_count: number;
}

export interface ArAgingSummary {
  as_of_date: string;
  total_outstanding: string;
  total_invoices: number;
  buckets: Record<AgingBucketKey, ArAgingBucket>;
  by_customer: ArAgingCustomerSummary[];
}

/* --- Customer Payments (AR) --- */

export interface CustomerPaymentSalesInvoiceBrief {
  id: number;
  invoice_number: string;
  sales_order_id: number;
  customer_id: number;
  total_billed: string;
  due_date: string | null;
  status: InvoiceStatus;
  total_received?: string;
  remaining_balance?: string;
  customer?: {
    id: number;
    name: string;
  };
}

export interface CustomerPayment {
  id: number;
  receipt_number: string;
  sales_invoice_id: number;
  amount_received: string;
  payment_date: string | null;
  payment_method: PaymentMethod;
  idempotency_key: string;
  sales_invoice?: CustomerPaymentSalesInvoiceBrief;
  general_ledgers?: GeneralLedgerEntry[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateCustomerPaymentPayload {
  sales_invoice_id: number;
  receipt_number?: string | null;
  amount_received: number | string;
  payment_date: string;
  payment_method: PaymentMethod;
  idempotency_key: string;
}
