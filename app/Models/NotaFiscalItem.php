<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class NotaFiscalItem extends Model
{
    protected $table = 'nfs';

    protected $fillable = [
        'loja_id',
        'nota_fiscal_id',

        'n_id_receb',
        'produto_codigo',
        'quantidade',

        'n_id_item',
        'n_id_pedido',
        'n_id_it_pedido',
        'n_id_produto',
        'n_sequencia',
        'c_codigo_produto',
        'c_descricao_produto',
        'c_ignorar_item',
        'c_adicionar_novo',
        'c_associar_existente',
        'c_item_devolvido',
        'c_ncm',
        'c_ean',
        'c_cfop',
        'n_qtde_nfe',
        'c_unidade_nfe',
        'n_preco_unit',
        'v_desconto',
        'v_frete',
        'v_total_item',

        'full_object',
    ];

    public function loja(): BelongsTo
    {
        return $this->belongsTo(Loja::class);
    }

    public function notaFiscal(): BelongsTo
    {
        return $this->belongsTo(NotaFiscal::class, 'nota_fiscal_id');
    }

    public function produto(): BelongsTo
    {
        return $this->belongsTo(Produto::class, 'produto_codigo', 'codigo_produto');
    }
}
