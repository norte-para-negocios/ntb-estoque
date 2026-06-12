import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

// Etiqueta 72.56 x 40.04 mm -> pontos (1mm = 2.8346pt)
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

export interface EtiquetaItem {
  descricao: string
  quantidade: number
  unidade: string
  codigo?: string
  validade?: string
  lote?: string
  index: number
  total: number
}

export function EtiquetaProdutoPDF({ itens }: { itens: EtiquetaItem[] }) {
  return (
    <Document>
      {itens.map((item, i) => (
        <Page key={i} size={[W, H]} style={styles.page}>
          <View style={styles.box}>
            <View>
              <Text style={styles.titulo}>{item.descricao}</Text>
              {item.codigo ? <Text style={styles.linha}>Cod: {item.codigo}</Text> : null}
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
