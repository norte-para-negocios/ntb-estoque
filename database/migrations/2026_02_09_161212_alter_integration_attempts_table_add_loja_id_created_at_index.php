<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('integration_attempts', function (Blueprint $table) {
            $table->index(['loja_id', 'created_at'], 'idx_loja_id_created_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('integration_attempts', function (Blueprint $table) {
            $table->dropIndex('idx_loja_id_created_at');
        });
    }
};
