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
  // paginar `.select()` de tabela (não-RPC).
  const produtos = await buscarTodasLinhas<{ codigo_produto: number }>((from, to) =>
    supabase.from('produtos').select('codigo_produto').eq('loja_id', loja.id).order('id').range(from, to)
  )

  let sincronizados = 0
  let semEstrutura = 0
  let falhas = 0
  let abortadoPorBloqueioOmie = false

  for (const produto of produtos) {
    let estrutura
    try {
      estrutura = await consultarEstrutura(loja, produto.codigo_produto)
    } catch (e) {
      if (e instanceof OmieError && e.faultCode === 'MISUSE_API_PROCESS') {
        abortadoPorBloqueioOmie = true
        break
      }
      falhas++
      await new Promise((r) => setTimeout(r, 400))
      continue
    }
    if (!estrutura?.itens?.length) {
      semEstrutura++
      await new Promise((r) => setTimeout(r, 400))
      continue
    }
    for (const item of estrutura.itens) {
      await supabase.from('ficha_tecnica_local').upsert(
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
    }
    sincronizados++
    await new Promise((r) => setTimeout(r, 400))
  }

  return NextResponse.json({
    ok: true,
    sincronizados,
    semEstrutura,
    falhas,
    totalProdutos: produtos.length,
    abortadoPorBloqueioOmie,
  })
}
