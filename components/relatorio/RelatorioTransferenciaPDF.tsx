import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape } from './PdfChrome'

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  table: { width: '100%' },
  thead: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 3, paddingVertical: 5, paddingHorizontal: 4, marginBottom: 2 },
  tr: { flexDirection: 'row', borderBottom: 0.5, borderColor: '#e5e7eb', paddingVertical: 3.5, paddingHorizontal: 4 },
  trAlt: { backgroundColor: '#fafafa' },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#374151', textTransform: 'uppercase' },
  td: { fontSize: 8.5 },
  total: { flexDirection: 'row', marginTop: 8, paddingTop: 4, paddingHorizontal: 4, borderTop: 1, borderColor: '#111' },
  totTxt: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#111' },
  cData: { width: '18%' },
  cOrigem: { width: '30%' },
  cDestino: { width: '30%' },
  cProdutos: { width: '12%', textAlign: 'right' },
  cStatus: { width: '10%' },
})

export interface RelatorioTransferenciaItem {
  data: string
  origem: string
  destino: string
  produtos: number
  status: string
}

export function RelatorioTransferenciaPDF({
  loja,
  periodo,
  transferencias,
}: {
  loja: string
  periodo: string
  transferencias: RelatorioTransferenciaItem[]
}) {
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatório de Transferências" sub={`${loja} · Período: ${periodo}`} />

        <View style={s.table}>
          <View style={s.thead} fixed>
            <Text style={[s.th, s.cData]}>Data</Text>
            <Text style={[s.th, s.cOrigem]}>Origem</Text>
            <Text style={[s.th, s.cDestino]}>Destino</Text>
            <Text style={[s.th, s.cProdutos]}>Produtos</Text>
            <Text style={[s.th, s.cStatus]}>Status</Text>
          </View>
          {transferencias.map((t, i) => (
            <View key={i} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
              <Text style={[s.td, s.cData]}>{t.data}</Text>
              <Text style={[s.td, s.cOrigem]}>{t.origem}</Text>
              <Text style={[s.td, s.cDestino]}>{t.destino}</Text>
              <Text style={[s.td, s.cProdutos]}>{t.produtos}</Text>
              <Text style={[s.td, s.cStatus]}>{t.status}</Text>
            </View>
          ))}
          <View style={s.total} wrap={false}>
            <Text style={[s.totTxt, { width: '90%' }]}>
              Total ({transferencias.length} transferências)
            </Text>
            <Text style={[s.totTxt, { width: '10%' }]} />
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
