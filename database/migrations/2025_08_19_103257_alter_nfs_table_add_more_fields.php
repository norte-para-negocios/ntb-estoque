<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('nfs', function (Blueprint $table) {
            $table->unsignedBigInteger('nota_fiscal_id')->nullable()->after('loja_id');
            $table->integer('quantidade')->nullable()->change();
            $table->bigInteger('n_id_item')->nullable();
            $table->bigInteger('n_id_pedido')->nullable();
            $table->bigInteger('n_id_it_pedido')->nullable();
            $table->bigInteger('n_id_produto')->nullable();
            $table->bigInteger('n_sequencia')->nullable();
            $table->string('c_codigo_produto', 60)->nullable();
            $table->string('c_descricao_produto', 120)->nullable();
            $table->string('c_ignorar_item', 1)->nullable();
            $table->string('c_adicionar_novo', 1)->nullable();
            $table->string('c_associar_existente', 1)->nullable();
            $table->string('c_item_devolvido', 1)->nullable();
            $table->string('c_ncm', 13)->nullable();
            $table->string('c_ean', 14)->nullable();
            $table->string('c_cfop', 10)->nullable();
            $table->decimal('n_qtde_nfe', 10, 2)->nullable();
            $table->string('c_unidade_nfe', 6)->nullable();
            $table->decimal('n_preco_unit', 10, 2)->nullable();
            $table->decimal('v_desconto', 10, 2)->nullable();
            $table->decimal('v_frete', 10, 2)->nullable();
            $table->decimal('v_total_item', 10, 2)->nullable();
            $table->json('full_object')->nullable();
            $table->foreign('nota_fiscal_id')->references('id')->on('notas_fiscais');
        });
    }

    public function down(): void
    {
        Schema::table('nfs', function (Blueprint $table) {
            $table->dropForeign(['nota_fiscal_id']);
            $table->dropColumn([
                'nota_fiscal_id',
                'n_id_item',
                'n_id_pedido',
                'n_id_it_pedido',
                'n_id_produto',
                'n_sequencia',
                'c_codigo_produto',
                'c_descricao_produto',
                'c_ignorar_item',
                'c_adicionar_novo',
                'c_associar_existente',
                'c_item_devolvido',
                'c_ncm',
                'c_ean',
                'c_cfop',
                'n_qtde_nfe',
                'c_unidade_nfe',
                'n_preco_unit',
                'v_desconto',
                'v_frete',
                'v_total_item',
                'full_object',
            ]);
        });
    }
};
