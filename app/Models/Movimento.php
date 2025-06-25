<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Movimento extends Model
{
    protected $fillable = [
        'loja_id',
        'codigo_local_estoque',
        'id_prod',
        'data',
        'tipo',
        'quan',
        'valor',
        'obs',
        'origem',
        'motivo',
        'codigo_local_estoque_destino',

        'codigo_status',
        'descricao_status',
        'id_movest',
        'id_ajuste',
    ];

    protected function casts(): array
    {
        return [
            'data' => 'datetime',
        ];
    }
}
