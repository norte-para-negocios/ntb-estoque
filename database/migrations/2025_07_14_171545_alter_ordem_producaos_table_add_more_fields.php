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
        Schema::table('ordem_producaos', function (Blueprint $table) {
            $table->bigInteger('identificacao_n_cod_op')->nullable();
            $table->string('identificacao_c_cod_int_op', 20)->nullable();
            $table->string('identificacao_c_num_op', 15)->nullable();
            $table->bigInteger('identificacao_n_cod_produto')->nullable();
            $table->string('identificacao_c_cod_int_prod', 60)->nullable();
            $table->dateTime('identificacao_d_dt_previsao')->nullable();
            $table->decimal('identificacao_n_qtde')->nullable();
            $table->bigInteger('identificacao_codigo_local_estoque')->nullable();

            $table->string('adicionais_c_etapa',2)->nullable();
            $table->bigInteger('adicionais_n_cod_projeto')->nullable();
            $table->dateTime('adicionais_d_dt_inicio')->nullable();
            $table->dateTime('adicionais_d_dt_conclusao')->nullable();

            $table->string('produto_codigo', 60)->nullable();
            $table->string('produto_descricao', 120)->nullable();
            $table->string('produto_tipo_item', 2)->nullable();
            $table->string('produto_unidade', 6)->nullable();

            $table->json('full_object')->nullable();

            $table->date('validade')->nullable()->change();

            $table->index(['identificacao_n_cod_op', 'identificacao_c_num_op', 'loja_id'], 'ordem_producao_n_cod_op_c_num_op_loja_id_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('ordem_producaos', function (Blueprint $table) {
            $table->dropIndex('ordem_producao_n_cod_op_c_num_op_loja_id_index');
            $table->dropColumn([
                'identificacao_n_cod_op',
                'identificacao_c_cod_int_op',
                'identificacao_c_num_op',
                'identificacao_n_cod_produto',
                'identificacao_c_cod_int_prod',
                'identificacao_d_dt_previsao',
                'identificacao_n_qtde',
                'identificacao_codigo_local_estoque',
                'adicionais_c_etapa',
                'adicionais_n_cod_projeto',
                'adicionais_d_dt_inicio',
                'adicionais_d_dt_conclusao',
                'produto_codigo',
                'produto_descricao',
                'produto_tipo_item',
                'produto_unidade',
                'full_object',
            ]);
        });
    }
};
