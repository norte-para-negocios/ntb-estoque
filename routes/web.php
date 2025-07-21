<?php

use App\Http\Controllers\InventarioController;
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

    // Usuário
    Route::resource('usuario', UserController::class)->parameter('usuario', 'user');
    Route::post('/usuario/{user}/loja/{loja}', [UserController::class, 'setCurrentLoja'])->name('usuario.loja');
    Route::post('/usuario/{user}/permissao', [PermissaoController::class, 'attach'])->name('usuario.permissao.attach');
    Route::delete('/usuario/{user}/loja/{loja}/permissao/{permissao}', [PermissaoController::class, 'detach'])->name('usuario.permissao.detach');

    // Loja
    Route::resource('loja', LojaController::class);

    // Nota fiscal
    Route::get('/notasfiscais', [NotafiscalController::class, 'index'])->name('notafiscal.index');
    Route::get('/notasfiscais/itens/{nIdReceb}', [NotafiscalController::class, 'itens'])->name('notafiscal.itens');
    Route::get('/notasfiscais/itens/{nIdReceb}/imprimir/{cCodigoProduto?}', [NotafiscalController::class, 'imprimir'])->name('notafiscal.imprimir');
    Route::post('/notasfiscais/{nIdReceb}/produto/{codigo}/quantidade', [NotafiscalController::class, 'setQuantidade'])->name('notafiscal.setQuantidade');

    // Ordens de produção
    Route::get('/ordenspro', [OrdemProducaoController::class, 'index'])->name('ordemproducao.index');
    Route::post('/ordenspro', [OrdemProducaoController::class, 'sincValidade'])->name('ordemproducao.sincValidade');
    Route::post('/ordenspro/{ordemProducao}/validade', [OrdemProducaoController::class, 'setValidade'])->name('ordemproducao.setValidade');
    Route::get('/ordenspro/{ordemProducao}/imprimir', [OrdemProducaoController::class, 'imprimir'])->name('ordemproducao.imprimir');

    // Transferência
    Route::prefix('transferencia')->group(function () {
        Route::get('/', [TransferenciaController::class, 'index'])->name('transferencia.index');
        Route::get('/create', [TransferenciaController::class, 'create'])->name('transferencia.create');
        Route::post('/store', [TransferenciaController::class, 'store'])->name('transferencia.store');
        // Rota para buscar produto via QR Code
        Route::get('/local/{local}/produto/{codigo}/data/{data}', [TransferenciaController::class, 'produto'])->name('transferencia.produto');
        Route::get('/reprocess/{movimento}', [TransferenciaController::class, 'reprocess'])->name('transferencia.reprocess');
        Route::delete('/destroy/{movimento}', [TransferenciaController::class, 'destroy'])->name('transferencia.destroy');
    });

    // Inventário
    Route::prefix('inventario')->group(function () {
        Route::get('/', [InventarioController::class, 'index'])->name('inventario.index');
        Route::get('/contagem/{inventario}', [InventarioController::class, 'contagem'])->name('inventario.contagem');
        Route::post('/store', [InventarioController::class, 'store'])->name('inventario.store');
        Route::post('/quantidade/{inventarioItem}', [InventarioController::class, 'setQuantidade'])->name('inventario.setQuantidade');
        Route::post('/finish/{inventario}', [InventarioController::class, 'finish'])->name('inventario.finish');
        Route::delete('/destroy/{inventario}', [InventarioController::class, 'destroy'])->name('inventario.destroy');
    });
});
