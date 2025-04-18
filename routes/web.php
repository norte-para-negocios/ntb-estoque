<?php

use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/', [\App\Http\Controllers\Auth\LoginController::class, 'showLoginForm'])->name('welcome');

Auth::routes();

Route::middleware(['auth'])->group(function () {
    Route::get('/home', [App\Http\Controllers\HomeController::class, 'index'])->name('home');

    Route::get('/notasfiscais', [App\Http\Controllers\NotafiscalController::class, 'index'])->name('notafiscal.index');

    Route::get('/notasfiscais/show', [App\Http\Controllers\NotafiscalController::class, 'index'])->name('notafiscal.show');

});
