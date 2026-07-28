import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'
import { statusInfo } from '@/lib/status-cor'

const col = StyleSheet.create({
  num:         { width: '10%' },
  local:       { width: '26%' },
  data:        { width: '16%' },
  responsavel: { width: '25%' },
  itens:       { width: '10%', textAlign: 'right' },
  status:      { width: '13%' },
})

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
})

export interface RelatorioInventarioItem {
  num: string
  local: string
  data: string
  responsavel: string
  itens: number
  status: string
}

export function RelatorioInventarioPDF({
  loja,
  periodo,
  filtros,
  inventarios,
}: {
  loja: string
  periodo: string
  filtros?: string
  inventarios: RelatorioInventarioItem[]
}) {
  const sub = [loja, `Período: ${periodo}`, filtros].filter(Boolean).join(' · ')
  const totalItens = inventarios.reduce((acc, i) => acc + i.itens, 0)

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatório de Inventários" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Período', valor: periodo },
            { label: 'Inventários', valor: String(inventarios.length) },
            { label: 'Total de itens contados', valor: String(totalItens) },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            <Text style={[pdfTabela.th, col.num]}>Nº</Text>
            <Text style={[pdfTabela.th, col.local]}>Local</Text>
            <Text style={[pdfTabela.th, col.data]}>Data</Text>
            <Text style={[pdfTabela.th, col.responsavel]}>Responsável</Text>
            <Text style={[pdfTabela.th, col.itens]}>Itens</Text>
            <Text style={[pdfTabela.th, col.status]}>Status</Text>
          </View>

          {inventarios.map((inv, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.tdMuted, col.num]}>{inv.num}</Text>
              <Text style={[pdfTabela.td, col.local]}>{inv.local}</Text>
              <Text style={[pdfTabela.tdMuted, col.data]}>{inv.data}</Text>
              <Text style={[pdfTabela.td, col.responsavel]}>{inv.responsavel}</Text>
              <Text style={[pdfTabela.td, col.itens]}>{inv.itens}</Text>
              <Text style={[pdfTabela.td, col.status]}>{statusInfo(inv.status).label}</Text>
            </View>
          ))}

          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>
              Total ({inventarios.length} {inventarios.length === 1 ? 'inventário' : 'inventários'})
            </Text>
            <Text style={[pdfTabela.totalTxt, col.itens, { textAlign: 'right' }]}>{totalItens}</Text>
            <Text style={[pdfTabela.totalTxt, col.status]} />
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
