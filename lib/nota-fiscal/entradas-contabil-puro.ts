// Relatório de entradas de NF para a contabilidade, no formato do Omie (uma linha por item, 195 colunas), para a loja de
// estoque próprio. Pedido do Ramon na reunião de 27/10/2026: "tem que trazer todos os campos da nota fiscal", modelo =
// planilha do Sertão de setembro; o que a nota não traz sai "N/D", mas a coluna existe.
// Fontes: o XML completo da SEFAZ (sefaz_documentos.xml) para tudo que é da nota, e a entrada conferida
// (compras_proprio / compras_proprio_itens) para o que é nosso: produto interno, CFOP de entrada, local, custo.
// Sem imports além do parser: node --test lib/nota-fiscal/entradas-contabil-puro.test.ts
// @ts-expect-error: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { parseXml } from '../estoque/nfe-xml.ts'
// @ts-expect-error: idem
import { descreverCFOP } from '../cfop.ts'
// @ts-expect-error: idem
import { COLUNAS_ENTRADAS_OMIE } from './entradas-colunas.ts'

type No = ReturnType<typeof parseXml>
export type Coluna = (typeof COLUNAS_ENTRADAS_OMIE)[number]
export type Celula = string | number | Date
export type LinhaEntrada = Record<Coluna, Celula>

export type NotaEntrada = {
  numero: string | null; serie: string | null; chave: string | null; emissao: string | null
  fornecedorRazao: string | null; fornecedorFantasia: string | null; fornecedorCnpj: string | null; fornecedorIe: string | null
  fornecedorCidade: string | null; fornecedorUf: string | null
  cancelada: boolean; canceladaEm: string | null
  registradaEm: string | null // chegou no sistema (SEFAZ ou importação)
  origem: string | null // 'sefaz' | 'xml' | 'manual'
  manifestacao: string | null // tp_evento mais recente respondido pela SEFAZ
  xml: string | null // procNFe completo; null = só o resumo (resNFe)
}
export type CompraEntrada = { status: string; lancadaEm: string | null; obs: string | null } | null
export type ItemEntrada = {
  linha: number; cProd: string | null; descricao: string | null; ean: string | null; ncm: string | null; cfop: string | null
  unidadeCompra: string | null; quantidade: number; valorUnitario: number; valorTotal: number; desconto: number
  fator: number; quantidadeRecebida: number | null; unidadeEstoque: string | null; custoUnitarioBase: number | null
  cfopEntrada: string | null; lancado: boolean; matchOrigem: string | null
  movimentaEstoque: boolean; geraContaPagar: boolean; lote: string | null; validade: string | null
  flags: { icms: boolean; icmsSt: boolean; ipi: boolean; pis: boolean; cofins: boolean; frete: boolean; seguro: boolean; outras: boolean } | null
  aliqCredPis: number; aliqCredCofins: number
  produto: { codigo: string; descricao: string; familia: string | null; tipoItem: string | null } | null
  local: { codigo: string; descricao: string } | null
  categoria: string | null
  cmcAtual: number | null; estoqueDisponivel: number | null
}

const ND = 'N/D'
const num = (s: string | undefined | null): number => { const n = Number(String(s ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const ou = (v: string | null | undefined): string => (v && v.trim() ? v.trim() : ND)

function achar(no: No | undefined, ...caminho: string[]): No | undefined {
  let atual = no
  for (const nome of caminho) {
    if (!atual) return undefined
    atual = atual.filhos.find((f) => f.nome === nome)
  }
  return atual
}
function buscar(no: No, nome: string): No | undefined {
  if (no.nome === nome) return no
  for (const f of no.filhos) { const r = buscar(f, nome); if (r) return r }
  return undefined
}
const txt = (no: No | undefined, ...c: string[]) => (achar(no, ...c)?.texto ?? '').trim()

/** "2026-10-27" ou ISO com hora -> Date à meia-noite (a planilha do Omie traz só a data). */
export function dataPlanilha(s: string | null | undefined): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '')
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : ND
}
/** Data local de Salvador (UTC-3) de um timestamp. */
export function diaBahia(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10)
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)
}

export function formatarCnpj(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return ou(v)
}
export function formatarNcm(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : ou(v)
}

