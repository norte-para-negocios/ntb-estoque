<?php

use App\Http\Controllers\LojaController;
use App\Http\Controllers\NotafiscalController;
use App\Http\Controllers\OrdemProducaoController;
use App\Http\Controllers\PermissaoController;
use App\Http\Controllers\TransferenciaController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;

Route::get('/', [\App\Http\Controllers\Auth\LoginController::class, 'showLoginForm'])->name('welcome');

Auth::routes(['register' => false]);

Route::middleware(['auth'])->group(function () {
    Route::get('/home', [App\Http\Controllers\HomeController::class, 'index'])->name('home.index');

    // Usuários
    Route::resource('usuario', UserController::class)->parameter('usuario', 'user');
    Route::post('/usuario/{user}/loja/{loja}', [UserController::class, 'setCurrentLoja'])->name('usuario.loja');
    Route::post('/usuario/{user}/permissao', [PermissaoController::class, 'attach'])->name('usuario.permissao.attach');
    Route::delete('/usuario/{user}/loja/{loja}/permissao/{permissao}', [PermissaoController::class, 'detach'])->name('usuario.permissao.detach');


    // Lojas
    Route::resource('loja', LojaController::class);

    // Notas fiscais
    Route::get('/notasfiscais', [NotafiscalController::class, 'index'])->name('notafiscal.index');
    Route::get('/notasfiscais/itens/{nIdReceb}', [NotafiscalController::class, 'itens'])->name('notafiscal.itens');
    Route::get('/notasfiscais/itens/{nIdReceb}/imprimir/{cCodigoProduto?}', [NotafiscalController::class, 'imprimir'])->name('notafiscal.imprimir');

    // Ordens de produção
    Route::get('/ordenspro', [OrdemProducaoController::class, 'index'])->name('ordemproducao.index');
    Route::post('/ordenspro', [OrdemProducaoController::class, 'sincValidade'])->name('ordemproducao.sincValidade');
    Route::get('/ordenspro/validade', [OrdemProducaoController::class, 'getValidade'])->name('ordemproducao.getValidade');
    Route::get('/ordenspro/imprimir', [OrdemProducaoController::class, 'imprimir'])->name('etiqueta.imprimir');

    // Transferências
    Route::prefix('transferencia')->group(function () {
        Route::get('/', [TransferenciaController::class, 'index'])->name('transferencia.index');
        Route::get('/create', [TransferenciaController::class, 'create'])->name('transferencia.create');
        Route::post('/store', [TransferenciaController::class, 'store'])->name('transferencia.store');
        // Rota para buscar produto via QR Code
        Route::get('/produto/buscar-por-qrcode/{codigo}', [TransferenciaController::class, 'buscarProdutoPorQrCode']);
    });
});
