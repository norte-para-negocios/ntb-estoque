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
        Schema::create('lojas', function (Blueprint $table) {
            $table->id();
            $table->string('cnpj',18);
            $table->string('nome', 120);
            $table->string('nome_fantasia', 80);

            $table->string('cep', 10)->nullable();
            $table->enum('uf', array_keys(Constants::UF))->nullable();
            $table->string('cidade', 255)->nullable();
            $table->string('bairro', 255)->nullable();
            $table->string('logradouro', 255)->nullable();
            $table->string('numero', 20)->nullable();

            $table->text('omie_app_key')->nullable();
            $table->text('omie_app_secret')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('lojas');
    }
};
