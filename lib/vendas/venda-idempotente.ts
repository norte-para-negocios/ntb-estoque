// Venda do Norte Vendas → estoque no Omie sem duplicar quando o pedido é reenviado (Fase A, Task 9; matriz H11).
// O código da OP e a chave da saída saem do pedido + produto + ocorrência do produto no pedido (não da posição do
// item nem da hora), então o mesmo pedido gera sempre os mesmos códigos. Prefixo NTBV mantido: é por ele que
// origemDaOP mostra "Norte Vendas". Puro: node --test lib/vendas/venda-idempotente.test.ts.

// Mesmo algoritmo de hashCurto (lib/correcoes/central-puro.ts), copiado: módulo puro não importa valor.
function hashCurto(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return (h1.toString(36).padStart(7, '0') + h2.toString(36).padStart(7, '0')).slice(0, 13)
}

const base = (pedidoRef: string, codigoProduto: number, ocorrencia: number) =>
  `${pedidoRef.trim().toLowerCase()}|${Math.trunc(codigoProduto)}|${Math.trunc(ocorrencia)}`

/** cCodIntOP da OP da venda (≤ 20 caracteres, limite do Omie). */
export function codIntOPVenda(pedidoRef: string, codigoProduto: number, ocorrencia: number): string {
  return `NTBV-${hashCurto(`op|${base(pedidoRef, codigoProduto, ocorrencia)}`)}`
}

/** Chave única da saída de estoque da venda (movimentos.venda_chave). */
export function chaveSaidaVenda(pedidoRef: string, codigoProduto: number, ocorrencia: number): string {
  return `VND-${hashCurto(`sai|${base(pedidoRef, codigoProduto, ocorrencia)}`)}`
}

/** Para cada item, quantas vezes o mesmo código já apareceu antes no pedido (0, 1, 2…): não depende da ordem dos itens. */
export function ocorrenciasPorCodigo(itens: { codigo: string }[]): number[] {
  const vistos = new Map<string, number>()
  return itens.map((i) => {
    const n = vistos.get(i.codigo) ?? 0
    vistos.set(i.codigo, n + 1)
    return n
  })
}

export type VinculoOP = { cod_int_op: string; n_cod_op: number | null; estado: 'incluindo' | 'criada' | 'concluida' | 'estornada' }

/** O que fazer com a OP desta venda, conforme o que já foi feito antes. */
export function decidirOPVenda(v: VinculoOP | null): 'incluir' | 'consultar' | 'concluir' | 'pronta' {
  if (!v) return 'incluir'
  if (v.estado === 'concluida' || v.estado === 'estornada') return 'pronta'
  if (v.estado === 'criada' && v.n_cod_op) return 'concluir'
  return 'consultar'
}

export type AlvoEstorno = { nCodOP: number } | { codInt: string }

/**
 * OPs a desfazer no estorno de uma venda: as do vínculo (as estornadas ficam de fora; sem nº ainda → procurar pelo
 * código) + as achadas no log de integração antigo (vendas de antes da migration 178), sem repetir o mesmo nº.
 */
export function opsParaEstornar(vinculos: VinculoOP[], legado: number[]): AlvoEstorno[] {
  const out: AlvoEstorno[] = []
  const vistos = new Set<number>()
  for (const v of vinculos) {
    if (v.estado === 'estornada') { if (v.n_cod_op) vistos.add(v.n_cod_op); continue }
    if (v.n_cod_op) { if (!vistos.has(v.n_cod_op)) { vistos.add(v.n_cod_op); out.push({ nCodOP: v.n_cod_op }) } }
    else out.push({ codInt: v.cod_int_op })
  }
  for (const n of legado) if (!vistos.has(n)) { vistos.add(n); out.push({ nCodOP: n }) }
  return out
}
