import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, pdfTabela, PdfResumoBar } from '@/components/relatorio/PdfChrome'
import { porFamilia, quantidadeTexto, type LinhaCompra, type LinhaProducao, type ResumoEvento } from '@/lib/custo-cardapio/eventos-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'

// Evento em PDF: resumo, lista de produção e lista de compras por família.
const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  nome: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#6b7280', marginBottom: 10 },
  secao: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  familia: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#6b7280', marginTop: 6, marginBottom: 2 },
  th: { textTransform: 'none' },
  muted: { color: '#6b7280' },
  obs: { fontSize: 9, color: '#374151', marginBottom: 8 },
})

export function EventoPDF({ loja, nome, sub, obs, resumo, meta, preco, pratos, producao, compras }: {
  loja: string
  nome: string
  sub: string
  obs: string | null
  resumo: ResumoEvento
  meta: number
  preco: number | null
  pratos: { descricao: string; porcoes: number }[]
  producao: LinhaProducao[]
  compras: LinhaCompra[]
}) {
  const comprar = compras.filter((c) => c.faltaComprar > 0)
  return (
    <Document title={`Evento · ${nome}`}>
      <Page size="A4" style={s.page}>
        <PdfCabecalho titulo="Evento · produção e compras" sub={loja} />
        <Text style={s.nome}>{nome}</Text>
        <Text style={s.sub}>{sub}</Text>
        {obs ? <Text style={s.obs}>{obs}</Text> : null}
        <PdfResumoBar campos={[
          { label: 'Custo total', valor: brl(resumo.custoTotal) },
          { label: 'Custo por pessoa', valor: brl(resumo.custoPorPessoa) },
          { label: 'Preço por pessoa', valor: preco != null ? brl(preco) : `sugerido ${brl(resumo.precoSugeridoPorPessoa)}` },
          { label: 'Margem', valor: pct(resumo.margem), destaque: resumo.cmv != null && resumo.cmv > meta },
          { label: 'Comprar', valor: brl(comprar.reduce((a, c) => a + c.custoCompra, 0)) },
        ]} />

        <Text style={s.secao}>Lista de produção</Text>
        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead}>
            <Text style={[pdfTabela.th, s.th, { width: '68%' }]}>Prato ou preparação</Text>
            <Text style={[pdfTabela.th, s.th, { width: '30%', textAlign: 'right' }]}>Quantidade</Text>
          </View>
          {pratos.map((p, i) => (
            <View key={`p${i}`} style={pdfTabela.tr} wrap={false}>
              <Text style={[pdfTabela.td, { width: '68%', fontFamily: 'Helvetica-Bold' }]}>{p.descricao}</Text>
              <Text style={[pdfTabela.td, { width: '30%', textAlign: 'right' }]}>{p.porcoes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} porções</Text>
            </View>
          ))}
          {producao.map((p, i) => (
            <View key={`r${i}`} style={pdfTabela.tr} wrap={false}>
              <Text style={[pdfTabela.td, { width: '68%' }]}>{p.descricao}</Text>
              <Text style={[pdfTabela.td, { width: '30%', textAlign: 'right' }]}>{quantidadeTexto(p.quantidade, p.unidade)}</Text>
            </View>
          ))}
        </View>

        <Text style={s.secao}>Lista de compras</Text>
        {comprar.length === 0 ? <Text style={s.muted}>Tudo o que o evento precisa já está em estoque.</Text> : (
          <View style={pdfTabela.table}>
            <View style={pdfTabela.thead}>
              <Text style={[pdfTabela.th, s.th, { width: '40%' }]}>Insumo</Text>
              <Text style={[pdfTabela.th, s.th, { width: '15%', textAlign: 'right' }]}>Precisa</Text>
              <Text style={[pdfTabela.th, s.th, { width: '15%', textAlign: 'right' }]}>Em estoque</Text>
              <Text style={[pdfTabela.th, s.th, { width: '15%', textAlign: 'right' }]}>Comprar</Text>
              <Text style={[pdfTabela.th, s.th, { width: '13%', textAlign: 'right' }]}>Custo</Text>
            </View>
            {porFamilia(comprar).map((g) => (
              <View key={g.familia}>
                <Text style={s.familia}>{g.familia}</Text>
                {g.linhas.map((c, i) => (
                  <View key={i} style={[pdfTabela.tr, i % 2 ? pdfTabela.trAlt : {}]} wrap={false}>
                    <Text style={[pdfTabela.td, { width: '40%' }]}>{c.descricao}</Text>
                    <Text style={[pdfTabela.td, { width: '15%', textAlign: 'right' }]}>{quantidadeTexto(c.bruta, c.unidade)}</Text>
                    <Text style={[pdfTabela.tdMuted, { width: '15%', textAlign: 'right' }]}>{c.emEstoque == null ? 'conferir' : quantidadeTexto(c.emEstoque, c.unidade)}</Text>
                    <Text style={[pdfTabela.td, { width: '15%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>{quantidadeTexto(c.faltaComprar, c.unidade)}</Text>
                    <Text style={[pdfTabela.td, { width: '13%', textAlign: 'right' }]}>{c.semCusto ? '—' : brl(c.custoCompra)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
        <PdfRodape texto="Norte ERP · Norte Cozinha" />
      </Page>
    </Document>
  )
}
