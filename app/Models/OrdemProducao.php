<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrdemProducao extends Model
{
    protected $fillable = [
        'loja_id',
        'num_ordem',
        'validade',

        'identificacao_n_cod_op',
        'identificacao_c_cod_int_op',
        'identificacao_c_num_op',
        'identificacao_n_cod_produto',
        'identificacao_c_cod_int_prod',
        'identificacao_d_dt_previsao',
        'identificacao_n_qtde',
        'identificacao_codigo_local_estoque',
        'adicionais_c_etapa',
        'adicionais_n_cod_projeto',
        'adicionais_d_dt_inicio',
        'adicionais_d_dt_conclusao',

        'produto_codigo',
        'produto_descricao',
        'produto_tipo_item',
        'produto_unidade',

        'full_object'
    ];

    protected function casts(): array
    {
        return [
            'validade' => 'date',
            'identificacao_d_dt_previsao' => 'date',
            'adicionais_d_dt_conclusao' => 'date',
            'adicionais_d_dt_inicio' => 'date',
        ];
    }
}
