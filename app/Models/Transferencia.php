<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Transferencia extends Model
{
    protected $fillable = [
        'nuproduto_id',
        'tipo_movimento',
        'produto_id',
        'tipo_movimento',
        'data',
        'local_origem_id',
        'local_destino_id',
        'motivo',
        'quantidade',
        'valor_unitario',
        'observacao',
        'codigo_status',
        'descricao_status',
        'id_movest',
        'id_ajuste'
    ];

    protected function casts(): array
    {
        return [
            'data' => 'datetime',
        ];
    }
}