// CFOP de saída que o fornecedor usa na nota (o dicionário de lib/cfop.ts é só de entrada).
const CFOP_SAIDA: Record<string, string> = {
  '101': 'Venda de produção do estabelecimento', '102': 'Venda de mercadoria adquirida ou recebida de terceiros',
  '104': 'Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento',
  '117': 'Venda de mercadoria originada de encomenda para entrega futura', '119': 'Venda de mercadoria adquirida ou recebida de terceiros remetida para industrialização por conta e ordem do adquirente',
  '401': 'Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária',
  '403': 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto',
  '405': 'Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído',
  '656': 'Venda de combustível ou lubrificante adquirido ou recebido de terceiros destinado a consumidor ou usuário final',
  '908': 'Remessa de bem por conta de contrato de comodato', '910': 'Remessa em bonificação, doação ou brinde',
  '911': 'Remessa de amostra grátis', '915': 'Remessa de mercadoria ou bem para conserto ou reparo',
  '920': 'Remessa de vasilhame ou sacaria', '929': 'Lançamento efetuado em decorrência de emissão de documento fiscal relativo a operação ou prestação também registrada em equipamento Emissor de Cupom Fiscal - ECF',
  '949': 'Outra saída de mercadoria ou prestação de serviço não especificado',
}
const pontoCfop = (c: string) => (c.length === 4 ? `${c[0]}.${c.slice(1)}` : c)
export function rotuloCfopEntrada(c: string | null | undefined): string {
  const so = (c ?? '').replace(/\D/g, '')
  if (!so) return ND
  const d = descreverCFOP(so)
  return d.desc === 'CFOP não catalogado' ? pontoCfop(so) : `${pontoCfop(so)} - ${d.desc}`
}
export function rotuloCfopSaida(c: string | null | undefined): string {
  const so = (c ?? '').replace(/\D/g, '')
  if (!so) return ND
  const d = CFOP_SAIDA[so.slice(-3)]
  return d ? `${pontoCfop(so)} - ${d}` : pontoCfop(so)
}

