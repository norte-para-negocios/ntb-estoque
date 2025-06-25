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
        /**
         *
         * codigo_local_estoque	integer	Código do local do estoque.+
         * id_prod	integer	Código do produto.
         * cod_int	string20	Código de Integração do Produto.+
         * cod_int_ajuste	string60	Código de Integração com sistemas legados.
         * data	string10	Data do Movimento.+
         * tipo	text	Tipo do Ajuste de Estoque.+
         * quan	decimal	Novo valor para quantidade mínima no estoque.+
         * valor	decimal	Valor do Movimento.+
         * obs	text	Observação do Movimento de Estoque.+
         * origem	string3	Origem do Movimento de Estoque.+
         * motivo	string3	Motivo do ajuste.+
         * codigo_local_estoque_destino	integer	Obrigatório quando utilizar Tipo = "TRF"+
         *
         */
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
