<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\MassPrunable;

class IntegrationAttempt extends Model
{
    use MassPrunable;

    public function prunable(): Builder
    {
        return static::where('created_at', '<=', now()->subDays(7));
    }

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
