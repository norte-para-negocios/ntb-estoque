// Registro de cada pedido de baixa do Norte Vendas (migration 319) e a resposta de
// GET /api/integracao/ordem-producao/status?pedidoRef= (02/11/2026). Puro: node --test lib/vendas/registro-pedido-venda.test.ts.
//
// Contrato com o Vendas (lib/baixaEstoque.ts decidirIncerto, lado de lá):
//  - `envios`: cada POST recebido para o pedido, em ordem de chegada. Sem `concluidoEm` = em andamento ou interrompido.
//  - `primeiroRegistro`/`ultimoRegistro`: primeiro e último pedido registrado DA LOJA (qualquer pedido). É a prova de
//    que o registro estava ligado: o Vendas só conclui "não chegou" se o Estoque registrou pedidos antes E depois do
//    envio incerto. Sem isso (Estoque antigo, tabela nova, rollback) a baixa continua incerta.

export interface LinhaRegistroPedido {
  recebido_em: string
  concluido_em: string | null
  itens: string[] | null
  resultados: unknown
}

export interface EnvioStatus {
  recebidoEm: string
  concluidoEm: string | null
  itens: Array<Record<string, unknown> & { codigo: string }>
}

export interface StatusPedidoVenda {
  versao: 1
  pedidoRef: string
  primeiroRegistro: string | null
  ultimoRegistro: string | null
  processado: boolean
  emAndamento: boolean
  envios: EnvioStatus[]
  itens: Array<{ codigo: string; nCodOP?: number }>
}

/** pedidoRef como gravado (mesma normalização de venda_op_vinculo, migration 178). */
export function normalizarPedidoRef(ref: unknown): string | null {
  if (typeof ref !== 'string') return null
  const r = ref.trim().toLowerCase()
  return r.length > 0 && r.length <= 200 ? r : null
}

export function montarStatusPedido(
  pedidoRef: string,
  linhas: LinhaRegistroPedido[],
  marcos: { primeiro: string | null; ultimo: string | null }
): StatusPedidoVenda {
  const ordenadas = linhas.slice().sort((a, b) => Date.parse(a.recebido_em) - Date.parse(b.recebido_em))
  const envios: EnvioStatus[] = ordenadas.map((l) => {
    const codigos = Array.isArray(l.itens) ? l.itens : []
    const res = Array.isArray(l.resultados) ? (l.resultados as Array<Record<string, unknown>>) : []
    return {
      recebidoEm: l.recebido_em,
      concluidoEm: l.concluido_em,
      itens: codigos.map((codigo, i) => {
        // Só o resultado da MESMA posição e do mesmo código conta (resultados vem na ordem dos itens enviados).
        const r = l.concluido_em && res[i] && typeof res[i] === 'object' && String(res[i].codigo ?? codigo) === codigo ? res[i] : {}
        return { ...r, codigo }
      }),
    }
  })
  // Último envio CONCLUÍDO por código: o resumo curto pedido no plano ({codigo, nCodOP}).
  const ultimoPorCodigo = new Map<string, { codigo: string; nCodOP?: number }>()
  for (const e of envios) {
    if (!e.concluidoEm) continue
    for (const it of e.itens) {
      const n = typeof it.nCodOP === 'number' ? it.nCodOP : undefined
      ultimoPorCodigo.set(it.codigo, n !== undefined ? { codigo: it.codigo, nCodOP: n } : { codigo: it.codigo })
    }
  }
  return {
    versao: 1,
    pedidoRef,
    primeiroRegistro: marcos.primeiro,
    ultimoRegistro: marcos.ultimo,
    processado: envios.some((e) => !!e.concluidoEm),
    emAndamento: envios.some((e) => !e.concluidoEm),
    envios,
    itens: [...ultimoPorCodigo.values()],
  }
}

/** Erro do PostgREST/Postgres de "tabela não existe" (migration 319 ainda não aplicada). */
export function ehTabelaAusente(error: { code?: string | null; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /venda_integracao_pedidos/.test(error.message ?? '') && /does not exist|not find|schema cache/i.test(error.message ?? '')
}
