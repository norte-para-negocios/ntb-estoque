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
        Schema::create('movimentos', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');

            //ENVIO
            $table->unsignedBigInteger('codigo_local_estoque');
            $table->unsignedBigInteger('id_prod');
            $table->dateTime('data');
            $table->enum('tipo', ['ENT', 'SAI', 'SLD', 'TRF']);
            $table->decimal('quan');
            $table->decimal('valor');
            $table->text('obs');
            $table->enum('origem', ['AJU', 'PDV'])->default('AJU');
            $table->enum('motivo', ['INV', 'OPE', 'PDV', 'INI', 'PER', 'OPS', 'CMC', 'TPQ', 'TRF']);
            $table->unsignedBigInteger('codigo_local_estoque_destino');

            // RESPOSTA
            $table->text('codigo_status')->nullable();
            $table->text('descricao_status')->nullable();
            $table->integer('id_movest')->nullable();
            $table->integer('id_ajuste')->nullable();
            $table->timestamps();
            $table->foreign('loja_id')->references('id')->on('lojas');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('movimentos');
    }
};
