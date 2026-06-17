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
  cEmissao: { width: '15%' },
  cNumero: { width: '15%' },
  cForn: { width: '45%' },
  cValor: { width: '25%', textAlign: 'right' },
})

export interface RelatorioNFItem {
  emissao: string
  numero: string
  fornecedor: string
  valor: number
}

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function RelatorioNFPDF({
  loja,
  periodo,
  notas,
}: {
  loja: string
  periodo: string
  notas: RelatorioNFItem[]
}) {
  const total = notas.reduce((acc, n) => acc + n.valor, 0)
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatório de Notas Fiscais" sub={`${loja} · Período: ${periodo}`} />

        <View style={s.table}>
          <View style={s.thead} fixed>
            <Text style={[s.th, s.cEmissao]}>Emissão</Text>
            <Text style={[s.th, s.cNumero]}>Número</Text>
            <Text style={[s.th, s.cForn]}>Fornecedor</Text>
            <Text style={[s.th, s.cValor]}>Valor</Text>
          </View>
          {notas.map((n, i) => (
            <View key={i} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
              <Text style={[s.td, s.cEmissao]}>{n.emissao}</Text>
              <Text style={[s.td, s.cNumero]}>{n.numero}</Text>
              <Text style={[s.td, s.cForn]}>{n.fornecedor}</Text>
              <Text style={[s.td, s.cValor]}>{moeda(n.valor)}</Text>
            </View>
          ))}
          <View style={s.total} wrap={false}>
            <Text style={[s.totTxt, { width: '75%' }]}>Total ({notas.length} notas)</Text>
            <Text style={[s.totTxt, { width: '25%', textAlign: 'right' }]}>{moeda(total)}</Text>
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
