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
        Schema::create('posicao_estoques', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->bigInteger('codigo_local_estoque')->nullable();
            $table->bigInteger('n_cod_prod');
            $table->date('data_posicao');

            $table->string('c_cod_int', 60)->nullable();
            $table->string('c_codigo', 60)->nullable();
            $table->string('c_descricao', 120)->nullable();
            $table->decimal('n_preco_unitario', 10, 2)->nullable();
            $table->decimal('n_saldo', 10, 2)->nullable();
            $table->decimal('n_cmc', 10, 2)->nullable();
            $table->decimal('n_pendente', 10, 2)->nullable();
            $table->decimal('estoque_minimo', 10, 2)->nullable();
            $table->decimal('reservado', 10, 2)->nullable();
            $table->decimal('fisico', 10, 2)->nullable();
            $table->timestamps();
            $table->foreign('loja_id')->references('id')->on('lojas');

            $table->unique(['loja_id', 'codigo_local_estoque', 'n_cod_prod', 'data_posicao'], 'unique_posicao_estoque');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('posicao_estoques');
    }
};
