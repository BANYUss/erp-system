<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('goods_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('po_id')
                ->constrained('purchase_orders')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
            $table->string('receipt_number')->unique();
            $table->date('received_date')->index();
            $table->enum('status', ['Draft', 'Validated'])
                ->default('Draft')
                ->index();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('goods_receipts');
    }
};
