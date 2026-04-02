<?php

namespace App\Models;

use App\Enums\SincronizacaoStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Loja extends Model
{
    use HasFactory;

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

        'ativo',

        'local_estoque_ultima_atualizacao',
        'local_estoque_status',

        'produto_ultima_atualizacao',
        'produto_status',

        'posicao_estoque_ultima_atualizacao',
        'posicao_estoque_status',

        'nota_fiscal_ultima_atualizacao',
        'nota_fiscal_status',

        'ordem_producao_ultima_atualizacao',
        'ordem_producao_status',
    ];

    protected function casts(): array
    {
        return [
            // 'omie_app_key' => 'encrypted',
            'omie_app_secret' => 'encrypted',
            'local_estoque_status' => SincronizacaoStatus::class,
            'produto_status' => SincronizacaoStatus::class,
            'posicao_estoque_status' => SincronizacaoStatus::class,
            'nota_fiscal_status' => SincronizacaoStatus::class,
            'ordem_producao_status' => SincronizacaoStatus::class,
        ];
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class);
    }
}
