// Parser da aba-resumo do export MOV_DRV do Omie (movimentação/baixas valorizadas).
// Função PURA: recebe as abas já lidas e devolve linhas (dimensao, rotulo, mes,
// valor). A aba "BAIXA RESUMO" é a baixa por tipo SPED em R$ mês a mês — os
// valores vêm NEGATIVOS (saída); guardamos o módulo (consumo positivo).
//
// Layout: linhas de filtro no topo, uma linha de cabeçalho com os meses por
// extenso ("Janeiro / 2026", ...) tendo "Tipo do Produto (SPED)" na 1ª coluna,
// e as linhas de tipo abaixo até "Total Geral".

export interface LinhaMov {
  dimensao: 'tipo'
  rotulo: string
  mes: string // 'YYYY-MM'
  valor: number // positivo (módulo da baixa)
}
export interface AbaLida {
  nome: string
  linhas: (string | number | null)[][]
}

const MESES: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
}

const txt = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
// "Janeiro / 2026" -> '01'; "jan" -> '01'; lixo -> null.
const mesDe = (v: unknown): string | null => MESES[txt(v).toLowerCase().slice(0, 3)] ?? null
function num(v: unknown): number {
  if (typeof v === 'number') return v
  const s = txt(v).replace(/[^\d,.-]/g, '')
  if (!s) return NaN
  return s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
}

// Acha a aba de baixa por tipo SPED (a "BAIXA RESUMO").
function abaResumo(nome: string): boolean {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /baixa/.test(n) && /resumo/.test(n)
}

function parseResumo(linhas: AbaLida['linhas'], ano: number): LinhaMov[] {
  // cabeçalho dos meses: a linha que tem 'jan' (Janeiro) seguido de 'fev'.
  let hdr = -1
  let janCol = -1
  for (let r = 0; r < Math.min(linhas.length, 25); r++) {
    const row = linhas[r] ?? []
    const j = row.findIndex((c) => mesDe(c) === '01')
    if (j >= 0 && mesDe(row[j + 1]) === '02') { hdr = r; janCol = j; break }
  }
  if (hdr < 0) return []

  const header = linhas[hdr]
  const mesCols: { col: number; mm: string }[] = []
  for (let c = janCol; c < header.length; c++) {
    const mm = mesDe(header[c])
    if (mm) mesCols.push({ col: c, mm })
    else break // meses são contíguos; para no "Total Geral" / célula vazia
  }
  const rotCol = Math.max(0, janCol - 1)

  const out: LinhaMov[] = []
  for (let r = hdr + 1; r < linhas.length; r++) {
    const row = linhas[r] ?? []
    const rotulo = txt(row[rotCol])
    if (!rotulo) continue
    if (/total\s*geral/i.test(rotulo)) break
    for (const { col, mm } of mesCols) {
      const v = num(row[col])
      if (Number.isFinite(v) && v !== 0) {
        out.push({ dimensao: 'tipo', rotulo, mes: `${ano}-${mm}`, valor: Number(Math.abs(v).toFixed(2)) })
      }
    }
  }
  return out
}

/**
 * Parseia o export MOV_DRV: acha a aba "BAIXA RESUMO" (baixa por tipo SPED) e
 * devolve as baixas valorizadas por tipo/mês (em módulo positivo).
 */
export function parseMovimentacaoResumo(abas: AbaLida[], ano: number): LinhaMov[] {
  for (const aba of abas) {
    if (!abaResumo(aba.nome)) continue
    const linhas = parseResumo(aba.linhas, ano)
    if (linhas.length) return linhas
  }
  return []
}
