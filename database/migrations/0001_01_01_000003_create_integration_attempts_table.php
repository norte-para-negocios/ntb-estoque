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
        Schema::create('integration_attempts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('loja_id');
            $table->string('model', 120);

            $table->longText('request');
            $table->longText('response')->nullable();
            $table->string('code', 3)->nullable();
            $table->boolean('error')->default(false);
            $table->longText('error_message')->nullable();
            $table->timestamps();

            $table->foreign('loja_id')->references('id')->on('lojas');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('integration_attempts');
    }
};
