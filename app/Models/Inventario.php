<?php

namespace App\Models;

use App\Enums\InventarioStatus;
use Illuminate\Database\Eloquent\Model;

class Inventario extends Model
{
    protected $fillable = [
        'loja_id',
        'codigo_local_estoque',
        'data',
        'tipo',
        'origem',
        'motivo',
        'finalizado',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'data' => 'date',
            'finalizado' => 'date',
            'status' => InventarioStatus::class,
        ];
    }

    public function items()
    {
        return $this->hasMany(InventarioItem::class, 'inventario_id');
    }

    public function loja()
    {
        return $this->belongsTo(Loja::class, 'loja_id');
    }

    public function localEstoque()
    {
        return $this->belongsTo(LocalEstoque::class, 'codigo_local_estoque', 'codigo_local_estoque')->where('loja_id', $this->loja_id);
    }
}
