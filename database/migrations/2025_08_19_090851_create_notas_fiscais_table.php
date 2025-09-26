<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('notas_fiscais', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->bigInteger('n_id_receb');
            $table->bigInteger('n_id_fornecedor')->nullable();
            $table->string('c_pessoa_fisica', 1)->nullable();
            $table->string('c_nome', 100)->nullable();
            $table->string('c_razao_social', 60)->nullable();
            $table->string('c_inscricao',20)->nullable();
            $table->string('c_cnpj_cpf', 20)->nullable();
            $table->string('c_chave_nfe', 44)->nullable();
            $table->string('c_etapa', 2)->nullable();
            $table->string('c_numero_nfe', 10)->nullable();
            $table->string('c_serie_nfe', 3)->nullable();
            $table->string('c_modelo_nfe', 2)->nullable();
            $table->date('d_emissao_nfe')->nullable();
            $table->decimal('n_valor_nfe', 10, 2)->nullable();
            $table->string('c_ambiente_nfe', 1)->nullable();
            $table->string('c_natureza_operacao', 60)->nullable();
            $table->json('full_object')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->foreign('loja_id')->references('id')->on('lojas');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notas_fiscais');
    }
};
