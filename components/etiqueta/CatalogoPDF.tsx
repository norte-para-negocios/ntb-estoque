// components/etiqueta/CatalogoPDF.tsx
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'

// Fator de conversao mm -> pt (1 mm = 2.83465 pt), mesmo padrao de EtiquetaPDF.tsx
const MM = 2.83465

const ITENS_POR_PAGINA = 18
const COLUNAS = 3
const LINHAS = 6

const MARGEM = 10 * MM
const ALTURA_CABECALHO = 12 * MM
const GAP_CABECALHO_GRID = 3 * MM
const GAP_CELULA = 2 * MM

// A4 = 210mm x 297mm
const LARGURA_UTIL = 210 * MM - 2 * MARGEM
const ALTURA_GRID = 297 * MM - 2 * MARGEM - ALTURA_CABECALHO - GAP_CABECALHO_GRID

const LARGURA_CELULA = (LARGURA_UTIL - (COLUNAS - 1) * GAP_CELULA) / COLUNAS
const ALTURA_CELULA = (ALTURA_GRID - (LINHAS - 1) * GAP_CELULA) / LINHAS

const LARGURA_QR = 15 * MM
const LARGURA_COLUNA_QR = 18 * MM

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGEM,
    paddingBottom: MARGEM,
    paddingLeft: MARGEM,
    paddingRight: MARGEM,
  },
  cabecalho: {
    height: ALTURA_CABECALHO,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0.75,
    borderBottomColor: '#ccc',
    marginBottom: GAP_CABECALHO_GRID,
    paddingHorizontal: 2,
  },
  nomeLoja: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  logo: { width: 36, height: 'auto' },
  linha: {
    flexDirection: 'row',
    marginBottom: GAP_CELULA,
  },
  celula: {
    width: LARGURA_CELULA,
    height: ALTURA_CELULA,
    borderWidth: 0.5,
    borderColor: '#ddd',
    flexDirection: 'row',
    padding: 2 * MM,
    overflow: 'hidden',
  },
  celulaComMargem: { marginRight: GAP_CELULA },
  celulaTexto: { flex: 1, minWidth: 0, justifyContent: 'center', paddingRight: 2 },
  descricao: { fontSize: 8, lineHeight: 1.15, marginBottom: 3 },
  codigo: { fontSize: 7, color: '#555' },
  celulaQr: { width: LARGURA_COLUNA_QR, alignItems: 'center', justifyContent: 'center' },
  qr: { width: LARGURA_QR, height: LARGURA_QR },
})

export interface ItemCatalogo {
  descricao: string
  codigo_produto: string
  qr: string // data URL do QR code
}

export interface CatalogoPDFProps {
  itens: ItemCatalogo[]
  nomeLoja: string
}

function paginar<T>(itens: T[], porPagina: number): T[][] {
  const paginas: T[][] = []
  for (let i = 0; i < itens.length; i += porPagina) paginas.push(itens.slice(i, i + porPagina))
  return paginas
}

function agruparEmLinhas<T>(itens: T[], colunas: number): T[][] {
  const linhas: T[][] = []
  for (let i = 0; i < itens.length; i += colunas) linhas.push(itens.slice(i, i + colunas))
  return linhas
}

export function CatalogoPDF({ itens, nomeLoja }: CatalogoPDFProps) {
  const paginas = paginar(itens, ITENS_POR_PAGINA)
  const nome = (nomeLoja || '').trim().toUpperCase()

  return (
    <Document>
      {paginas.map((pagina, p) => (
        <Page key={p} size="A4" style={styles.page} wrap={false}>
          <View style={styles.cabecalho}>
            <Text style={styles.nomeLoja}>{nome || 'NTB NORTE PARA NEGOCIOS'}</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={NTB_LOGO_DATA_URL} />
          </View>

          {agruparEmLinhas(pagina, COLUNAS).map((linha, li) => (
            <View key={li} style={styles.linha}>
              {linha.map((item, ci) => (
                <View key={ci} style={[styles.celula, ci < COLUNAS - 1 ? styles.celulaComMargem : {}]}>
                  <View style={styles.celulaTexto}>
                    <Text style={styles.descricao}>{item.descricao}</Text>
                    <Text style={styles.codigo}>Cod: {item.codigo_produto}</Text>
                  </View>
                  <View style={styles.celulaQr}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <Image style={styles.qr} src={item.qr} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </Page>
      ))}
    </Document>
  )
}
