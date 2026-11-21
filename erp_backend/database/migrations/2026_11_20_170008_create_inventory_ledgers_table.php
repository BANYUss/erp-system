<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_ledgers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_batch_id')
                ->constrained('product_batches')
                ->cascadeOnUpdate()
                ->restrictOnDelete();
            $table->enum('state', ['available', 'reserved', 'in_transit', 'in_qc'])
                ->default('available')
                ->index();
            $table->decimal('qty', 15, 2)->default(0);
            $table->decimal('cost_price', 15, 2)->default(0);
            $table->timestamps();

            $table->index(['product_batch_id', 'state']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_ledgers');
    }
};
