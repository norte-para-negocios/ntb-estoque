// Motor da tabela dinâmica dos relatórios (estilo Omie): agrega linhas planas num layout de linhas x colunas x medidas.
// Puro e sem dependências, para rodar no servidor, no navegador e nos testes.
export type Linha = Record<string, string | number | null>
export type Agg = 'soma' | 'contagem' | 'contagem_distinta' | 'media' | 'min' | 'max'
export type Medida = { campo: string; agg: Agg }
export type Layout = {
  linhas: string[]
  colunas: string[]
  medidas: Medida[]
  /** Só entram as linhas cujo campo está na lista. */
  filtros: Record<string, string[]>
  /** Saem as linhas cujo campo está na lista (ex.: Situação = Cancelada). */
  exceto?: Record<string, string[]>
}
export type No = { chave: string; rotulo: string; valores: Record<string, number>; filhos: No[] }

export const VAZIO = '(vazio)'
export const chaveMedida = (m: Medida) => `${m.campo}|${m.agg}`

const rotuloDe = (v: string | number | null | undefined): string => (v == null || v === '' ? VAZIO : String(v))
const numeroDe = (v: string | number | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

// Ordem natural: datas/meses/números pela ordem do valor, texto pela ordem alfabética pt-BR, (vazio) sempre por último.
function comparar(a: string, b: string): number {
  if (a === VAZIO) return b === VAZIO ? 0 : 1
  if (b === VAZIO) return -1
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
}

type Acc = { soma: number; n: number; min: number; max: number; distintos: Set<string> }
const novoAcc = (): Acc => ({ soma: 0, n: 0, min: Infinity, max: -Infinity, distintos: new Set() })

function acumular(acc: Acc, v: string | number | null | undefined) {
  const x = numeroDe(v)
  acc.soma += x
  acc.n += 1
  if (x < acc.min) acc.min = x
  if (x > acc.max) acc.max = x
  acc.distintos.add(rotuloDe(v))
}

function resultado(acc: Acc, agg: Agg): number {
  if (acc.n === 0) return 0
  switch (agg) {
    case 'soma': return acc.soma
    case 'contagem': return acc.n
    case 'contagem_distinta': return acc.distintos.size
    case 'media': return acc.soma / acc.n
    case 'min': return acc.min
    case 'max': return acc.max
  }
}

type NoAcc = { chave: string; rotulo: string; acc: Map<string, Acc>; filhos: Map<string, NoAcc> }
const novoNo = (chave: string, rotulo: string): NoAcc => ({ chave, rotulo, acc: new Map(), filhos: new Map() })

function somar(no: NoAcc, colunaChave: string, medidas: Medida[], linha: Linha) {
  for (const m of medidas) {
    for (const k of [chaveMedida(m), `${colunaChave}|${chaveMedida(m)}`]) {
      let a = no.acc.get(k)
      if (!a) no.acc.set(k, (a = novoAcc()))
      acumular(a, linha[m.campo])
    }
  }
}

function fechar(no: NoAcc, medidas: Medida[]): No {
  const aggPorChave = new Map<string, Agg>()
  for (const m of medidas) aggPorChave.set(chaveMedida(m), m.agg)
  const valores: Record<string, number> = {}
  for (const [k, a] of no.acc) {
    const base = k.slice(k.lastIndexOf('|', k.lastIndexOf('|') - 1) + 1)
    const chaveMed = aggPorChave.has(k) ? k : base
    valores[k] = resultado(a, aggPorChave.get(chaveMed) ?? 'soma')
  }
  const filhos = [...no.filhos.values()].sort((x, y) => comparar(x.rotulo, y.rotulo)).map((f) => fechar(f, medidas))
  return { chave: no.chave, rotulo: no.rotulo, valores, filhos }
}

export function pivotar(linhas: Linha[], layout: Layout): { raizLinhas: No; colunas: string[]; total: Record<string, number> } {
  const { colunas: camposColuna, medidas, filtros } = layout
  const raiz = novoNo('', '')
  const colunas = new Set<string>()
  const filtrosAtivos = Object.entries(filtros).filter(([, v]) => v.length > 0)
  const excecoes = Object.entries(layout.exceto ?? {}).filter(([, v]) => v.length > 0)

  for (const linha of linhas) {
    if (filtrosAtivos.some(([campo, ok]) => !ok.includes(rotuloDe(linha[campo])))) continue
    if (excecoes.some(([campo, fora]) => fora.includes(rotuloDe(linha[campo])))) continue
    const col = camposColuna.length ? camposColuna.map((c) => rotuloDe(linha[c])).join(' / ') : ''
    if (col) colunas.add(col)
    somar(raiz, col, medidas, linha)
    let no = raiz
    let chave = ''
    for (const campo of layout.linhas) {
      const rotulo = rotuloDe(linha[campo])
      chave = `${chave}\u0001${rotulo}`
      let filho = no.filhos.get(rotulo)
      if (!filho) no.filhos.set(rotulo, (filho = novoNo(chave, rotulo)))
      somar(filho, col, medidas, linha)
      no = filho
    }
  }

  const fechada = fechar(raiz, medidas)
  const total: Record<string, number> = {}
  for (const m of medidas) total[chaveMedida(m)] = fechada.valores[chaveMedida(m)] ?? 0
  return { raizLinhas: fechada, colunas: [...colunas].sort(comparar), total }
}
