import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', color: '#000' },
  titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  linha: { marginBottom: 1 },
  rotulo: { fontFamily: 'Helvetica-Bold' },
  table: { width: '100%', marginTop: 14 },
  thead: { flexDirection: 'row', borderBottom: 1, borderColor: '#000', paddingBottom: 3 },
  tr: { flexDirection: 'row', borderBottom: 0.5, borderColor: '#ccc', paddingVertical: 3 },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  cCodigo: { width: '15%' },
  cDescricao: { width: '47%' },
  cUnidade: { width: '12%' },
  cQtde: { width: '13%', textAlign: 'right' },
  cStatus: { width: '13%', textAlign: 'center' },
})

export interface ContagemInventarioItem {
  codigo: string
  descricao: string
  unidade: string
  quan: number
  status: string
}

export function ContagemInventarioPDF({
  id,
  loja,
  data,
  local,
  tipo,
  itens,
}: {
  id: number
  loja: string
  data: string
  local: string
  tipo: string
  itens: ContagemInventarioItem[]
}) {
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <Text style={s.titulo}>
          Inventário: {id}
          {loja ? ` - ${loja}` : ''}
        </Text>
        <Text style={s.linha}>
          <Text style={s.rotulo}>Data: </Text>
          {data}
        </Text>
        <Text style={s.linha}>
          <Text style={s.rotulo}>Local de Estoque: </Text>
          {local}
        </Text>
        <Text style={s.linha}>
          <Text style={s.rotulo}>Tipo de Inventário: </Text>
          {tipo}
        </Text>

        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.cCodigo]}>Código do Produto</Text>
            <Text style={[s.th, s.cDescricao]}>Descrição do Produto</Text>
            <Text style={[s.th, s.cUnidade]}>Unidade</Text>
            <Text style={[s.th, s.cQtde]}>Quantidade</Text>
            <Text style={[s.th, s.cStatus]}>Status</Text>
          </View>
          {itens.map((it, i) => (
            <View key={i} style={s.tr}>
              <Text style={s.cCodigo}>{it.codigo}</Text>
              <Text style={s.cDescricao}>{it.descricao}</Text>
              <Text style={s.cUnidade}>{it.unidade}</Text>
              <Text style={s.cQtde}>
                {it.quan.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              <Text style={s.cStatus}>{it.status}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}
