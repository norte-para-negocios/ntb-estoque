import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: 1, borderColor: '#e5e7eb', paddingBottom: 10 },
  logo: { width: 72, height: 24, objectFit: 'contain' },
  headerRight: { textAlign: 'right' },
  titulo: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#111' },
  subtitulo: { fontSize: 8, color: '#6b7280', marginTop: 2 },
  metaBox: { backgroundColor: '#f9fafb', borderRadius: 4, padding: '8 10', marginBottom: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metaItem: { flexDirection: 'row', gap: 3 },
  rotulo: { fontFamily: 'Helvetica-Bold', color: '#374151' },
  valor: { color: '#111' },
  table: { width: '100%', marginTop: 4 },
  thead: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 3, paddingVertical: 5, paddingHorizontal: 4, marginBottom: 2 },
  tr: { flexDirection: 'row', borderBottom: 0.5, borderColor: '#e5e7eb', paddingVertical: 4, paddingHorizontal: 4 },
  trAlt: { backgroundColor: '#fafafa' },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#6b7280', textTransform: 'uppercase' },
  td: { fontSize: 8.5 },
  cCodigo: { width: '15%' },
  cDescricao: { width: '47%' },
  cUnidade: { width: '12%' },
  cQtde: { width: '13%', textAlign: 'right' },
  cStatus: { width: '13%', textAlign: 'center' },
  footer: { position: 'absolute', bottom: 20, left: 32, right: 32, textAlign: 'center', fontSize: 7.5, color: '#9ca3af' },
})

export interface ContagemTransferenciaItem {
  codigo: string
  descricao: string
  unidade: string
  quan: string
  status: string
}

export function ContagemTransferenciaPDF({
  loja,
  data,
  origem,
  destino,
  itens,
}: {
  loja: string
  data: string
  origem: string
  destino: string
  itens: ContagemTransferenciaItem[]
}) {
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <View style={s.header}>
          <Image src={NTB_LOGO_DATA_URL} style={s.logo} />
          <View style={s.headerRight}>
            <Text style={s.titulo}>Transferência de Estoque</Text>
            {loja ? <Text style={s.subtitulo}>{loja}</Text> : null}
          </View>
        </View>

        <View style={s.metaBox}>
          <View style={s.metaItem}>
            <Text style={s.rotulo}>Data:</Text>
            <Text style={s.valor}>{data}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.rotulo}>Origem:</Text>
            <Text style={s.valor}>{origem}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.rotulo}>Destino:</Text>
            <Text style={s.valor}>{destino}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.rotulo}>Itens:</Text>
            <Text style={s.valor}>{itens.length}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.cCodigo]}>Código</Text>
            <Text style={[s.th, s.cDescricao]}>Descrição</Text>
            <Text style={[s.th, s.cUnidade]}>Un.</Text>
            <Text style={[s.th, s.cQtde]}>Qtde</Text>
            <Text style={[s.th, s.cStatus]}>Status</Text>
          </View>
          {itens.map((it, i) => (
            <View key={i} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]}>
              <Text style={[s.td, s.cCodigo]}>{it.codigo}</Text>
              <Text style={[s.td, s.cDescricao]}>{it.descricao}</Text>
              <Text style={[s.td, s.cUnidade]}>{it.unidade}</Text>
              <Text style={[s.td, s.cQtde]}>{it.quan}</Text>
              <Text style={[s.td, s.cStatus]}>{it.status}</Text>
            </View>
          ))}
        </View>

        <Text style={s.footer}>NTB Estoque — gerado em {data}</Text>
      </Page>
    </Document>
  )
}
