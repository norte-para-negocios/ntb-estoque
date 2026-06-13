import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', color: '#000' },
  titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#444', marginBottom: 12 },
  table: { width: '100%' },
  thead: { flexDirection: 'row', borderBottom: 1, borderColor: '#000', paddingBottom: 3 },
  tr: { flexDirection: 'row', borderBottom: 0.5, borderColor: '#ccc', paddingVertical: 3 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
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
        <Text style={s.titulo}>Relatório de Ordens de Produção</Text>
        <Text style={s.sub}>
          {loja} · {periodo}
        </Text>

        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.cOP]}>Nº OP</Text>
            <Text style={[s.th, s.cProduto]}>Produto</Text>
            <Text style={[s.th, s.cQtd]}>Quantidade</Text>
            <Text style={[s.th, s.cValidade]}>Validade</Text>
            <Text style={[s.th, s.cStatus]}>Status</Text>
          </View>
          {ordens.map((o, i) => (
            <View key={i} style={s.tr}>
              <Text style={s.cOP}>{o.numOP}</Text>
              <Text style={s.cProduto}>{o.produto}</Text>
              <Text style={s.cQtd}>{o.quantidade}</Text>
              <Text style={s.cValidade}>{o.validade}</Text>
              <Text style={s.cStatus}>{o.status}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}
