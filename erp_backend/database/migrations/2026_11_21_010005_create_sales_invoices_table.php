<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales_invoices', function (Blueprint $table) {
            $table->id();
            $table->string('invoice_number')->unique();
            $table->foreignId('sales_order_id')
                ->constrained('sales_orders')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
            $table->foreignId('customer_id')
                ->constrained('customers')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
            $table->decimal('total_billed', 15, 2);
            $table->date('due_date')->index();
            $table->enum('status', [
                'Unpaid',
                'Partially Paid',
                'Paid',
            ])->default('Unpaid')->index();
            $table->string('idempotency_key')->unique();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_invoices');
    }
};
