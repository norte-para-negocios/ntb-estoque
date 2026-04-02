<?php

namespace App\Models;

use App\Enums\TransferenciaStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Transferencia extends Model
{
    protected $fillable = [
        'loja_id',
        'codigo_local_origem',
        'codigo_local_destino',
        'data',
        'status',
        'motivo',
    ];

    protected function casts(): array
    {
        return [
            'data' => 'date',
            'status' => TransferenciaStatus::class,
        ];
    }

    public function loja(): BelongsTo
    {
        return $this->belongsTo(Loja::class);
    }

    public function movimentos(): HasMany
    {
        return $this->hasMany(Movimento::class);
    }

    public function localOrigem(): BelongsTo
    {
        return $this->belongsTo(LocalEstoque::class, 'codigo_local_origem', 'codigo_local_estoque');
    }

    public function localDestino(): BelongsTo
    {
        return $this->belongsTo(LocalEstoque::class, 'codigo_local_destino', 'codigo_local_estoque');
    }
}
