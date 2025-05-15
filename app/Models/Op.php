<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Op extends Model
{
    protected $fillable = [
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
