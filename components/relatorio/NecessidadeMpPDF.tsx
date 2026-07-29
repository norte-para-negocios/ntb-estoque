import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, pdfTabela } from './PdfChrome'
import type { LinhaProgramacao } from './ProgramacaoProducaoPDF'

const s = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    fontSize: 7,
    fontFamily: 'Helvetica',
    color: '#111',
  },
  linhaCabecalho: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 2,
    paddingVertical: 4,
    marginBottom: 2,
  },
  linhaProduto: {
    flexDirection: 'row',
    borderBottom: 0.5,
    borderColor: '#e5e7eb',
    minHeight: 18,
    alignItems: 'stretch',
  },
  colProduto: {
    width: 150,
    paddingRight: 4,
    paddingLeft: 2,
    justifyContent: 'center',
  },
  colDia: {
    flex: 1,
    borderLeft: 0.5,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thProduto: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, textTransform: 'uppercase' },
  thDia: { fontFamily: 'Helvetica-Bold', fontSize: 6.5, textAlign: 'center' },
  codigo: { fontSize: 6, color: '#6b7280' },
  descricao: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  qtd: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#111' },
  qtdVazio: { fontSize: 7, color: '#d1d5db' },
})

export function NecessidadeMpPDF({
  loja,
  local,
  mesLabel,
  filtros,
  dias,
  linhas,
}: {
  loja: string
  local: string
  mesLabel: string
  filtros?: string
  dias: number[]
  linhas: LinhaProgramacao[]
}) {
  const sub = [loja, `Local: ${local}`, mesLabel, filtros].filter(Boolean).join(' · ')

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <PdfCabecalho titulo="Necessidade de Matéria-Prima" sub={sub} />

        <View style={pdfTabela.table}>
          <View style={s.linhaCabecalho} fixed>
            <View style={s.colProduto}>
              <Text style={s.thProduto}>Matéria-prima</Text>
            </View>
            {dias.map((d) => (
              <View key={d} style={s.colDia}>
                <Text style={s.thDia}>{d}</Text>
              </View>
            ))}
          </View>

          {linhas.map((l) => (
            <View key={l.codigo} style={s.linhaProduto} wrap={false}>
              <View style={s.colProduto}>
                <Text style={s.descricao}>{l.descricao}</Text>
                <Text style={s.codigo}>{l.codigo} · {l.unidade}</Text>
              </View>
              {dias.map((d) => {
                const qtd = l.porDia[d]
                return (
                  <View key={d} style={s.colDia}>
                    <Text style={qtd ? s.qtd : s.qtdVazio}>{qtd ? qtd : '-'}</Text>
                  </View>
                )
              })}
            </View>
          ))}

          {!linhas.length && (
            <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 10 }}>
              Nenhuma ordem de produção prevista para este período/local.
            </Text>
          )}
        </View>

        <PdfRodape texto="NTB Estoque · Quantidade de matéria-prima necessária por dia, calculada a partir da ficha técnica das ordens de produção previstas." />
      </Page>
    </Document>
  )
}
