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
        Schema::table('lojas', function (Blueprint $table) {
            $table->boolean('ativo')->default(true)->after('omie_app_secret');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('lojas', function (Blueprint $table) {
            $table->dropColumn(['ativo']);
        });
    }
};
