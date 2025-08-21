<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('lojas', function (Blueprint $table) {
            $table->dateTime('local_estoque_ultima_atualizacao')->nullable();
            $table->enum('local_estoque_status', [null, 'Erro', 'Processando', 'Concluído'])->nullable();

            $table->dateTime('produto_ultima_atualizacao')->nullable();
            $table->enum('produto_status', [null, 'Erro', 'Processando', 'Concluído'])->nullable();

            $table->dateTime('posicao_estoque_ultima_atualizacao')->nullable();
            $table->enum('posicao_estoque_status', [null, 'Erro', 'Processando', 'Concluído'])->nullable();

            $table->dateTime('nota_fiscal_ultima_atualizacao')->nullable();
            $table->enum('nota_fiscal_status', [null, 'Erro', 'Processando', 'Concluído'])->nullable();

            $table->dateTime('ordem_producao_ultima_atualizacao')->nullable();
            $table->enum('ordem_producao_status', [null, 'Erro', 'Processando', 'Concluído'])->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('lojas', function (Blueprint $table) {
            $table->dropColumn([
                'local_estoque_ultima_atualizacao',
                'local_estoque_status',

                'produto_ultima_atualizacao',
                'produto_status',

                'posicao_estoque_ultima_atualizacao',
                'posicao_estoque_status',

                'nota_fiscal_ultima_atualizacao',
                'nota_fiscal_status',

                'ordem_producao_ultima_atualizacao',
                'ordem_producao_status',
            ]);
        });
    }
};
