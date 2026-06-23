import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'
import { formatNumBR } from '@/lib/num-br'

// Fator de conversao mm -> pt (1 mm = 2.83465 pt)
const MM = 2.83465
const CM = 10 * MM

// Tamanho padrao em cm (largura original 72.56mm = 7.256cm; altura 40.04mm = 4.0cm)
export const LARGURA_CM_PADRAO = 7.26
export const ALTURA_CM_PADRAO = 4.0

// Campos opcionais do corpo, na ordem que podem ser reordenados pelo admin.
export type CampoEtiqueta =
  | 'fabricacao' | 'validade' | 'qtde_nf' | 'qtde_etiqueta' | 'lote' | 'recebido' | 'fornecedor'

export const CAMPOS_ETIQUETA: { key: CampoEtiqueta; label: string }[] = [
  { key: 'fabricacao', label: 'Fabricação' },
  { key: 'validade', label: 'Validade' },
  { key: 'qtde_nf', label: 'Qtde NF' },
  { key: 'qtde_etiqueta', label: 'Qtde Etiqueta' },
  { key: 'lote', label: 'Lote' },
  { key: 'recebido', label: 'Recebido' },
  { key: 'fornecedor', label: 'Fornecedor' },
]
export const ORDEM_CAMPOS_PADRAO: CampoEtiqueta[] = CAMPOS_ETIQUETA.map((c) => c.key)

// Config do padrao da etiqueta (vem da tabela etiqueta_config, por loja). O
// tamanho (larguraCm/alturaCm) pode ser sobrescrito pelo usuario na hora.
export interface EtiquetaConfig {
  nomeExibido?: string
  larguraCm?: number
  alturaCm?: number
  offsetX?: number // mm (negativo = esquerda)
  offsetY?: number // mm (negativo = cima)
  corDestaque?: string | null // hex (#1C8D99); null/vazio = preto
  fonteEscala?: number // 1.0 = padrao
  negritoNome?: boolean
  negritoDescricao?: boolean
  mostrarLogo?: boolean
  mostrarBorda?: boolean
  ordemCampos?: CampoEtiqueta[]
  // Visibilidade de campos (todos true por padrão)
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
  nome_loja?: string
}

export interface EtiquetaPDFProps {
  etiquetas: Etiqueta[]
  config?: EtiquetaConfig
}

function buildStyles(opts: {
  larguraCm: number
  alturaCm: number
  offsetX: number
  offsetY: number
  escala: number
  cor: string
  corFilete: string
  borda: boolean
}) {
  const { larguraCm, alturaCm, offsetX, offsetY, escala, cor, corFilete, borda } = opts
  const W = larguraCm * CM
  const H = alturaCm * CM
  // Tudo escala junto (fonte, QR, cabeçalho/rodapé, paddings) conforme a etiqueta.
  const hCabecalho = 6 * MM * escala
  const hRodape = 5 * MM * escala
  const padH = 2.5 * MM * escala
  const padOX = (3 * escala + offsetX) * MM
  const padOY = (2 * escala + offsetY) * MM
  const fs = (n: number) => n * escala
  const qrSize = 36 * escala
  const rightW = 40 * escala

  return StyleSheet.create({
    page: {
      width: W,
      height: H,
      padding: 0,
      fontSize: fs(8),
      color: '#000',
    },
    // Box de tamanho FIXO (= página) com overflow hidden: garante que a etiqueta
    // saia exatamente no tamanho em cm pedido, clipando conteúdo que sobra em vez
    // de crescer/encolher a página.
    root: {
      width: W,
      height: H,
      overflow: 'hidden',
      flexDirection: 'column',
      paddingLeft: padOX < 0 ? 0 : padOX,
      paddingTop: padOY < 0 ? 0 : padOY,
      paddingRight: padH,
      ...(borda ? { borderWidth: 0.7, borderColor: cor, borderStyle: 'solid' } : {}),
    },
    cabecalho: {
      height: hCabecalho,
      borderBottomWidth: 0.5,
      borderBottomColor: corFilete,
      justifyContent: 'center',
      paddingHorizontal: 2,
      marginBottom: 1.5,
    },
    nomeLoja: {
      fontSize: fs(7),
      textTransform: 'uppercase',
      letterSpacing: 0.3,
      color: cor,
    },
    corpo: { flex: 1, flexDirection: 'row', overflow: 'hidden' },
    left: { flex: 1, minWidth: 0, paddingRight: 3, overflow: 'hidden' },
    right: { width: rightW, flexShrink: 0, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 1 },
    descricao: { fontSize: fs(8), marginBottom: 3, lineHeight: 1.25 },
    campoLinha: { flexDirection: 'row', marginBottom: 2, alignItems: 'baseline' },
    label: { fontSize: fs(5.5), color: '#555', marginRight: 2 },
    valor: { fontSize: fs(7) },
    linha: { fontSize: fs(6.5), marginBottom: 1 },
    qr: { width: qrSize, height: qrSize },
    rodape: {
      height: hRodape,
      borderTopWidth: 0.5,
      borderTopColor: corFilete,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 2,
      paddingTop: 1,
    },
    rodapeTexto: { fontSize: fs(5.5), color: '#444', flex: 1 },
    logo: { width: 32, height: 'auto' },
  })
}

