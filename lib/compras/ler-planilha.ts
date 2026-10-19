import ExcelJS from 'exceljs'
import { lerCsv, LIMITES_IMPORTACAO, type Celula } from './importar-pedidos-puro'

// Lê a planilha enviada (.xlsx ou .csv) como matriz de células para validarImportacao. Só no servidor.

export const TAMANHO_MAX_PLANILHA = 600 * 1024

function valorDaCelula(v: ExcelJS.CellValue): Celula {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return valorDaCelula((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue)
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('error' in v) return null
  }
  return null
}

export async function lerPlanilha(buf: Buffer): Promise<Celula[][] | { erro: string }> {
  if (!buf.length) return { erro: 'Arquivo vazio.' }
  if (buf.length > TAMANHO_MAX_PLANILHA) return { erro: 'Arquivo grande demais (máximo 600 KB). Divida a planilha.' }
  const ehXlsx = buf[0] === 0x50 && buf[1] === 0x4b   // "PK": zip do .xlsx
  if (!ehXlsx) {
    let txt = new TextDecoder('utf-8').decode(buf)
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf)   // CSV salvo pelo Excel em português
    if (/[\x00-\x08]/.test(txt.slice(0, 2000))) return { erro: 'Formato não reconhecido: envie .xlsx ou .csv.' }
    const linhas = lerCsv(txt)
    return linhas.length > LIMITES_IMPORTACAO.linhas + 10 ? { erro: `No máximo ${LIMITES_IMPORTACAO.linhas} linhas por planilha. Divida o arquivo.` } : linhas
  }
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
  } catch {
    return { erro: 'Não consegui abrir a planilha. Salve como .xlsx (Excel) ou .csv e tente de novo.' }
  }
  const ws = wb.worksheets.find((w) => !/instru/i.test(w.name)) ?? wb.worksheets[0]
  if (!ws) return { erro: 'A planilha não tem abas.' }
  if (ws.actualRowCount > LIMITES_IMPORTACAO.linhas + 10) return { erro: `No máximo ${LIMITES_IMPORTACAO.linhas} linhas por planilha. Divida o arquivo.` }
  const m: Celula[][] = []
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const linha: Celula[] = []
    for (let c = 1; c <= Math.min(row.cellCount, 40); c++) linha.push(valorDaCelula(row.getCell(c).value))
    m[r - 1] = linha
  })
  return Array.from(m, (l) => l ?? [])
}
