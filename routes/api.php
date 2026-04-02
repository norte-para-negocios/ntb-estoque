<?php

use App\Http\Controllers\API\OmieWebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/webhook', [OmieWebhookController::class, 'webhook'])
    ->name('webhook')
    ->middleware('throttle:60,1');
