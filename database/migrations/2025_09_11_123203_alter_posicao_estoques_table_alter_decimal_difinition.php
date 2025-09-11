<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('posicao_estoques', function (Blueprint $table) {
            $table->decimal('n_preco_unitario', 20, 6)->nullable()->change();
            $table->decimal('n_saldo', 20, 6)->nullable()->change();
            $table->decimal('n_cmc', 20, 6)->nullable()->change();
            $table->decimal('n_pendente', 20, 6)->nullable()->change();
            $table->decimal('estoque_minimo', 20, 6)->nullable()->change();
            $table->decimal('reservado', 20, 6)->nullable()->change();
            $table->decimal('fisico', 20, 6)->nullable()->change();
        });

        Schema::table('inventario_items', function (Blueprint $table) {
            $table->decimal('quan', 20, 6)->nullable()->change();
            $table->decimal('valor', 20, 6)->nullable()->change();
        });
    }
};
