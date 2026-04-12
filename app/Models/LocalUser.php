<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\Pivot;

class LocalUser extends Pivot
{
    protected $table = 'local_estoque_user';

    protected $fillable = [
        'loja_id',
        'local_estoque_id',
        'user_id',
    ];

    public function localEstoque(): BelongsTo
    {
        return $this->belongsTo(LocalEstoque::class);
    }

    public function loja(): BelongsTo
    {
        return $this->belongsTo(Loja::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
