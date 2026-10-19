import ExcelJS from 'exceljs'
import { COLUNAS_MODELO } from './importar-pedidos-puro'

// Modelo da planilha de importação de pedidos de compra: aba "Pedidos" (cabeçalho + 2 linhas de exemplo) e aba
// "Instruções" (o que vai em cada coluna). A leitura ignora a aba de instruções.
export async function gerarModeloPedidos(exemplo?: { codigo: string; fornecedor: string | null; cnpj: string | null }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Pedidos')
  ws.columns = COLUNAS_MODELO.map((c) => ({ header: c.titulo, key: c.campo, width: Math.max(14, c.titulo.length + 4) }))
  const ex = COLUNAS_MODELO.map((c) => {
    if (exemplo && c.campo === 'produto') return exemplo.codigo
    if (exemplo?.fornecedor && c.campo === 'fornecedorNome') return exemplo.fornecedor
    if (exemplo && c.campo === 'fornecedorCnpj') return exemplo.cnpj ?? ''
    return c.exemplo
  })
  ws.addRow(ex)
  ws.addRow(ex.map((v, i) => (['pedido', 'produto', 'quantidade', 'preco'].includes(COLUNAS_MODELO[i].campo) ? v : '')))
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C8D99' } }
  for (const c of ['A', 'B', 'E', 'K', 'L']) ws.getColumn(c).numFmt = '@'   // texto: código e CNPJ não perdem o zero à esquerda; "30/60" não vira data
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const inst = wb.addWorksheet('Instruções')
  inst.columns = [{ header: 'Coluna', key: 'c', width: 28 }, { header: 'O que preencher', key: 'a', width: 90 }]
  inst.getRow(1).font = { bold: true }
  for (const c of COLUNAS_MODELO) inst.addRow({ c: c.titulo, a: c.ajuda })
  inst.addRow({})
  inst.addRow({ c: 'Regras', a: 'Uma linha = um item. Apague as linhas de exemplo. Os pedidos entram como rascunho: confira e envie para aprovação.' })
  inst.addRow({ c: '', a: 'Se alguma linha tiver erro, nada é importado: a tela mostra a linha e o motivo. Enviar o mesmo arquivo de novo não duplica.' })
  const ab = await wb.xlsx.writeBuffer()
  return Buffer.from(ab as ArrayBuffer)
}
