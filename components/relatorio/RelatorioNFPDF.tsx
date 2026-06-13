import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', color: '#000' },
  titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#444', marginBottom: 12 },
  table: { width: '100%' },
  thead: { flexDirection: 'row', borderBottom: 1, borderColor: '#000', paddingBottom: 3 },
  tr: { flexDirection: 'row', borderBottom: 0.5, borderColor: '#ccc', paddingVertical: 3 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  cEmissao: { width: '15%' },
  cNumero: { width: '15%' },
  cForn: { width: '45%' },
  cValor: { width: '25%', textAlign: 'right' },
  total: { flexDirection: 'row', marginTop: 8, paddingTop: 4, borderTop: 1, borderColor: '#000' },
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
        <Text style={s.titulo}>Relatório de Notas Fiscais</Text>
        <Text style={s.sub}>
          {loja} · Período: {periodo}
        </Text>

        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.cEmissao]}>Emissão</Text>
            <Text style={[s.th, s.cNumero]}>Número</Text>
            <Text style={[s.th, s.cForn]}>Fornecedor</Text>
            <Text style={[s.th, s.cValor]}>Valor</Text>
          </View>
          {notas.map((n, i) => (
            <View key={i} style={s.tr}>
              <Text style={s.cEmissao}>{n.emissao}</Text>
              <Text style={s.cNumero}>{n.numero}</Text>
              <Text style={s.cForn}>{n.fornecedor}</Text>
              <Text style={s.cValor}>{moeda(n.valor)}</Text>
            </View>
          ))}
          <View style={s.total}>
            <Text style={[s.th, { width: '75%' }]}>Total ({notas.length} notas)</Text>
            <Text style={[s.th, { width: '25%', textAlign: 'right' }]}>{moeda(total)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
