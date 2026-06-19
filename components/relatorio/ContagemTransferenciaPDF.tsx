import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfMetaBox, pdfTabela } from './PdfChrome'
import { numBR2 } from '@/lib/pdf-utils'

// Colunas: somam 96% para garantir paddingRight entre colunas sem colisao.
// BUG corrigido: anteriormente somavam 100% sem paddingRight, colando "5Concluido".
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

export interface ContagemTransferenciaItem {
  codigo: string
  descricao: string
  unidade: string
  quan: string
  status: string
}

export function ContagemTransferenciaPDF({
  loja,
  data,
  origem,
  destino,
  itens,
}: {
  loja: string
  data: string
  origem: string
  destino: string
  itens: ContagemTransferenciaItem[]
}) {
  const concluidos = itens.filter((it) => it.status === 'Concluido' || it.status === 'Concluída').length

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho
          titulo="Transferencia de Estoque"
          sub={loja || undefined}
        />

        <PdfMetaBox
          campos={[
            { rotulo: 'Data', valor: data },
            { rotulo: 'Origem', valor: origem },
            { rotulo: 'Destino', valor: destino },
            { rotulo: 'Itens', valor: String(itens.length) },
            { rotulo: 'Concluidos', valor: String(concluidos) },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            <Text style={[pdfTabela.th, col.codigo]}>Codigo</Text>
            <Text style={[pdfTabela.th, col.descricao]}>Descricao</Text>
            <Text style={[pdfTabela.th, col.unidade]}>Un.</Text>
            <Text style={[pdfTabela.th, col.qtde]}>Qtde</Text>
            <Text style={[pdfTabela.th, col.status]}>Status</Text>
          </View>

          {itens.map((it, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.tdMuted, col.codigo]}>{it.codigo}</Text>
              <Text style={[pdfTabela.td, col.descricao]}>{it.descricao}</Text>
              <Text style={[pdfTabela.tdMuted, col.unidade]}>{it.unidade}</Text>
              <Text style={[pdfTabela.td, col.qtde]}>
                {numBR2(it.quan)}
              </Text>
              <Text style={[pdfTabela.td, col.status]}>{it.status}</Text>
            </View>
          ))}

          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>
              Total ({itens.length} {itens.length === 1 ? 'item' : 'itens'})
            </Text>
            <Text style={[pdfTabela.totalTxt, col.qtde, { textAlign: 'right' }]}>
              {itens.reduce((acc, it) => acc + (parseFloat(String(it.quan)) || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text style={[pdfTabela.totalTxt, col.status]} />
          </View>
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
