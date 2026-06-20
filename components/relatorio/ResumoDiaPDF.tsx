import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'
import type { EventoFeed, ResumoKpis } from '@/lib/resumo-dia'

const col = StyleSheet.create({
  hora:   { width: '9%' },
  pessoa: { width: '20%' },
  acao:   { width: '20%' },
  alvo:   { width: '27%' },
  status: { width: '12%' },
  loja:   { width: '12%' },
})

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
})

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
}

export function ResumoDiaPDF({
  loja,
  dataBR,
  kpis,
  feed,
}: {
  loja: string
  dataBR: string
  kpis: ResumoKpis
  feed: EventoFeed[]
}) {
  const haLoja = feed.some((e) => e.lojaNome)
  const sub = [loja, `Dia: ${dataBR}`].filter(Boolean).join(' · ')

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Resumo do dia" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Transferências', valor: fmt(kpis.transferencias) },
            { label: 'Inventários', valor: fmt(kpis.inventarios) },
            { label: 'OPs (concl.)', valor: `${fmt(kpis.opsCriadas)} (${fmt(kpis.opsConcluidas)})` },
            { label: 'Mov. (E/S)', valor: `${fmt(kpis.movEntradas)}/${fmt(kpis.movSaidas)}` },
            { label: 'Etiquetas', valor: fmt(kpis.etiquetas) },
            { label: 'Erros', valor: fmt(kpis.erros) },
          ]}
        />

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            <Text style={[pdfTabela.th, col.hora]}>Hora</Text>
            <Text style={[pdfTabela.th, col.pessoa]}>Pessoa</Text>
            <Text style={[pdfTabela.th, col.acao]}>Ação</Text>
            <Text style={[pdfTabela.th, col.alvo]}>Onde</Text>
            <Text style={[pdfTabela.th, col.status]}>Status</Text>
            {haLoja ? <Text style={[pdfTabela.th, col.loja]}>Loja</Text> : null}
          </View>

          {feed.length === 0 ? (
            <View style={pdfTabela.tr}>
              <Text style={[pdfTabela.tdMuted, { flex: 1 }]}>Nada registrado neste dia.</Text>
            </View>
          ) : (
            feed.map((e, i) => (
              <View key={i} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
                <Text style={[pdfTabela.tdMuted, col.hora]}>{e.hora || '-'}</Text>
                <Text style={[pdfTabela.td, col.pessoa]}>{e.pessoa ?? 'Sistema'}</Text>
                <Text style={[pdfTabela.td, col.acao]}>{e.acao}</Text>
                <Text style={[pdfTabela.td, col.alvo]}>{e.alvo}</Text>
                <Text style={[pdfTabela.tdMuted, col.status]}>{e.status ?? '-'}</Text>
                {haLoja ? <Text style={[pdfTabela.tdMuted, col.loja]}>{e.lojaNome ?? '-'}</Text> : null}
              </View>
            ))
          )}
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
