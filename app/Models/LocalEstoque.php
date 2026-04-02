<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class LocalEstoque extends Model
{
    use SoftDeletes;

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
        'u_alt',
    ];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'local_estoque_user', 'local_estoque_id', 'user_id');
    }
}
