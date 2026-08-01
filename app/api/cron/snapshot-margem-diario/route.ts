import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

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
// app/(app)/relatorio-margem/page.tsx (achado real: sem isto, `produtos`/
// `posicao_estoques` truncavam silenciosamente pra lojas acima de 1000
// linhas). `contar`: quando informado, busca todas as paginas em paralelo.
async function buscarTodasLinhas<T>(
  montar: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  contar?: () => PromiseLike<{ count: number | null }>,
): Promise<T[]> {
  const PAGE = 1000
  if (contar) {
    const { count } = await contar()
    const numPaginas = Math.ceil((count ?? 0) / PAGE)
    const blocos = await Promise.all(
      Array.from({ length: numPaginas }, (_, p) => montar(p * PAGE, p * PAGE + PAGE - 1))
    )
    return blocos.flatMap((r) => r.data ?? [])
  }
  const todas: T[] = []
  for (let p = 0; ; p++) {
    const { data } = await montar(p * PAGE, p * PAGE + PAGE - 1)
    if (!data?.length) break
    todas.push(...data)
    if (data.length < PAGE) break
  }
  return todas
}

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
    // produtosCalc e fotoRow sao independentes entre si -- roda em paralelo
    // (mesmo padrao de relatorio-margem/page.tsx).
    const [produtosCalc, { data: fotoRow }] = await Promise.all([
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
            .in('tipo_item', ['04', '00'])
      ),
      supabase
        .from('posicao_estoques')
        .select('data_posicao')
        .eq('loja_id', loja.id)
        .order('data_posicao', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

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
            .gt('n_saldo', 0)
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

    if (linhas.length) {
      const { error } = await supabase.from('margem_snapshot_diario').upsert(
        linhas.map((l) => ({ loja_id: loja.id, data_snapshot: hoje, ...l })),
        { onConflict: 'loja_id,data_snapshot,codigo_produto' }
      )
      resumo.push({ loja_id: loja.id, linhas: linhas.length, erro: error?.message ?? null })
    } else {
      resumo.push({ loja_id: loja.id, linhas: 0, erro: null })
    }
  }
  return NextResponse.json({ total_lojas: lojas.length, resumo })
}
