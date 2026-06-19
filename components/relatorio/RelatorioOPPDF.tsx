import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'
import { statusInfo } from '@/lib/status-cor'

// Colunas OP: somam 96% para garantir paddingRight entre colunas sem colisao.
const col = StyleSheet.create({
  op:        { width: '14%' },
  produto:   { width: '38%' },
  qtd:       { width: '14%', textAlign: 'right' },
  validade:  { width: '16%' },
  status:    { width: '14%' },
})

const s = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 28,
    paddingBottom: 44,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111',
  },
})

export interface RelatorioOPItem {
  numOP: string
  produto: string
  quantidade: string
  validade: string
  status: string
}

export function RelatorioOPPDF({
  loja,
  periodo,
  filtros,
  ordens,
}: {
  loja: string
  periodo: string
  filtros?: string
  ordens: RelatorioOPItem[]
}) {
  const sub = [loja, periodo, filtros].filter(Boolean).join(' · ')
  const concluidas = ordens.filter((o) => o.status === 'Concluida').length

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatório de Ordens de Produção" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Ordens', valor: String(ordens.length) },
            { label: 'Concluídas', valor: String(concluidas) },
            { label: 'Pendentes', valor: String(ordens.length - concluidas) },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            <Text style={[pdfTabela.th, col.op]}>No OP</Text>
            <Text style={[pdfTabela.th, col.produto]}>Produto</Text>
            <Text style={[pdfTabela.th, col.qtd]}>Quantidade</Text>
            <Text style={[pdfTabela.th, col.validade]}>Validade</Text>
            <Text style={[pdfTabela.th, col.status]}>Status</Text>
          </View>

          {ordens.map((o, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.td, col.op]}>{o.numOP}</Text>
              <Text style={[pdfTabela.td, col.produto]}>{o.produto}</Text>
              <Text style={[pdfTabela.td, col.qtd]}>{o.quantidade}</Text>
              <Text style={[pdfTabela.tdMuted, col.validade]}>{o.validade}</Text>
              <Text style={[pdfTabela.td, col.status]}>{statusInfo(o.status).label}</Text>
            </View>
          ))}

          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>
              Total ({ordens.length} {ordens.length === 1 ? 'ordem' : 'ordens'})
            </Text>
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
