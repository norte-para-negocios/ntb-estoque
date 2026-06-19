import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'
import { formatNumBR } from '@/lib/num-br'

// Fator de conversao mm -> pt (1 mm = 2.83465 pt)
const MM = 2.83465

// Largura fixa original (72.56 mm). Altura parametrizavel.
const W = 72.56 * MM

// Presets de altura
export const ALTURA_PRESETS = {
  padrao: 40.04,   // mesma do sistema Laravel original
  compacta: 32,    // reduzida — elimina sobra vertical
} as const
export type AlturaPreset = keyof typeof ALTURA_PRESETS

// Config de impressao por loja (persiste em localStorage via EtiquetaConfigStore)
export interface EtiquetaConfig {
  nomeExibido?: string    // nome custom da loja na etiqueta; '' usa o nome do banco
  alturaPreset?: AlturaPreset
  offsetX?: number        // deslocamento horizontal em mm (negativo = esquerda)
  offsetY?: number        // deslocamento vertical em mm (negativo = cima)
  // Visibilidade de campos (todos true por padrao)
  mostrarFabricacao?: boolean
  mostrarValidade?: boolean
  mostrarQtdeNf?: boolean
  mostrarQtdeEtiqueta?: boolean
  mostrarLote?: boolean
  mostrarRecebido?: boolean
  mostrarFornecedor?: boolean
  mostrarCnpj?: boolean
}

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
  // Novos campos 3.1
  nome_loja?: string // nome do restaurante/loja a exibir no cabecalho
}

export interface EtiquetaPDFProps {
  etiquetas: Etiqueta[]
  config?: EtiquetaConfig
}

