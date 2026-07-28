import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, pdfTabela } from './PdfChrome'

export interface LinhaProgramacao {
  codigo: string
  descricao: string
  unidade: string
  porDia: Record<number, number>
}

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
    minHeight: 26,
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
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  thProduto: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, textTransform: 'uppercase' },
  thDia: { fontFamily: 'Helvetica-Bold', fontSize: 6.5, textAlign: 'center' },
  codigo: { fontSize: 6, color: '#6b7280' },
  descricao: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  prev: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#111' },
  prevVazio: { fontSize: 7, color: '#d1d5db' },
  linhaReal: {
    marginTop: 3,
    width: '80%',
    borderBottom: 0.5,
    borderColor: '#9ca3af',
    height: 8,
  },
})

export function ProgramacaoProducaoPDF({
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
        <PdfCabecalho titulo="Programação de Produção" sub={sub} />

        <View style={pdfTabela.table}>
          <View style={s.linhaCabecalho} fixed>
            <View style={s.colProduto}>
              <Text style={s.thProduto}>Produto</Text>
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
                    <Text style={qtd ? s.prev : s.prevVazio}>{qtd ? qtd : '-'}</Text>
                    <View style={s.linhaReal} />
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

        <PdfRodape texto="NTB Estoque · Número em cima = previsto. Linha em baixo = espaço para anotar o produzido." />
      </Page>
    </Document>
  )
}
