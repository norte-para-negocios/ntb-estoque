import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape } from './PdfChrome'

const BRAND = '#1c8d99'

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  resumo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f3fafb',
    border: 0.5,
    borderColor: '#cfeaee',
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
  },
  resumoBox: { flexDirection: 'column' },
  resumoLabel: { fontSize: 7, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 },
  resumoValor: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#111', marginTop: 2 },
  resumoValorBrand: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND, marginTop: 2 },
  table: { width: '100%' },
  thead: { flexDirection: 'row', backgroundColor: BRAND, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 4, marginBottom: 2 },
  tr: { flexDirection: 'row', borderBottom: 0.5, borderColor: '#e5e7eb', paddingVertical: 3.5, paddingHorizontal: 4 },
  trAlt: { backgroundColor: '#fafafa' },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#ffffff', textTransform: 'uppercase' },
  td: { fontSize: 8.5 },
  tdMuted: { fontSize: 8.5, color: '#6b7280' },
  total: { flexDirection: 'row', marginTop: 8, paddingTop: 4, paddingHorizontal: 4, borderTop: 1, borderColor: '#111' },
  totTxt: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#111' },
  cEmissao: { width: '13%' },
  cNumero: { width: '15%' },
  cForn: { width: '40%' },
  cEtapa: { width: '13%' },
  cValor: { width: '19%', textAlign: 'right' },
})

export interface RelatorioNFItem {
  emissao: string
  numero: string
  fornecedor: string
  etapa?: string
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

        {/* Resumo do periodo no topo (espelha os totalizadores da tela). */}
        <View style={s.resumo}>
          <View style={s.resumoBox}>
            <Text style={s.resumoLabel}>Período</Text>
            <Text style={s.resumoValor}>{periodo}</Text>
          </View>
          <View style={s.resumoBox}>
            <Text style={s.resumoLabel}>Notas</Text>
            <Text style={s.resumoValor}>{notas.length}</Text>
          </View>
          <View style={[s.resumoBox, { alignItems: 'flex-end' }]}>
            <Text style={s.resumoLabel}>Total</Text>
            <Text style={s.resumoValorBrand}>{moeda(total)}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.thead} fixed>
            <Text style={[s.th, s.cEmissao]}>Emissão</Text>
            <Text style={[s.th, s.cNumero]}>Número</Text>
            <Text style={[s.th, s.cForn]}>Fornecedor</Text>
            <Text style={[s.th, s.cEtapa]}>Etapa</Text>
            <Text style={[s.th, s.cValor]}>Valor</Text>
          </View>
          {notas.map((n, i) => (
            <View key={i} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
              <Text style={[s.tdMuted, s.cEmissao]}>{n.emissao}</Text>
              <Text style={[s.td, s.cNumero]}>{n.numero}</Text>
              <Text style={[s.td, s.cForn]}>{n.fornecedor}</Text>
              <Text style={[s.tdMuted, s.cEtapa]}>{n.etapa ?? '-'}</Text>
              <Text style={[s.td, s.cValor]}>{moeda(n.valor)}</Text>
            </View>
          ))}
          <View style={s.total} wrap={false}>
            <Text style={[s.totTxt, { width: '81%' }]}>Total ({notas.length} {notas.length === 1 ? 'nota' : 'notas'})</Text>
            <Text style={[s.totTxt, { width: '19%', textAlign: 'right' }]}>{moeda(total)}</Text>
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
