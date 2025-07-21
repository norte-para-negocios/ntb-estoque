<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Produto extends Model
{
    protected $fillable = [
        'loja_id',
        'codigo_produto',
        'codigo',
        'descricao',
        'codigo_familia',
        'descricao_familia',
        'tipo_item',
        'unidade',
        'valor_unitario',
        'full_object',
    ];

    public function loja()
    {
        return $this->belongsTo(Loja::class);
    }
}
