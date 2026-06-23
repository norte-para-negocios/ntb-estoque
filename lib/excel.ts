import ExcelJS from 'exceljs'

// Cor da marca (teal) usada no cabecalho da planilha. Sem '#'.
const BRAND = 'FF1C8D99'
const BRAND_SOFT = 'FFF3FAFB'
const BORDA = 'FFE6E9EF'

export type TipoColuna = 'texto' | 'numero' | 'moeda' | 'data'

export interface ColunaExcel {
  key: string
  label: string
  tipo?: TipoColuna
  largura?: number
  // Soma a coluna na linha de total (so faz sentido para numero/moeda).
  somar?: boolean
}

export interface PlanilhaOpts {
  // Titulo da aba e do relatorio (ex.: "Notas Fiscais").
  titulo: string
  // Subtitulo opcional (ex.: "Donana Rio Vermelho · 19/05/2026 a 18/06/2026").
  subtitulo?: string
  // Liga o AutoFiltro do Excel no cabecalho (dropdowns de filtrar/ordenar por
  // coluna). Ideal para planilhas de detalhe que a pessoa vai fatiar na mao.
  autoFiltro?: boolean
}

/**
 * Gera um arquivo .xlsx formatado (cabecalho com cor de marca, zebra, larguras,
 * formato de moeda/data pt-BR e linha de totais) a partir de linhas + colunas.
 * Retorna o buffer pronto para download. Substitui o CSV cru por uma planilha
 * de verdade, bem feita.
 */
// Uma aba do arquivo (para gerarPlanilha e gerarPlanilhaMulti).
export interface AbaPlanilha {
  rows: Record<string, unknown>[]
  colunas: ColunaExcel[]
  opts: PlanilhaOpts
  // Nome da aba (default: opts.titulo). Útil quando o título é longo.
  nome?: string
}

export async function gerarPlanilha(
  rows: Record<string, unknown>[],
  colunas: ColunaExcel[],
  opts: PlanilhaOpts,
): Promise<Buffer> {
  return gerarPlanilhaMulti([{ rows, colunas, opts }])
}

/**
 * Gera um .xlsx com VÁRIAS abas (ex.: "Resumo" + "Detalhado"). Cada aba tem o
 * mesmo padrão de gerarPlanilha (cabeçalho de marca, zebra, totais, AutoFiltro).
 */
export async function gerarPlanilhaMulti(abas: AbaPlanilha[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'NTB Estoque'
  wb.created = new Date()
  const usados = new Set<string>()
  for (const aba of abas) {
    // Nome da aba: Excel limita a 31 chars, proibe alguns caracteres e exige unico.
    let nomeAba = (aba.nome ?? aba.opts.titulo).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Relatório'
    let n = 2
    while (usados.has(nomeAba.toLowerCase())) nomeAba = `${nomeAba.slice(0, 28)} ${n++}`
    usados.add(nomeAba.toLowerCase())
    montarAba(wb.addWorksheet(nomeAba, { views: [{ state: 'frozen', ySplit: aba.opts.subtitulo ? 3 : 2 }] }), aba)
  }
  const arrayBuffer = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

// Preenche uma worksheet já criada com título, cabeçalho, dados, totais e filtro.
function montarAba(ws: ExcelJS.Worksheet, { rows, colunas, opts }: AbaPlanilha): void {
  const totalCols = colunas.length

  // Linha 1: titulo (mesclado em todas as colunas).
  ws.mergeCells(1, 1, 1, totalCols)
  const cTitulo = ws.getCell(1, 1)
  cTitulo.value = opts.titulo
  cTitulo.font = { bold: true, size: 14, color: { argb: 'FF111111' } }
  cTitulo.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 22

  let linhaCabecalho = 2
  if (opts.subtitulo) {
    ws.mergeCells(2, 1, 2, totalCols)
    const cSub = ws.getCell(2, 1)
    cSub.value = opts.subtitulo
    cSub.font = { size: 9, color: { argb: 'FF6B7280' } }
    linhaCabecalho = 3
  }

  // Linha de cabecalho das colunas (fundo da marca, texto branco).
  const header = ws.getRow(linhaCabecalho)
  colunas.forEach((col, i) => {
    const cell = header.getCell(i + 1)
    cell.value = col.label
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
    cell.alignment = {
      vertical: 'middle',
      horizontal: col.tipo === 'numero' || col.tipo === 'moeda' ? 'right' : 'left',
    }
    cell.border = { bottom: { style: 'thin', color: { argb: BRAND } } }
  })
  header.height = 18

  // Linhas de dados.
  const fmtMoeda = '"R$" #,##0.00'
  const fmtNumero = '#,##0.###'
  rows.forEach((row, idx) => {
    const r = ws.getRow(linhaCabecalho + 1 + idx)
    colunas.forEach((col, i) => {
      const cell = r.getCell(i + 1)
      const valor = row[col.key]
      if (col.tipo === 'moeda') {
        cell.value = typeof valor === 'number' ? valor : Number(valor) || 0
        cell.numFmt = fmtMoeda
        cell.alignment = { horizontal: 'right' }
      } else if (col.tipo === 'numero') {
        cell.value = typeof valor === 'number' ? valor : Number(valor) || 0
        cell.numFmt = fmtNumero
        cell.alignment = { horizontal: 'right' }
      } else {
        cell.value = valor == null ? '' : String(valor)
      }
      cell.font = { size: 9.5 }
      cell.border = { bottom: { style: 'hair', color: { argb: BORDA } } }
      // Zebra discreta nas linhas pares.
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFC' } }
      }
    })
  })

  // Linha de totais (so se alguma coluna pede soma).
  const colunasSoma = colunas.filter((c) => c.somar)
  if (colunasSoma.length && rows.length) {
    const r = ws.getRow(linhaCabecalho + 1 + rows.length)
    colunas.forEach((col, i) => {
      const cell = r.getCell(i + 1)
      if (i === 0) {
        cell.value = `Total (${rows.length})`
        cell.font = { bold: true, size: 10 }
      } else if (col.somar) {
        const soma = rows.reduce((acc, row) => acc + (Number(row[col.key]) || 0), 0)
        cell.value = soma
        cell.numFmt = col.tipo === 'moeda' ? fmtMoeda : fmtNumero
        cell.font = { bold: true, size: 10 }
        cell.alignment = { horizontal: 'right' }
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } }
      cell.border = { top: { style: 'thin', color: { argb: 'FF111111' } } }
    })
    r.height = 16
  }

  // Larguras das colunas (usa a definida ou estima pelo conteudo, com limites).
  colunas.forEach((col, i) => {
    let largura = col.largura
    if (!largura) {
      const maxConteudo = rows.reduce((max, row) => {
        const s = row[col.key] == null ? '' : String(row[col.key])
        return Math.max(max, s.length)
      }, col.label.length)
      largura = Math.min(Math.max(maxConteudo + 2, 10), 48)
    }
    ws.getColumn(i + 1).width = largura
  })

  // AutoFiltro no cabecalho: dropdowns de filtrar/ordenar por coluna no Excel.
  if (opts.autoFiltro) {
    ws.autoFilter = {
      from: { row: linhaCabecalho, column: 1 },
      to: { row: linhaCabecalho, column: totalCols },
    }
  }
}

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "2026-01" -> "jan/26". */
export function mesLabelCurto(ym: string): string {
  const [a, m] = ym.split('-')
  return `${MESES_ABREV[Number(m) - 1] ?? m}/${(a ?? '').slice(2)}`
}

