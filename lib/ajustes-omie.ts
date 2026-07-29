import { createServiceClient } from '@/lib/supabase/server'

export type AjusteOmieDetectado = {
  chave: string
  tipo: 'TRF' | 'SLD'
  codigoLocalOrigem: number
  codigoLocalDestino: number | null
  localOrigemNome: string
  localDestinoNome: string | null
  data: string
  qtdProdutos: number
  qtdTotal: number
}

type MovimentoRow = {
  id_prod: number | null
  quan: number | null
  data: string
  codigo_local_estoque: number | null
  codigo_local_estoque_destino: number | null
  id_ajuste: number | null
}

const PAGE = 1000

export async function carregarAjustesOmieDetectados(
  lojaId: number,
  tipo: 'TRF' | 'SLD',
  dataIni: string,
  dataFim: string
): Promise<AjusteOmieDetectado[]> {
  const supabase = createServiceClient()

  // Exclusao (so pra SLD/inventario): ids de ajuste que o proprio NTB ja
  // rastreia via inventario_items -- sem isso, TODO inventario do NTB
  // reaparece "sem dono" (confirmado: 858 linhas hoje, achado real 2026-07-29).
  const idsInventarioNTB = new Set<number>()
  if (tipo === 'SLD') {
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('inventario_items')
        .select('id_ajuste')
        .eq('loja_id', lojaId)
        .not('id_ajuste', 'is', null)
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      for (const r of data as { id_ajuste: number }[]) idsInventarioNTB.add(Number(r.id_ajuste))
      if (data.length < PAGE) break
    }
  }

  const movimentos: MovimentoRow[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('movimentos')
      .select('id_prod, quan, data, codigo_local_estoque, codigo_local_estoque_destino, id_ajuste')
      .eq('loja_id', lojaId)
      .eq('tipo', tipo)
      .is('transferencia_id', null) // ja tem link pra transferencia do NTB -> nao e orfa de verdade
      // motivo/obs sao NULL na maioria das linhas de verdade vindas da Omie --
      // .neq()/.not(ilike) sozinhos excluiriam TODAS (NULL != 'x' e NULL ilike
      // 'x' avaliam pra NULL em SQL, nao TRUE, entao a linha some do WHERE).
      // Achado real ao validar contra dado de producao (2026-07-29): sem o
      // "is.null" explicito, a funcao descartava quase toda transferencia
      // externa legitima -- o oposto do bug de duplicata que motivou esses
      // filtros, mas igualmente errado.
      .or('motivo.is.null,motivo.neq.TPQ') // Omie nunca devolve motivo=TPQ -- so existe se o NTB escreveu localmente
      .or('obs.is.null,obs.not.ilike.%NTB%') // carimbo que o NTB grava em toda observacao propria
      .gte('data', dataIni)
      .lte('data', `${dataFim}T23:59:59`)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    movimentos.push(...(data as MovimentoRow[]))
    if (data.length < PAGE) break
  }

  const filtrados =
    tipo === 'SLD' ? movimentos.filter((m) => !m.id_ajuste || !idsInventarioNTB.has(Number(m.id_ajuste))) : movimentos

  if (!filtrados.length) return []

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
  const nomeLocal = new Map((locais ?? []).map((l) => [Number(l.codigo_local_estoque), l.descricao as string]))

  const grupos = new Map<string, { itens: Set<number>; qtd: number; row: MovimentoRow }>()
  for (const m of filtrados) {
    const dia = m.data.slice(0, 10)
    const chave = `${dia}|${m.codigo_local_estoque}|${m.codigo_local_estoque_destino ?? ''}`
    const g = grupos.get(chave) ?? { itens: new Set<number>(), qtd: 0, row: m }
    if (m.id_prod) g.itens.add(m.id_prod)
    g.qtd += Number(m.quan) || 0
    grupos.set(chave, g)
  }

  return Array.from(grupos.entries())
    .map(([chave, g]) => ({
      chave,
      tipo,
      codigoLocalOrigem: Number(g.row.codigo_local_estoque),
      codigoLocalDestino: g.row.codigo_local_estoque_destino ? Number(g.row.codigo_local_estoque_destino) : null,
      localOrigemNome: nomeLocal.get(Number(g.row.codigo_local_estoque)) ?? String(g.row.codigo_local_estoque),
      localDestinoNome: g.row.codigo_local_estoque_destino
        ? nomeLocal.get(Number(g.row.codigo_local_estoque_destino)) ?? String(g.row.codigo_local_estoque_destino)
        : null,
      data: g.row.data.slice(0, 10),
      qtdProdutos: g.itens.size,
      qtdTotal: Math.round(g.qtd * 1000) / 1000,
    }))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
}
