import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'

// Etiqueta 72.56 x 40.04 mm (mesma do sistema Laravel original)
const MM = 2.83465
const W = 72.56 * MM
const H = 40.04 * MM

const s = StyleSheet.create({
  page: { paddingTop: 3 * MM, paddingHorizontal: 3 * MM, fontSize: 8, color: '#000' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  left: { width: '70%', flexShrink: 0, flexGrow: 0, paddingRight: 4, overflow: 'hidden' },
  right: { width: '30%', flexShrink: 0, flexGrow: 0, alignItems: 'center', overflow: 'hidden' },
  descricao: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  campoRow: { flexDirection: 'row', marginBottom: 4 },
  campo: { flex: 1, minWidth: 0, paddingRight: 4, overflow: 'hidden' },
  label: { fontSize: 6, color: '#000' },
  valor: { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  linha: { fontSize: 7, marginBottom: 1.5 },
  qr: { width: 50, height: 50, marginBottom: 5 },
  logo: { width: 40, height: 'auto' },
})

export interface Etiqueta {
  descricao: string
  codigo_produto: string
  quantidade: string
  qtde_nf: string
  qtde_etiqueta: string
  validade: string
  produzido: string
  inclusao: string
  lote: string
  fornecedor: string
  cnpj: string
  qr: string // data URL do QR code
}

export function EtiquetaPDF({ etiquetas }: { etiquetas: Etiqueta[] }) {
  return (
    <Document>
      {etiquetas.map((e, i) => (
        <Page key={i} size={[W, H]} style={s.page}>
          <View style={s.row}>
            {/* Coluna esquerda: dados */}
            <View style={s.left}>
              <Text style={s.descricao} wrap={false}>{e.descricao.trim().slice(0, 40)}</Text>

              {e.produzido !== '' && e.validade !== '' && (
                <View style={s.campoRow}>
                  <View style={s.campo}>
                    <Text style={s.label}>Fabricação:</Text>
                    <Text style={s.valor} wrap={false}>{e.produzido.trim().slice(0, 10)}</Text>
                  </View>
                  <View style={s.campo}>
                    <Text style={s.label}>Validade:</Text>
                    <Text style={s.valor} wrap={false}>{e.validade.trim().slice(0, 10)}</Text>
                  </View>
                  {e.qtde_etiqueta !== '' && e.qtde_nf === '' && (
                    <View style={s.campo}>
                      <Text style={s.label}>Qtde Etiqueta:</Text>
                      <Text style={s.valor}>{e.qtde_etiqueta.trim().slice(0, 15)}</Text>
                    </View>
                  )}
                </View>
              )}

              {e.qtde_nf !== '' && e.qtde_etiqueta !== '' && (
                <View style={s.campoRow}>
                  <View style={s.campo}>
                    <Text style={s.label}>Qtde NF</Text>
                    <Text style={s.valor}>{e.qtde_nf.trim().slice(0, 17)}</Text>
                  </View>
                  <View style={s.campo}>
                    <Text style={s.label}>Qtde Etiqueta</Text>
                    <Text style={s.valor}>{e.qtde_etiqueta.trim().slice(0, 17)}</Text>
                  </View>
                </View>
              )}

              <View style={s.campoRow}>
                <Text style={[s.linha, { flex: 1 }]}>
                  Produto:{e.codigo_produto.trim().slice(0, 6)}
                </Text>
                {e.quantidade !== '' && (
                  <Text style={[s.linha, { flex: 1 }]}>{e.quantidade.trim().slice(0, 14)}</Text>
                )}
              </View>

              {e.lote !== '' && <Text style={s.linha}>Lote: {e.lote.trim().slice(0, 22)}</Text>}
              {e.inclusao !== '' && (
                <Text style={s.linha}>Recebido em: {e.inclusao.trim().slice(0, 10)}</Text>
              )}
              {e.fornecedor !== '' && (
                <Text style={s.linha}>{e.fornecedor.trim().slice(0, 28)}</Text>
              )}
              <Text style={s.linha}>CNPJ:{e.cnpj || '-'}</Text>
            </View>

            {/* Coluna direita: QR + logo */}
            <View style={s.right}>
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image style={s.qr} src={e.qr} />
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image style={s.logo} src={NTB_LOGO_DATA_URL} />
            </View>
          </View>
        </Page>
      ))}
    </Document>
  )
}
