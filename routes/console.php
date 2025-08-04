<?php

use App\Models\Loja;
use App\Services\LocalEstoqueService;
use App\Services\OrdemProducaoService;
use App\Services\ProdutoService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new LocalEstoqueService($loja))->fetchAll();
    }
})->everySixHours();

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new OrdemProducaoService($loja))->fetchAll(3);
    }
})->everyFifteenMinutes();

Schedule::call(function () {
    foreach (Loja::all() as $loja) {
        (new ProdutoService($loja))->fetchAll();
    }
})->everySixHours();
