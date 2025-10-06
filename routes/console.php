<?php

use App\Models\Loja;
use App\Services\LocalEstoqueService;
use App\Services\NotaFiscalService;
use App\Services\OrdemProducaoService;
use App\Services\ProdutoService;
use Illuminate\Support\Facades\Schedule;

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new LocalEstoqueService($loja))->fetchAll();
    }
})->dailyAt('00:05:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new ProdutoService($loja))->fetchAll();
    }
})->dailyAt('00:10:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new OrdemProducaoService($loja))->fetchAll();
    }
})->dailyAt('00:15:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new NotaFiscalService($loja))->fetchAll();
    }
})->dailyAt('01:00:00');

Schedule::command('model:prune')->daily();

Schedule::call(function () {
    \App\Models\InventarioItem::where('status', 'Erro')
        ->whereNotNull('id_ajuste')
        ->whereNotNull('id_movest')
        ->update(['status' => 'Concluído']);

    \App\Models\Inventario::whereNotNull('finalizado')
        ->update(['status' => 'Finalizado']);
})->everyTenMinutes();

Schedule::command('queue:prune-batches')->daily();
Schedule::command('queue:prune-failed')->daily();
