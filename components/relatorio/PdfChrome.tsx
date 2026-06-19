// Motor base dos PDFs NTB Estoque.
// Exporta: PdfCabecalho, PdfRodape, pdfTabela (estilos de tabela), PdfMetaBox, PdfResumoBar, PdfErro.
// Todos os relatorios devem usar este modulo para evitar duplicacao e garantir espacamento correto.
import { Text, View, Image, StyleSheet, Page, Document } from '@react-pdf/renderer'
import { NTB_LOGO_DATA_URL } from '@/lib/etiqueta-logo'
import { dataGeracao } from '@/lib/pdf-utils'

// ─── Cores e constantes ───────────────────────────────────────────────────────
export const BRAND = '#1c8d99'
const GREY_BG = '#f3f4f6'
const BORDER_COLOR = '#e5e7eb'
const TEXT_MUTED = '#6b7280'
const TEXT_DARK = '#374151'

// ─── Cabecalho ────────────────────────────────────────────────────────────────
const sHeader = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottom: 1,
    borderColor: BORDER_COLOR,
    paddingBottom: 10,
  },
  logo: { width: 72, height: 24, objectFit: 'contain' },
  headerRight: { textAlign: 'right' },
  titulo: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#111' },
  sub: { fontSize: 8, color: TEXT_MUTED, marginTop: 2 },
  geradoEm: { fontSize: 7, color: '#9ca3af', marginTop: 1 },
})

export function PdfCabecalho({
  titulo,
  sub,
  mostrarDataGeracao = true,
}: {
  titulo: string
  sub?: string
  mostrarDataGeracao?: boolean
}) {
  return (
    <View style={sHeader.header}>
      <Image src={NTB_LOGO_DATA_URL} style={sHeader.logo} />
      <View style={sHeader.headerRight}>
        <Text style={sHeader.titulo}>{titulo}</Text>
        {sub ? <Text style={sHeader.sub}>{sub}</Text> : null}
        {mostrarDataGeracao ? (
          <Text style={sHeader.geradoEm}>Gerado em {dataGeracao()}</Text>
        ) : null}
      </View>
    </View>
  )
}

// ─── Rodape ──────────────────────────────────────────────────────────────────
const sFooter = StyleSheet.create({
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: TEXT_MUTED,
  },
})

export function PdfRodape({ texto = 'NTB Estoque' }: { texto?: string }) {
  return (
    <View style={sFooter.footer} fixed>
      <Text>{texto}</Text>
      <Text render={({ pageNumber, totalPages }) => `Pagina ${pageNumber} de ${totalPages}`} />
    </View>
  )
}

// ─── Estilos de tabela compartilhados ────────────────────────────────────────
// REGRA ANTI-COLISAO: toda celula DEVE ter paddingRight >= 6.
// As larguras somam < 100% para garantir a folga visual.
export const pdfTabela = StyleSheet.create({
  table: { width: '100%' },
  // Cabecalho cinza padrao
  thead: {
    flexDirection: 'row',
    backgroundColor: GREY_BG,
    borderRadius: 3,
    paddingVertical: 5,
    paddingLeft: 4,
    paddingRight: 4,
    marginBottom: 2,
  },
  // Cabecalho colorido (brand) para NF
  theadBrand: {
    flexDirection: 'row',
    backgroundColor: BRAND,
    borderRadius: 3,
    paddingVertical: 5,
    paddingLeft: 4,
    paddingRight: 4,
    marginBottom: 2,
  },
  tr: {
    flexDirection: 'row',
    borderBottom: 0.5,
    borderColor: BORDER_COLOR,
    paddingVertical: 3.5,
    paddingLeft: 4,
    paddingRight: 4,
  },
  trAlt: { backgroundColor: '#fafafa' },
  // th cinza
  th: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: TEXT_DARK,
    textTransform: 'uppercase',
    paddingRight: 6,
  },
  // th branco (sobre fundo brand)
  thBrand: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: '#ffffff',
    textTransform: 'uppercase',
    paddingRight: 6,
  },
  td: { fontSize: 8.5, paddingRight: 6 },
  tdMuted: { fontSize: 8.5, color: TEXT_MUTED, paddingRight: 6 },
  // Linha de total
  totalRow: {
    flexDirection: 'row',
    marginTop: 8,
    paddingTop: 4,
    paddingLeft: 4,
    paddingRight: 4,
    borderTop: 1,
    borderColor: '#111',
  },
  totalTxt: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#111' },
})

// ─── MetaBox (ficha de dados: Data, Origem, Destino, etc.) ───────────────────
const sMeta = StyleSheet.create({
  box: {
    backgroundColor: '#f9fafb',
    borderRadius: 4,
    padding: '8 10',
    marginBottom: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  item: { flexDirection: 'row', gap: 3 },
  rotulo: { fontFamily: 'Helvetica-Bold', color: TEXT_DARK, fontSize: 8.5 },
  valor: { color: '#111', fontSize: 8.5 },
})

export interface MetaField {
  rotulo: string
  valor: string
}

export function PdfMetaBox({ campos }: { campos: MetaField[] }) {
  return (
    <View style={sMeta.box}>
      {campos.map((c, i) => (
        <View key={i} style={sMeta.item}>
          <Text style={sMeta.rotulo}>{c.rotulo}:</Text>
          <Text style={sMeta.valor}>{c.valor}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── ResumoBar (boxes de totalizadores no topo, ex. NF) ──────────────────────
const sResumo = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f3fafb',
    border: 0.5,
    borderColor: '#cfeaee',
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
  },
  box: { flexDirection: 'column' },
  label: { fontSize: 7, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
  valor: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#111', marginTop: 2 },
  valorBrand: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND, marginTop: 2 },
})

export interface ResumoField {
  label: string
  valor: string
  destaque?: boolean
  alinhaDireita?: boolean
}

export function PdfResumoBar({ campos }: { campos: ResumoField[] }) {
  return (
    <View style={sResumo.bar}>
      {campos.map((c, i) => (
        <View key={i} style={[sResumo.box, c.alinhaDireita ? { alignItems: 'flex-end' } : {}]}>
          <Text style={sResumo.label}>{c.label}</Text>
          <Text style={c.destaque ? sResumo.valorBrand : sResumo.valor}>{c.valor}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── Pagina de erro amigavel (substitui JSON cru 403/404) ────────────────────
const sErro = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#111' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#dc2626', marginBottom: 8 },
  msg: { fontSize: 10, color: TEXT_DARK, lineHeight: 1.5 },
})

export function PdfErro({ titulo = 'Acesso negado', mensagem = 'Voce nao tem permissao para acessar este relatorio.' }: {
  titulo?: string
  mensagem?: string
}) {
  return (
    <Document>
      <Page size="A4" style={sErro.page}>
        <PdfCabecalho titulo="NTB Estoque" mostrarDataGeracao={false} />
        <Text style={sErro.titulo}>{titulo}</Text>
        <Text style={sErro.msg}>{mensagem}</Text>
        <PdfRodape />
      </Page>
    </Document>
  )
}
