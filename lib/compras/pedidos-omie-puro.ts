// Pedidos de compra do Omie (PesquisarPedCompra, só leitura): quanto ainda falta receber por produto.
// Sem imports: node --test lib/compras/pedidos-omie-puro.test.ts.
// Formato da resposta: endpoints/public-api/stock-and-purchase-detail.md (omie-rea) — pedidos_pesquisa[] com
// cabecalho_consulta (dDtPrevisao dd/mm/aaaa, cEtapa) e produtos_consulta[] (nCodProd, nQtde, nQtdeRec).

export type PedidoOmie = {
  cabecalho_consulta?: { nCodPed?: number; cNumero?: string; dDtPrevisao?: string; cEtapa?: string }
  produtos_consulta?: { nCodProd?: number; nQtde?: number; nQtdeRec?: number }[]
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