export function EtiquetaPDF({ etiquetas, config = {} }: EtiquetaPDFProps) {
  const larguraCm = config.larguraCm ?? LARGURA_CM_PADRAO
  const alturaCm = config.alturaCm ?? ALTURA_CM_PADRAO
  const offsetX = config.offsetX ?? 0
  const offsetY = config.offsetY ?? 0
  // Escala automática: o conteúdo acompanha o tamanho da etiqueta (quadrada ou
  // retangular). Usa a dimensão mais apertada pra não estourar. Sem ajuste manual.
  const escala = Math.min(Math.max(Math.min(larguraCm / LARGURA_CM_PADRAO, alturaCm / ALTURA_CM_PADRAO), 0.55), 2.4)
  const cor = (config.corDestaque || '').trim() || '#000000'
  const corFilete = cor === '#000000' ? '#ccc' : cor
  const borda = config.mostrarBorda ?? false
  const negritoNome = config.negritoNome ?? true
  const negritoDescricao = config.negritoDescricao ?? true
  // Logo da NTB é OBRIGATÓRIA na etiqueta (pedido da reunião 22/06): sempre exibida,
  // independente da config antiga. O campo mostrar_logo fica ignorado.
  const mostrarLogo = true
  const ordem = (config.ordemCampos?.length ? config.ordemCampos : ORDEM_CAMPOS_PADRAO)

  const mostrar = {
    fabricacao: config.mostrarFabricacao ?? true,
    validade: config.mostrarValidade ?? true,
    qtdeNf: config.mostrarQtdeNf ?? true,
    qtdeEtiqueta: config.mostrarQtdeEtiqueta ?? true,
    lote: config.mostrarLote ?? true,
    recebido: config.mostrarRecebido ?? true,
    fornecedor: config.mostrarFornecedor ?? true,
    cnpj: config.mostrarCnpj ?? true,
  }

  const s = buildStyles({ larguraCm, alturaCm, offsetX, offsetY, escala, cor, corFilete, borda })
  const bold = (b: boolean) => ({ fontFamily: b ? 'Helvetica-Bold' : 'Helvetica' })

  return (
    <Document>
      {etiquetas.map((e, i) => {
        const nomeLoja = (config.nomeExibido?.trim() || e.nome_loja?.trim() || '').toUpperCase()
        const descricao = e.descricao.trim()
        const qtdeNf = e.qtde_nf
          ? e.qtde_nf.replace(/^(\d+[\d.,]*)/, (m) => formatNumBR(parseFloat(m.replace(',', '.'))))
          : ''
        const qtdeEtiqueta = e.qtde_etiqueta
          ? e.qtde_etiqueta.replace(/^(\d+[\d.,]*)/, (m) => formatNumBR(parseFloat(m.replace(',', '.'))))
          : ''

        // Resolve cada campo opcional -> { label, valor } | null (oculto/vazio)
        const valores: Record<CampoEtiqueta, { label: string; valor: string } | null> = {
          fabricacao: mostrar.fabricacao && e.produzido ? { label: 'Fabricação', valor: e.produzido.trim().slice(0, 10) } : null,
          validade: mostrar.validade && e.validade ? { label: 'Validade', valor: e.validade.trim().slice(0, 10) } : null,
          qtde_nf: mostrar.qtdeNf && e.qtde_nf ? { label: 'Qtde NF', valor: qtdeNf.slice(0, 16) } : null,
          qtde_etiqueta: mostrar.qtdeEtiqueta && e.qtde_etiqueta ? { label: 'Qtde Etiqueta', valor: qtdeEtiqueta.slice(0, 16) } : null,
          lote: mostrar.lote && e.lote ? { label: 'Lote', valor: e.lote.trim().slice(0, 24) } : null,
          recebido: mostrar.recebido && e.inclusao ? { label: 'Recebido', valor: e.inclusao.trim().slice(0, 10) } : null,
          fornecedor: mostrar.fornecedor && e.fornecedor ? { label: '', valor: e.fornecedor.trim().slice(0, 30) } : null,
        }
        const linhas = ordem.map((k) => valores[k]).filter(Boolean) as { label: string; valor: string }[]
        const temRodape = mostrar.cnpj || mostrarLogo

        return (
          <Page key={i} size={{ width: larguraCm * CM, height: alturaCm * CM }} style={s.page} wrap={false}>
            <View style={s.root}>
              {/* CABECALHO — nome da loja */}
              <View style={s.cabecalho}>
                <Text style={[s.nomeLoja, bold(negritoNome)]}>{nomeLoja || 'NTB NORTE PARA NEGOCIOS'}</Text>
              </View>

              {/* CORPO */}
              <View style={s.corpo}>
                <View style={s.left}>
                  <Text style={[s.descricao, bold(negritoDescricao)]}>{descricao}</Text>

                  {/* Produto + quantidade (linha fixa) */}
                  <View style={s.campoLinha}>
                    <Text style={[s.linha, { flex: 1 }]}>Prod: {e.codigo_produto.trim().slice(0, 8)}</Text>
                    {e.quantidade !== '' && (
                      <Text style={[s.linha, { flex: 1 }]}>{e.quantidade.trim().slice(0, 14)}</Text>
                    )}
                  </View>

                  {/* Campos opcionais na ordem escolhida */}
                  {linhas.map((c, idx) => (
                    <View key={idx} style={s.campoLinha}>
                      {c.label !== '' && <Text style={s.label}>{c.label}:</Text>}
                      <Text style={[s.valor, bold(true)]}>{c.valor}</Text>
                    </View>
                  ))}
                </View>

                {/* QR code */}
                <View style={s.right}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image style={s.qr} src={e.qr} />
                </View>
              </View>

              {/* RODAPE — CNPJ + logo */}
              {temRodape && (
                <View style={s.rodape}>
                  {mostrar.cnpj ? <Text style={s.rodapeTexto}>CNPJ: {e.cnpj || '-'}</Text> : <Text style={s.rodapeTexto} />}
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  {mostrarLogo && <Image style={s.logo} src={NTB_LOGO_DATA_URL} />}
                </View>
              )}
            </View>
          </Page>
        )
      })}
    </Document>
  )
}
