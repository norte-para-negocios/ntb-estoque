import type { SupabaseClient } from '@supabase/supabase-js'

// Baixa de estoque local pras lojas de teste (is_test=true) --
// ver docs/superpowers/specs/2026-08-18-estoque-independente-omie-lojas-teste-design.md.
// Nunca chama a Omie. Sem ficha técnica local cadastrada pro produto:
// não é erro fatal, só não baixa nada (mesmo princípio de
// consultarEstrutura devolvendo null pra produto sem estrutura).

export interface ResultadoBaixaLocal {
  baixado: boolean
  itens: { codigoProdutoInsumo: number; quantidadeBaixada: number; saldoApos: number }[]
  motivo?: string
}

interface FichaTecnicaLinha {
  codigo_produto_insumo: number
  quantidade: number
  percentual_perda: number
}

export async function baixarEstoqueLocal(
  supabase: SupabaseClient,
  lojaId: number,
  codigoProduto: number,
  quantidadeVendida: number,
  nCodOP: number,
  pedidoRef: string | null
): Promise<ResultadoBaixaLocal> {
  const { data: ficha, error: fichaError } = await supabase
    .from('ficha_tecnica_local')
    .select('codigo_produto_insumo, quantidade, percentual_perda')
    .eq('loja_id', lojaId)
    .eq('codigo_produto', codigoProduto)
    .returns<FichaTecnicaLinha[]>()

  if (fichaError) {
    return { baixado: false, itens: [], motivo: `Falha ao ler ficha técnica local: ${fichaError.message}` }
  }
  if (!ficha || ficha.length === 0) {
    return { baixado: false, itens: [], motivo: 'Sem ficha técnica local cadastrada pra este produto' }
  }

  const itens: ResultadoBaixaLocal['itens'] = []

  for (const linha of ficha) {
    const quantidadeBaixar = quantidadeVendida * linha.quantidade * (1 + linha.percentual_perda / 100)

    const { data: saldoAtual } = await supabase
      .from('estoque_local_saldos')
      .select('saldo')
      .eq('loja_id', lojaId)
      .eq('codigo_produto', linha.codigo_produto_insumo)
      .maybeSingle<{ saldo: number }>()

    const saldoAnterior = saldoAtual?.saldo ?? 0
    const saldoApos = saldoAnterior - quantidadeBaixar

    await supabase.from('estoque_local_saldos').upsert(
      {
        loja_id: lojaId,
        codigo_produto: linha.codigo_produto_insumo,
        saldo: saldoApos,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'loja_id,codigo_produto' }
    )

    await supabase.from('movimentos_locais').insert({
      loja_id: lojaId,
      codigo_produto: linha.codigo_produto_insumo,
      tipo: 'SAI',
      quantidade: quantidadeBaixar,
      saldo_apos: saldoApos,
      origem_n_cod_op: nCodOP,
      pedido_ref: pedidoRef,
    })

    itens.push({ codigoProdutoInsumo: linha.codigo_produto_insumo, quantidadeBaixada: quantidadeBaixar, saldoApos })
  }

  return { baixado: true, itens }
}
