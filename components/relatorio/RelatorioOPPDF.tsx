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
  cOP: { width: '15%' },
  cProduto: { width: '40%' },
  cQtd: { width: '15%', textAlign: 'right' },
  cValidade: { width: '15%' },
  cStatus: { width: '15%' },
})

export interface RelatorioOPItem {
  numOP: string
  produto: string
  quantidade: string
  validade: string
  status: string
}

export function RelatorioOPPDF({
  loja,
  periodo,
  ordens,
}: {
  loja: string
  periodo: string
  ordens: RelatorioOPItem[]
}) {
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatório de Ordens de Produção" sub={`${loja} · ${periodo}`} />

        <View style={s.table}>
          <View style={s.thead} fixed>
            <Text style={[s.th, s.cOP]}>Nº OP</Text>
            <Text style={[s.th, s.cProduto]}>Produto</Text>
            <Text style={[s.th, s.cQtd]}>Quantidade</Text>
            <Text style={[s.th, s.cValidade]}>Validade</Text>
            <Text style={[s.th, s.cStatus]}>Status</Text>
          </View>
          {ordens.map((o, i) => (
            <View key={i} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
              <Text style={[s.td, s.cOP]}>{o.numOP}</Text>
              <Text style={[s.td, s.cProduto]}>{o.produto}</Text>
              <Text style={[s.td, s.cQtd]}>{o.quantidade}</Text>
              <Text style={[s.td, s.cValidade]}>{o.validade}</Text>
              <Text style={[s.td, s.cStatus]}>{o.status}</Text>
            </View>
          ))}
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
