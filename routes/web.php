<?php

use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/', [\App\Http\Controllers\Auth\LoginController::class, 'showLoginForm'])->name('welcome');

Auth::routes(['register' => false]);

Route::middleware(['auth'])->group(function () {
    Route::get('/home', [App\Http\Controllers\HomeController::class, 'index'])->name('home.index');

    Route::get('/notasfiscais', [App\Http\Controllers\NotafiscalController::class, 'index'])->name('notafiscal.index');
    Route::get('/notasfiscais/itens/{nIdReceb}', [App\Http\Controllers\NotafiscalController::class, 'itens'])->name('notafiscal.itens');
    Route::get('/notasfiscais/itens/{nIdReceb}/imprimir/{cCodigoProduto?}', [App\Http\Controllers\NotafiscalController::class, 'imprimir'])->name('notafiscal.imprimir');

    Route::get('/ordenspro', [App\Http\Controllers\OrdemProController::class, 'index'])->name('ordemproducao.index');
});
