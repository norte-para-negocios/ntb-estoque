// Modelo .xlsx da importação por planilha (Fase G): aba com o cabeçalho + 1 linha de exemplo e aba "Instruções".
import ExcelJS from 'exceljs'
import { COLUNAS, type TipoImportacao } from './planilha-puro'

export async function modeloPlanilha(tipo: TipoImportacao): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const cols = COLUNAS[tipo]
  const ws = wb.addWorksheet(tipo === 'produtos' ? 'Produtos' : 'Fornecedores')
  ws.columns = cols.map((c) => ({ header: c.titulo, key: c.chave, width: Math.max(14, c.titulo.length + 4) }))
  ws.getRow(1).font = { bold: true }
  ws.addRow(Object.fromEntries(cols.map((c) => [c.chave, c.exemplo])))
  // códigos com zero à esquerda (NCM, EAN, CEST, CNPJ, CEP) ficam como texto
  for (const c of cols) ws.getColumn(c.chave).numFmt = '@'
  const inst = wb.addWorksheet('Instruções')
  inst.columns = [{ header: 'Coluna', key: 'coluna', width: 22 }, { header: 'Obrigatória', key: 'obrigatoria', width: 14 }, { header: 'Como preencher', key: 'ajuda', width: 90 }]
  inst.getRow(1).font = { bold: true }
  for (const c of cols) inst.addRow({ coluna: c.titulo, obrigatoria: c.obrigatoria ? 'sim (no novo)' : '', ajuda: c.ajuda })
  inst.addRow({})
  inst.addRow({ coluna: 'Regras', ajuda: 'A 1ª linha é o cabeçalho. Célula vazia não apaga nada. Se o registro já existir, só os campos preenchidos são atualizados.' })
  inst.addRow({ ajuda: tipo === 'produtos'
    ? 'O produto é encontrado pelo código; sem código, pelo EAN; sem os dois, pela descrição.'
    : 'O fornecedor é encontrado pelo CNPJ/CPF; sem ele, pela razão social.' })
  inst.addRow({ ajuda: 'Antes de gravar a tela mostra a prévia linha a linha; linhas com erro ficam de fora.' })
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export function respostaModelo(tipo: TipoImportacao, buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="modelo-importacao-${tipo}.xlsx"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
