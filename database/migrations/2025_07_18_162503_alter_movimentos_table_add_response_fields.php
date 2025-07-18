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
        Schema::table('movimentos', function (Blueprint $table) {
            $table->text('response')->nullable()->after('id_ajuste');
            $table->bigInteger('id_movest')->nullable()->change();
            $table->bigInteger('id_ajuste')->nullable()->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('movimentos', function (Blueprint $table) {
            $table->dropColumn('response');
            $table->integer('id_movest')->nullable()->change();
            $table->integer('id_ajuste')->nullable()->change();
        });
    }
};
