<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\Pivot;

class PermissaoUser extends Pivot
{
    protected $table = 'permissao_user';

    protected $fillable = [
        'loja_id',
        'permissao_id',
        'user_id',
    ];

    public function permissao(): BelongsTo
    {
        return $this->belongsTo(Permissao::class);
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