function buildStyles(alturaPreset: AlturaPreset, offsetX: number, offsetY: number) {
  const H = ALTURA_PRESETS[alturaPreset] * MM
  // Alturas das zonas em mm
  const hCabecalho = 6 * MM    // 6 mm para o nome da loja
  const hRodape    = 5 * MM    // 5 mm para CNPJ + logo mini
  const hCorpo     = H - hCabecalho - hRodape

  const padH = 2.5 * MM  // padding horizontal interno
  const padOX = (3 + offsetX) * MM   // margem esquerda com offset de calibracao
  const padOY = (2 + offsetY) * MM   // margem topo com offset de calibracao

  return StyleSheet.create({
    page: {
      width: W,
      height: H,
      padding: 0,
      fontSize: 8,
      color: '#000',
    },
    // Offset: wrapper interno com margens (evita deslocamento da pagina)
    inner: {
      marginLeft: padOX < 0 ? 0 : padOX,
      marginTop: padOY < 0 ? 0 : padOY,
      marginRight: padH,
      flex: 1,
    },
    // --- CABECALHO ---
    cabecalho: {
      height: hCabecalho,
      borderBottomWidth: 0.5,
      borderBottomColor: '#ccc',
      justifyContent: 'center',
      paddingHorizontal: 2,
      marginBottom: 1.5,
    },
    nomeLoja: {
      fontSize: 7,
      fontFamily: 'Helvetica-Bold',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    // --- CORPO (coluna esquerda + coluna direita) ---
    corpo: {
      height: hCorpo,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    left: {
      flex: 1,
      minWidth: 0,
      paddingRight: 3,
      overflow: 'hidden',
    },
    right: {
      width: 45,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: 2,
    },
    descricao: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      marginBottom: 3,
      lineHeight: 1.25,
    },
    campoRow: { flexDirection: 'row', marginBottom: 3 },
    campo: { flex: 1, minWidth: 0, paddingRight: 3, overflow: 'hidden' },
    label: { fontSize: 5.5, color: '#555' },
    valor: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
    linha: { fontSize: 6.5, marginBottom: 1 },
    qr: { width: 44, height: 44 },
    // --- RODAPE ---
    rodape: {
      height: hRodape,
      borderTopWidth: 0.5,
      borderTopColor: '#ccc',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 2,
      paddingTop: 1,
    },
    rodapeTexto: { fontSize: 5.5, color: '#444', flex: 1 },
    logo: { width: 32, height: 'auto' },
  })
}

export function EtiquetaPDF({ etiquetas, config = {} }: EtiquetaPDFProps) {
  const alturaPreset: AlturaPreset = config.alturaPreset ?? 'padrao'
  const offsetX = config.offsetX ?? 0
  const offsetY = config.offsetY ?? 0

  // Defaults de visibilidade (tudo visivel quando nao configurado)
  const mostrar = {
    fabricacao:     config.mostrarFabricacao    ?? true,
    validade:       config.mostrarValidade       ?? true,
    qtdeNf:         config.mostrarQtdeNf         ?? true,
    qtdeEtiqueta:   config.mostrarQtdeEtiqueta   ?? true,
    lote:           config.mostrarLote           ?? true,
    recebido:       config.mostrarRecebido       ?? true,
    fornecedor:     config.mostrarFornecedor     ?? true,
    cnpj:           config.mostrarCnpj           ?? true,
  }

  const s = buildStyles(alturaPreset, offsetX, offsetY)

  return (
    <Document>
      {etiquetas.map((e, i) => {
        const H = ALTURA_PRESETS[alturaPreset] * MM
        const nomeLoja = (config.nomeExibido?.trim() || e.nome_loja?.trim() || '').toUpperCase()

        // Descricao: sem truncamento forcado — deixa quebrar em ate 2 linhas
        const descricao = e.descricao.trim()

        // Qtde formatada com num-br
        const qtdeNf = e.qtde_nf
          ? e.qtde_nf.replace(/^(\d+[\d.,]*)/, (m) => formatNumBR(parseFloat(m.replace(',', '.'))))
          : ''
        const qtdeEtiqueta = e.qtde_etiqueta
          ? e.qtde_etiqueta.replace(/^(\d+[\d.,]*)/, (m) => formatNumBR(parseFloat(m.replace(',', '.'))))
          : ''

        return (
          <Page key={i} size={[W, H]} style={s.page}>
            <View style={s.inner}>
              {/* === ZONA 1: CABECALHO — nome da loja === */}
              <View style={s.cabecalho}>
                <Text style={s.nomeLoja}>{nomeLoja || 'NTB NORTE PARA NEGOCIOS'}</Text>
              </View>

              {/* === ZONA 2: CORPO === */}
              <View style={s.corpo}>
                {/* Coluna esquerda: dados do produto */}
                <View style={s.left}>
                  {/* Descricao: quebra natural, maximo 2 linhas via lineClamp nao disponivel no react-pdf
                      Usamos numberOfLines=2 via maxLines — react-pdf suporta via wrap implicito */}
                  <Text style={s.descricao}>{descricao}</Text>

                  {/* Fabricacao + Validade */}
                  {(mostrar.fabricacao || mostrar.validade) &&
                    (e.produzido !== '' || e.validade !== '') && (
                    <View style={s.campoRow}>
                      {mostrar.fabricacao && e.produzido !== '' && (
                        <View style={s.campo}>
                          <Text style={s.label}>Fabricacao:</Text>
                          <Text style={s.valor}>{e.produzido.trim().slice(0, 10)}</Text>
                        </View>
                      )}
                      {mostrar.validade && e.validade !== '' && (
                        <View style={s.campo}>
                          <Text style={s.label}>Validade:</Text>
                          <Text style={s.valor}>{e.validade.trim().slice(0, 10)}</Text>
                        </View>
                      )}
                      {/* Qtde Etiqueta sozinha (sem qtde NF) */}
                      {mostrar.qtdeEtiqueta && e.qtde_etiqueta !== '' && e.qtde_nf === '' && (
                        <View style={s.campo}>
                          <Text style={s.label}>Qtde Et.:</Text>
                          <Text style={s.valor}>{qtdeEtiqueta.slice(0, 14)}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Qtde NF + Qtde Etiqueta */}
                  {(mostrar.qtdeNf || mostrar.qtdeEtiqueta) &&
                    e.qtde_nf !== '' && e.qtde_etiqueta !== '' && (
                    <View style={s.campoRow}>
                      {mostrar.qtdeNf && (
                        <View style={s.campo}>
                          <Text style={s.label}>Qtde NF</Text>
                          <Text style={s.valor}>{qtdeNf.slice(0, 16)}</Text>
                        </View>
                      )}
                      {mostrar.qtdeEtiqueta && (
                        <View style={s.campo}>
                          <Text style={s.label}>Qtde Etiqueta</Text>
                          <Text style={s.valor}>{qtdeEtiqueta.slice(0, 16)}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Produto + Quantidade */}
                  <View style={s.campoRow}>
                    <Text style={[s.linha, { flex: 1 }]}>
                      Prod: {e.codigo_produto.trim().slice(0, 8)}
                    </Text>
                    {e.quantidade !== '' && (
                      <Text style={[s.linha, { flex: 1 }]}>{e.quantidade.trim().slice(0, 14)}</Text>
                    )}
                  </View>

                  {mostrar.lote && e.lote !== '' && (
                    <Text style={s.linha}>Lote: {e.lote.trim().slice(0, 24)}</Text>
                  )}
                  {mostrar.recebido && e.inclusao !== '' && (
                    <Text style={s.linha}>Recebido: {e.inclusao.trim().slice(0, 10)}</Text>
                  )}
                  {mostrar.fornecedor && e.fornecedor !== '' && (
                    <Text style={s.linha}>{e.fornecedor.trim().slice(0, 30)}</Text>
                  )}
                </View>

                {/* Coluna direita: QR code */}
                <View style={s.right}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image style={s.qr} src={e.qr} />
                </View>
              </View>

              {/* === ZONA 3: RODAPE — CNPJ + logo NTB === */}
              <View style={s.rodape}>
                {mostrar.cnpj && (
                  <Text style={s.rodapeTexto}>CNPJ: {e.cnpj || '-'}</Text>
                )}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image style={s.logo} src={NTB_LOGO_DATA_URL} />
              </View>
            </View>
          </Page>
        )
      })}
    </Document>
  )
}
