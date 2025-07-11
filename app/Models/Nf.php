<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Nf extends Model
{
    protected $fillable = [
        'loja_id',
        'n_id_receb',
        'produto_codigo',
        'quantidade',
    ];
}
