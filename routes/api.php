<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\API\OmieWebhookController;

Route::post('/webhook', [OmieWebhookController::class, 'webhook'])->name('webhook');
