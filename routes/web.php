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
//        Route::post('/excel', [RelatorioNotaFiscalController::class, 'excel'])->name('notafiscal.relatorio.excel');
    });

    // Ordens de produção
    Route::prefix('ordem-producao')->group(function () {
        Route::get('/', [OrdemProducaoController::class, 'index'])->name('ordemproducao.index');
        Route::post('/{ordemProducao}/validade', [OrdemProducaoController::class, 'setValidade'])->name('ordemproducao.setValidade');
        Route::get('/{ordemProducao}/imprimir', [OrdemProducaoController::class, 'imprimir'])->name('ordemproducao.imprimir');
    });

    // Relatório Ordem Produção
    Route::prefix('ordem-producao/relatorio')->group(function () {
        Route::post('/imprimir', [RelatorioOrdemProducaoController::class, 'imprimir'])->name('ordemproducao.relatorio.imprimir');
//        Route::post('/excel', [RelatorioOrdemProducaoController::class, 'excel'])->name('relatorio.ordemproducao.excel');
    });

    // Transferência
    Route::resource('transferencia', TransferenciaController::class)->only(['index', 'create', 'store', 'destroy'])->parameter('transferencia', 'movimento');
    Route::get('/transferencia/local-estoque/{local}/produto/{codigo}/data/{data}', [TransferenciaController::class, 'produto'])->name('transferencia.produto');
    Route::get('/transferencia/produtos', [TransferenciaController::class, 'produtos'])->name('transferencia.produtos');
    Route::get('/transferencia/reprocess/{movimento}', [TransferenciaController::class, 'reprocess'])->name('transferencia.reprocess');

    // Inventário
    Route::prefix('inventario')->group(function () {
        Route::get('/', [InventarioController::class, 'index'])->name('inventario.index');
        Route::get('/contagem/{inventario}', [InventarioController::class, 'contagem'])->name('inventario.contagem');
        Route::post('/store', [InventarioController::class, 'store'])->name('inventario.store');
        Route::post('/quantidade/{inventarioItem}', [InventarioController::class, 'setQuantidade'])->name('inventario.setQuantidade');
        Route::post('/finish/{inventario}', [InventarioController::class, 'finish'])->name('inventario.finish');
        Route::delete('/destroy/{inventario}', [InventarioController::class, 'destroy'])->name('inventario.destroy');
        Route::get('/pdf/{inventario}', [InventarioController::class, 'pdf'])->name('inventario.pdf');
    });
});
