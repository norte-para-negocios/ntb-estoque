// Central de correções: cupons do PDV de prato com ficha que ficaram sem OP (a integração do PDV parou, ex.: 07–09/10
// e 13/10 à tarde na Donana PF). Puro, sem imports de valor: node --test.
//
// Regra (Ruling R8 do plano 2026-10-14): por (dia, produto), as OPs do PDV com previsão naquele dia cobrem as vendas
// em ordem de hora (FIFO); o que sobra é "sem OP". Só produtos que têm OP do PDV (ou ficha lida com itens).

const b36 = (n: number) => Math.trunc(Math.abs(n)).toString(36)
/** Mesmo hash de central-puro.ts (hashCurto): 2 × FNV-1a 32 bits, base36, 13 caracteres. */
function hashCurto(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return (h1.toString(36).padStart(7, '0') + h2.toString(36).padStart(7, '0')).slice(0, 13)
}

export type ItemCupom = { nIdCupom: number; num: string | null; data: string; hora: string | null; produto: number; nome: string; quant: number }
export type OPPdv = { data: string; produto: number; qtd: number }
export type CupomSemOP = { nIdCupom: number; num: string | null; data: string; hora: string | null; itens: { produto: number; nome: string; quantidade: number }[] }

const EPS = 1e-9

/** OP criada pela venda do caixa (integração do PDV) ou pela própria Central para um cupom. */
export function ehOPdoPDV(o: { cCodInt: string | null; obs?: string | null; origem?: string | null }): boolean {
  const c = (o.cCodInt ?? '').trim()
  if (/^\d+$/.test(c)) return true
  if (/^CP-/i.test(c)) return true
  if (/^Cupom\s+\d+/i.test((o.obs ?? '').trim())) return true
  return o.origem === 'cupom'
}

/** `corte` = 'YYYY-MM-DDTHH:MM:SS' no fuso da Bahia: venda depois dele ainda pode receber a OP do PDV. */
export function cuponsSemOP(itens: ItemCupom[], ops: OPPdv[], comOP: Set<number>, corte: string): CupomSemOP[] {
  const quando = (i: ItemCupom) => `${i.data}T${(i.hora ?? '00:00:00').slice(0, 8)}`
  const elegiveis = itens
    .filter((i) => comOP.has(i.produto) && i.quant > 0 && quando(i) <= corte)
    .sort((a, b) => quando(a).localeCompare(quando(b)) || a.nIdCupom - b.nIdCupom)
  const cobertura = new Map<string, number>()
  for (const o of ops) {
    const k = `${o.data}|${o.produto}`
    cobertura.set(k, (cobertura.get(k) ?? 0) + Math.max(0, o.qtd))
  }
  const porCupom = new Map<number, CupomSemOP>()
  for (const i of elegiveis) {
    const k = `${i.data}|${i.produto}`
    const disp = cobertura.get(k) ?? 0
    const usa = Math.min(disp, i.quant)
    cobertura.set(k, disp - usa)
    const falta = i.quant - usa
    if (falta <= EPS) continue
    const c = porCupom.get(i.nIdCupom) ?? { nIdCupom: i.nIdCupom, num: i.num, data: i.data, hora: i.hora, itens: [] }
    const ja = c.itens.find((x) => x.produto === i.produto)
    if (ja) ja.quantidade = Math.round((ja.quantidade + falta) * 1e6) / 1e6
    else c.itens.push({ produto: i.produto, nome: i.nome, quantidade: Math.round(falta * 1e6) / 1e6 })
    porCupom.set(i.nIdCupom, c)
  }
  return [...porCupom.values()].sort((a, b) => b.data.localeCompare(a.data) || (b.hora ?? '').localeCompare(a.hora ?? '') || b.nIdCupom - a.nIdCupom)
}

/** cCodIntOP determinístico da OP de um item de cupom (o Omie recusa repetido: nunca duplica). Máx. 20 caracteres. */
export function codIntOPCupom(nIdCupom: number, produto: number): string {
  const c = `CP-${b36(nIdCupom)}-${b36(produto)}`
  return c.length <= 20 ? c : `CP-${hashCurto(`${nIdCupom}|${produto}`)}`
}

/** cCodIntOP determinístico de uma OP de correção (preparo/prato): mesma loja+produto+data+quantidade = mesmo código. */
export function codIntOPCorrecao(lojaId: number, produto: number, dataISO: string, quantidade: number): string {
  return `CT-${hashCurto(`${lojaId}|${produto}|${dataISO}|${Math.round(quantidade * 1e6)}`)}`
}

/** Ainda falta OP? (a integração do PDV pode ter reprocessado depois da tela carregar). */
export function coberturaAindaFalta(vendido: number, coberto: number, pedido: number): boolean {
  return pedido > 0 && coberto + pedido <= vendido + 1e-6
}

export function resumoCuponsPorDia(c: CupomSemOP[]): { data: string; cupons: number; itens: number }[] {
  const m = new Map<string, { data: string; cupons: number; itens: number }>()
  for (const x of c) {
    const r = m.get(x.data) ?? { data: x.data, cupons: 0, itens: 0 }
    r.cupons++
    r.itens += x.itens.reduce((s, i) => s + i.quantidade, 0)
    m.set(x.data, r)
  }
  return [...m.values()].sort((a, b) => b.data.localeCompare(a.data))
}

/** O Omie recusou o IncluirOrdemProducao porque o código de integração já existe (≠ "já existe uma requisição"). */
export function pareceOPJaExiste(msg: string): boolean {
  if (/j. existe uma requisi/i.test(msg)) return false
  return /j. cadastrad|j. existe.*(c.digo de integra|cCodIntOP|ordem|OP\b)/i.test(msg)
}

/** Validação do pedido de OP da Central (o servidor confere de novo o que a tela mandou). */
export function validarPedidoOP(p: { quantidade: number; dataISO: string; tipo: string | null }, hoje: string): string | null {
  if (!Number.isFinite(p.quantidade) || p.quantidade <= 0 || p.quantidade > 100_000) return 'Informe uma quantidade maior que zero (até 100.000).'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dataISO) || Number.isNaN(Date.parse(`${p.dataISO}T12:00:00Z`))) return 'Escolha uma data válida.'
  if (p.dataISO > hoje) return 'A data não pode ser no futuro (o Omie recusa concluir OP com data futura).'
  if ((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${p.dataISO}T12:00:00Z`)) / 86_400_000 > 90) return 'Data de mais de 90 dias atrás: lance pela tela de OPs, com cuidado com o mês fechado.'
  if (p.tipo !== '03' && p.tipo !== '04') return 'Só dá para lançar OP de prato ou preparo (produto acabado ou em processo).'
  return null
}
