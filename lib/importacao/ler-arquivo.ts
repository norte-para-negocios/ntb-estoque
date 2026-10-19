// Leitura da planilha enviada (Fase G [K10/O6]): .xlsx (1ª aba) ou .csv. Devolve as linhas como texto (o mesmo que a
// pessoa vê na célula); a validação é toda em planilha-puro.ts.
import ExcelJS from 'exceljs'
import { lerCsv } from './planilha-puro'

export const LIMITE_PLANILHA_BYTES = 900 * 1024 // abaixo do limite de 1 MB do corpo das server actions
export const LIMITE_LINHAS = 2000

function decodificarTexto(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  // planilha salva pelo Excel em "CSV (separado por vírgulas)" costuma vir em Windows-1252
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8
}

export async function lerArquivoPlanilha(nome: string, bytes: Uint8Array): Promise<{ linhas: string[][] } | { error: string }> {
  const ext = nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (ext === 'csv' || ext === 'txt') return { linhas: lerCsv(decodificarTexto(bytes)) }
  if (ext !== 'xlsx') return { error: 'Envie a planilha em .xlsx ou .csv (o modelo para baixar está nesta tela).' }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return { error: 'O arquivo não é uma planilha .xlsx válida.' }
  try {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer)
    const ws = wb.worksheets[0]
    if (!ws) return { error: 'A planilha está vazia.' }
    const linhas: string[][] = []
    // posição = número da linha no Excel (linha em branco no meio continua contando, para o erro apontar a linha certa)
    ws.eachRow({ includeEmpty: true }, (row) => {
      const valores: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, col) => { valores[col - 1] = (cell.text ?? '').trim() })
      linhas[row.number - 1] = Array.from(valores, (v) => v ?? '')
    })
    return { linhas: Array.from(linhas, (l) => l ?? []) }
  } catch {
    return { error: 'Não foi possível ler a planilha. Salve de novo como .xlsx e tente outra vez.' }
  }
}
