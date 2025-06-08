<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrdemProducao extends Model
{
    protected $fillable = [
        'loja_id',
        'num_ordem',
        'validade'
    ];

    protected function casts(): array
    {
        return [
            'validade' => 'date',
        ];
    }
}
