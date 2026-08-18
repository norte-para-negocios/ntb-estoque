import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'
import { consultarEstrutura } from '@/lib/omie/malha'
import { OmieError, type LojaOmie } from '@/lib/omie/client'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

export const maxDuration = 300

// Sincroniza a ficha técnica local a partir da Omie (só leitura,
// ConsultarEstrutura -- nunca escreve na malha da Omie). Só pra lojas
// is_test=true -- ver docs/superpowers/specs/
// 2026-08-18-estoque-independente-omie-lojas-teste-design.md.
export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Apenas administradores' }, { status: 403 })
  }
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()

  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 })
  }
  if (!loja.is_test) {
    return NextResponse.json({ error: 'Esta ação só é permitida em loja de teste' }, { status: 400 })
  }

  // Pagina a leitura de `produtos` -- o PostgREST corta em 1000 linhas por
  // padrão, e a loja 12 sozinha tem 2553 produtos (mesmo padrão de bug já
  // documentado várias vezes no AGENTS.md, ex. "bug do 1000-linhas do
  // PostgREST"). Mesmo helper compartilhado já usado em outras telas pra
  // paginar `.select()` de tabela (não-RPC). `onErro` sinaliza truncamento
  // no corpo da resposta em vez de silenciosamente processar só parte dos
  // produtos.
  //
  // Só produtos ainda não checados (`ficha_tecnica_checada_em is null`,
  // migration 124) -- sem isso, toda tentativa nova recomeçava do produto 1
  // e, como o loop trava cedo em MISUSE_API_PROCESS quase sempre (ver
  // AGENTS.md), nunca alcançava produtos novos. Pra forçar recheck de tudo
  // de novo, resetar a coluna manualmente (`update produtos set
  // ficha_tecnica_checada_em = null where loja_id = X`).
  let produtosTruncados = false
  const produtos = await buscarTodasLinhas<{ codigo_produto: number }>(
    (from, to) =>
      supabase
        .from('produtos')
        .select('codigo_produto')
        .eq('loja_id', loja.id)
        .is('ficha_tecnica_checada_em', null)
        .order('id')
        .range(from, to),
    undefined,
    () => {
      produtosTruncados = true
    }
  )

  let sincronizados = 0
  let semEstrutura = 0
  let falhas = 0
  let abortadoPorBloqueioOmie = false

  // 400ms (2,5 chamadas/s) se mostrou rápido demais na prática -- travou em
  // MISUSE_API_PROCESS por volta da 11a chamada em sequência, em lojas
  // diferentes (ver AGENTS.md). 3s é bem mais conservador; ainda pode
  // precisar de ajuste conforme o limite real da Omie for confirmado.
  const PACING_MS = 3000

  for (const produto of produtos) {
    let estrutura
    try {
      estrutura = await consultarEstrutura(loja, produto.codigo_produto)
    } catch (e) {
      if (e instanceof OmieError && e.faultCode === 'MISUSE_API_PROCESS') {
        // Não marca ficha_tecnica_checada_em -- não tivemos resposta de
        // verdade pra esse produto, ele deve ser a primeira tentativa da
        // próxima rodada.
        abortadoPorBloqueioOmie = true
        break
      }
      // Não marca ficha_tecnica_checada_em -- falha pode ser transitória
      // (rede, instabilidade da Omie), não uma resposta de verdade.
      falhas++
      await new Promise((r) => setTimeout(r, PACING_MS))
      continue
    }
    if (!estrutura?.itens?.length) {
      semEstrutura++
      await supabase
        .from('produtos')
        .update({ ficha_tecnica_checada_em: new Date().toISOString() })
        .eq('loja_id', loja.id)
        .eq('codigo_produto', produto.codigo_produto)
      await new Promise((r) => setTimeout(r, PACING_MS))
      continue
    }
    let falhouAlgumItem = false
    for (const item of estrutura.itens) {
      const { error } = await supabase.from('ficha_tecnica_local').upsert(
        {
          loja_id: loja.id,
          codigo_produto: produto.codigo_produto,
          codigo_produto_insumo: item.idProdMalha,
          descricao_insumo: item.descrProdMalha,
          quantidade: item.quantProdMalha,
          percentual_perda: item.percPerdaProdMalha ?? 0,
          unidade: item.unidProdMalha,
          sincronizado_em: new Date().toISOString(),
        },
        { onConflict: 'loja_id,codigo_produto,codigo_produto_insumo' }
      )
      if (error) {
        console.error('sync ficha-tecnica-local: upsert falhou', produto.codigo_produto, item.idProdMalha, error.message)
        falhouAlgumItem = true
      }
    }
    if (falhouAlgumItem) {
      falhas++
    } else {
      sincronizados++
      await supabase
        .from('produtos')
        .update({ ficha_tecnica_checada_em: new Date().toISOString() })
        .eq('loja_id', loja.id)
        .eq('codigo_produto', produto.codigo_produto)
    }
    await new Promise((r) => setTimeout(r, PACING_MS))
  }

  return NextResponse.json({
    ok: true,
    sincronizados,
    semEstrutura,
    falhas,
    totalProdutosPendentes: produtos.length,
    abortadoPorBloqueioOmie,
    produtosTruncados,
  })
}
