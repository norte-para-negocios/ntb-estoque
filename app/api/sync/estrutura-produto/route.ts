import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'
import { consultarEstrutura } from '@/lib/omie/malha'
import { OmieError, type LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

// Sync manual (nunca automática/cron -- ver Global Constraints do plano
// 2026-08-19-baixa-estoque-ordem-producao.md) da ficha técnica de produtos
// REAIS, só leitura (ConsultarEstrutura, nunca escreve na malha do
// cliente). Pacing de 10s -- bem mais conservador que os 3s que já
// travaram em MISUSE_API_PROCESS numa loja de teste no mesmo dia.
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Apenas administradores' }, { status: 403 })
  }
  const lojaId = await getCurrentLojaId()
  const body = (await request.json().catch(() => null)) as { codigosProduto?: number[] } | null
  const codigosProduto = Array.isArray(body?.codigosProduto) ? body.codigosProduto : []
  if (!codigosProduto.length) {
    return NextResponse.json({ error: 'codigosProduto vazio' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 })
  }

  const PACING_MS = 10_000

  // Pula quem já está em cache (independente de idade -- ficha técnica
  // muda pouco; refresh manual é só apagar a linha na tabela se precisar).
  const { data: jaSincronizados } = await supabase
    .from('estrutura_produto_cache')
    .select('codigo_produto')
    .eq('loja_id', loja.id)
    .in('codigo_produto', codigosProduto)
  const jaFeitos = new Set((jaSincronizados ?? []).map((r) => Number(r.codigo_produto)))
  const pendentesInicio = codigosProduto.filter((c) => !jaFeitos.has(c))

  // Mapa código_produto -> tipo_item, pra gravar o tipo do INSUMO junto
  // (a estrutura da Omie não devolve tipo_item do insumo, só descrição).
  const { data: produtosRows } = await supabase
    .from('produtos')
    .select('codigo_produto, tipo_item')
    .eq('loja_id', loja.id)
  const tipoPorCodigo = new Map((produtosRows ?? []).map((p) => [Number(p.codigo_produto), p.tipo_item as string | null]))

  let sincronizados = 0
  let semEstrutura = 0
  let falhas = 0
  let abortadoPorBloqueioOmie = false
  const pendentes: number[] = []

  for (let i = 0; i < pendentesInicio.length; i++) {
    const codigoProduto = pendentesInicio[i]
    let estrutura
    try {
      estrutura = await consultarEstrutura(loja, codigoProduto)
    } catch (e) {
      if (e instanceof OmieError && e.faultCode === 'MISUSE_API_PROCESS') {
        abortadoPorBloqueioOmie = true
        pendentes.push(...pendentesInicio.slice(i))
        break
      }
      falhas++
      pendentes.push(codigoProduto)
      await new Promise((r) => setTimeout(r, PACING_MS))
      continue
    }
    if (!estrutura?.itens?.length) {
      semEstrutura++
      // Sem estrutura é resposta definitiva -- não marca em cache (nada
      // pra gravar), mas também não fica pendente pra sempre: se quiser
      // reconfirmar depois, o caller reenvia esse código explicitamente.
      await new Promise((r) => setTimeout(r, PACING_MS))
      continue
    }
    let falhouAlgum = false
    for (const item of estrutura.itens) {
      const { error } = await supabase.from('estrutura_produto_cache').upsert(
        {
          loja_id: loja.id,
          codigo_produto: codigoProduto,
          codigo_produto_insumo: item.idProdMalha,
          descricao_insumo: item.descrProdMalha,
          quantidade: item.quantProdMalha,
          percentual_perda: item.percPerdaProdMalha ?? 0,
          unidade: item.unidProdMalha,
          tipo_insumo: tipoPorCodigo.get(item.idProdMalha) ?? null,
          sincronizado_em: new Date().toISOString(),
        },
        { onConflict: 'loja_id,codigo_produto,codigo_produto_insumo' }
      )
      if (error) {
        console.error('sync estrutura-produto: upsert falhou', codigoProduto, item.idProdMalha, error.message)
        falhouAlgum = true
      }
    }
    if (falhouAlgum) {
      falhas++
      pendentes.push(codigoProduto)
    } else {
      sincronizados++
    }
    await new Promise((r) => setTimeout(r, PACING_MS))
  }

  return NextResponse.json({
    ok: true,
    sincronizados,
    semEstrutura,
    falhas,
    abortadoPorBloqueioOmie,
    pendentes,
  })
}
