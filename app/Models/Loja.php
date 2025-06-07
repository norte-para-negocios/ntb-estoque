<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Loja extends Model
{
    protected $fillable = [
        'cnpj',
        'nome',
        'nome_fantasia',

        'cep',
        'uf',
        'cidade',
        'bairro',
        'logradouro',
        'numero',

        'omie_app_key',
        'omie_app_secret',
    ];

    protected $casts = [
        'omie_app_key' => 'encrypted',
        'omie_app_secret' => 'encrypted',
    ];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class);
    }
}
