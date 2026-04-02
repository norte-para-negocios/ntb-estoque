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
        Schema::create('local_estoque_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('loja_id')->constrained('lojas');
            $table->foreignId('user_id')->constrained('users');
            $table->foreignId('local_estoque_id')->constrained('local_estoques');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('local_estoque_user');
    }
};
