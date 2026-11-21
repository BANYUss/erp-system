<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_payments', function (Blueprint $table) {
            $table->id();
            $table->string('receipt_number')->unique();
            $table->foreignId('sales_invoice_id')
                ->constrained('sales_invoices')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
            $table->decimal('amount_received', 15, 2);
            $table->date('payment_date')->index();
            $table->string('payment_method', 50);
            $table->string('idempotency_key')->unique();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_payments');
    }
};
