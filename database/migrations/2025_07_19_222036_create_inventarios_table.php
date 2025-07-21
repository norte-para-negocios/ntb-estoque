<?php

use App\Helpers\Constants;
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
        Schema::create('inventarios', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->unsignedBigInteger('codigo_local_estoque');
            $table->dateTime('data')->useCurrent();
            $table->enum('tipo', ['SLD'])->default('SLD');
            $table->enum('origem', ['AJU', 'PDV'])->default('AJU');
            $table->enum('motivo', array_keys(Constants::TIPO_MOVIMENTO_INVENTARIO))->default('INV');
            $table->dateTime('finalizado')->nullable();
            $table->timestamps();

            $table->foreign('loja_id')->references('id')->on('lojas');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('inventarios');
    }
};
