<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class IntegrationAttempt extends Model
{
    protected $fillable = [
        'loja_id',
        'model',
        'request',
        'response',
        'code',
        'error',
        'error_message',
    ];
}
