<?php

use App\Http\Controllers\API\OrdemProducaoWebhookController;
use App\Http\Controllers\API\ProdutoWebhookController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::post('/ordensproducao/webhook', [
    OrdemProducaoWebhookController::class,
    'webhook'
]);

Route::post('/produtos/webhook', [
    ProdutoWebhookController::class,
    'webhook'
]);
