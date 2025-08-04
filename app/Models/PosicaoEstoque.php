<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PosicaoEstoque extends Model
{
    protected $fillable = [
        'loja_id',
        'codigo_local_estoque',
        'n_cod_prod',
        'data_posicao',

        'c_cod_int',
        'c_codigo',
        'c_descricao',
        'n_preco_unitario',
        'n_saldo',
        'n_cmc',
        'n_pendente',
        'estoque_minimo',
        'reservado',
        'fisico',
    ];
}
