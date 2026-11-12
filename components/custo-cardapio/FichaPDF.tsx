import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, pdfTabela, PdfResumoBar } from '@/components/relatorio/PdfChrome'
import type { NoTela } from '@/lib/custo-cardapio/carregar'
import { brl, pct, qtd } from '@/lib/custo-cardapio/formato'

// Ficha técnica do prato. `cozinha` = sem nenhum valor em R$ (para colar na parede da cozinha).
const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  nome: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 9, color: '#6b7280', marginBottom: 10 },
  secao: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4 },
  filho: { color: '#6b7280' },
  foto: { width: '100%', height: 200, objectFit: 'cover', borderRadius: 6, marginBottom: 10 },
  chips: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  chip: { fontSize: 9, color: '#374151' },
  passo: { flexDirection: 'row', marginBottom: 5 },
  passoNum: { width: 18, fontFamily: 'Helvetica-Bold' },
  passoTxt: { flex: 1, lineHeight: 1.4 },
  obs: { lineHeight: 1.4, color: '#374151' },
})

export type FichaPdfProps = {
  loja: string
  nome: string
  sub: string
  itens: NoTela[]
  cozinha: boolean
  custo: number
  preco: number | null
  meta: number
  /** Foto do prato (JPG/PNG baixados no servidor). */
  foto?: { data: Buffer; format: 'jpg' | 'png' } | null
  passos?: string[]
  observacoes?: string | null
  tempo?: string | null
  rendimento?: string | null
}

function linhas(nos: NoTela[], nivel: number, out: { n: NoTela; nivel: number }[]) {
  for (const n of nos) {
    out.push({ n, nivel })
    if (n.filhos.length && nivel < 2) linhas(n.filhos, nivel + 1, out)
  }
  return out
}

export function FichaPDF(p: FichaPdfProps) {
  const todas = linhas(p.itens, 0, [])
  const cmv = p.preco ? p.custo / p.preco : null
  return (
    <Document title={`Ficha técnica · ${p.nome}`}>
      <Page size="A4" style={s.page}>
        <PdfCabecalho titulo={p.cozinha ? 'Ficha técnica · cozinha' : 'Ficha técnica'} sub={p.loja} />
        {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do @react-pdf não tem alt */}
        {p.foto && <Image src={p.foto} style={s.foto} />}
        <Text style={s.nome}>{p.nome}</Text>
        <Text style={s.sub}>{p.sub}</Text>
        {(p.tempo || p.rendimento) && (
          <View style={s.chips}>
            {p.tempo && <Text style={s.chip}>Tempo de preparo: {p.tempo}</Text>}
            {p.rendimento && <Text style={s.chip}>Rendimento: {p.rendimento}</Text>}
          </View>
        )}
        {!p.cozinha && (
          <PdfResumoBar campos={[
            { label: 'Custo', valor: brl(p.custo) },
            { label: 'Preço', valor: brl(p.preco) },
            { label: 'CMV', valor: pct(cmv), destaque: cmv != null && cmv > p.meta },
            { label: 'Meta', valor: pct(p.meta, 0) },
          ]} />
        )}
        <Text style={s.secao}>Ingredientes</Text>
        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead}>
            <Text style={[pdfTabela.th, { width: p.cozinha ? '70%' : '50%' }]}>Ingrediente</Text>
            <Text style={[pdfTabela.th, { width: p.cozinha ? '26%' : '18%', textAlign: 'right' }]}>Quantidade</Text>
            {!p.cozinha && <Text style={[pdfTabela.th, { width: '14%', textAlign: 'right' }]}>Custo</Text>}
            {!p.cozinha && <Text style={[pdfTabela.th, { width: '14%', textAlign: 'right' }]}>% do prato</Text>}
          </View>
          {todas.map(({ n, nivel }, i) => (
            <View key={i} style={[pdfTabela.tr, i % 2 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.td, { width: p.cozinha ? '70%' : '50%', paddingLeft: nivel * 12 }, nivel ? s.filho : {}]}>{nivel ? '- ' : ''}{n.descricao}</Text>
              <Text style={[pdfTabela.td, { width: p.cozinha ? '26%' : '18%', textAlign: 'right' }, nivel ? s.filho : {}]}>{qtd(n.quantidade, n.unidade)}</Text>
              {!p.cozinha && <Text style={[pdfTabela.td, { width: '14%', textAlign: 'right' }, nivel ? s.filho : {}]}>{n.semCusto ? 'sem custo' : brl(n.custo)}</Text>}
              {!p.cozinha && <Text style={[pdfTabela.td, { width: '14%', textAlign: 'right' }, nivel ? s.filho : {}]}>{nivel === 0 && p.custo > 0 ? pct(n.custo / p.custo, 0) : ''}</Text>}
            </View>
          ))}
        </View>
        {p.passos && p.passos.length > 0 && (
          <View>
            <Text style={s.secao} minPresenceAhead={40}>Modo de preparo</Text>
            {p.passos.map((t, i) => (
              <View key={i} style={s.passo} wrap={false}>
                <Text style={s.passoNum}>{i + 1}.</Text>
                <Text style={s.passoTxt}>{t}</Text>
              </View>
            ))}
          </View>
        )}
        {p.observacoes && (
          <View wrap={false}>
            <Text style={s.secao}>Observações</Text>
            <Text style={s.obs}>{p.observacoes}</Text>
          </View>
        )}
        <PdfRodape texto="Norte ERP · Custo e Cardápio" />
      </Page>
    </Document>
  )
}
