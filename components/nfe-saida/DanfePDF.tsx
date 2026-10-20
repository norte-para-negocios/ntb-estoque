import { Document, Page, Text, View, StyleSheet, Svg, Rect } from '@react-pdf/renderer'
import { chaveEmGrupos, code128C, docFormatado, MOD_FRETE, type DadosDanfe } from '@/lib/nfe-saida/danfe-puro'

// DANFE retrato simplificado (Fase F, F1/F2) a partir do procNFe: blocos do leiaute oficial (emitente, código de barras
// da chave, destinatário, cálculo do imposto, transportador, itens, dados adicionais). Homologação e cancelada saem com
// a tarja. Não substitui um DANFE certificado; serve para acompanhar a mercadoria e para conferência.

const s = StyleSheet.create({
  page: { padding: 18, fontSize: 7, fontFamily: 'Helvetica', color: '#000' },
  caixa: { borderWidth: 0.7, borderColor: '#000', padding: 3 },
  linha: { flexDirection: 'row' },
  rot: { fontSize: 5.5, color: '#333', textTransform: 'uppercase' },
  val: { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  titulo: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', marginTop: 5, marginBottom: 1 },
  tarja: { position: 'absolute', top: 360, left: 20, right: 20, textAlign: 'center', fontSize: 26, color: '#cc0000', opacity: 0.25, transform: 'rotate(-30deg)' },
  th: { fontSize: 5.5, fontFamily: 'Helvetica-Bold', borderBottomWidth: 0.5, paddingVertical: 1 },
  td: { fontSize: 6.3, paddingVertical: 1 },
})

const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
const dataBR = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 19)}` : '')

function Campo({ r, v, w, alinhar }: { r: string; v: string; w: string; alinhar?: 'right' }) {
  return (
    <View style={[s.caixa, { width: w }]}>
      <Text style={s.rot}>{r}</Text>
      <Text style={[s.val, alinhar ? { textAlign: alinhar } : {}]}>{v || ' '}</Text>
    </View>
  )
}

function Barras({ chave }: { chave: string }) {
  const larg = code128C(chave)
  const total = larg.reduce((a, x) => a + x, 0)
  const W = 200, H = 30 // cabe no bloco da chave com margem (zona de silêncio)
  const m = W / total
  let x = 0
  const barras: { x: number; w: number }[] = []
  larg.forEach((l, i) => { if (i % 2 === 0) barras.push({ x, w: l * m }); x += l * m })
  return (
    <Svg width={W} height={H}>
      {barras.map((b, i) => <Rect key={i} x={b.x} y={0} width={b.w} height={H} fill="#000" />)}
    </Svg>
  )
}

const COL = { cod: '9%', desc: '27%', ncm: '7%', cst: '5%', cfop: '5%', un: '4%', q: '8%', vun: '8%', vtot: '8%', bc: '7%', icms: '6%', aliq: '6%' }

export function DanfePDF({ d, cancelada }: { d: DadosDanfe; cancelada?: boolean }) {
  const homolog = d.tpAmb === '2'
  return (
    <Document title={`DANFE ${d.numero}`}>
      <Page size="A4" style={s.page}>
        {(homolog || cancelada) && <Text style={s.tarja} fixed>{cancelada ? 'NF-e CANCELADA' : 'SEM VALOR FISCAL — HOMOLOGAÇÃO'}</Text>}
        <View style={s.linha}>
          <View style={[s.caixa, { width: '42%' }]}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>{d.emit.nome}</Text>
            <Text>{d.emit.endereco}</Text>
            <Text>{d.emit.municipio} - {d.emit.uf} · CEP {d.emit.cep}{d.emit.fone ? ` · Fone ${d.emit.fone}` : ''}</Text>
          </View>
          <View style={[s.caixa, { width: '18%', alignItems: 'center' }]}>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>DANFE</Text>
            <Text style={{ fontSize: 5.5, textAlign: 'center' }}>Documento Auxiliar da Nota Fiscal Eletrônica</Text>
            <Text style={{ marginTop: 2 }}>{d.tpNF === '0' ? '0 - Entrada' : '1 - Saída'}</Text>
            <Text style={s.val}>Nº {d.numero.padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}</Text>
            <Text>Série {d.serie} · Folha 1/1</Text>
          </View>
          <View style={[s.caixa, { width: '40%', alignItems: 'center' }]}>
            <Barras chave={d.chave} />
            <Text style={s.rot}>Chave de acesso</Text>
            <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold' }}>{chaveEmGrupos(d.chave)}</Text>
            <Text style={{ fontSize: 5.5, textAlign: 'center' }}>Consulta de autenticidade no portal nacional da NF-e (www.nfe.fazenda.gov.br/portal) ou no site da SEFAZ autorizadora</Text>
          </View>
        </View>
        <View style={s.linha}>
          <Campo r="Natureza da operação" v={d.natOp} w="60%" />
          <Campo r="Protocolo de autorização de uso" v={d.protocolo ? `${d.protocolo} ${dataBR(d.dhRecbto)}` : 'NÃO AUTORIZADA'} w="40%" />
        </View>
        <View style={s.linha}>
          <Campo r="Inscrição estadual" v={d.emit.ie} w="33%" />
          <Campo r="Nome fantasia" v={d.emit.fantasia} w="34%" />
          <Campo r="CNPJ" v={docFormatado(d.emit.doc)} w="33%" />
        </View>

        <Text style={s.titulo}>DESTINATÁRIO / REMETENTE</Text>
        <View style={s.linha}>
          <Campo r="Nome / razão social" v={d.dest.nome} w="55%" />
          <Campo r="CNPJ / CPF" v={docFormatado(d.dest.doc)} w="25%" />
          <Campo r="Data da emissão" v={dataBR(d.dhEmi).slice(0, 10)} w="20%" />
        </View>
        <View style={s.linha}>
          <Campo r="Endereço" v={d.dest.endereco} w="45%" />
          <Campo r="Bairro" v={d.dest.bairro} w="25%" />
          <Campo r="CEP" v={d.dest.cep} w="10%" />
          <Campo r="Hora da emissão" v={dataBR(d.dhEmi).slice(11)} w="20%" />
        </View>
        <View style={s.linha}>
          <Campo r="Município" v={d.dest.municipio} w="45%" />
          <Campo r="UF" v={d.dest.uf} w="10%" />
          <Campo r="Inscrição estadual" v={d.dest.ie} w="45%" />
        </View>

        <Text style={s.titulo}>CÁLCULO DO IMPOSTO</Text>
        <View style={s.linha}>
          <Campo r="Base de cálculo do ICMS" v={brl(d.totais.vBC)} w="20%" alinhar="right" />
          <Campo r="Valor do ICMS" v={brl(d.totais.vICMS)} w="20%" alinhar="right" />
          <Campo r="Base de cálculo ICMS ST" v={brl(d.totais.vBCST)} w="20%" alinhar="right" />
          <Campo r="Valor do ICMS ST" v={brl(d.totais.vST)} w="20%" alinhar="right" />
          <Campo r="Valor total dos produtos" v={brl(d.totais.vProd)} w="20%" alinhar="right" />
        </View>
        <View style={s.linha}>
          <Campo r="Valor do frete" v={brl(d.totais.vFrete)} w="16%" alinhar="right" />
          <Campo r="Valor do seguro" v={brl(d.totais.vSeg)} w="16%" alinhar="right" />
          <Campo r="Desconto" v={brl(d.totais.vDesc)} w="16%" alinhar="right" />
          <Campo r="Outras despesas" v={brl(d.totais.vOutro)} w="16%" alinhar="right" />
          <Campo r="IPI devolvido" v={brl(d.totais.vIPIDevol + d.totais.vIPI)} w="16%" alinhar="right" />
          <Campo r="Valor total da nota" v={brl(d.totais.vNF)} w="20%" alinhar="right" />
        </View>

        <Text style={s.titulo}>TRANSPORTADOR / VOLUMES TRANSPORTADOS</Text>
        <View style={s.linha}>
          <Campo r="Razão social" v={d.transp.nome} w="40%" />
          <Campo r="Frete por conta" v={MOD_FRETE[d.transp.modFrete] ?? d.transp.modFrete} w="20%" />
          <Campo r="CNPJ / CPF" v={docFormatado(d.transp.doc)} w="25%" />
          <Campo r="UF" v={d.transp.uf} w="15%" />
        </View>
        <View style={s.linha}>
          <Campo r="Quantidade" v={d.transp.qVol} w="20%" />
          <Campo r="Espécie" v={d.transp.esp} w="30%" />
          <Campo r="Peso bruto" v={d.transp.pesoB} w="25%" />
          <Campo r="Peso líquido" v={d.transp.pesoL} w="25%" />
        </View>

        <Text style={s.titulo}>DADOS DOS PRODUTOS</Text>
        <View style={s.caixa}>
          <View style={s.linha}>
            {(['Código', 'Descrição', 'NCM', 'CST', 'CFOP', 'Un', 'Quant.', 'V. unit.', 'V. total', 'BC ICMS', 'V. ICMS', 'Alíq.'] as const).map((h, i) => (
              <Text key={h} style={[s.th, { width: Object.values(COL)[i], textAlign: i >= 6 ? 'right' : 'left' }]}>{h}</Text>
            ))}
          </View>
          {d.itens.map((it, i) => (
            <View key={i} style={s.linha} wrap={false}>
              <Text style={[s.td, { width: COL.cod }]}>{it.cProd}</Text>
              <Text style={[s.td, { width: COL.desc }]}>{it.xProd}</Text>
              <Text style={[s.td, { width: COL.ncm }]}>{it.ncm}</Text>
              <Text style={[s.td, { width: COL.cst }]}>{it.cst}</Text>
              <Text style={[s.td, { width: COL.cfop }]}>{it.cfop}</Text>
              <Text style={[s.td, { width: COL.un }]}>{it.un}</Text>
              <Text style={[s.td, { width: COL.q, textAlign: 'right' }]}>{qtd(it.q)}</Text>
              <Text style={[s.td, { width: COL.vun, textAlign: 'right' }]}>{brl(it.vUn)}</Text>
              <Text style={[s.td, { width: COL.vtot, textAlign: 'right' }]}>{brl(it.vProd)}</Text>
              <Text style={[s.td, { width: COL.bc, textAlign: 'right' }]}>{brl(it.vBC)}</Text>
              <Text style={[s.td, { width: COL.icms, textAlign: 'right' }]}>{brl(it.vICMS)}</Text>
              <Text style={[s.td, { width: COL.aliq, textAlign: 'right' }]}>{it.pICMS ? brl(it.pICMS) : ''}</Text>
            </View>
          ))}
        </View>

        <Text style={s.titulo}>DADOS ADICIONAIS</Text>
        <View style={[s.caixa, { minHeight: 60 }]}>
          <Text style={s.rot}>Informações complementares</Text>
          <Text>{d.infCpl}</Text>
          {d.refs.length > 0 && <Text style={{ marginTop: 2 }}>NF-e referenciada: {d.refs.join(', ')}</Text>}
          {d.infAdFisco ? <Text style={{ marginTop: 2 }}>Fisco: {d.infAdFisco}</Text> : null}
        </View>
      </Page>
    </Document>
  )
}
