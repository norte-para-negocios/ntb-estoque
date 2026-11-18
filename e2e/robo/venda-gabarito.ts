// Gabarito da venda do Norte Vendas (ticket 05): conta independente, SÓ função pura (sem banco, sem navegador, sem código do ERP).
// Regra de negócio em palavras (não copiada do ERP): o prato vendido gera uma OP que consome cada insumo da ficha
// (líquida x fator x (1 + perda%), 6 casas) x quantidade vendida ÷ rendimento, produz a quantidade vendida do prato e a venda
// tira o prato; item sem ficha só sai; serviço não mexe no estoque. Inteiros em micro-unidades (6 casas), meia para longe do zero.
const MICRO = 1_000_000n

function micro(v: string | number): bigint {
  const s = String(v).trim()
  const m = s.match(/^([+-])?(\d*)(?:\.(\d*))?$/)
  if (!m || (!m[2] && !m[3])) throw new Error(`decimal inválido: "${s}"`)
  const frac = (m[3] ?? '').padEnd(7, '0')
  let n = BigInt(m[2] || '0') * MICRO + BigInt(frac.slice(0, 6))
  if (Number(frac[6]) >= 5) n += 1n
  return m[1] === '-' ? -n : n
}
function texto(n: bigint): string {
  const neg = n < 0n
  const a = neg ? -n : n
  const frac = (a % MICRO).toString().padStart(6, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${a / MICRO}${frac ? `.${frac}` : ''}`
}
/** a / b arredondado meia para longe do zero (b > 0). */
function dividir(a: bigint, b: bigint): bigint {
  const neg = a < 0n
  const x = neg ? -a : a
  const q = (2n * x + b) / (2n * b)
  return neg ? -q : q
}

export type FichaGab = { rendimento: string; itens: { insumo: string; liquida: string; fator: string; perda: string }[] }

/** Consumo de cada insumo para `quantidade` unidades vendidas do prato. */
export function consumoDaFicha(ficha: FichaGab, quantidade: string): { insumo: string; quantidade: string }[] {
  const q = micro(quantidade)
  const r = micro(ficha.rendimento)
  return ficha.itens.map((i) => {
    // bruta = liquida x fator x (1 + perda/100), em micro: fator e perda entram como micro também
    const bruta = dividir(micro(i.liquida) * micro(i.fator) * (100n * MICRO + micro(i.perda)), 100n * MICRO * MICRO)
    return { insumo: i.insumo, quantidade: texto(dividir(bruta * q, r)) }
  })
}

export type LojaGab = { padrao: number | null; cozinha: number | null; bar: number | null; porSetor: Record<string, number> | null; porProduto: Record<string, number> | null }
export type ItemLocalGab = { codigo: string; localEstoque?: number | null; setor?: string | null; destination?: 'kitchen' | 'bar' | null }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/** Local de onde sai o item (regra do dono): produto mapeado > local escolhido no Vendas > setor > cozinha/bar > padrão da loja. */
export function resolverLocal(loja: LojaGab, item: ItemLocalGab): number | null {
  const p = loja.porProduto?.[item.codigo]
  if (p) return Number(p)
  if (item.localEstoque) return Number(item.localEstoque)
  if (item.setor && loja.porSetor) {
    for (const [nome, cod] of Object.entries(loja.porSetor)) if (norm(nome) === norm(item.setor) && cod) return Number(cod)
  }
  if (item.destination === 'kitchen' && loja.cozinha) return loja.cozinha
  if (item.destination === 'bar' && loja.bar) return loja.bar
  return loja.padrao
}

export type ItemVendaGab = { codigo: string; quantidade: string; local: number; ficha?: FichaGab; servico?: boolean }
export type MovEsperado = { codigo: string; local: number; tipo: 'Produção' | 'Saída'; quantidade: string }

/** O que a venda deve gravar no estoque, na ordem dos itens (insumos, prato produzido, prato vendido). */
export function movimentosEsperados(itens: ItemVendaGab[]): MovEsperado[] {
  const out: MovEsperado[] = []
  for (const it of itens) {
    if (it.servico) continue
    if (it.ficha) {
      for (const c of consumoDaFicha(it.ficha, it.quantidade)) out.push({ codigo: c.insumo, local: it.local, tipo: 'Produção', quantidade: texto(-micro(c.quantidade)) })
      out.push({ codigo: it.codigo, local: it.local, tipo: 'Produção', quantidade: texto(micro(it.quantidade)) })
    }
    out.push({ codigo: it.codigo, local: it.local, tipo: 'Saída', quantidade: texto(-micro(it.quantidade)) })
  }
  return out
}

/** Soma dos movimentos por "produto:local". */
export function saldoLiquido(movs: { codigo: string; local: number; quantidade: string }[]): Map<string, string> {
  const s = new Map<string, bigint>()
  for (const m of movs) { const k = `${m.codigo}:${m.local}`; s.set(k, (s.get(k) ?? 0n) + micro(m.quantidade)) }
  return new Map([...s].map(([k, v]) => [k, texto(v)]))
}

export const microDe = micro
export const textoDeMicro = texto
