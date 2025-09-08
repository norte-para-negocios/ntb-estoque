<?php

use App\Models\LocalEstoque;
use App\Models\Loja;
use App\Services\LocalEstoqueService;
use App\Services\NotaFiscalService;
use App\Services\OrdemProducaoService;
use App\Services\PosicaoEstoqueService;
use App\Services\ProdutoService;
use Illuminate\Support\Facades\Schedule;

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new LocalEstoqueService($loja))->fetchAll();
        (new ProdutoService($loja))->fetchAll();
        (new OrdemProducaoService($loja))->fetchAll();
        (new NotaFiscalService($loja))->fetchAll();
        foreach (LocalEstoque::where('loja_id', $loja->id)->get() as $localEstoque) {
            (new PosicaoEstoqueService($loja))->fetchAll($localEstoque->codigo_local_estoque, date('d/m/Y'));
        }
    }
})->dailyAt('00:30:00');

Schedule::command('model:prune')->daily();

Schedule::call(function () {
    \App\Models\InventarioItem::where('status', 'Erro')
        ->whereNotNull('id_ajuste')
        ->whereNotNull('id_movest')
        ->update(['status' => 'Concluído']);

    \App\Models\Inventario::whereNotNull('finalizado')
        ->update(['status' => 'Finalizado']);

    \App\Models\InventarioItem::whereNull('id_movest')
        ->whereNull('id_ajuste')
        ->whereHas('inventario', function ($query) {
            $query->whereNotNull('finalizado');
        })
        ->delete();

    \App\Models\Inventario::whereNull('finalizado')
        ->where('status', 'Processando no Omie')
        ->whereDoesntHave('items', function ($query) {
            $query->where('status', '<>', 'Concluído');
        })
        ->update([
            'status' => 'Finalizado',
            'finalizado' => date('Y-m-d H:i:s')
        ]);

    foreach (Loja::all() as $loja) {
        (new OrdemProducaoService($loja))->fetchAll(0, \Carbon\Carbon::now()->subDays(4)->format('d/m/Y'), \Carbon\Carbon::now()->addDays(1)->format('d/m/Y'));
    }
})->everyTenMinutes();
