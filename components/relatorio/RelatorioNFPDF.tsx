import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'
import { moedaBR } from '@/lib/pdf-utils'

// Colunas NF: somam 96% para garantir paddingRight entre colunas sem colisao.
const col = StyleSheet.create({
  emissao:    { width: '12%' },
  numero:     { width: '13%' },
  fornecedor: { width: '38%' },
  etapa:      { width: '14%' },
  valor:      { width: '19%', textAlign: 'right' },
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

export interface RelatorioNFItem {
  emissao: string
  numero: string
  fornecedor: string
  etapa?: string
  valor: number
}

export function RelatorioNFPDF({
  loja,
  periodo,
  filtros,
  notas,
}: {
  loja: string
  periodo: string
  filtros?: string
  notas: RelatorioNFItem[]
}) {
  const sub = [loja, `Período: ${periodo}`, filtros].filter(Boolean).join(' · ')
  const total = notas.reduce((acc, n) => acc + n.valor, 0)

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Relatório de Notas Fiscais" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Período', valor: periodo },
            { label: 'Notas', valor: String(notas.length) },
            { label: 'Total', valor: moedaBR(total), destaque: true, alinhaDireita: true },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.theadBrand} fixed>
            <Text style={[pdfTabela.thBrand, col.emissao]}>Emissão</Text>
            <Text style={[pdfTabela.thBrand, col.numero]}>Número</Text>
            <Text style={[pdfTabela.thBrand, col.fornecedor]}>Fornecedor</Text>
            <Text style={[pdfTabela.thBrand, col.etapa]}>Etapa</Text>
            <Text style={[pdfTabela.thBrand, col.valor]}>Valor</Text>
          </View>

          {notas.map((n, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.tdMuted, col.emissao]}>{n.emissao}</Text>
              <Text style={[pdfTabela.td, col.numero]}>{n.numero}</Text>
              <Text style={[pdfTabela.td, col.fornecedor]}>{n.fornecedor}</Text>
              <Text style={[pdfTabela.tdMuted, col.etapa]}>{n.etapa ?? '-'}</Text>
              <Text style={[pdfTabela.td, col.valor]}>{moedaBR(n.valor)}</Text>
            </View>
          ))}

          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>
              Total ({notas.length} {notas.length === 1 ? 'nota' : 'notas'})
            </Text>
            <Text style={[pdfTabela.totalTxt, col.valor]}>{moedaBR(total)}</Text>
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