const CST_ICMS: Record<string, string> = {
  '00': 'Tributada integralmente', '02': 'Tributação monofásica própria sobre combustíveis', '10': 'Tributada e com cobrança do ICMS por substituição tributária',
  '15': 'Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis', '20': 'Com redução de base de cálculo',
  '30': 'Isenta ou não tributada e com cobrança do ICMS por substituição tributária', '40': 'Isenta', '41': 'Não tributada', '50': 'Suspensão',
  '51': 'Diferimento', '53': 'Tributação monofásica sobre combustíveis com recolhimento diferido', '60': 'ICMS cobrado anteriormente por substituição tributária',
  '61': 'Tributação monofásica sobre combustíveis cobrada anteriormente', '70': 'Com redução de base de cálculo e cobrança do ICMS por substituição tributária', '90': 'Outros',
}
const CSOSN: Record<string, string> = {
  '101': 'Tributada pelo Simples Nacional com permissão de crédito', '102': 'Tributada pelo Simples Nacional sem permissão de crédito',
  '103': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta', '201': 'Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária',
  '202': 'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária',
  '203': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária',
  '300': 'Imune', '400': 'Não tributada pelo Simples Nacional', '500': 'ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação', '900': 'Outros',
}
const ORIGEM: Record<string, string> = {
  '0': 'Nacional, exceto as indicadas nos códigos 3, 4, 5 e 8', '1': 'Estrangeira - Importação direta, exceto a indicada no código 6',
  '2': 'Estrangeira - Adquirida no mercado interno, exceto a indicada no código 7', '3': 'Nacional, mercadoria ou bem com Conteúdo de Importação superior a 40% e inferior ou igual a 70%',
  '4': 'Nacional, cuja produção tenha sido feita em conformidade com os processos produtivos básicos', '5': 'Nacional, mercadoria ou bem com Conteúdo de Importação inferior ou igual a 40%',
  '6': 'Estrangeira - Importação direta, sem similar nacional, constante em lista da CAMEX', '7': 'Estrangeira - Adquirida no mercado interno, sem similar nacional, constante em lista da CAMEX',
  '8': 'Nacional, mercadoria ou bem com Conteúdo de Importação superior a 70%',
}
const MOD_BC: Record<string, string> = { '0': 'Margem Valor Agregado (%)', '1': 'Pauta (valor)', '2': 'Preço Tabelado Máximo (valor)', '3': 'Valor da Operação' }
const MOD_BC_ST: Record<string, string> = {
  '0': 'Preço Tabelado ou Máximo Sugerido', '1': 'Lista Negativa (valor)', '2': 'Lista Positiva (valor)', '3': 'Lista Neutra (valor)',
  '4': 'Margem Valor Agregado (%)', '5': 'Pauta (valor)', '6': 'Valor da Operação',
}
const CST_IPI: Record<string, string> = {
  '00': 'Entrada com recuperação de crédito', '01': 'Entrada tributada com alíquota zero', '02': 'Entrada isenta', '03': 'Entrada não-tributada', '04': 'Entrada imune',
  '05': 'Entrada com suspensão', '49': 'Outras entradas', '50': 'Saída tributada', '51': 'Saída tributada com alíquota zero', '52': 'Saída isenta',
  '53': 'Saída não-tributada', '54': 'Saída imune', '55': 'Saída com suspensão', '99': 'Outras saídas',
}
const CST_PIS: Record<string, string> = {
  '01': 'Operação Tributável (base de cálculo = valor da operação alíquota normal (cumulativo/não cumulativo))',
  '02': 'Operação Tributável (base de cálculo = valor da operação (alíquota diferenciada))',
  '03': 'Operação Tributável (base de cálculo = quantidade vendida x alíquota por unidade de produto)',
  '04': 'Operação Tributável (tributação monofásica (alíquota zero))', '05': 'Operação Tributável (Substituição Tributária)',
  '06': 'Operação Tributável (alíquota zero)', '07': 'Operação Isenta da Contribuição', '08': 'Operação Sem Incidência da Contribuição',
  '09': 'Operação com Suspensão da Contribuição', '49': 'Outras Operações de Saída', '98': 'Outras Operações de Entrada', '99': 'Outras Operações',
}
const TIPO_ITEM: Record<string, string> = {
  '00': 'Mercadoria para Revenda', '01': 'Matéria Prima', '02': 'Embalagem', '03': 'Produto em Processo', '04': 'Produto Acabado', '05': 'Subproduto',
  '06': 'Produto Intermediário', '07': 'Material de Uso e Consumo', '08': 'Ativo Imobilizado', '09': 'Serviços', '10': 'Outros Insumos', '99': 'Outras',
}
const MANIFESTACAO: Record<string, string> = {
  '210200': 'Confirmação da Operação', '210210': 'Ciência da Operação', '210220': 'Desconhecimento da Operação', '210240': 'Operação Não Realizada',
}
const rot = (tab: Record<string, string>, c: string | null | undefined) => (c ? (tab[c] ? `${c} - ${tab[c]}` : c) : ND)
export const rotuloCstIcms = (c: string | null | undefined) => rot(CST_ICMS, c)
export const rotuloTipoItem = (c: string | null | undefined) => rot(TIPO_ITEM, c)

/**
 * Entrada (como o Omie classifica a entrada do Sertão em set/2026): ICMS 60 quando a nota veio com ST (CST 10/30/60/70 ou
 * CSOSN 201/202/203/500), senão 90; IPI 49; PIS e COFINS 98; não se credita do ICMS. É regra observada na planilha
 * do Ramon, não decisão fiscal nossa: a contabilidade confere.
 */
export function cstIcmsEntrada(cst: string | null, csosn: string | null): string {
  const st = ['10', '30', '60', '70'].includes(cst ?? '') || ['201', '202', '203', '500'].includes(csosn ?? '')
  return rotuloCstIcms(st ? '60' : '90')
}

export function rotuloParcelas(n: number): string {
  if (n <= 0) return 'A Vista'
  return n === 1 ? '1 Parcela' : `${n} parcelas`
}

