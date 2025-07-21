<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventarioItem extends Model
{
    protected $fillable = [
        'loja_id',
        'inventario_id',
        'produto_codigo_produto',
        'produto_codigo',
        'produto_descricao',
        'produto_familia',
        'quan',
        'valor',
    ];

    public function inventario()
    {
        return $this->belongsTo(Inventario::class, 'inventario_id');
    }

    public function loja()
    {
        return $this->belongsTo(Loja::class, 'loja_id');
    }
}
