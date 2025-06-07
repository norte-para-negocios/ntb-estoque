<?php

use App\Http\Controllers\MovimentacaoEstoqueController;
use App\Http\Controllers\OrdemProController;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/', [\App\Http\Controllers\Auth\LoginController::class, 'showLoginForm'])->name('welcome');

Auth::routes(['register' => false]);

Route::middleware(['auth'])->group(function () {
    Route::get('/home', [App\Http\Controllers\HomeController::class, 'index'])->name('home.index');

    // Notas fiscais
    Route::get('/notasfiscais', [App\Http\Controllers\NotafiscalController::class, 'index'])->name('notafiscal.index');
    Route::get('/notasfiscais/itens/{nIdReceb}', [App\Http\Controllers\NotafiscalController::class, 'itens'])->name('notafiscal.itens');
    Route::get('/notasfiscais/itens/{nIdReceb}/imprimir/{cCodigoProduto?}', [App\Http\Controllers\NotafiscalController::class, 'imprimir'])->name('notafiscal.imprimir');

    // Ordens de produção
    Route::get('/ordenspro', [App\Http\Controllers\OrdemProController::class, 'index'])->name('ordemproducao.index');
    Route::post('/ordenspro', [App\Http\Controllers\OrdemProController::class, 'sincValidade'])->name('ordemproducao.sincValidade');
    Route::get('/ordenspro/validade', [App\Http\Controllers\OrdemProController::class, 'getValidade'])->name('ordemproducao.getValidade');
    Route::get('/ordenspro/imprimir', [App\Http\Controllers\OrdemProController::class, 'imprimir'])->name('etiqueta.imprimir');

    // Transferências
    Route::prefix('transferencia')->group(function () {
        Route::get('/', [App\Http\Controllers\MovimentacaoEstoqueController::class, 'index'])->name('transferencia.index');
        Route::get('/create', [MovimentacaoEstoqueController::class, 'create'])->name('transferencia.create');
        Route::post('/store', [MovimentacaoEstoqueController::class, 'store'])->name('transferencia.store');
        // Rota para buscar produto via QR Code
        Route::get('/produto/buscar-por-qrcode/{codigo}', [MovimentacaoEstoqueController::class, 'buscarProdutoPorQrCode']);
    });

});
