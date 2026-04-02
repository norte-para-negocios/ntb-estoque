<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\IntegrationAttemptController;
use App\Http\Controllers\Inventario\InventarioController;
use App\Http\Controllers\LocalEstoqueController;
use App\Http\Controllers\LojaController;
use App\Http\Controllers\NotaFiscal\NotafiscalController;
use App\Http\Controllers\NotaFiscal\RelatorioNotaFiscalController;
use App\Http\Controllers\OrdemProducao\OrdemProducaoController;
use App\Http\Controllers\OrdemProducao\RelatorioOrdemProducaoController;
use App\Http\Controllers\ProdutoController;
use App\Http\Controllers\Transferencia\TransferenciaController;
use App\Http\Controllers\Transferencia\TransfersController;
use App\Http\Controllers\User\PermissaoController;
use App\Http\Controllers\User\UserController;
use App\Http\Middleware\CheckCurrentLoja;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;

Route::get('/', [LoginController::class, 'showLoginForm'])->name('welcome');

Auth::routes(['register' => false]);

Route::middleware('auth')->group(function () {
    Route::get('/home', [App\Http\Controllers\HomeController::class, 'index'])->name('home.index');

    // Usuário
    Route::resource('usuario', UserController::class)->parameter('usuario', 'user')->except(['show']);
    Route::post('/usuario/{user}/loja/{loja}', [UserController::class, 'setCurrentLoja'])->name('usuario.loja');
    Route::post('/usuario/{user}/permissao', [PermissaoController::class, 'attach'])->name('usuario.permissao.attach');
    Route::delete('/usuario/{user}/loja/{loja}/permissao/{permissao}', [PermissaoController::class, 'detach'])->name('usuario.permissao.detach');
    Route::post('/usuario/{user}/local', [PermissaoController::class, 'attachLocal'])->name('usuario.local.attach');
    Route::delete('/usuario/{user}/loja/{loja}/local/{local}', [PermissaoController::class, 'detachLocal'])->name('usuario.local.detach');

    // Locais de Estoque e Produtos
    Route::get('/local-estoque', [LocalEstoqueController::class, 'index'])->name('locais-estoque.index');
    Route::get('/local-estoque/update', [LocalEstoqueController::class, 'update'])->name('locais-estoque.update');
    Route::get('/produto', [ProdutoController::class, 'index'])->name('produto.index');
    Route::get('/produto/update', [ProdutoController::class, 'update'])->name('produto.update');

    // Logs de Integração com APIs
    Route::get('/log', IntegrationAttemptController::class)->name('log.index');

    // Loja
    Route::resource('loja', LojaController::class)->except(['show']);
    Route::get('/loja/{loja}/sync/force', [LojaController::class, 'syncForce'])->name('loja.sync.force');
});