type Situacao = { situacao: string; etapa: string }
export function situacaoDaNota(nota: Pick<NotaEntrada, 'cancelada'>, compra: CompraEntrada): Situacao {
  if (nota.cancelada) return { situacao: 'Cancelado', etapa: 'Cancelado' }
  if (compra?.status === 'lancada') return { situacao: 'Concluído', etapa: 'Recebido' }
  return { situacao: 'Faturado pelo Fornecedor', etapa: 'Faturado pelo Fornecedor' }
}

const ORIGEM_NOTA: Record<string, string> = { sefaz: 'Importada da SEFAZ (DF-e)', xml: 'Importada do XML', manual: 'Lançada sem XML' }

/** Um item do XML: as tags de imposto por grupo (o primeiro filho de ICMS/PIS/COFINS é o grupo do CST). */
type DetXml = { det: No; prod: No }
function detsDoXml(xml: string | null): { inf: No | null; dets: Map<number, DetXml> } {
  const dets = new Map<number, DetXml>()
  if (!xml) return { inf: null, dets }
  let inf: No | undefined
  try { inf = buscar(parseXml(xml), 'infNFe') } catch { return { inf: null, dets } }
  if (!inf) return { inf: null, dets }
  let i = 0
  for (const det of inf.filhos.filter((f) => f.nome === 'det')) {
    i++
    const prod = achar(det, 'prod')
    if (prod) dets.set(Number(det.attrs.nItem) || i, { det, prod })
  }
  return { inf, dets }
}

