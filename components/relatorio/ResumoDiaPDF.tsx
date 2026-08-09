import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'
import type { CategoriaKey, CategoriaLista, Contagem, Grafico } from '@/lib/resumo-dia'

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  secaoTitulo: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  totalNf: { fontSize: 9, marginBottom: 8, color: '#444' },
})

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtBar = (v: number, u: 'num' | 'reais') => (u === 'reais' ? fmtMoeda(v) : fmt(v))

// Gráfico de barras horizontais no PDF.
function Barras({ grafico }: { grafico: Grafico }) {
  const max = Math.max(...grafico.itens.map((i) => i.valor), 1)
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 8, color: '#777', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{grafico.titulo}</Text>
      {grafico.itens.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
          <Text style={{ width: '34%', fontSize: 8, color: '#333' }}>{it.label}</Text>
          <View style={{ flex: 1, height: 7, backgroundColor: '#edf0f2', borderRadius: 3 }}>
            <View style={{ height: 7, width: `${Math.max(3, (it.valor / max) * 100)}%`, backgroundColor: '#14b8a6', borderRadius: 3 }} />
          </View>
          <Text style={{ width: '16%', fontSize: 8, color: '#111', textAlign: 'right', marginLeft: 6 }}>{fmtBar(it.valor, grafico.unidade)}</Text>
        </View>
      ))}
    </View>
  )
}

function Secao({ label, lista, quebra }: { label: string; lista: CategoriaLista; quebra: boolean }) {
  const temStatus = lista.linhas.some((l) => l.status)
  const cols = [...lista.colunas, ...(temStatus ? [{ label: 'Situação' }] : [])]
  const ncol = cols.length || 1
  const wCol = (alinharDir?: boolean) =>
    ({ width: `${100 / ncol}%`, textAlign: (alinharDir ? 'right' : 'left') as 'right' | 'left' })

  return (
    <View break={quebra} wrap>
      <Text style={s.secaoTitulo}>{label} ({fmt(lista.total)})</Text>
      {lista.grafico && lista.grafico.itens.length > 0 ? <Barras grafico={lista.grafico} /> : null}
      <View style={pdfTabela.table}>
        <View style={pdfTabela.thead} fixed>
          {cols.map((c, i) => (
            <Text key={i} style={[pdfTabela.th, wCol((c as { alinharDir?: boolean }).alinharDir)]}>{c.label}</Text>
          ))}
        </View>
        {lista.linhas.map((linha, ri) => (
          <View key={ri} style={[pdfTabela.tr, ri % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
            {linha.celulas.map((cel, ci) => (
              <Text key={ci} style={[pdfTabela.td, wCol(lista.colunas[ci]?.alinharDir)]}>{cel ?? '-'}</Text>
            ))}
            {temStatus && <Text style={[pdfTabela.tdMuted, wCol(false)]}>{linha.status?.label ?? '-'}</Text>}
          </View>
        ))}
      </View>
    </View>
  )
}

export function ResumoDiaPDF({
  loja,
  periodoLabel,
  contagem,
  listas,
}: {
  loja: string
  periodoLabel: string
  contagem: Contagem
  listas: { cat: CategoriaKey; label: string; lista: CategoriaLista }[]
}) {
  const sub = [loja, periodoLabel].filter(Boolean).join(' · ')
  const comDados = listas.filter((s) => s.lista.linhas.length > 0)

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Resumo do dia" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Notas Fiscais', valor: fmt(contagem.notas) },
            { label: 'Transferências', valor: fmt(contagem.transferencias) },
            { label: 'Inventários', valor: fmt(contagem.inventarios) },
            { label: 'Produção', valor: fmt(contagem.opsConcluidas) },
            { label: 'Etiquetas', valor: fmt(contagem.etiquetas) },
            { label: 'Erros', valor: fmt(contagem.erros) },
          ]}
        />
        {contagem.valorNotas > 0 ? (
          <Text style={s.totalNf}>Total em Notas Fiscais: {fmtMoeda(contagem.valorNotas)}</Text>
        ) : null}

        {comDados.length === 0 ? (
          <Text style={{ marginTop: 16, color: '#666' }}>Nenhuma atividade registrada neste dia.</Text>
        ) : (
          comDados.map((sec, i) => <Secao key={sec.cat} label={sec.label} lista={sec.lista} quebra={i > 0} />)
        )}

        <PdfRodape />
      </Page>
    </Document>
  )
}
