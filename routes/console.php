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

Schedule::call(function () {
    \App\Models\InventarioItem::where('status', 'Erro')
        ->whereNotNull('id_ajuste')
        ->whereNotNull('id_movest')
        ->update(['status' => 'Concluído']);
})->everyTenMinutes();
