<?php

use App\Enums\InventarioItemStatus;
use App\Enums\InventarioStatus;
use App\Models\Inventario;
use App\Models\InventarioItem;
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
})->dailyAt('00:00:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new ProdutoService($loja))->fetchAll();
    }
})->dailyAt('00:30:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new OrdemProducaoService($loja))->fetchAll();
    }
})->dailyAt('01:00:00');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new NotaFiscalService($loja))->fetchAll();
    }
})->dailyAt('01:30:00');

Schedule::call(function () {
    InventarioItem::where('status', InventarioItemStatus::Erro->value)
        ->whereNotNull('id_ajuste')
        ->whereNotNull('id_movest')
        ->update(['status' => InventarioItemStatus::Concluido->value]);

    Inventario::whereNotNull('finalizado')
        ->update(['status' => InventarioStatus::Finalizado->value]);
})->everyTenMinutes();

Schedule::command('model:prune')->daily();
Schedule::command('queue:prune-batches')->daily();
Schedule::command('queue:prune-failed')->daily();
