<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasOne;

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
        'response',

        'status'
    ];

    protected function casts(): array
    {
        return [
            'data' => 'date',
        ];
    }

    public function loja()
    {
        return $this->belongsTo(Loja::class);
    }

    public function produto(): hasOne
    {
        return $this->hasOne(Produto::class, 'codigo_produto', 'id_prod');
    }

    public function estoqueOrigem(): hasOne
    {
        return $this->hasOne(LocalEstoque::class, 'codigo_local_estoque', 'codigo_local_estoque')
            ->where('loja_id', '=', $this->loja_id);

    }

    public function estoqueDestino(): hasOne
    {
        return $this->hasOne(LocalEstoque::class, 'codigo_local_estoque', 'codigo_local_estoque_destino')
            ->where('loja_id', '=', $this->loja_id);
    }
}
