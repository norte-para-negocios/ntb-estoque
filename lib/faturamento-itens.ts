// Funcoes puras do painel de Faturamento (sem I/O, sem alias '@/', sem import '.ts').

export type LinhaItem = {
  dia: string // 'YYYY-MM-DD'
  cupom: number
  idProduto: number | null
  produto: string
  tipoCod: string
  tipo: string
  familia: string
  quant: number
  valor: number
}
export type Dimensao = 'produto' | 'familia' | 'tipo'
export type LinhaRanking = { chave: string; rotulo: string; valor: number; quant: number; cupons: number; pct: number }

const round2 = (n: number) => Math.round(n * 100) / 100
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function chaveDe(l: LinhaItem, por: Dimensao): { chave: string; rotulo: string } {
  if (por === 'familia') return { chave: l.familia, rotulo: l.familia }
  if (por === 'tipo') return { chave: l.tipoCod || '_', rotulo: l.tipo }
  return { chave: l.idProduto != null ? String(l.idProduto) : `nome:${l.produto}`, rotulo: l.produto }
}

export function rankear(linhas: LinhaItem[], por: Dimensao): LinhaRanking[] {
  const m = new Map<string, { rotulo: string; valor: number; quant: number; cupons: Set<number> }>()
  for (const l of linhas) {
    const { chave, rotulo } = chaveDe(l, por)
    const g = m.get(chave) ?? { rotulo, valor: 0, quant: 0, cupons: new Set<number>() }
    g.valor += l.valor
    g.quant += l.quant
    g.cupons.add(l.cupom)
    m.set(chave, g)
  }
  const total = [...m.values()].reduce((s, g) => s + g.valor, 0)
  return [...m.entries()]
    .map(([chave, g]) => ({
      chave, rotulo: g.rotulo, valor: round2(g.valor), quant: round2(g.quant), cupons: g.cupons.size,
      pct: total > 0 ? round2((g.valor / total) * 100) : 0,
    }))
    .sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

export function ordenarRanking(r: LinhaRanking[], ordem: 'valor' | 'quant', sentido: 'mais' | 'menos'): LinhaRanking[] {
  const dir = sentido === 'mais' ? -1 : 1
  return [...r].sort((a, b) => dir * (a[ordem] - b[ordem]) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

export function filtrarPorNome(r: LinhaRanking[], q: string): LinhaRanking[] {
  const t = semAcento(q.trim())
  return t ? r.filter((x) => semAcento(x.rotulo).includes(t)) : r
}

export type ResumoItens = { faturado: number; cupons: number; ticket: number | null; itens: number; melhorDia: { dia: string; valor: number } | null }

export function resumir(linhas: LinhaItem[]): ResumoItens {
  const cupons = new Set<number>()
  const porDia = new Map<string, number>()
  let faturado = 0
  let itens = 0
  for (const l of linhas) {
    faturado += l.valor
    itens += l.quant
    cupons.add(l.cupom)
    porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + l.valor)
  }
  let melhor: { dia: string; valor: number } | null = null
  for (const [dia, valor] of porDia) if (melhor === null || valor > melhor.valor) melhor = { dia, valor: round2(valor) }
  return {
    faturado: round2(faturado), cupons: cupons.size, itens: round2(itens),
    ticket: cupons.size > 0 ? round2(faturado / cupons.size) : null,
    melhorDia: melhor,
  }
}

function proximoDia(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function serieDiaria(linhas: LinhaItem[], ini: string, fim: string): { dia: string; valor: number }[] {
  const porDia = new Map<string, number>()
  for (const l of linhas) porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + l.valor)
  const out: { dia: string; valor: number }[] = []
  for (let d = ini; d <= fim && out.length < 366; d = proximoDia(d)) out.push({ dia: d, valor: round2(porDia.get(d) ?? 0) })
  return out
}

export function posicaoNoRanking(r: LinhaRanking[], chave: string): number | null {
  const i = r.findIndex((x) => x.chave === chave)
  return i < 0 ? null : i + 1
}

export function mesesEntre(ini: string, fim: string): string[] {
  const out: string[] = []
  let [a, m] = ini.slice(0, 7).split('-').map(Number)
  const [af, mf] = fim.slice(0, 7).split('-').map(Number)
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; a += 1 }
  }
  return out
}

export type LinhaMatriz = { chave: string; rotulo: string; porMes: Record<string, number>; total: number; pct: number }
export type MatrizMensal = { meses: string[]; linhas: LinhaMatriz[]; totalPorMes: Record<string, number>; total: number }

// Evolucao mensal: uma linha por produto/familia/tipo, uma coluna por mes do periodo.
export function matrizMensal(linhas: LinhaItem[], por: Dimensao, ini: string, fim: string): MatrizMensal {
  const meses = mesesEntre(ini, fim)
  const zero = () => Object.fromEntries(meses.map((m) => [m, 0])) as Record<string, number>
  const g = new Map<string, { rotulo: string; porMes: Record<string, number> }>()
  const totalPorMes = zero()
  for (const l of linhas) {
    const { chave, rotulo } = chaveDe(l, por)
    const mes = l.dia.slice(0, 7)
    const x = g.get(chave) ?? { rotulo, porMes: zero() }
    x.porMes[mes] = (x.porMes[mes] ?? 0) + l.valor
    totalPorMes[mes] = (totalPorMes[mes] ?? 0) + l.valor
    g.set(chave, x)
  }
  const total = round2(Object.values(totalPorMes).reduce((s, v) => s + v, 0))
  const out = [...g.entries()].map(([chave, x]) => {
    const porMes = Object.fromEntries(Object.entries(x.porMes).map(([k, v]) => [k, round2(v)])) as Record<string, number>
    const t = round2(Object.values(porMes).reduce((s, v) => s + v, 0))
    return { chave, rotulo: x.rotulo, porMes, total: t, pct: total > 0 ? round2((t / total) * 100) : 0 }
  }).sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  return { meses, linhas: out, totalPorMes: Object.fromEntries(Object.entries(totalPorMes).map(([k, v]) => [k, round2(v)])), total }
}

export type Pagamento = { cupom: number; forma: string; valor: number }

// Forma de pagamento como ranking (mesmo formato dos outros; quant fica 0).
export function agruparPagamentos(pags: Pagamento[]): LinhaRanking[] {
  const m = new Map<string, { valor: number; cupons: Set<number> }>()
  for (const p of pags) {
    const g = m.get(p.forma) ?? { valor: 0, cupons: new Set<number>() }
    g.valor += p.valor
    g.cupons.add(p.cupom)
    m.set(p.forma, g)
  }
  const total = [...m.values()].reduce((s, g) => s + g.valor, 0)
  return [...m.entries()]
    .map(([forma, g]) => ({ chave: forma, rotulo: forma, valor: round2(g.valor), quant: 0, cupons: g.cupons.size, pct: total > 0 ? round2((g.valor / total) * 100) : 0 }))
    .sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}
