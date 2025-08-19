<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class NotaFiscal extends Model
{
    protected $table = 'nfs';

    protected $fillable = [
        'loja_id',
        'n_id_receb',
        'produto_codigo',
        'quantidade',
    ];
}
