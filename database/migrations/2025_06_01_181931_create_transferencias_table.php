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
        Schema::create('transferencias', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('produto_id');
            $table->string('tipo_movimento');
            $table->dateTime('data');
            $table->unsignedBigInteger('local_origem_id');
            $table->unsignedBigInteger('local_destino_id');
            $table->string('descricao');
            $table->string('motivo');
            $table->decimal('quantidade');
            $table->decimal('valor_unitario');
            $table->text('observacao')->nullable();
            $table->text('codigo_status')->nullable();
            $table->text('descricao_status')->nullable();
            $table->integer('id_movest')->nullable();
            $table->integer('id_ajuste')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('transferencias');
    }
};
