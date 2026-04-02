<?php

namespace App\Models;

use App\Enums\InventarioItemStatus;
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

        'response',
        'codigo_status',
        'descricao_status',
        'id_movest',
        'id_ajuste',

        'status',
    ];

    protected function casts(): array
    {
        return [
            'status' => InventarioItemStatus::class,
        ];
    }

    public function inventario()
    {
        return $this->belongsTo(Inventario::class, 'inventario_id');
    }

    public function produto()
    {
        return $this->belongsTo(Produto::class, 'produto_codigo_produto', 'codigo_produto');
    }

    public function loja()
    {
        return $this->belongsTo(Loja::class, 'loja_id');
    }
}
