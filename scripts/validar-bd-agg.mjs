// Validação: agrega a aba BD do MOV_DRV por (origem × tipo) e por perdas (manual
// saída), e cruza com os números do Ramon. NÃO grava nada. Streaming p/ aguentar
// 935k linhas / 160MB.
import ExcelJS from 'exceljs'
const FILE = process.argv[2] || 'C:/Users/media/Downloads/MOV_DRV_2026 - 1SEM.xlsx'
const reader = new ExcelJS.stream.xlsx.WorkbookReader(FILE, { worksheets: 'emit', sharedStrings: 'cache', styles: 'ignore' })

const txt = (v) => {
  if (v == null) return ''
  if (typeof v === 'object') {
    if ('result' in v) v = v.result
    else if ('text' in v) v = v.text
    else if ('richText' in v) v = v.richText.map((r) => r.text).join('')
  }
  return String(v).trim()
}
const numOf = (v) => {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'result' in v) return Number(v.result) || 0
  const s = txt(v).replace(/[^\d,.-]/g, '')
  if (!s) return 0
  return s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
}

// colunas (1-based) confirmadas: 1 Origem, 25 Mês, 26 Tipo, 27 Qtde, 28 Valor,
// 30 Local, 32 Motivo
const C = { origem: 1, tipoSped: 9, mes: 25, tipo: 26, qtde: 27, valor: 28, local: 30, motivo: 32 }

const porOrigemTipo = new Map() // "origem | tipo" -> {qtde, valor, n}
const perdasPorLocal = new Map() // local -> valor  (manual saída, sem inventário)
let manualSaidaTotal = 0, manualSaidaInvTotal = 0
let totalLinhas = 0

for await (const ws of reader) {
  if (ws.name !== 'BD') { for await (const _ of ws) {} ; continue }
  let rn = 0
  for await (const row of ws) {
    rn++
    if (rn === 1) continue // header
    totalLinhas++
    const origem = txt(row.getCell(C.origem).value)
    const tipo = txt(row.getCell(C.tipo).value) // "2.Entrada" / "3.Saída"
    const valor = numOf(row.getCell(C.valor).value)
    const qtde = numOf(row.getCell(C.qtde).value)
    const local = txt(row.getCell(C.local).value)
    const motivo = txt(row.getCell(C.motivo).value)

    const k = `${origem} | ${tipo}`
    const e = porOrigemTipo.get(k) ?? { qtde: 0, valor: 0, n: 0 }
    e.qtde += qtde; e.valor += valor; e.n++
    porOrigemTipo.set(k, e)

    const ehSaida = /sa[ií]da/i.test(tipo)
    if (origem === 'Movimento Manual de Estoque' && ehSaida) {
      const ehInv = /invent/i.test(motivo)
      if (ehInv) manualSaidaInvTotal += valor
      else {
        manualSaidaTotal += valor
        perdasPorLocal.set(local, (perdasPorLocal.get(local) ?? 0) + valor)
      }
    }
    if (rn % 200000 === 0) console.error(`  ...${rn}`)
  }
}

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
console.log(`\n=== BD: ${totalLinhas} linhas de movimento ===\n`)
console.log('=== POR ORIGEM × TIPO (valor R$) ===')
for (const [k, v] of [...porOrigemTipo.entries()].sort((a, b) => b[1].valor - a[1].valor)) {
  console.log(`  ${brl(v.valor).padStart(18)}  ${v.n.toString().padStart(7)} mov  ${k}`)
}
console.log('\n=== PERDAS (Movimento Manual de Estoque · Saída, SEM ajuste de inventário) ===')
console.log(`  Total perdas: ${brl(manualSaidaTotal)}`)
console.log(`  (Manual saída por ajuste de inventário, à parte: ${brl(manualSaidaInvTotal)})`)
console.log('\n  Por local:')
for (const [l, v] of [...perdasPorLocal.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${brl(v).padStart(16)}  ${l}`)
}
