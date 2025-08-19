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
        Schema::create('local_estoques', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->bigInteger('codigo_local_estoque');
            $table->string('codigo', 50)->nullable();
            $table->string('descricao', 250)->nullable();
            $table->string('tipo', 1)->nullable();
            $table->string('padrao', 1)->nullable();
            $table->string('inativo', 1)->nullable();
            $table->unsignedBigInteger('codigo_cliente')->nullable();
            $table->string('disp_ordem_producao', 1)->nullable();
            $table->string('disp_consumo_op', 1)->nullable();
            $table->string('disp_remessa', 1)->nullable();
            $table->string('disp_venda', 1)->nullable();
            $table->string('d_inc', 10)->nullable();
            $table->string('h_inc', 8)->nullable();
            $table->string('u_inc', 10)->nullable();
            $table->string('d_alt', 10)->nullable();
            $table->string('h_alt', 8)->nullable();
            $table->string('u_alt', 10)->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->foreign('loja_id')->references('id')->on('lojas');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('local_estoques');
    }
};
