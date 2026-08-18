import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

// Espelha o saldo mais recente de posicao_estoques (já sincronizado
// via /api/sync/posicao, não chama a Omie de novo aqui) pra
// estoque_local_saldos -- ponto de partida do ledger local. Ação
// explícita: sobrescreve qualquer saldo local já divergido. Ver
// docs/superpowers/specs/2026-08-18-estoque-independente-omie-lojas-teste-design.md.
export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Apenas administradores' }, { status: 403 })
  }
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, is_test')
    .eq('id', lojaId)
    .single<{ id: number; is_test: boolean }>()

  if (!loja) {
    return NextResponse.json({ error: 'Loja não encontrada' }, { status: 400 })
  }
  if (!loja.is_test) {
    return NextResponse.json({ error: 'Esta ação só é permitida em loja de teste' }, { status: 400 })
  }

  // Acha a data mais recente primeiro, sem trazer nenhuma linha de fato --
  // evita ler o histórico inteiro de posicao_estoques (todo local x produto
  // x dia já sincronizado pra loja) só pra descartar tudo que não é do dia
  // mais recente. Mesmo padrão já usado em lib/omie/posicao-estoque.ts pra
  // achar a data máxima.
  const { data: maxRow } = await supabase
    .from('posicao_estoques')
    .select('data_posicao')
    .eq('loja_id', loja.id)
    .order('data_posicao', { ascending: false })
    .limit(1)
    .maybeSingle<{ data_posicao: string }>()

  if (!maxRow) {
    return NextResponse.json(
      { error: 'Nenhuma posição de estoque sincronizada ainda -- rode /api/sync/posicao nesta loja primeiro' },
      { status: 400 }
    )
  }

  const dataMaisRecente = maxRow.data_posicao

  // posicao_estoques tem 1 linha por (local_estoque, produto, dia) -- pra
  // 1 dia só, uma loja ainda pode ter muitos locais x produtos, então
  // pagina defensivamente com o mesmo helper compartilhado que corrige o
  // corte de 1000 linhas do PostgREST (Task 3).
  let posicoesTruncadas = false
  const posicoes = await buscarTodasLinhas<{ n_cod_prod: number; n_saldo: number }>(
    (from, to) =>
      supabase
        .from('posicao_estoques')
        .select('n_cod_prod, n_saldo')
        .eq('loja_id', loja.id)
        .eq('data_posicao', dataMaisRecente)
        .order('id')
        .range(from, to),
    undefined,
    () => {
      posicoesTruncadas = true
    }
  )

  const somaPorProduto = new Map<number, number>()
  for (const p of posicoes) {
    somaPorProduto.set(p.n_cod_prod, (somaPorProduto.get(p.n_cod_prod) ?? 0) + p.n_saldo)
  }

  const totalProdutos = somaPorProduto.size
  let copiados = 0
  let falhas = 0
  for (const [codigoProduto, saldo] of somaPorProduto) {
    const { error } = await supabase.from('estoque_local_saldos').upsert(
      {
        loja_id: loja.id,
        codigo_produto: codigoProduto,
        saldo,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'loja_id,codigo_produto' }
    )
    if (error) {
      console.error('sync estoque-local: upsert falhou', codigoProduto, error.message)
      falhas++
      continue
    }
    copiados++
  }

  return NextResponse.json({ ok: true, copiados, falhas, totalProdutos, dataPosicao: dataMaisRecente, posicoesTruncadas })
}
