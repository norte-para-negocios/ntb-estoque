import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'

export const maxDuration = 300

// Roda 1x/dia -- arquiva CMC/PDV/margem calculados "ao vivo" (mesma formula
// de app/(app)/relatorio-margem/page.tsx, bloco `if (!rows.length)`) numa
// tabela append-only, pra construir uma serie temporal real dali pra frente
// (achado 2026-08-01: posicao_estoques so guarda 2 dias, nao sustenta
// tendencia mensal). Ao contrario da tela, NAO checa margem_importada
// primeiro -- o snapshot precisa de granularidade diaria real (posicao de
// estoque), que so o calculo ao vivo tem; o import manual do FAT_DRV
// (loja 3) e mensal/agregado e nao serve pra essa serie.

// PostgREST corta em 1000 linhas por padrao, sem erro -- mesma paginacao de
// app/(app)/relatorio-margem/page.tsx. Task 13 (auditoria 2026-08-09): a
// copia local hand-rolled que existia aqui nao checava `error` -- pior aqui
// do que na tela/export, porque este cron ESCREVE o resultado numa tabela
// append-only sem retroativo possivel (comentario da migration 101): uma
// falha de query no meio da paginacao viraria silenciosamente "acabaram as
// paginas", e o CMC truncado/errado ficaria gravado pra sempre como se fosse
// o snapshot real do dia. Trocado pelo helper compartilhado
// `lib/supabase/buscar-todas-linhas.ts` (loga o erro real) + `onErro` usado
// abaixo pra NAO gravar o snapshot da loja nesse dia quando alguma consulta
// falhar (melhor um dia faltando na serie -- visivel como buraco -- do que
// um numero errado gravado como se fosse real).

type Linha = {
  codigo_produto: number
  codigo: string
  descricao: string | null
  descricao_familia: string | null
  pdv: number | null
  cmc: number | null
  margem: number | null
}

