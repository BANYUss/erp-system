<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class RoleAndPermissionSeeder extends Seeder
{
    public function run(): void
    {
        app()[PermissionRegistrar::class]->forgetCachedPermissions();

        $permissions = [
            // Master Data & System
            'users.manage',
            'roles.manage',
            'settings.manage',
            'products.view',
            'products.manage',
            'products.view_selling_price',
            'suppliers.view',
            'suppliers.manage',
            'customers.view',
            'customers.manage',
            'customers.view_credit_limit',
            'customers.override_credit_limit',

            // Inventory & Warehouse
            'inventory.view_available',
            'inventory.view_physical',
            'inventory.view_cost',
            'goods_receipts.view',
            'goods_receipts.create',
            'goods_receipts.validate',
            'delivery_orders.view',
            'delivery_orders.create',
            'delivery_orders.process',
            'stock_opname.manage',
            'stock_movements.view',

            // Sales
            'sales_orders.view',
            'sales_orders.create',
            'sales_orders.update',

            // Purchasing / P2P
            'purchase_requisitions.view',
            'purchase_requisitions.create',
            'purchase_requisitions.submit',
            'purchase_orders.view',
            'purchase_orders.create',
            'purchase_orders.update',
            'purchase_orders.approve',
            'purchase_prices.update',

            // Finance & Accounting
            'invoices.view',
            'invoices.create',
            'invoices.manage',
            'ap.manage',
            'ar.manage',
            'payments.view',
            'payments.create',
            'payments.manage',
            'bank_reconciliation.manage',
            'general_ledger.view',
            'general_ledger.manage',
            'financial_reports.view',

            // Dashboard & Audit
            'dashboard.view',
            'audit_logs.view',
        ];

        foreach ($permissions as $permission) {
            Permission::firstOrCreate(['name' => $permission, 'guard_name' => 'web']);
        }

        $rolePermissions = [
            'Super Admin' => $permissions,

            // Hanya melihat dan mengubah fisik barang. DILARANG melihat cost_price, selling_price, atau ledger keuangan.
            'Staf Gudang' => [
                'products.view',
                'inventory.view_available',
                'inventory.view_physical',
                'goods_receipts.view',
                'goods_receipts.create',
                'goods_receipts.validate',
                'delivery_orders.view',
                'delivery_orders.create',
                'delivery_orders.process',
                'stock_opname.manage',
                'stock_movements.view',
            ],

            // Membuat SO, melihat status available, melihat credit limit. DILARANG mengubah stok atau HPP.
            'Admin Sales' => [
                'products.view',
                'products.view_selling_price',
                'customers.view',
                'customers.view_credit_limit',
                'inventory.view_available',
                'sales_orders.view',
                'sales_orders.create',
                'sales_orders.update',
                'delivery_orders.view',
            ],

            // Membuat PR, PO, mengelola data supplier & product, update harga beli, dan approve PO <= Rp10.000.000.
            'Purchasing' => [
                'products.view',
                'products.manage',
                'inventory.view_available',
                'inventory.view_cost',
                'suppliers.view',
                'suppliers.manage',
                'purchase_requisitions.view',
                'purchase_requisitions.create',
                'purchase_requisitions.submit',
                'purchase_orders.view',
                'purchase_orders.create',
                'purchase_orders.update',
                'purchase_orders.approve',
                'purchase_prices.update',
            ],

            // Mengelola AR/AP, Invoicing, rekonsiliasi bank, jurnal, dan laporan keuangan.
            'Finance' => [
                'products.view',
                'products.view_selling_price',
                'inventory.view_cost',
                'suppliers.view',
                'customers.view',
                'customers.view_credit_limit',
                'purchase_orders.view',
                'goods_receipts.view',
                'sales_orders.view',
                'delivery_orders.view',
                'invoices.view',
                'invoices.create',
                'invoices.manage',
                'ap.manage',
                'ar.manage',
                'payments.view',
                'payments.create',
                'payments.manage',
                'bank_reconciliation.manage',
                'general_ledger.view',
                'general_ledger.manage',
                'financial_reports.view',
            ],

            // Approver (PO di atas limit, override credit limit pelanggan) dan melihat dashboard.
            'Manajer' => [
                'dashboard.view',
                'audit_logs.view',
                'products.view',
                'products.view_selling_price',
                'inventory.view_available',
                'inventory.view_cost',
                'suppliers.view',
                'customers.view',
                'customers.view_credit_limit',
                'customers.override_credit_limit',
                'purchase_requisitions.view',
                'purchase_orders.view',
                'purchase_orders.approve',
                'sales_orders.view',
                'delivery_orders.view',
                'invoices.view',
                'payments.view',
                'general_ledger.view',
                'financial_reports.view',
            ],
        ];

        foreach ($rolePermissions as $roleName => $perms) {
            $role = Role::firstOrCreate(['name' => $roleName, 'guard_name' => 'web']);
            $role->syncPermissions($perms);
        }

        $dummyUsers = [
            [
                'name' => 'Super Admin ERP',
                'email' => 'superadmin@erp.test',
                'role' => 'Super Admin',
            ],
            [
                'name' => 'Staf Gudang ERP',
                'email' => 'gudang@erp.test',
                'role' => 'Staf Gudang',
            ],
            [
                'name' => 'Admin Sales ERP',
                'email' => 'sales@erp.test',
                'role' => 'Admin Sales',
            ],
            [
                'name' => 'Purchasing ERP',
                'email' => 'purchasing@erp.test',
                'role' => 'Purchasing',
            ],
            [
                'name' => 'Finance ERP',
                'email' => 'finance@erp.test',
                'role' => 'Finance',
            ],
            [
                'name' => 'Manajer ERP',
                'email' => 'manajer@erp.test',
                'role' => 'Manajer',
            ],
        ];

        foreach ($dummyUsers as $userData) {
            $user = User::updateOrCreate(
                ['email' => $userData['email']],
                [
                    'name' => $userData['name'],
                    'password' => Hash::make('password'),
                    'is_active' => true,
                    'email_verified_at' => now(),
                ]
            );

            $user->syncRoles([$userData['role']]);
        }

        app()[PermissionRegistrar::class]->forgetCachedPermissions();
    }
}
