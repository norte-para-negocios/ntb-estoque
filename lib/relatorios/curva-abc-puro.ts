// Curva ABC (matriz N10/N11), regra do Omie provada com a captura da loja 5 (17/10/2026, 385 produtos):
// ordena pela medida (valor faturado ou quantidade), o % acumulado INCLUI o próprio item e
// A = acumulado ≤ 20 %, B = ≤ 80 %, C = o resto ("A (20% das vendas)", "B (60%)", "C (20%)").
// Puro, sem imports: node --test lib/relatorios/curva-abc-puro.test.ts

export type Classe = 'A' | 'B' | 'C'
export type Medida = 'valor' | 'quant'
export type ItemAbc = { chave: string; rotulo: string; codigo: string; familia: string; tipo: string; valor: number; quant: number; tipoCod?: string }
export type LinhaAbc = ItemAbc & { ordem: number; pct: number; acumulado: number; pctAcumulado: number; classe: Classe }
export type Cortes = { a: number; b: number }

export const CORTES_OMIE: Cortes = { a: 20, b: 80 }
export const ROTULO_CLASSE: Record<Classe, string> = { A: 'A (20% das vendas)', B: 'B (60% das vendas)', C: 'C (20% das vendas)' }

const r2 = (n: number) => Math.round(n * 100) / 100
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** Item vendido que não é produto (taxa de serviço, taxa de rolha/troca/frete/estacionamento, gorjeta, couvert
 *  artístico): tipo 09 (serviço) no cadastro ou nome começando por "taxa"/"gorjeta"; "couvert" só quando o tipo é 09/99
 *  (o "Couvert de pães" tipo 04 é comida e fica). O Omie põe a Taxa de Serviço na curva (loja 5, out/2026: 2º lugar da
 *  classe A com R$ 53 mil, ~9 % do total); aqui ela sai por padrão e aparece à parte. */
export function naoEProduto(item: { rotulo: string; tipoCod?: string }): boolean {
  const t = (item.tipoCod ?? '').trim()
  const n = semAcento(item.rotulo)
  if (t === '09') return true
  if (/^(taxa|gorjeta)\b/.test(n)) return true
  if (/^couvert\b/.test(n) && (t === '99' || t === '')) return true
  return false
}

/** Separa os itens da curva (produtos) das taxas/serviços. `incluir` = como o Omie (tudo na curva). */
export function separarTaxas(itens: ItemAbc[], incluir: boolean): { curva: ItemAbc[]; fora: ItemAbc[] } {
  if (incluir) return { curva: itens, fora: [] }
  const curva: ItemAbc[] = [], fora: ItemAbc[] = []
  for (const i of itens) (naoEProduto(i) ? fora : curva).push(i)
  fora.sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  return { curva, fora }
}
const r4 = (n: number) => Math.round(n * 10000) / 10000
const EPS = 1e-9

export function curvaAbc(itens: ItemAbc[], medida: Medida, cortes: Cortes = CORTES_OMIE): LinhaAbc[] {
  const ord = [...itens].sort((x, y) => y[medida] - x[medida] || y[medida === 'valor' ? 'quant' : 'valor'] - x[medida === 'valor' ? 'quant' : 'valor'] || x.rotulo.localeCompare(y.rotulo, 'pt-BR') || x.chave.localeCompare(y.chave))
  const total = ord.reduce((s, i) => s + Math.max(0, i[medida]), 0)
  let acum = 0
  return ord.map((i, k) => {
    const m = Math.max(0, i[medida])
    acum += m
    const pctAcum = total > 0 ? (acum / total) * 100 : 100
    const classe: Classe = m <= 0 ? 'C' : pctAcum <= cortes.a + EPS ? 'A' : pctAcum <= cortes.b + EPS ? 'B' : 'C'
    return { ...i, ordem: k + 1, pct: total > 0 ? r4((m / total) * 100) : 0, acumulado: r2(acum), pctAcumulado: r4(pctAcum), classe }
  })
}

export function resumoAbc(linhas: LinhaAbc[], medida: Medida): Record<Classe, { itens: number; total: number; pct: number }> {
  const out = { A: { itens: 0, total: 0, pct: 0 }, B: { itens: 0, total: 0, pct: 0 }, C: { itens: 0, total: 0, pct: 0 } }
  const total = linhas.reduce((s, l) => s + Math.max(0, l[medida]), 0)
  for (const l of linhas) {
    out[l.classe].itens++
    out[l.classe].total += l[medida]
  }
  for (const c of ['A', 'B', 'C'] as Classe[]) {
    out[c].total = r2(out[c].total)
    out[c].pct = total > 0 ? r2((Math.max(0, out[c].total) / total) * 100) : 0
  }
  return out
}