/**
 * Monta uma aba de MATRIZ MENSAL (linha = rótulo, colunas = meses + Total + %),
 * no mesmo padrão das planilhas DRV do Ramon, a partir do formato longo
 * (rotulo, mes 'YYYY-MM', valor). AutoFiltro ligado. Use em gerarPlanilhaMulti.
 */
export function abaMatrizMensal(params: {
  titulo: string
  dimLabel: string
  linhas: { rotulo: string; mes: string; valor: number }[]
  subtitulo?: string
  nome?: string
  moeda?: boolean // colunas em R$ (default) vs número
  pct?: boolean // adiciona coluna "%" do total geral (default true)
}): AbaPlanilha {
  const { titulo, dimLabel, linhas, subtitulo, nome } = params
  const moeda = params.moeda !== false
  const comPct = params.pct !== false

  const meses = [...new Set(linhas.map((l) => l.mes))].sort()
  const porRotulo = new Map<string, Record<string, number>>()
  let totalGeral = 0
  for (const l of linhas) {
    const ent = porRotulo.get(l.rotulo) ?? {}
    const v = Number(l.valor) || 0
    ent[l.mes] = (ent[l.mes] ?? 0) + v
    porRotulo.set(l.rotulo, ent)
    totalGeral += v
  }

  const colunas: ColunaExcel[] = [{ key: 'rotulo', label: dimLabel, tipo: 'texto' }]
  for (const m of meses) colunas.push({ key: m, label: mesLabelCurto(m), tipo: moeda ? 'moeda' : 'numero', somar: true })
  colunas.push({ key: '__total', label: 'Total', tipo: moeda ? 'moeda' : 'numero', somar: true })
  if (comPct) colunas.push({ key: '__pct', label: '%', tipo: 'texto' })

  const rows = [...porRotulo.entries()]
    .map(([rotulo, mm]) => {
      const total = meses.reduce((s, m) => s + (mm[m] ?? 0), 0)
      const row: Record<string, unknown> = { rotulo }
      for (const m of meses) row[m] = mm[m] ?? 0
      row.__total = total
      if (comPct) row.__pct = totalGeral > 0 ? `${((total / totalGeral) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-'
      return { row, total }
    })
    .sort((a, b) => b.total - a.total)
    .map((x) => x.row)

  return { rows, colunas, opts: { titulo, subtitulo, autoFiltro: true }, nome }
}

/**
 * Monta a Response de download para o .xlsx gerado.
 */
export function planilhaResponse(nome: string, buffer: Buffer): Response {
  const nomeArquivo = nome.endsWith('.xlsx') ? nome : `${nome}.xlsx`
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
    },
  })
}