Route::middleware(['auth', CheckCurrentLoja::class])->group(function () {

    // Nota fiscal
    Route::prefix('nota-fiscal')->group(function () {
        Route::get('/', [NotafiscalController::class, 'index'])->name('notafiscal.index');
        Route::get('/itens/{notaFiscal}', [NotafiscalController::class, 'itens'])->name('notafiscal.itens');
        Route::get('/itens/{notaFiscal}/imprimir/{cCodigoProduto?}', [NotafiscalController::class, 'imprimir'])->name('notafiscal.imprimir');
        Route::post('/{notaFiscalItem}/quantidade', [NotafiscalController::class, 'setQuantidade'])->name('notafiscal.setQuantidade');
        Route::get('/sync-omie', [NotafiscalController::class, 'syncNotasFiscais'])->name('notafiscal.sync');
    });

    // Relatório de Notas Fiscais
    Route::prefix('nota-fiscal/relatorio')->group(function () {
        Route::post('/imprimir', [RelatorioNotaFiscalController::class, 'imprimir'])->name('notafiscal.relatorio.imprimir');
    });

    // Ordens de produção
    Route::prefix('ordem-producao')->group(function () {
        Route::get('/', [OrdemProducaoController::class, 'index'])->name('ordemproducao.index');
        Route::post('/{ordemProducao}/validade', [OrdemProducaoController::class, 'setValidade'])->name('ordemproducao.setValidade');
        Route::post('/{ordemProducao}/quantidade', [OrdemProducaoController::class, 'setQuantidade'])->name('ordemproducao.setQuantidade');
        Route::get('/{ordemProducao}/imprimir', [OrdemProducaoController::class, 'imprimir'])->name('ordemproducao.imprimir');
        Route::post('/{ordemProducao}/finish', [OrdemProducaoController::class, 'finish'])->name('ordemproducao.finish');
        Route::get('/sync-omie', [OrdemProducaoController::class, 'syncOrdensProducao'])->name('ordemproducao.sync');
    });

    // Relatório Ordem Produção
    Route::prefix('ordem-producao/relatorio')->group(function () {
        Route::post('/imprimir', [RelatorioOrdemProducaoController::class, 'imprimir'])->name('ordemproducao.relatorio.imprimir');
    });

    // Transferência
    Route::get('/transferencia/produtos', [TransferenciaController::class, 'produtos'])->name('transferencia.produtos');

    // Inventário
    Route::prefix('inventario')->group(function () {
        Route::get('/', [InventarioController::class, 'index'])->name('inventario.index');
        Route::get('/contagem/{inventario}', [InventarioController::class, 'contagem'])->name('inventario.contagem');
        Route::post('/store', [InventarioController::class, 'store'])->name('inventario.store');
        Route::post('/finish/{inventario}', [InventarioController::class, 'finish'])->name('inventario.finish');
        Route::delete('/destroy/{inventario}', [InventarioController::class, 'destroy'])->name('inventario.destroy');
        Route::get('/pdf/{inventario}', [InventarioController::class, 'pdf'])->name('inventario.pdf');
        Route::get('/{inventario}/duplicar', [InventarioController::class, 'duplicar'])->name('inventario.duplicar');
        Route::get('/{inventario}/force-sync', [InventarioController::class, 'forceSync'])->name('inventario.force-sync');
        Route::post('/quantidade/{inventarioItem}', [InventarioController::class, 'setQuantidade'])->name('inventario.setQuantidade');
        Route::post('/edit/quantidade/{inventarioItem}', [InventarioController::class, 'editQuantidade'])->name('inventario.editQuantidade');
        Route::post('/item/{inventario}', [InventarioController::class, 'storeItem'])->name('inventarioitem.store');
        Route::delete('/item/{inventarioItem}', [InventarioController::class, 'destroyItem'])->name('inventarioitem.destroy');
    });

    // Transfers
    Route::prefix('transfers')->group(function () {
        Route::get('/', [TransfersController::class, 'index'])->name('transfers.index');
        Route::get('/contagem/{transferencia}', [TransfersController::class, 'contagem'])->name('transfers.contagem');
        Route::post('/store', [TransfersController::class, 'store'])->name('transfers.store');
        Route::post('/finish/{transferencia}', [TransfersController::class, 'finish'])->name('transfers.finish');
        Route::delete('/destroy/{transferencia}', [TransfersController::class, 'destroy'])->name('transfers.destroy');
        Route::get('/pdf/{transferencia}', [TransfersController::class, 'pdf'])->name('transfers.pdf');
        Route::get('/{transferencia}/duplicar', [TransfersController::class, 'duplicar'])->name('transfers.duplicar');

        Route::post('/quantidade/{movimento}', [TransfersController::class, 'setQuantidade'])->name('transfers.setQuantidade');
        Route::post('/edit/quantidade/{movimento}', [TransfersController::class, 'editQuantidade'])->name('transfers.editQuantidade');
        Route::post('/item/{transferencia}', [TransfersController::class, 'storeItem'])->name('movimento.store');
        Route::delete('/item/{movimento}', [TransfersController::class, 'destroyItem'])->name('movimento.destroy');

        Route::get('/{transferencia}/force-sync', [TransfersController::class, 'forceSync'])->name('transfers.force-sync');
    });
});
