# ERP Distribusi - Database Schema Map

## 1. Master Data (MDM)
*   **`users`**: `id`, `name`, `email`, `password`, `is_active`, `softDeletes`. (Direlasikan dengan `roles` dari Spatie).
*   **`products`**: `id`, `sku` (unique), `name`, `category_id`, `uom` (Unit of Measure), `is_active`.
*   **`product_batches`**: `id`, `product_id`, `batch_number`, `expiry_date`.
*   **`suppliers`**: `id`, `name`, `contact_name`, `email`, `phone`, `address`, `status`.
*   **`customers`**: `id`, `name`, `email`, `credit_limit` (DECIMAL), `status`.

## 2. Modul Inventory & Pergudangan
*   **`inventory_ledgers` (Immutable Stock Ledger per Batch)**: `id`, `product_batch_id`, `state` (ENUM: available, reserved, in_transit, in_qc), `qty` (DECIMAL/INT), `cost_price` (DECIMAL - MWA saat barang masuk).
*   **`stock_movements` (Kartu Stok / Audit Level)**: `id`, `product_batch_id`, `type` (ENUM: IN, OUT, ADJ), `qty_change`, `reference_type` (Morph: PO, SO, Return), `reference_id`, `user_id` (pelaku).
*   **`goods_receipts`**: `id`, `po_id`, `receipt_number`, `received_date`, `status` (Draft, Validated).
*   **`goods_receipt_items`**: `id`, `goods_receipt_id`, `product_id`, `product_batch_id`, `qty_received`.

## 3. Modul Procure-to-Pay (P2P)
*   **`purchase_requisitions`**: `id`, `pr_number`, `requestor_id`, `status` (Draft, Submitted, Converted).
*   **`purchase_orders`**: `id`, `po_number`, `pr_id` (nullable), `supplier_id`, `total_amount` (DECIMAL), `status` (Pending Approval, Approved, Rejected, Partially Received, Completed), `approver_id`.
*   **`purchase_order_items`**: `id`, `po_id`, `product_id`, `qty_ordered`, `unit_price` (DECIMAL).
*   **`purchase_invoices` (Account Payable)**: `id`, `invoice_number`, `po_id`, `supplier_id`, `total_billed` (DECIMAL), `due_date`, `status` (Unpaid, Partially Paid, Paid), `idempotency_key` (Unique).

## 4. Modul Keuangan & Audit
*   **`general_ledgers` (Jurnal Umum)**: `id`, `transaction_date`, `account_code`, `debit` (DECIMAL), `credit` (DECIMAL), `reference_type`, `reference_id`, `description`.
*   **`payment_vouchers` (Kas Keluar)**: `id`, `voucher_number`, `purchase_invoice_id`, `amount_paid` (DECIMAL), `payment_date`, `payment_method`, `idempotency_key` (Unique), `softDeletes`.
*   **`audit_logs`**: `id`, `user_id`, `action`, `model_type`, `model_id`, `old_payload` (JSON), `new_payload` (JSON), `ip_address`, `created_at`.

## 5. Modul Order-to-Cash (O2C)
*   **`sales_orders`**: `id`, `so_number` (Unique), `customer_id`, `salesperson_id` (FK ke `users`), `order_date`, `total_amount` (DECIMAL 15,2), `status` (Draft, Confirmed, Partially Delivered, Completed, Cancelled), `softDeletes`.
*   **`sales_order_items`**: `id`, `sales_order_id`, `product_id`, `qty_ordered` (DECIMAL 15,2), `unit_price` (DECIMAL 15,2 — pricing snapshot), `line_total` (DECIMAL 15,2), `softDeletes`.
*   **`delivery_orders`**: `id`, `do_number` (Unique), `sales_order_id`, `delivery_date`, `status` (Draft, Dispatched, Delivered, Cancelled), `softDeletes`.
*   **`delivery_order_items`**: `id`, `delivery_order_id`, `product_id`, `product_batch_id`, `qty_dispatched` (DECIMAL 15,2), `unit_cost` (DECIMAL 15,2 — snapshot HPP MWA saat barang keluar), `softDeletes`.
*   **`sales_invoices` (Account Receivable)**: `id`, `invoice_number` (Unique), `sales_order_id`, `customer_id`, `total_billed` (DECIMAL 15,2), `due_date`, `status` (Unpaid, Partially Paid, Paid), `idempotency_key` (Unique), `softDeletes`.
*   **`customer_payments` (Kas Masuk)**: `id`, `receipt_number` (Unique), `sales_invoice_id`, `amount_received` (DECIMAL 15,2), `payment_date`, `payment_method`, `idempotency_key` (Unique), `softDeletes`.