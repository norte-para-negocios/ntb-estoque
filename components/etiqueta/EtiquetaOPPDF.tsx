import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const W = 72.56 * 2.8346
const H = 40.04 * 2.8346

const styles = StyleSheet.create({
  page: { padding: 6 },
  box: {
    border: '1pt solid #000',
    borderRadius: 3,
    padding: 5,
    height: '100%',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  titulo: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  linha: { fontSize: 8 },
  rodape: { fontSize: 7, color: '#555', textAlign: 'right' },
})

export interface EtiquetaOPItem {
  produto: string
  numOP: string
  quantidade: number
  unidade: string
  validade?: string
  lote?: string
  index: number
  total: number
}

export function EtiquetaOPPDF({ itens }: { itens: EtiquetaOPItem[] }) {
  return (
    <Document>
      {itens.map((item, i) => (
        <Page key={i} size={[W, H]} style={styles.page}>
          <View style={styles.box}>
            <View>
              <Text style={styles.titulo}>{item.produto}</Text>
              <Text style={styles.linha}>OP: {item.numOP}</Text>
              <Text style={styles.linha}>
                Qtd: {item.quantidade} {item.unidade}
              </Text>
              {item.lote ? <Text style={styles.linha}>Lote: {item.lote}</Text> : null}
              {item.validade ? <Text style={styles.linha}>Val: {item.validade}</Text> : null}
            </View>
            <Text style={styles.rodape}>
              {item.index} de {item.total}
            </Text>
          </View>
        </Page>
      ))}
    </Document>
  )
}
