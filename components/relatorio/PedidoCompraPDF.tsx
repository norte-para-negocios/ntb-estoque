import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PdfCabecalho, PdfMetaBox, PdfResumoBar, PdfRodape, pdfTabela } from './PdfChrome'
import { moedaBR, numBRPdf } from '@/lib/pdf-utils'

// Pedido de compra para enviar ao fornecedor (I4). Só o que é do fornecedor: sem observação interna.
const col = StyleSheet.create({
  item: { width: '5%' },
  codigo: { width: '11%' },
  desc: { width: '36%' },
  un: { width: '7%' },
  qtd: { width: '13%', textAlign: 'right' },
  preco: { width: '13%', textAlign: 'right' },
  total: { width: '15%', textAlign: 'right' },
})
const s = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 28, paddingBottom: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  bloco: { marginTop: 10 },
  titulo: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, marginBottom: 3 },
  texto: { fontSize: 8.5, color: '#374151', lineHeight: 1.4 },
  linha: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 },
})

export type PedidoPDFDados = {
  loja: string; lojaCnpj: string | null; numero: number; etapa: string; emissao: string; previsao: string | null
  fornecedor: string; fornecedorCnpj: string | null; numeroFornecedor: string | null; contato: string | null
  itens: { linha: number; codigo: string; descricao: string; unidade: string; quantidade: number; preco: number; obs: string | null }[]
  mercadorias: number; frete: number; outras: number; total: number
  parcelas: { numero: number; vencimento: string | null; dias: number; valor: number }[]
  obs: string | null; aprovadoPor: string | null
}

export function PedidoCompraPDF({ d }: { d: PedidoPDFDados }) {
  const meta = [
    { rotulo: 'Comprador', valor: d.lojaCnpj ? `${d.loja} · CNPJ ${d.lojaCnpj}` : d.loja },
    { rotulo: 'Fornecedor', valor: d.fornecedorCnpj ? `${d.fornecedor} · CNPJ ${d.fornecedorCnpj}` : d.fornecedor },
    ...(d.contato ? [{ rotulo: 'Contato', valor: d.contato }] : []),
    ...(d.numeroFornecedor ? [{ rotulo: 'Seu nº de pedido', valor: d.numeroFornecedor }] : []),
    ...(d.aprovadoPor ? [{ rotulo: 'Aprovado por', valor: d.aprovadoPor }] : []),
  ]
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={s.page}>
        <PdfCabecalho titulo={`Pedido de compra nº ${d.numero}`} sub={`${d.loja} · ${d.etapa}`} />
        <PdfResumoBar campos={[
          { label: 'Emissão', valor: d.emissao },
          { label: 'Previsão de entrega', valor: d.previsao ?? 'a combinar' },
          { label: 'Itens', valor: String(d.itens.length) },
          { label: 'Total', valor: moedaBR(d.total), destaque: true, alinhaDireita: true },
        ]} />
        <PdfMetaBox campos={meta} />

        <View style={[pdfTabela.table, { marginTop: 10 }]}>
          <View style={pdfTabela.theadBrand} fixed>
            <Text style={[pdfTabela.thBrand, col.item]}>#</Text>
            <Text style={[pdfTabela.thBrand, col.codigo]}>Código</Text>
            <Text style={[pdfTabela.thBrand, col.desc]}>Descrição</Text>
            <Text style={[pdfTabela.thBrand, col.un]}>Un.</Text>
            <Text style={[pdfTabela.thBrand, col.qtd]}>Quantidade</Text>
            <Text style={[pdfTabela.thBrand, col.preco]}>Preço unit.</Text>
            <Text style={[pdfTabela.thBrand, col.total]}>Total</Text>
          </View>
          {d.itens.map((it, i) => (
            <View key={it.linha} style={[pdfTabela.tr, i % 2 === 1 ? pdfTabela.trAlt : {}]} wrap={false}>
              <Text style={[pdfTabela.tdMuted, col.item]}>{it.linha}</Text>
              <Text style={[pdfTabela.tdMuted, col.codigo]}>{it.codigo}</Text>
              <Text style={[pdfTabela.td, col.desc]}>{it.descricao}{it.obs ? ` — ${it.obs}` : ''}</Text>
              <Text style={[pdfTabela.tdMuted, col.un]}>{it.unidade}</Text>
              <Text style={[pdfTabela.td, col.qtd]}>{numBRPdf(it.quantidade)}</Text>
              <Text style={[pdfTabela.td, col.preco]}>{moedaBR(it.preco)}</Text>
              <Text style={[pdfTabela.td, col.total]}>{moedaBR(it.quantidade * it.preco)}</Text>
            </View>
          ))}
          <View style={pdfTabela.totalRow} wrap={false}>
            <Text style={[pdfTabela.totalTxt, { flex: 1 }]}>Mercadorias</Text>
            <Text style={[pdfTabela.totalTxt, col.total]}>{moedaBR(d.mercadorias)}</Text>
          </View>
        </View>
        {d.frete > 0 && <View style={s.linha}><Text style={s.texto}>Frete: {moedaBR(d.frete)}</Text></View>}
        {d.outras > 0 && <View style={s.linha}><Text style={s.texto}>Outras despesas: {moedaBR(d.outras)}</Text></View>}
        <View style={s.linha}><Text style={[s.titulo, { marginTop: 4 }]}>Total do pedido: {moedaBR(d.total)}</Text></View>

        {d.parcelas.length > 0 && (
          <View style={s.bloco}>
            <Text style={s.titulo}>Condição de pagamento</Text>
            {d.parcelas.map((p) => <Text key={p.numero} style={s.texto}>{p.numero}ª parcela · {p.vencimento ?? `${p.dias} dias após a entrega`} · {moedaBR(p.valor)}</Text>)}
          </View>
        )}
        {d.obs && (
          <View style={s.bloco}>
            <Text style={s.titulo}>Observações</Text>
            <Text style={s.texto}>{d.obs}</Text>
          </View>
        )}
        <PdfRodape />
      </Page>
    </Document>
  )
}
