import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfMetaBox, pdfTabela } from './PdfChrome'
import { numBR2 } from '@/lib/pdf-utils'
import { statusInfo } from '@/lib/status-cor'

// Colunas: somam 96% para garantir paddingRight entre colunas sem colisao.
const col = StyleSheet.create({
  codigo:    { width: '14%' },
  descricao: { width: '45%' },
  unidade:   { width: '11%' },
  qtde:      { width: '13%', textAlign: 'right' },
  status:    { width: '13%' },
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
  const totalQtde = itens.reduce((acc, it) => acc + Number(it.quan ?? 0), 0)

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho
          titulo={`Inventário #${id}`}
          sub={loja || undefined}
        />

        <PdfMetaBox
          campos={[
            { rotulo: 'Data', valor: data },
            { rotulo: 'Local', valor: local },
            { rotulo: 'Tipo', valor: tipo },
            { rotulo: 'Itens', valor: String(itens.length) },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            <Text style={[pdfTabela.th, col.codigo]}>Código</Text>
            <Text style={[pdfTabela.th, col.descricao]}>Descrição</Text>
            <Text style={[pdfTabela.th, col.unidade]}>Un.</Text>
            <Text style={[pdfTabela.th, col.qtde]}>Qtde</Text>
            <Text style={[pdfTabela.th, col.status]}>Status</Text>
          </View>

          {itens.map((it, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.tdMuted, col.codigo]}>{it.codigo}</Text>
              <Text style={[pdfTabela.td, col.descricao]}>{it.descricao}</Text>
              <Text style={[pdfTabela.tdMuted, col.unidade]}>{it.unidade}</Text>
              <Text style={[pdfTabela.td, col.qtde]}>{numBR2(it.quan)}</Text>
              <Text style={[pdfTabela.td, col.status]}>{statusInfo(it.status).label}</Text>
            </View>
          ))}

          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>
              Total ({itens.length} {itens.length === 1 ? 'item' : 'itens'})
            </Text>
            <Text style={[pdfTabela.totalTxt, col.qtde, { textAlign: 'right' }]}>
              {totalQtde.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text style={[pdfTabela.totalTxt, col.status]} />
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
