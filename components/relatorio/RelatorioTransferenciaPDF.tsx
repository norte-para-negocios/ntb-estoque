import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', color: '#000' },
  titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#444', marginBottom: 12 },
  table: { width: '100%' },
  thead: { flexDirection: 'row', borderBottom: 1, borderColor: '#000', paddingBottom: 3 },
  tr: { flexDirection: 'row', borderBottom: 0.5, borderColor: '#ccc', paddingVertical: 3 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  cData: { width: '18%' },
  cOrigem: { width: '30%' },
  cDestino: { width: '30%' },
  cProdutos: { width: '12%', textAlign: 'right' },
  cStatus: { width: '10%' },
  total: { flexDirection: 'row', marginTop: 8, paddingTop: 4, borderTop: 1, borderColor: '#000' },
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
        <Text style={s.titulo}>Relatório de Transferências</Text>
        <Text style={s.sub}>
          {loja} · Período: {periodo}
        </Text>

        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.cData]}>Data</Text>
            <Text style={[s.th, s.cOrigem]}>Origem</Text>
            <Text style={[s.th, s.cDestino]}>Destino</Text>
            <Text style={[s.th, s.cProdutos]}>Produtos</Text>
            <Text style={[s.th, s.cStatus]}>Status</Text>
          </View>
          {transferencias.map((t, i) => (
            <View key={i} style={s.tr}>
              <Text style={s.cData}>{t.data}</Text>
              <Text style={s.cOrigem}>{t.origem}</Text>
              <Text style={s.cDestino}>{t.destino}</Text>
              <Text style={s.cProdutos}>{t.produtos}</Text>
              <Text style={s.cStatus}>{t.status}</Text>
            </View>
          ))}
          <View style={s.total}>
            <Text style={[s.th, { width: '90%' }]}>
              Total ({transferencias.length} transferências)
            </Text>
            <Text style={[s.th, { width: '10%' }]} />
          </View>
        </View>
      </Page>
    </Document>
  )
}
