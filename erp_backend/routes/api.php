<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\CustomerPaymentController;
use App\Http\Controllers\Api\DeliveryOrderController;
use App\Http\Controllers\Api\GeneralLedgerController;
use App\Http\Controllers\Api\GoodsReceiptController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\PaymentVoucherController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\PurchaseInvoiceController;
use App\Http\Controllers\Api\PurchaseOrderController;
use App\Http\Controllers\Api\PurchaseRequisitionController;
use App\Http\Controllers\Api\SalesInvoiceController;
use App\Http\Controllers\Api\SalesOrderController;
use App\Http\Controllers\Api\SupplierController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::post('/login', [AuthController::class, 'login'])->name('auth.login');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::get('/me', [AuthController::class, 'me'])->name('auth.me');
    });
});

Route::middleware('auth:sanctum')->group(function () {
    Route::prefix('products')->name('products.')->group(function () {
        Route::middleware('permission:products.view')->group(function () {
            Route::get('/', [ProductController::class, 'index'])->name('index');
            Route::get('/{product}', [ProductController::class, 'show'])->name('show');
        });

        Route::middleware('permission:products.manage')->group(function () {
            Route::post('/', [ProductController::class, 'store'])->name('store');
            Route::match(['put', 'patch'], '/{product}', [ProductController::class, 'update'])->name('update');
            Route::delete('/{product}', [ProductController::class, 'destroy'])->name('destroy');
        });
    });

    Route::prefix('suppliers')->name('suppliers.')->group(function () {
        Route::middleware('permission:suppliers.view')->group(function () {
            Route::get('/', [SupplierController::class, 'index'])->name('index');
            Route::get('/{supplier}', [SupplierController::class, 'show'])->name('show');
        });

        Route::middleware('permission:suppliers.manage')->group(function () {
            Route::post('/', [SupplierController::class, 'store'])->name('store');
            Route::match(['put', 'patch'], '/{supplier}', [SupplierController::class, 'update'])->name('update');
            Route::delete('/{supplier}', [SupplierController::class, 'destroy'])->name('destroy');
        });
    });

    Route::prefix('customers')->name('customers.')->group(function () {
        Route::middleware('permission:customers.view')->group(function () {
            Route::get('/', [CustomerController::class, 'index'])->name('index');
            Route::get('/{customer}', [CustomerController::class, 'show'])->name('show');
        });

        Route::middleware('permission:customers.manage')->group(function () {
            Route::post('/', [CustomerController::class, 'store'])->name('store');
            Route::match(['put', 'patch'], '/{customer}', [CustomerController::class, 'update'])->name('update');
            Route::delete('/{customer}', [CustomerController::class, 'destroy'])->name('destroy');
        });
    });

    Route::prefix('purchase-requisitions')->name('purchase_requisitions.')->group(function () {
        Route::middleware('permission:purchase_requisitions.view')->group(function () {
            Route::get('/', [PurchaseRequisitionController::class, 'index'])->name('index');
            Route::get('/{purchaseRequisition}', [PurchaseRequisitionController::class, 'show'])->name('show');
        });

        Route::middleware('permission:purchase_requisitions.create')->group(function () {
            Route::post('/', [PurchaseRequisitionController::class, 'store'])->name('store');
        });

        Route::middleware('permission:purchase_requisitions.submit')->group(function () {
            Route::post('/{purchaseRequisition}/submit', [PurchaseRequisitionController::class, 'submit'])->name('submit');
        });

        Route::middleware('permission:purchase_orders.create')->group(function () {
            Route::post('/{purchaseRequisition}/convert-to-po', [PurchaseRequisitionController::class, 'convertToPurchaseOrder'])->name('convert_to_po');
        });
    });

    Route::prefix('purchase-orders')->name('purchase_orders.')->group(function () {
        Route::middleware('permission:purchase_orders.view')->group(function () {
            Route::get('/', [PurchaseOrderController::class, 'index'])->name('index');
            Route::get('/{purchaseOrder}', [PurchaseOrderController::class, 'show'])->name('show');
        });

        Route::middleware('permission:purchase_orders.create')->group(function () {
            Route::post('/', [PurchaseOrderController::class, 'store'])->name('store');
        });

        Route::middleware('permission:purchase_orders.approve')->group(function () {
            Route::post('/{purchaseOrder}/approve', [PurchaseOrderController::class, 'approve'])->name('approve');
            Route::post('/{purchaseOrder}/reject', [PurchaseOrderController::class, 'reject'])->name('reject');
        });

        Route::middleware('permission:purchase_orders.update')->group(function () {
            Route::delete('/{purchaseOrder}', [PurchaseOrderController::class, 'destroy'])->name('destroy');
        });
    });

    Route::prefix('goods-receipts')->name('goods_receipts.')->group(function () {
        Route::middleware('permission:goods_receipts.view')->group(function () {
            Route::get('/', [GoodsReceiptController::class, 'index'])->name('index');
            Route::get('/{goodsReceipt}', [GoodsReceiptController::class, 'show'])->name('show');
        });

        Route::middleware('permission:goods_receipts.create')->group(function () {
            Route::post('/', [GoodsReceiptController::class, 'store'])->name('store');
            Route::delete('/{goodsReceipt}', [GoodsReceiptController::class, 'destroy'])->name('destroy');
        });

        Route::middleware('permission:goods_receipts.validate')->group(function () {
            Route::post('/{goodsReceipt}/validate', [GoodsReceiptController::class, 'validateReceipt'])->name('validate');
        });
    });

    Route::prefix('inventory')->name('inventory.')->group(function () {
        Route::middleware('permission:inventory.view_available|inventory.view_physical|inventory.view_cost')->group(function () {
            Route::get('/ledgers', [InventoryController::class, 'ledgers'])->name('ledgers');
        });

        Route::middleware('permission:stock_movements.view')->group(function () {
            Route::get('/stock-movements', [InventoryController::class, 'stockMovements'])->name('stock_movements');
        });

        Route::middleware('permission:inventory.view_available|inventory.view_physical')->group(function () {
            Route::get('/fefo-picking', [InventoryController::class, 'fefoPicking'])->name('fefo_picking');
        });
    });

    Route::prefix('purchase-invoices')->name('purchase_invoices.')->group(function () {
        Route::middleware('permission:invoices.view|financial_reports.view')->group(function () {
            Route::get('/ap-aging', [PurchaseInvoiceController::class, 'apAging'])->name('ap_aging');
        });

        Route::middleware('permission:invoices.view')->group(function () {
            Route::get('/', [PurchaseInvoiceController::class, 'index'])->name('index');
            Route::get('/{purchaseInvoice}', [PurchaseInvoiceController::class, 'show'])->name('show');
        });

        Route::middleware('permission:invoices.create')->group(function () {
            Route::post('/', [PurchaseInvoiceController::class, 'store'])->name('store');
        });

        Route::middleware('permission:invoices.manage')->group(function () {
            Route::delete('/{purchaseInvoice}', [PurchaseInvoiceController::class, 'destroy'])->name('destroy');
        });
    });

    Route::prefix('payment-vouchers')->name('payment_vouchers.')->group(function () {
        Route::middleware('permission:payments.view')->group(function () {
            Route::get('/', [PaymentVoucherController::class, 'index'])->name('index');
            Route::get('/{paymentVoucher}', [PaymentVoucherController::class, 'show'])->name('show');
        });

        Route::middleware('permission:payments.create')->group(function () {
            Route::post('/', [PaymentVoucherController::class, 'store'])->name('store');
        });
    });

    Route::prefix('general-ledgers')->name('general_ledgers.')->group(function () {
        Route::middleware('permission:general_ledger.view')->group(function () {
            Route::get('/summary', [GeneralLedgerController::class, 'summary'])->name('summary');
            Route::get('/', [GeneralLedgerController::class, 'index'])->name('index');
            Route::get('/{generalLedger}', [GeneralLedgerController::class, 'show'])->name('show');
        });

        Route::middleware('permission:general_ledger.manage')->group(function () {
            Route::post('/', [GeneralLedgerController::class, 'store'])->name('store');
        });
    });

    Route::prefix('sales-orders')->name('sales_orders.')->group(function () {
        Route::middleware('permission:sales_orders.view')->group(function () {
            Route::get('/', [SalesOrderController::class, 'index'])->name('index');
            Route::get('/{salesOrder}', [SalesOrderController::class, 'show'])->name('show');
        });

        Route::middleware('permission:sales_orders.create')->group(function () {
            Route::post('/', [SalesOrderController::class, 'store'])->name('store');
        });

        Route::middleware('permission:sales_orders.update|customers.override_credit_limit')->group(function () {
            Route::post('/{salesOrder}/confirm', [SalesOrderController::class, 'confirm'])->name('confirm');
        });

        Route::middleware('permission:sales_orders.update')->group(function () {
            Route::post('/{salesOrder}/cancel', [SalesOrderController::class, 'cancel'])->name('cancel');
            Route::delete('/{salesOrder}', [SalesOrderController::class, 'destroy'])->name('destroy');
        });
    });

    Route::prefix('delivery-orders')->name('delivery_orders.')->group(function () {
        Route::middleware('permission:delivery_orders.view')->group(function () {
            Route::get('/', [DeliveryOrderController::class, 'index'])->name('index');
            Route::get('/{deliveryOrder}', [DeliveryOrderController::class, 'show'])->name('show');
        });

        Route::middleware('permission:delivery_orders.create')->group(function () {
            Route::post('/', [DeliveryOrderController::class, 'store'])->name('store');
            Route::delete('/{deliveryOrder}', [DeliveryOrderController::class, 'destroy'])->name('destroy');
        });

        Route::middleware('permission:delivery_orders.process')->group(function () {
            Route::post('/{deliveryOrder}/dispatch', [DeliveryOrderController::class, 'dispatchOrder'])->name('dispatch');
            Route::post('/{deliveryOrder}/deliver', [DeliveryOrderController::class, 'deliver'])->name('deliver');
        });
    });

    Route::prefix('sales-invoices')->name('sales_invoices.')->group(function () {
        Route::middleware('permission:invoices.view|financial_reports.view')->group(function () {
            Route::get('/ar-aging', [SalesInvoiceController::class, 'arAging'])->name('ar_aging');
        });

        Route::middleware('permission:invoices.view')->group(function () {
            Route::get('/', [SalesInvoiceController::class, 'index'])->name('index');
            Route::get('/{salesInvoice}', [SalesInvoiceController::class, 'show'])->name('show');
        });

        Route::middleware('permission:invoices.create')->group(function () {
            Route::post('/', [SalesInvoiceController::class, 'store'])->name('store');
        });

        Route::middleware('permission:invoices.manage')->group(function () {
            Route::delete('/{salesInvoice}', [SalesInvoiceController::class, 'destroy'])->name('destroy');
        });
    });

    Route::prefix('customer-payments')->name('customer_payments.')->group(function () {
        Route::middleware('permission:payments.view')->group(function () {
            Route::get('/', [CustomerPaymentController::class, 'index'])->name('index');
            Route::get('/{customerPayment}', [CustomerPaymentController::class, 'show'])->name('show');
        });

        Route::middleware('permission:payments.create')->group(function () {
            Route::post('/', [CustomerPaymentController::class, 'store'])->name('store');
        });
    });
});
