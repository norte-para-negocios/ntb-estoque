<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class NotaFiscal extends Model
{
    use SoftDeletes;

    protected $table = 'notas_fiscais';

    protected $fillable = [
        'loja_id',
        'n_id_receb',
        'n_id_fornecedor',
        'c_pessoa_fisica',
        'c_nome',
        'c_razao_social',
        'c_inscricao',
        'c_cnpj_cpf',
        'c_chave_nfe',
        'c_etapa',
        'c_numero_nfe',
        'c_serie_nfe',
        'c_modelo_nfe',
        'd_emissao_nfe',
        'n_valor_nfe',
        'c_ambiente_nfe',
        'c_natureza_operacao',

        'full_object',
    ];

    protected function casts(): array
    {
        return [
            'd_emissao_nfe' => 'date',
        ];
    }

    public function loja(): BelongsTo
    {
        return $this->belongsTo(Loja::class, 'loja_id');
    }

    public function nfItems(): HasMany
    {
        return $this->hasMany(NotaFiscalItem::class, 'nota_fiscal_id', 'id');
    }
}
