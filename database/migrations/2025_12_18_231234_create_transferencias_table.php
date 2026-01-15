<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('transferencias', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->unsignedBigInteger('codigo_local_origem');
            $table->unsignedBigInteger('codigo_local_destino');
            $table->enum('motivo', array_keys(\App\Helpers\Constants::TIPO_MOVIMENTO_TRANSFERENCIA));
            $table->dateTime('data')->useCurrent();
            $table->enum('status', ['Processando', 'Concluído']);
            $table->timestamps();
            $table->foreign('loja_id')->references('id')->on('lojas');
        });

        Schema::table('movimentos', function (Blueprint $table) {
            $table->unsignedBigInteger('transferencia_id')->nullable();
            $table->foreign('transferencia_id')->references('id')->on('transferencias');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('movimentos') && Schema::hasColumn('movimentos', 'transferencia_id')) {
            Schema::table('movimentos', function (Blueprint $table) {
                $table->dropForeign(['transferencia_id']);
                $table->dropColumn('transferencia_id');
            });
        }
        Schema::dropIfExists('transferencias');
    }
};
