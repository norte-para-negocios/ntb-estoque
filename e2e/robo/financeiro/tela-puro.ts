// Leitura do texto das telas do financeiro (puro): converte "R$ 1.234,56" em centavos e acha os cartões pelo rótulo.
export function moedaParaCent(t: string): number | null {
  const m = t.replace(/ /g, ' ').match(/(-)?\s*R\$\s*(-)?\s*([\d.]+),(\d{2})/)
  if (!m) return null
  const c = Number(m[3].replace(/\./g, '')) * 100 + Number(m[4])
  return m[1] || m[2] ? -c : c
}

const linhas = (texto: string) => texto.replace(/ /g, ' ').split('\n').map((l) => l.trim()).filter(Boolean)

/** Valor que vem na linha logo depois do rótulo (começa com o rótulo). Sem o rótulo: null. */
export function valorDepoisDe(texto: string, rotulo: string): string | null {
  const ls = linhas(texto)
  const i = ls.findIndex((l) => l === rotulo || l.startsWith(rotulo))
  return i >= 0 && i + 1 < ls.length ? ls[i + 1] : null
}

export type CartoesPagar = { quantidade: number; faltaPagarCent: number; quantidadeAtrasada: number; atrasadoCent: number; jaPagoCent: number }
export function lerCartoesPagar(texto: string): CartoesPagar | null {
  const q = valorDepoisDe(texto, 'Títulos no filtro')
  const falta = valorDepoisDe(texto, 'Falta pagar')
  const ls = linhas(texto)
  const iAt = ls.findIndex((l) => /^Atrasado \(\d+\)$/.test(l))
  const pago = valorDepoisDe(texto, 'Já pago')
  if (q === null || falta === null || iAt < 0 || pago === null) return null
  const n = moedaParaCent(falta), a = moedaParaCent(ls[iAt + 1] ?? ''), p = moedaParaCent(pago)
  if (n === null || a === null || p === null || !/^\d+$/.test(q)) return null
  return { quantidade: Number(q), faltaPagarCent: n, quantidadeAtrasada: Number(ls[iAt].match(/\d+/)![0]), atrasadoCent: a, jaPagoCent: p }
}

export type CartoesReceber = { quantidade: number; brutoCent: number }
export function lerCartoesReceber(texto: string): CartoesReceber | null {
  const ls = linhas(texto)
  const i = ls.findIndex((l) => l === 'Vendido no filtro')
  if (i < 0) return null
  const bruto = moedaParaCent(ls[i + 1] ?? '')
  const q = (ls[i + 2] ?? '').match(/^(\d+) contas/)
  return bruto === null || !q ? null : { quantidade: Number(q[1]), brutoCent: bruto }
}

export type ContaNaTela = { nome: string; saldoCent: number }
/** Cada <li> do cartão de conta: 1ª linha = nome; depois de "Saldo atual" vem o saldo. */
export function lerContas(blocos: string[]): ContaNaTela[] {
  const out: ContaNaTela[] = []
  for (const b of blocos) {
    const ls = linhas(b)
    const i = ls.indexOf('Saldo atual')
    const s = i >= 0 ? moedaParaCent(ls[i + 1] ?? '') : null
    if (i >= 0 && s !== null) out.push({ nome: ls[0], saldoCent: s })
  }
  return out
}