export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const lojas = await getLojasAtivas()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })

  const resumo: { loja_id: number; linhas: number; erro: string | null }[] = []
  for (const loja of lojas) {
    let houveErroConsulta = false
    const marcarErro = (etapa: string) => (error: { message: string }) => {
      houveErroConsulta = true
      console.error(`snapshot-margem-diario: loja ${loja.id}, consulta "${etapa}" falhou -- snapshot do dia NAO sera gravado`, error.message)
    }

    // produtosCalc e fotoRow sao independentes entre si -- roda em paralelo
    // (mesmo padrao de relatorio-margem/page.tsx).
    const [produtosCalc, { data: fotoRow, error: erroFotoRow }] = await Promise.all([
      buscarTodasLinhas<{
        codigo: string | null
        codigo_produto: number
        descricao: string | null
        descricao_familia: string | null
        valor_unitario: number | null
      }>(
        (from, to) =>
          supabase
            .from('produtos')
            .select('codigo, codigo_produto, descricao, descricao_familia, tipo_item, valor_unitario')
            .eq('loja_id', loja.id)
            .in('tipo_item', ['04', '00'])
            .order('id', { ascending: true })
            .range(from, to),
        () =>
          supabase
            .from('produtos')
            .select('codigo_produto', { count: 'exact', head: true })
            .eq('loja_id', loja.id)
            .in('tipo_item', ['04', '00']),
        marcarErro('produtos')
      ),
      supabase
        .from('posicao_estoques')
        .select('data_posicao')
        .eq('loja_id', loja.id)
        .order('data_posicao', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (erroFotoRow) marcarErro('posição de estoque (data mais recente)')(erroFotoRow)

    let linhas: Linha[] = []
    if (fotoRow?.data_posicao && produtosCalc.length) {
      // Pondera por local (soma de custo x saldo, dividido pelo saldo total) em
      // vez de pegar o MAIOR n_cmc entre locais -- mesmo bug ja achado e
      // corrigido em relatorio_estoque_valorizado (migration 082) e
      // relatorio-margem/page.tsx: quando o mesmo produto tem CMC divergente
      // entre locais, o maior valor sozinho superestima o custo e derruba a
      // margem calculada artificialmente. n_saldo>0 tambem: Omie grava linhas
      // com saldo NEGATIVO em locais "fantasma" que, sem esse filtro, zeram o
      // saldo total do produto e derrubam o produto inteiro do calculo.
      const posRows = await buscarTodasLinhas<{ n_cod_prod: number; n_cmc: number; n_saldo: number }>(
        (from, to) =>
          supabase
            .from('posicao_estoques')
            .select('n_cod_prod, n_cmc, n_saldo')
            .eq('loja_id', loja.id)
            .eq('data_posicao', fotoRow.data_posicao)
            .gt('n_cmc', 0)
            .gt('n_saldo', 0)
            .order('id', { ascending: true })
            .range(from, to),
        () =>
          supabase
            .from('posicao_estoques')
            .select('n_cod_prod', { count: 'exact', head: true })
            .eq('loja_id', loja.id)
            .eq('data_posicao', fotoRow.data_posicao)
            .gt('n_cmc', 0)
            .gt('n_saldo', 0),
        marcarErro('posição de estoque (CMC/saldo)')
      )
      const acumPorCod = new Map<number, { valor: number; saldo: number }>()
      for (const p of posRows) {
        const cod = Number(p.n_cod_prod)
        const saldo = Number(p.n_saldo) || 0
        const ent = acumPorCod.get(cod) ?? { valor: 0, saldo: 0 }
        ent.valor += Number(p.n_cmc) * saldo
        ent.saldo += saldo
        acumPorCod.set(cod, ent)
      }
      const cmcPorCod = new Map<number, number>()
      for (const [cod, e] of acumPorCod) {
        if (e.saldo > 0) cmcPorCod.set(cod, e.valor / e.saldo)
      }
      // Todo produto do tipo certo entra no snapshot, mesmo sem cmc/pdv valido
      // (mesmo criterio de relatorio-margem/page.tsx: nao esconder produto sem
      // custo/preco cadastrado -- fica com margem null, nao desaparece).
      linhas = produtosCalc.map((p) => {
        const cmc = cmcPorCod.get(Number(p.codigo_produto)) ?? null
        const pdv = Number(p.valor_unitario) || null
        const margem = pdv && cmc && pdv > 0 && cmc > 0 ? Number((((pdv - cmc) / pdv) * 100).toFixed(1)) : null
        return {
          codigo_produto: Number(p.codigo_produto),
          codigo: p.codigo ?? String(p.codigo_produto),
          descricao: p.descricao,
          descricao_familia: p.descricao_familia,
          pdv,
          cmc,
          margem,
        }
      })
    }

    if (houveErroConsulta) {
      // Nao grava: um snapshot parcial/truncado gravado como se fosse o real
      // do dia seria pior do que um buraco na serie (buraco pelo menos e
      // detectavel depois; numero errado gravado no append-only, nao).
      resumo.push({ loja_id: loja.id, linhas: 0, erro: 'falha ao consultar produtos/posição de estoque -- snapshot do dia não gravado' })
    } else if (linhas.length) {
      const { error } = await supabase.from('margem_snapshot_diario').upsert(
        linhas.map((l) => ({ loja_id: loja.id, data_snapshot: hoje, ...l })),
        { onConflict: 'loja_id,data_snapshot,codigo_produto' }
      )
      resumo.push({ loja_id: loja.id, linhas: linhas.length, erro: error?.message ?? null })
    } else {
      resumo.push({ loja_id: loja.id, linhas: 0, erro: null })
    }
  }
  // Mesmo padrao ja aplicado em sync-posicao/sync-previsao/sync-preco-movimentacao
  // (achado da Task 9 desta auditoria: um cron que sempre responde 200, mesmo
  // com todas as lojas falhando, fica mudo no log -- "-> 200" nao diferencia
  // sucesso de apagao total). Se TODAS as lojas com resultado falharam, 502.
  const todasFalharam = resumo.length > 0 && resumo.every((r) => r.erro !== null)
  return NextResponse.json({ total_lojas: lojas.length, resumo }, { status: todasFalharam ? 502 : 200 })
}
