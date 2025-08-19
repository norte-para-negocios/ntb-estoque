<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class IntegrationAttempt extends Model
{
    protected $fillable = [
        'request',
        'response',
        'code',
        'error',
        'error_message',
        'read_at',
        'read_by',
    ];
}
