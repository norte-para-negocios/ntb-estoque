<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LocalEstoque extends Model
{
    protected $fillable = [
        'loja_id',
        'codigo_local_estoque',
        'codigo',
        'descricao',
        'tipo',
        'padrao',
        'inativo',
        'codigo_cliente',
        'disp_ordem_producao',
        'disp_consumo_op',
        'disp_remessa',
        'disp_venda',
        'd_inc',
        'h_inc',
        'u_inc',
        'd_alt',
        'h_alt',
        'u_alt'
    ];
}
