import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfResumoBar, PdfRodape, pdfTabela } from './PdfChrome'
import { moedaBR } from '@/lib/pdf-utils'
import type { LinhaLivro, TotalCfop } from '@/lib/contador/livro-entradas-puro'

// Fase F: livro de entradas do mês (modelo do Registro de Entradas), para o contador. Paisagem, uma linha por nota × CFOP.
const col = StyleSheet.create({
  entrada: { width: '7%' },
  emissao: { width: '7%' },
  doc: { width: '9%' },
  forn: { width: '22%' },
  uf: { width: '4%' },
  cfop: { width: '6%' },
  valor: { width: '10%', textAlign: 'right' },
  bc: { width: '9%', textAlign: 'right' },
  icms: { width: '8%', textAlign: 'right' },
  st: { width: '6%', textAlign: 'right' },
  ipi: { width: '6%', textAlign: 'right' },
  pc: { width: '6%', textAlign: 'right' },
})
const s = StyleSheet.create({
  page: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 40, fontSize: 7.5, fontFamily: 'Helvetica', color: '#111' },
  titulo: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginTop: 12, marginBottom: 4 },
  aviso: { fontSize: 7.5, color: '#b45309', marginTop: 6 },
})
const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')
const cnpjFmt = (d: string) => (d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : '')

export type LivroPDFDados = { loja: string; mesRotulo: string; linhas: LinhaLivro[]; totaisCfop: TotalCfop[]; total: TotalCfop; avisos: string[] }

export function LivroEntradasPDF({ d }: { d: LivroPDFDados }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <PdfCabecalho titulo="Livro de entradas" sub={`${d.loja} · ${d.mesRotulo}`} />
        <PdfResumoBar campos={[
          { label: 'Notas', valor: String(d.total.notas) },
          { label: 'ICMS', valor: moedaBR(d.total.icms) },
          { label: 'IPI', valor: moedaBR(d.total.ipi) },
          { label: 'Valor contábil', valor: moedaBR(d.total.valorContabil), destaque: true, alinhaDireita: true },
        ]} />
        {d.avisos.map((a) => <Text key={a} style={s.aviso}>{a}</Text>)}
        <View style={[pdfTabela.table, { marginTop: 8 }]}>
          <View style={pdfTabela.theadBrand} fixed>
            <Text style={[pdfTabela.thBrand, col.entrada]}>Entrada</Text>
            <Text style={[pdfTabela.thBrand, col.emissao]}>Emissão</Text>
            <Text style={[pdfTabela.thBrand, col.doc]}>NF-e / série</Text>
            <Text style={[pdfTabela.thBrand, col.forn]}>Fornecedor</Text>
            <Text style={[pdfTabela.thBrand, col.uf]}>UF</Text>
            <Text style={[pdfTabela.thBrand, col.cfop]}>CFOP</Text>
            <Text style={[pdfTabela.thBrand, col.valor]}>Valor contábil</Text>
            <Text style={[pdfTabela.thBrand, col.bc]}>Base ICMS</Text>
            <Text style={[pdfTabela.thBrand, col.icms]}>ICMS</Text>
            <Text style={[pdfTabela.thBrand, col.st]}>ICMS-ST</Text>
            <Text style={[pdfTabela.thBrand, col.ipi]}>IPI</Text>
            <Text style={[pdfTabela.thBrand, col.pc]}>PIS+COFINS</Text>
          </View>
          {d.linhas.map((l, i) => (
            <View key={`${l.notaId}-${l.cfop}`} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.td, col.entrada]}>{br(l.dataEntrada)}</Text>
              <Text style={[pdfTabela.tdMuted, col.emissao]}>{br(l.emissao)}</Text>
              <Text style={[pdfTabela.td, col.doc]}>{l.numero}{l.serie ? ` / ${l.serie}` : ''}</Text>
              <Text style={[pdfTabela.td, col.forn]}>{l.fornecedor}{l.cnpj.length === 14 ? `\n${cnpjFmt(l.cnpj)}` : ''}</Text>
              <Text style={[pdfTabela.tdMuted, col.uf]}>{l.uf}</Text>
              <Text style={[pdfTabela.td, col.cfop]}>{l.cfop}</Text>
              <Text style={[pdfTabela.td, col.valor]}>{moedaBR(l.valorContabil)}</Text>
              <Text style={[pdfTabela.td, col.bc]}>{moedaBR(l.baseIcms)}</Text>
              <Text style={[pdfTabela.td, col.icms]}>{moedaBR(l.icms)}</Text>
              <Text style={[pdfTabela.td, col.st]}>{moedaBR(l.icmsSt)}</Text>
              <Text style={[pdfTabela.td, col.ipi]}>{moedaBR(l.ipi)}</Text>
              <Text style={[pdfTabela.td, col.pc]}>{moedaBR(l.pis + l.cofins)}</Text>
            </View>
          ))}
        </View>

        <Text style={s.titulo}>Resumo por CFOP</Text>
        <View style={pdfTabela.table}>
          {[...d.totaisCfop, d.total].map((t) => (
            <View key={t.cfop} style={t.cfop === 'Total' ? pdfTabela.totalRow : pdfTabela.tr} wrap={false}>
              <Text style={[t.cfop === 'Total' ? pdfTabela.totalTxt : pdfTabela.td, { width: '55%' }]}>{t.cfop} · {t.notas} nota(s)</Text>
              <Text style={[t.cfop === 'Total' ? pdfTabela.totalTxt : pdfTabela.td, col.valor]}>{moedaBR(t.valorContabil)}</Text>
              <Text style={[t.cfop === 'Total' ? pdfTabela.totalTxt : pdfTabela.td, col.bc]}>{moedaBR(t.baseIcms)}</Text>
              <Text style={[t.cfop === 'Total' ? pdfTabela.totalTxt : pdfTabela.td, col.icms]}>{moedaBR(t.icms)}</Text>
              <Text style={[t.cfop === 'Total' ? pdfTabela.totalTxt : pdfTabela.td, col.st]}>{moedaBR(t.icmsSt)}</Text>
              <Text style={[t.cfop === 'Total' ? pdfTabela.totalTxt : pdfTabela.td, col.ipi]}>{moedaBR(t.ipi)}</Text>
              <Text style={[t.cfop === 'Total' ? pdfTabela.totalTxt : pdfTabela.td, col.pc]}>{moedaBR(t.pis + t.cofins)}</Text>
            </View>
          ))}
        </View>
        <PdfRodape />
      </Page>
    </Document>
  )
}
