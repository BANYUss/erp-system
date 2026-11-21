<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RoleAndPermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class AuthAndRbacTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RoleAndPermissionSeeder::class);
    }

    public function test_all_six_roles_and_dummy_users_are_seeded(): void
    {
        $expectedRoles = [
            'Super Admin',
            'Staf Gudang',
            'Admin Sales',
            'Purchasing',
            'Finance',
            'Manajer',
        ];

        $this->assertEqualsCanonicalizing(
            $expectedRoles,
            Role::pluck('name')->all()
        );

        $this->assertSame(6, User::count());

        foreach ($expectedRoles as $roleName) {
            $this->assertSame(1, User::role($roleName)->count());
        }
    }

    public function test_role_permission_boundaries_follow_architecture(): void
    {
        $gudang = User::where('email', 'gudang@erp.test')->firstOrFail();
        $this->assertTrue($gudang->can('goods_receipts.create'));
        $this->assertTrue($gudang->can('stock_opname.manage'));
        $this->assertFalse($gudang->can('inventory.view_cost'));
        $this->assertFalse($gudang->can('products.view_selling_price'));
        $this->assertFalse($gudang->can('general_ledger.view'));

        $sales = User::where('email', 'sales@erp.test')->firstOrFail();
        $this->assertTrue($sales->can('sales_orders.create'));
        $this->assertTrue($sales->can('inventory.view_available'));
        $this->assertTrue($sales->can('customers.view_credit_limit'));
        $this->assertFalse($sales->can('inventory.view_cost'));
        $this->assertFalse($sales->can('stock_opname.manage'));

        $superAdmin = User::where('email', 'superadmin@erp.test')->firstOrFail();
        $this->assertTrue($superAdmin->can('any.arbitrary.permission'));
    }

    public function test_user_can_login_fetch_me_and_logout_with_sanctum_token(): void
    {
        $loginResponse = $this->postJson('/api/auth/login', [
            'email' => 'superadmin@erp.test',
            'password' => 'password',
            'device_name' => 'phpunit',
        ]);

        $loginResponse->assertOk()
            ->assertJsonPath('data.token_type', 'Bearer')
            ->assertJsonPath('data.user.email', 'superadmin@erp.test')
            ->assertJsonPath('data.user.roles.0', 'Super Admin');

        $token = $loginResponse->json('data.access_token');
        $this->assertNotEmpty($token);

        $meResponse = $this->withToken($token)->getJson('/api/auth/me');
        $meResponse->assertOk()
            ->assertJsonPath('data.email', 'superadmin@erp.test')
            ->assertJsonPath('data.roles.0', 'Super Admin');

        $logoutResponse = $this->withToken($token)->postJson('/api/auth/logout');
        $logoutResponse->assertOk()
            ->assertJsonPath('message', 'Logout berhasil.');

        // Pastikan token sudah dihapus dari database
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_login_fails_for_invalid_credentials_or_inactive_user(): void
    {
        $this->postJson('/api/auth/login', [
            'email' => 'superadmin@erp.test',
            'password' => 'wrong-password',
        ])->assertStatus(401);

        $user = User::where('email', 'gudang@erp.test')->firstOrFail();
        $user->update(['is_active' => false]);

        $this->postJson('/api/auth/login', [
            'email' => 'gudang@erp.test',
            'password' => 'password',
        ])->assertStatus(403);
    }
}
