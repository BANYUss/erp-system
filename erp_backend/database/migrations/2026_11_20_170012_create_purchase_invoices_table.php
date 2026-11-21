<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_invoices', function (Blueprint $table) {
            $table->id();
            $table->string('invoice_number')->unique();
            $table->foreignId('po_id')
                ->constrained('purchase_orders')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
            $table->foreignId('supplier_id')
                ->constrained('suppliers')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
            $table->decimal('total_billed', 15, 2);
            $table->date('due_date')->index();
            $table->enum('status', ['Unpaid', 'Partially Paid', 'Paid'])
                ->default('Unpaid')
                ->index();
            $table->string('idempotency_key')->unique();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_invoices');
    }
};
