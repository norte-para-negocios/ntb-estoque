<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('inventario_items', function (Blueprint $table) {
            $table->enum('status', [null, 'Iniciado', 'Processando', 'Concluído', 'Erro'])->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('inventario_items', function (Blueprint $table) {
            $table->dropColumn(['status']);
        });
    }
};
