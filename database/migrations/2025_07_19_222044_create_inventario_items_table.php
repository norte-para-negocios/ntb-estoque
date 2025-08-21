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
        Schema::create('inventario_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->unsignedBigInteger('inventario_id');
            $table->unsignedBigInteger('produto_codigo_produto');
            $table->string('produto_codigo', 60);
            $table->string('produto_descricao', 120);
            $table->string('produto_familia', 50)->nullable();
            $table->decimal('quan', 10, 2)->nullable();
            $table->decimal('valor', 10, 2)->nullable();

            $table->text('response')->nullable();
            $table->text('codigo_status')->nullable();
            $table->text('descricao_status')->nullable();
            $table->bigInteger('id_movest')->nullable();
            $table->bigInteger('id_ajuste')->nullable();
            $table->timestamps();

            $table->foreign('loja_id')->references('id')->on('lojas');
            $table->foreign('inventario_id')->references('id')->on('inventarios')->onDelete('CASCADE');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('inventario_items');
    }
};
