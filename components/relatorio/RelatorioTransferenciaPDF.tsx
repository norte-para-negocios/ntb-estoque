import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'

// Colunas: somam 96% para garantir paddingRight entre elas sem colisao.
const col = StyleSheet.create({
  data:     { width: '16%' },
  origem:   { width: '26%' },
  destino:  { width: '26%' },
  motivo:   { width: '16%' },
  produtos: { width: '7%', textAlign: 'right' },
  status:   { width: '9%' },
})

const s = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 28,
    paddingBottom: 44,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111',
  },
})

export interface RelatorioTransferenciaItem {
  data: string
  origem: string
  destino: string
  motivo?: string
  produtos: number
  status: string
}

export function RelatorioTransferenciaPDF({
  loja,
  periodo,
  filtros,
  transferencias,
}: {
  loja: string
  periodo: string
  filtros?: string
  transferencias: RelatorioTransferenciaItem[]
}) {
  const sub = [loja, `Periodo: ${periodo}`, filtros].filter(Boolean).join(' · ')
  const total = transferencias.reduce((acc, t) => acc + t.produtos, 0)
  const haMotivo = transferencias.some((t) => t.motivo)

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatorio de Transferencias" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Periodo', valor: periodo },
            { label: 'Transferencias', valor: String(transferencias.length) },
            { label: 'Total de itens', valor: String(total) },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            <Text style={[pdfTabela.th, col.data]}>Data</Text>
            <Text style={[pdfTabela.th, col.origem]}>Origem</Text>
            <Text style={[pdfTabela.th, col.destino]}>Destino</Text>
            {haMotivo ? <Text style={[pdfTabela.th, col.motivo]}>Motivo</Text> : null}
            <Text style={[pdfTabela.th, col.produtos]}>Itens</Text>
            <Text style={[pdfTabela.th, col.status]}>Status</Text>
          </View>

          {transferencias.map((t, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.tdMuted, col.data]}>{t.data}</Text>
              <Text style={[pdfTabela.td, col.origem]}>{t.origem}</Text>
              <Text style={[pdfTabela.td, col.destino]}>{t.destino}</Text>
              {haMotivo ? <Text style={[pdfTabela.tdMuted, col.motivo]}>{t.motivo ?? '-'}</Text> : null}
              <Text style={[pdfTabela.td, col.produtos]}>{t.produtos}</Text>
              <Text style={[pdfTabela.td, col.status]}>{t.status}</Text>
            </View>
          ))}

          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>
              Total ({transferencias.length} {transferencias.length === 1 ? 'transferencia' : 'transferencias'})
            </Text>
            <Text style={[pdfTabela.totalTxt, col.produtos, { textAlign: 'right' }]}>{total}</Text>
            <Text style={[pdfTabela.totalTxt, col.status]} />
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
