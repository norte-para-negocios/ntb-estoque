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
            $table->longText('request');
            $table->longText('response')->nullable();
            $table->string('code', 3)->nullable();
            $table->boolean('error', 3)->nullable()->default(false);
            $table->longText('error_message')->nullable();
            $table->dateTime('read_at')->nullable();
            $table->unsignedBigInteger('read_by')->nullable();
            $table->timestamps();
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
