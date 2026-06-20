import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfRodape, PdfResumoBar, pdfTabela } from './PdfChrome'
import type { CategoriaLista, Contagem } from '@/lib/resumo-dia'

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
})

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 12 })
const fmtMoeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function ResumoDiaPDF({
  loja,
  dataBR,
  catLabel,
  contagem,
  lista,
}: {
  loja: string
  dataBR: string
  catLabel: string
  contagem: Contagem
  lista: CategoriaLista
}) {
  const sub = [loja, `Dia: ${dataBR}`].filter(Boolean).join(' · ')
  const temStatus = lista.linhas.some((l) => l.status)
  const cols = [...lista.colunas, ...(temStatus ? [{ label: 'Situação' }] : [])]
  const ncol = cols.length || 1
  const wCol = (alinharDir?: boolean) =>
    ({ width: `${100 / ncol}%`, textAlign: (alinharDir ? 'right' : 'left') as 'right' | 'left' })

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo="Resumo do dia" sub={sub} />

        <PdfResumoBar
          campos={[
            { label: 'Notas Fiscais', valor: fmt(contagem.notas) },
            { label: 'Transferências', valor: fmt(contagem.transferencias) },
            { label: 'Inventários', valor: fmt(contagem.inventarios) },
            { label: 'Produção', valor: `${fmt(contagem.opsConcluidas)}/${fmt(contagem.opsPrevistas)}` },
            { label: 'Etiquetas', valor: fmt(contagem.etiquetas) },
            { label: 'Erros', valor: fmt(contagem.erros) },
          ]}
        />

        {contagem.valorNotas > 0 ? (
          <Text style={{ fontSize: 9, marginBottom: 6, color: '#444' }}>
            Total em Notas Fiscais: {fmtMoeda(contagem.valorNotas)}
          </Text>
        ) : null}

        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>
          {catLabel} ({fmt(lista.total)})
        </Text>

        <View style={pdfTabela.table}>
          <View style={pdfTabela.thead} fixed>
            {cols.map((c, i) => (
              <Text key={i} style={[pdfTabela.th, wCol((c as { alinharDir?: boolean }).alinharDir)]}>{c.label}</Text>
            ))}
          </View>

          {lista.linhas.length === 0 ? (
            <View style={pdfTabela.tr}>
              <Text style={[pdfTabela.tdMuted, { flex: 1 }]}>Nada registrado nesta categoria.</Text>
            </View>
          ) : (
            lista.linhas.map((linha, ri) => (
              <View key={ri} style={[pdfTabela.tr, ri % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
                {linha.celulas.map((cel, ci) => (
                  <Text key={ci} style={[pdfTabela.td, wCol(lista.colunas[ci]?.alinharDir)]}>{cel ?? '-'}</Text>
                ))}
                {temStatus && <Text style={[pdfTabela.tdMuted, wCol(false)]}>{linha.status?.label ?? '-'}</Text>}
              </View>
            ))
          )}
        </View>

        <PdfRodape />
      </Page>
    </Document>
  )
}
