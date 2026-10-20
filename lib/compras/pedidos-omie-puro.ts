// Pedidos de compra do Omie (PesquisarPedCompra, só leitura): quanto ainda falta receber por produto.
// Sem imports: node --test lib/compras/pedidos-omie-puro.test.ts.
// Formato da resposta: endpoints/public-api/stock-and-purchase-detail.md (omie-rea) — pedidos_pesquisa[] com
// cabecalho_consulta (dDtPrevisao dd/mm/aaaa, cEtapa) e produtos_consulta[] (nCodProd, nQtde, nQtdeRec).

export type PedidoOmie = {
  cabecalho_consulta?: {
    nCodPed?: number; cNumero?: string; dDtPrevisao?: string; cEtapa?: string
    cCodIntPed?: string; nCodFor?: number; dIncData?: string; cNumPedido?: string; cContato?: string
  }
  produtos_consulta?: { nCodProd?: number; nQtde?: number; nQtdeRec?: number; nValUnit?: number; nValMerc?: number; nValTot?: number; cDescricao?: string }[]
}

/** dd/mm/aaaa → aaaa-mm-dd (null se não vier no formato). */
export function dataOmieParaIso(d: string | undefined | null): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Saldo a receber (nQtde − nQtdeRec, nunca negativo) por produto, dos pedidos com previsão até o fim da estimativa (sem previsão = conta). */
export function saldoPedidosOmie(pedidos: PedidoOmie[], fimEstimativa: string): Map<number, number> {
  const r = new Map<number, number>()
  for (const p of pedidos) {
    const prev = dataOmieParaIso(p.cabecalho_consulta?.dDtPrevisao)
    if (prev && prev > fimEstimativa) continue
    for (const it of p.produtos_consulta ?? []) {
      const cod = Number(it.nCodProd)
      if (!cod) continue
      const falta = Math.max(0, (Number(it.nQtde) || 0) - (Number(it.nQtdeRec) || 0))
      if (falta > 0) r.set(cod, Math.round(((r.get(cod) ?? 0) + falta) * 1e6) / 1e6)
    }
  }
  return r
}

/** A leitura só liga com OMIE_LER_PEDIDOS_COMPRA=1 (padrão desligado: nenhuma chamada ao Omie). */
export function leituraPedidosOmieLigada(env: Record<string, string | undefined>): boolean {
  return env.OMIE_LER_PEDIDOS_COMPRA === '1'
}

export type PedidoOmieResumo = {
  nCodPed: number
  numero: string
  /** id do pedido no NTB quando o pedido foi gravado pelo NTB (cCodIntPed NTB-PC-<id>) */
  pedidoNtbId: number | null
  fornecedor: string
  previsao: string | null
  inclusao: string | null
  etapa: string | null
  itens: number
  valor: number
  quantidade: number
  recebido: number
  situacao: 'pendente' | 'recebido_parcial' | 'recebido'
}

/**
 * Pedidos de compra lidos do Omie (PesquisarPedCompra) para a lista "Pedidos no Omie". `fornecedores` = nCodFor →
 * nome (cadastro sincronizado). Recebido = soma de nQtdeRec; o código da etapa (cEtapa) vai cru: o significado de cada
 * código ainda não foi provado (omie-rea/regras/status-numeracao-arredondamento-vinculos.md).
 */
export function resumirPedidosOmie(pedidos: PedidoOmie[], fornecedores: Map<number, string>): PedidoOmieResumo[] {
  const r: PedidoOmieResumo[] = []
  const vistos = new Set<number>()
  for (const p of pedidos) {
    const c = p.cabecalho_consulta ?? {}
    const nCodPed = Number(c.nCodPed)
    if (!nCodPed || vistos.has(nCodPed)) continue  // páginas que se sobrepõem não duplicam
    vistos.add(nCodPed)
    const itens = p.produtos_consulta ?? []
    const quantidade = itens.reduce((a, i) => a + (Number(i.nQtde) || 0), 0)
    const recebido = itens.reduce((a, i) => a + Math.min(Number(i.nQtdeRec) || 0, Number(i.nQtde) || 0), 0)
    const valor = itens.reduce((a, i) => a + (Number(i.nValMerc) || (Number(i.nQtde) || 0) * (Number(i.nValUnit) || 0)), 0)
    const m = /^NTB-PC-(\d{1,13})$/.exec((c.cCodIntPed ?? '').trim())
    r.push({
      nCodPed, numero: (c.cNumero ?? '').trim() || String(nCodPed), pedidoNtbId: m ? Number(m[1]) : null,
      fornecedor: fornecedores.get(Number(c.nCodFor)) ?? (c.nCodFor ? `Fornecedor ${c.nCodFor}` : '—'),
      previsao: dataOmieParaIso(c.dDtPrevisao), inclusao: dataOmieParaIso(c.dIncData), etapa: (c.cEtapa ?? '').trim() || null,
      itens: itens.length, valor: Math.round(valor * 100) / 100,
      quantidade: Math.round(quantidade * 1e6) / 1e6, recebido: Math.round(recebido * 1e6) / 1e6,
      situacao: recebido <= 1e-6 ? 'pendente' : recebido + 1e-6 >= quantidade ? 'recebido' : 'recebido_parcial',
    })
  }
  return r.sort((a, b) => (a.previsao ?? '9999').localeCompare(b.previsao ?? '9999') || b.nCodPed - a.nCodPed)
}
