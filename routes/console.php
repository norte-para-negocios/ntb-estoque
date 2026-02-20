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
        sleep(60);
    }
})->dailyAt('00:00:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new ProdutoService($loja))->fetchAll();
        sleep(120);
    }
})->dailyAt('00:30:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new OrdemProducaoService($loja))->fetchAll();
        sleep(120);
    }
})->dailyAt('01:00:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new NotaFiscalService($loja))->fetchAll();
        sleep(120);
    }
})->dailyAt('01:30:00');

Schedule::call(function () {
    \App\Models\InventarioItem::where('status', 'Erro')
        ->whereNotNull('id_ajuste')
        ->whereNotNull('id_movest')
        ->update(['status' => 'Concluído']);

    \App\Models\Inventario::whereNotNull('finalizado')
        ->update(['status' => 'Finalizado']);
})->everyTenMinutes();

Schedule::command('model:prune')->daily();
Schedule::command('queue:prune-batches')->daily();
Schedule::command('queue:prune-failed')->daily();
