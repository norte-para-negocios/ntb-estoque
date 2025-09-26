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
        Schema::create('produtos', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->bigInteger('codigo_produto');
            $table->string('codigo', 60)->nullable();
            $table->string('descricao', 120)->nullable();
            $table->bigInteger('codigo_familia')->nullable();
            $table->string('descricao_familia', 50)->nullable();
            $table->string('tipo_item', 2)->nullable();
            $table->string('unidade', 6)->nullable();
            $table->decimal('valor_unitario', 10, 2)->nullable();
            $table->json('full_object')->nullable();
            $table->timestamps();

            $table->foreign('loja_id')->references('id')->on('lojas');
            $table->index(['codigo_produto', 'loja_id'], 'produtos_codigo_produto_loja_id_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('produtos');
    }
};
