import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, pdfTabela, PdfResumoBar } from '@/components/relatorio/PdfChrome'
import { brl, pct } from '@/lib/custo-cardapio/formato'

// Cardápio em PDF. Público: só nome e preço, agrupado pela família na ordem do cardápio. Interno: com custo, CMV e sugerido.
const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#111' },
  nome: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#6b7280', marginBottom: 14 },
  grupo: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 6, color: '#1c8d99' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingVertical: 4, borderBottom: 0.5, borderColor: '#e5e7eb' },
  prato: { fontSize: 11, flex: 1, paddingRight: 12 },
  preco: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  th: { textTransform: 'none' },
  vermelho: { color: '#dc2626' },
})

export type LinhaCardapioPdf = { descricao: string; familia: string | null; preco: number | null; custo: number; cmv: number | null; sugerido: number; acima: boolean }

export function CardapioPDF({ loja, nome, canal, linhas, interno, meta, resumo }: {
  loja: string
  nome: string
  canal: string
  linhas: LinhaCardapioPdf[]
  interno: boolean
  meta: number
  resumo: { cmvCardapio: number | null; acima: number; semPreco: number }
}) {
  const grupos: { familia: string; linhas: LinhaCardapioPdf[] }[] = []
  for (const l of linhas) {
    const f = l.familia ?? 'Outros'
    const g = grupos.find((x) => x.familia === f)
    if (g) g.linhas.push(l); else grupos.push({ familia: f, linhas: [l] })
  }
  return (
    <Document title={`Cardápio · ${nome}`}>
      <Page size="A4" style={s.page}>
        <PdfCabecalho titulo={interno ? 'Cardápio · versão interna' : 'Cardápio'} sub={loja} />
        <Text style={s.nome}>{nome}</Text>
        <Text style={s.sub}>{canal}</Text>
        {interno ? (
          <>
            <PdfResumoBar campos={[
              { label: 'Pratos', valor: String(linhas.length) },
              { label: 'CMV do cardápio', valor: pct(resumo.cmvCardapio), destaque: resumo.cmvCardapio != null && resumo.cmvCardapio > meta },
              { label: 'Meta', valor: pct(meta, 0) },
              { label: 'Acima da meta', valor: String(resumo.acima) },
              { label: 'Sem preço', valor: String(resumo.semPreco) },
            ]} />
            <View style={pdfTabela.table}>
              <View style={pdfTabela.thead}>
                <Text style={[pdfTabela.th, s.th, { width: '46%' }]}>Prato</Text>
                <Text style={[pdfTabela.th, s.th, { width: '13%', textAlign: 'right' }]}>Custo</Text>
                <Text style={[pdfTabela.th, s.th, { width: '13%', textAlign: 'right' }]}>Preço</Text>
                <Text style={[pdfTabela.th, s.th, { width: '12%', textAlign: 'right' }]}>CMV</Text>
                <Text style={[pdfTabela.th, s.th, { width: '14%', textAlign: 'right' }]}>Preço p/ meta</Text>
              </View>
              {linhas.map((l, i) => (
                <View key={i} style={[pdfTabela.tr, i % 2 ? pdfTabela.trAlt : {}]} wrap={false}>
                  <Text style={[pdfTabela.td, { width: '46%' }]}>{l.descricao}</Text>
                  <Text style={[pdfTabela.td, { width: '13%', textAlign: 'right' }]}>{brl(l.custo)}</Text>
                  <Text style={[pdfTabela.td, { width: '13%', textAlign: 'right' }]}>{brl(l.preco)}</Text>
                  <Text style={[pdfTabela.td, { width: '12%', textAlign: 'right' }, l.acima ? s.vermelho : {}]}>{pct(l.cmv)}</Text>
                  <Text style={[pdfTabela.td, { width: '14%', textAlign: 'right' }]}>{l.sugerido > 0 ? brl(l.sugerido) : '—'}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          grupos.map((g) => (
            <View key={g.familia}>
              {grupos.length > 1 && <Text style={s.grupo}>{g.familia}</Text>}
              {g.linhas.map((l, i) => (
                <View key={i} style={s.linha} wrap={false}>
                  <Text style={s.prato}>{l.descricao}</Text>
                  <Text style={s.preco}>{l.preco != null ? brl(l.preco) : ''}</Text>
                </View>
              ))}
            </View>
          ))
        )}
        <PdfRodape texto="Norte ERP · Norte Cozinha" />
      </Page>
    </Document>
  )
}