export function montarLinhas(nota: NotaEntrada, compra: CompraEntrada, itens: ItemEntrada[]): LinhaEntrada[] {
  const { inf, dets } = detsDoXml(nota.xml)
  const transp = achar(inf ?? undefined, 'transp')
  const transporta = achar(transp, 'transporta')
  const vol = achar(transp, 'vol')
  const cobr = achar(inf ?? undefined, 'cobr')
  const emit = achar(inf ?? undefined, 'emit')
  const enderEmit = achar(emit, 'enderEmit')
  const nDup = (cobr?.filhos ?? []).filter((f) => f.nome === 'dup').length
  const infCpl = txt(achar(inf ?? undefined, 'infAdic'), 'infCpl')
  const fornCnpj = (nota.fornecedorCnpj ?? '').replace(/\D/g, '')
  const transpCnpj = (txt(transporta, 'CNPJ') || txt(transporta, 'CPF')).replace(/\D/g, '')
  const fornecedorTransporta = !!transpCnpj && transpCnpj === fornCnpj
  const { situacao, etapa } = situacaoDaNota(nota, compra)
  const registro = dataPlanilha(diaBahia(nota.registradaEm) ?? nota.emissao)
  const recebimento = compra?.status === 'lancada' ? dataPlanilha(diaBahia(compra.lancadaEm)) : ND
  const cancel = nota.cancelada ? dataPlanilha(diaBahia(nota.canceladaEm)) : ND

  return [...itens].sort((a, b) => a.linha - b.linha).map((it) => {
    const x = dets.get(it.linha)
    const imp = achar(x?.det, 'imposto')
    const icms = achar(imp, 'ICMS')?.filhos[0]
    const ipiNo = achar(imp, 'IPI')
    const ipi = achar(ipiNo, 'IPITrib') ?? achar(ipiNo, 'IPINT')
    const pis = achar(imp, 'PIS')?.filhos[0]
    const cofins = achar(imp, 'COFINS')?.filhos[0]
    const is = achar(imp, 'IS')
    const ibscbs = achar(imp, 'IBSCBS')
    const g = achar(ibscbs, 'gIBSCBS')
    const gUF = achar(g, 'gIBSUF')
    const gMun = achar(g, 'gIBSMun')
    const gCBS = achar(g, 'gCBS')
    const cst = txt(icms, 'CST') || null
    const csosn = txt(icms, 'CSOSN') || null
    const frete = num(txt(x?.prod, 'vFrete'))
    const seguro = num(txt(x?.prod, 'vSeg'))
    const outras = num(txt(x?.prod, 'vOutro'))
    const vIpi = num(txt(ipi, 'vIPI'))
    const vSt = num(txt(icms, 'vICMSST'))
    const totalItem = r2(it.valorTotal - it.desconto + vIpi + vSt + num(txt(icms, 'vFCPST')) + frete + seguro + outras)
    const fator = it.fator || 1
    const qtdEstoque = it.quantidadeRecebida ?? r6(it.quantidade * fator)
    const p = it.produto
    const f = it.flags
    const sn = (v: boolean | undefined) => (f ? (v ? 'S' : 'N') : ND)
    const tipoCalc = (no: No | undefined, aliq: string) => (txt(no, aliq) ? 'B - Base de Cálculo x Alíquota' : txt(no, 'qBCProd') ? 'Q - Quantidade x Valor' : ND)
    const linha: Record<string, Celula> = {
      'Situação': situacao,
      'Operação': 'Nota Fiscal Recebida',
      'Etapa': etapa,
      'Origem': ORIGEM_NOTA[nota.origem ?? ''] ?? ou(nota.origem),
      'Data de Emissão': dataPlanilha(nota.emissao),
      'Data de Emissão (completa)': dataPlanilha(nota.emissao),
      'Data de Registro': registro,
      'Data de Registro (completa)': registro,
      'Categoria': ou(it.categoria),
      'Conta Corrente': ND,
      'Departamento': ND,
      'Nota Fiscal': ou(nota.numero ? nota.numero.padStart(9, '0') : null),
      'Conhecimento de Transporte': ND,
      'Série': ou(nota.serie),
      'Chave de Acesso da NF-e': ou(nota.chave),
      'Chave de Acesso do CT-e': ND,
      'Documentos Fiscais Relacionados': ND,
      'Pedidos Relacionados': ND,
      'Pedido de Compra': ND,
      'Número de Parcelas': inf ? rotuloParcelas(nDup) : ND,
      'Dados Adicionais para a Nota Fiscal': ou(infCpl),
      'Comprador': ND,
      'Projeto': ND,
      'Manifestação do Destinatário': nota.manifestacao ? (MANIFESTACAO[nota.manifestacao] ?? nota.manifestacao) : ND,
      'Data do Cancelamento': cancel,
      'Data do Cancelamento (completa)': cancel,
      'Data do Recebimento': recebimento,
      'Data do Recebimento (completa)': recebimento,
      'Fornecedor/Cliente (Razão Social)': ou(nota.fornecedorRazao),
      'Fornecedor/Cliente (Nome Fantasia)': ou(txt(emit, 'xFant') || nota.fornecedorFantasia || nota.fornecedorRazao),
      'Fornecedor/Cliente (CNPJ/CPF)': formatarCnpj(nota.fornecedorCnpj),
      'Fornecedor/Cliente (Inscrição Estadual)': ou(nota.fornecedorIe || txt(emit, 'IE')),
      'Fornecedor/Cliente (Inscrição SUFRAMA)': ND,
      'Fornecedor/Cliente (Cidade)': ou(txt(enderEmit, 'xMun') || nota.fornecedorCidade),
      'Fornecedor/Cliente (Estado)': ou(txt(enderEmit, 'UF') || nota.fornecedorUf),
      'Fornecedor/Cliente (Tags)': fornecedorTransporta ? 'Fornecedor, Transportadora' : 'Fornecedor',
      'Transportadora (Razão Social)': ou(txt(transporta, 'xNome')),
      'Transportadora (Nome Fantasia)': ou(txt(transporta, 'xNome')),
      'Transportadora (CNPJ/CPF)': transpCnpj ? formatarCnpj(transpCnpj) : ND,
      'Transportadora (Cidade)': ou(txt(transporta, 'xMun')),
      'Transportadora (Estado)': ou(txt(transporta, 'UF')),
      'Transportadora (Tags)': transpCnpj ? (fornecedorTransporta ? 'Fornecedor, Transportadora' : 'Transportadora') : ND,
      'Item': it.linha,
      'Código do Produto': ou(p?.codigo),
      'Descrição do Produto': ou(p?.descricao),
      'Descrição do Produto (completa)': p ? `${p.codigo} - ${p.descricao}` : ND,
      'Características': ND,
      'Código do Produto na NF-e': ou(it.cProd),
      'Descrição do Produto na NF-e': ou(it.descricao),
      'Descrição do Produto na NF-e (completa)': it.cProd || it.descricao ? `${it.cProd ?? ''} - ${it.descricao ?? ''}` : ND,
      'Código da Família': ND,
      'Família de Produto': ou(p?.familia),
      'Código EAN (GTIN)': it.ean && !/sem\s*gtin/i.test(it.ean) ? it.ean : ND,
      'Código NCM': formatarNcm(it.ncm),
      'Dados Adicionais para o Item da Nota Fiscal': ou(txt(x?.det, 'infAdProd')),
      'CFOP de Entrada': rotuloCfopEntrada(it.cfopEntrada),
      'CFOP no Documento Fiscal': rotuloCfopSaida(it.cfop),
      'Número do Pedido de Compra': ou(txt(x?.prod, 'xPed')),
      'Item do Pedido de Compra': num(txt(x?.prod, 'nItemPed')),
      'Quantidade': qtdEstoque,
      'Quant. Prevista': 0,
      'Unidade': ou(it.unidadeEstoque ?? it.unidadeCompra),
      'Valor Unitário': qtdEstoque ? r6(it.valorTotal / qtdEstoque) : 0,
      'Total de Mercadoria': r2(it.valorTotal),
      'Desconto': r2(it.desconto),
      'Frete': frete,
      'Seguro': seguro,
      'Peso Líquido do Item (Kg)': 0,
      'Peso Bruto do Item (Kg)': 0,
      'Outras Despesas Acessórias': outras,
      'Total do Documento Fiscal': totalItem,
      'Valor Aprox. dos Impostos': num(txt(imp, 'vTotTrib')),
      'CMC Atual': it.cmcAtual ?? 0,
      'Estoque Disponível': it.estoqueDisponivel ?? 0,
      'Custo de Estoque - Valor de Entrada': it.custoUnitarioBase == null ? 0 : r6(it.custoUnitarioBase * fator),
      'CMC Unitário do Movimento': it.custoUnitarioBase ?? 0,
      'Custo de Estoque - ICMS é Custo': sn(f?.icms),
      'Custo de Estoque - ICMS ST é Custo': sn(f?.icmsSt),
      'Custo de Estoque - IPI é Custo': sn(f?.ipi),
      'Custo de Estoque - PIS é Custo': sn(f?.pis),
      'Custo de Estoque - COFINS é Custo': sn(f?.cofins),
      'Custo de Estoque - Frete é Custo': sn(f?.frete),
      'Custo de Estoque - Seguro é Custo': sn(f?.seguro),
      'Custo de Estoque - Outras Despesas é Custo': sn(f?.outras),
      'Custo de Estoque - Valor do ICMS ST': f?.icmsSt ? vSt : 0,
      'Custo de Estoque - Valor do PIS': f?.pis ? num(txt(pis, 'vPIS')) : 0,
      'Custo de Estoque - Valor do COFINS': f?.cofins ? num(txt(cofins, 'vCOFINS')) : 0,
      'Custo de Estoque - Alíquota de Crédito do PIS': it.aliqCredPis,
      'Custo de Estoque - Alíquota de Crédito do COFINS': it.aliqCredCofins,
      'Peso Líquido Total (Kg)': num(txt(vol, 'pesoL')),
      'Peso Bruto Total (Kg)': num(txt(vol, 'pesoB')),
      'Tipo da Mercadoria': rotuloTipoItem(p?.tipoItem),
      'Origem da Mercadoria': rot(ORIGEM, txt(icms, 'orig') || null),
      'Situação Tributária do Simples Nacional (CSOSN)': rot(CSOSN, csosn),
      'Alíquota de Cálculo de Crédito do Simples Nacional': num(txt(icms, 'pCredSN')),
      'Valor do Crédito do ICMS Aproveitado (Simples Nacional)': num(txt(icms, 'vCredICMSSN')),
      'Base de Cálculo do ICMS Retido por ST (Simples Nacional)': csosn ? num(txt(icms, 'vBCSTRet')) : 0,
      'Valor do ICMS Retido por ST (Simples Nacional)': csosn ? num(txt(icms, 'vICMSSTRet')) : 0,
      'Situação Tributária do ICMS': rot(CST_ICMS, cst),
      'Modalidade da Base de Cálculo do ICMS': rot(MOD_BC, txt(icms, 'modBC') || null),
      'Perc. Redução da Base de Cálculo do ICMS': num(txt(icms, 'pRedBC')),
      'Base de Cálculo do ICMS': num(txt(icms, 'vBC')),
      'Alíquota do ICMS': num(txt(icms, 'pICMS')),
      'Valor do ICMS': num(txt(icms, 'vICMS')),
      'Modalidade da Base de Cálculo do ICMS ST': rot(MOD_BC_ST, txt(icms, 'modBCST') || null),
      'Margem de Valor Adicionado (ICMS ST)': num(txt(icms, 'pMVAST')),
      'Perc. Redução da Base de Cálculo do ICMS ST': num(txt(icms, 'pRedBCST')),
      'Base de Cálculo do ICMS ST': num(txt(icms, 'vBCST')),
      'Alíquota do ICMS ST': num(txt(icms, 'pICMSST')),
      'Valor do ICMS ST': vSt,
      'Situação Tributária do IPI': rot(CST_IPI, txt(ipi, 'CST') || null),
      'Tipo de Cálculo do IPI': tipoCalc(ipi, 'pIPI'),
      'Base do IPI': num(txt(ipi, 'vBC')),
      'Alíquota do IPI': num(txt(ipi, 'pIPI')),
      'Quant. de Unid. Tributáveis do IPI': num(txt(ipi, 'qUnid')),
      'Valor por Unid. Tributável do IPI': num(txt(ipi, 'vUnid')),
      'Valor do IPI': vIpi,
      'Situação Tributária do PIS': rot(CST_PIS, txt(pis, 'CST') || null),
      'Tipo de Cálculo do PIS': tipoCalc(pis, 'pPIS'),
      'Base do PIS': num(txt(pis, 'vBC')),
      'Alíquota do PIS': num(txt(pis, 'pPIS')),
      'Quant. de Unid. Tributáveis do PIS': num(txt(pis, 'qBCProd')),
      'Valor por Unid. Tributável do PIS': num(txt(pis, 'vAliqProd')),
      'Valor do PIS': num(txt(pis, 'vPIS')),
      'Situação Tributária do COFINS': rot(CST_PIS, txt(cofins, 'CST') || null),
      'Tipo de Cálculo do COFINS': tipoCalc(cofins, 'pCOFINS'),
      'Base do COFINS': num(txt(cofins, 'vBC')),
      'Alíquota do COFINS': num(txt(cofins, 'pCOFINS')),
      'Quant. de Unid. Tributáveis do COFINS': num(txt(cofins, 'qBCProd')),
      'Valor por Unid. Tributável do COFINS': num(txt(cofins, 'vAliqProd')),
      'Valor do COFINS': num(txt(cofins, 'vCOFINS')),
      'Entrada - Situação Tributária do ICMS': x ? cstIcmsEntrada(cst, csosn) : ND,
      'Entrada - Situação Tributária do IPI': '49 - Outras entradas',
      'Entrada - Situação Tributária do PIS': '98 - Outras Operações de Entrada',
      'Entrada - Situação Tributária do COFINS': '98 - Outras Operações de Entrada',
      'Entrada - Não deve se creditar do ICMS': f?.icms ? 'Não' : 'Sim',
      'Entrada - Base do PIS': 0,
      'Entrada - Alíquota do PIS': 0,
      'Entrada - Valor do PIS': 0,
      'Entrada - Base do COFINS': 0,
      'Entrada - Alíquota do COFINS': 0,
      'Entrada - Valor do COFINS': 0,
      'Reforma Tributária - Código da Situação Tributária (CST) do IS': ou(txt(is, 'CSTIS')),
      'Reforma Tributária - Código da Classificação Fiscal do IS': ou(txt(is, 'cClassTribIS')),
      'Reforma Tributária - Base de Cálculo do IS': num(txt(is, 'vBCIS')),
      'Reforma Tributária - Alíquota do IS': num(txt(is, 'pIS')),
      'Reforma Tributária - Valor do IS': num(txt(is, 'vIS')),
      'Reforma Tributária - Código da Situação Tributária (CST) do IBS e CBS': ou(txt(ibscbs, 'CST')),
      'Reforma Tributária - Código da Classificação Fiscal do IBS e CBS': ou(txt(ibscbs, 'cClassTrib')),
      'Reforma Tributária - Base de Cálculo do IBS e CBS': num(txt(g, 'vBC')),
      'Reforma Tributária - Alíquota do IBS Estadual': num(txt(gUF, 'pIBSUF')),
      'Reforma Tributária - Alíquota Efetiva do IBS Estadual': num(txt(gUF, 'gRed', 'pAliqEfet')),
      'Reforma Tributária - Valor do IBS Estadual': num(txt(gUF, 'vIBSUF')),
      'Reforma Tributária - Alíquota do IBS Municipal': num(txt(gMun, 'pIBSMun')),
      'Reforma Tributária - Alíquota Efetiva do IBS Municipal': num(txt(gMun, 'gRed', 'pAliqEfet')),
      'Reforma Tributária - Valor do IBS Municipal': num(txt(gMun, 'vIBSMun')),
      'Reforma Tributária - Valor do IBS': num(txt(g, 'vIBS')),
      'Reforma Tributária - Alíquota da CBS': num(txt(gCBS, 'pCBS')),
      'Reforma Tributária - Alíquota Efetiva da CBS': num(txt(gCBS, 'gRed', 'pAliqEfet')),
      'Reforma Tributária - Valor da CBS': num(txt(gCBS, 'vCBS')),
      'Reforma Tributária - Base de Cálculo do Crédito Presumido': 0,
      'Reforma Tributária - Código da Classificação Fiscal do Crédito Presumido': 0,
      'Reforma Tributária - Percentual do Crédito Presumido - IBS': 0,
      'Reforma Tributária - Valor do Crédito Presumido - IBS': 0,
      'Reforma Tributária - Valor do Crédito Presumido em Condição Suspensiva - IBS': 0,
      'Reforma Tributária - Percentual do Crédito Presumido - CBS': 0,
      'Reforma Tributária - Valor do Crédito Presumido - CBS': 0,
      'Reforma Tributária - Valor do Crédito Presumido em Condição Suspensiva - CBS': 0,
      'Situação do Item': it.lancado || it.produto ? 'Associado com Produto' : 'Não associado',
      'Nota de Devolução': ND,
      'Quantidade na Nota Fiscal': it.quantidade,
      'Unidade na Nota Fiscal': ou(it.unidadeCompra),
      'Valor Unitário na Nota Fiscal': it.valorUnitario,
      'Gera Conta a Pagar': it.geraContaPagar ? 'Sim' : 'Não',
      'Movimenta Estoque': it.movimentaEstoque ? 'Sim' : 'Não',
      'Local de Estoque (Código)': ou(it.local?.codigo),
      'Local de Estoque (Descrição)': ou(it.local?.descricao),
      'Local de Estoque (Tipo)': it.local ? 'Estoque próprio da empresa' : ND,
      'Valor do IPI Devolvido': 0,
      'Observações do Recebimento': ou(compra?.obs),
      'Lote e Validade - Número do Lote': ou(it.lote),
      'Lote e Validade - Quantidade de Produtos do Lote': it.lote ? qtdEstoque : 0,
      'Lote e Validade - Data de Fabricação/Produção (completa)': ND,
      'Lote e Validade - Data de Validade (completa)': it.validade ? dataPlanilha(it.validade) : ND,
      'Lote e Validade - Código de Agregação': ND,
      'Lote e Validade - Data de Fabricação/Produção (todas)': ND,
      'Lote e Validade - Data de Validade (todas)': it.validade ? dataPlanilha(it.validade) : ND,
      'Código do Produto Variante Pai': ND,
      'Descrição do Produto Variante Pai': ND,
      'Descrição do Produto Variante Pai (completa)': ND,
      'Tag - Cliente': 'Não',
      'Tag - Consulta de Restrição': 'Não',
      'Tag - Fornecedor': 'Sim',
      'Tag - Funcionário': 'Não',
      'Tag - Transportadora': fornecedorTransporta ? 'Sim' : 'Não',
    }
    return linha as LinhaEntrada
  })
}
