// Converte a NF-e lida do XML para o formato das tabelas notas_fiscais / nota_fiscal_items (as mesmas que o Omie alimenta),
// para a tela de Notas Fiscais e todos os relatórios funcionarem sem mudança. Puro e testável com `node --test`.
import type { ItemNfe, NfeLida } from './nfe-xml.ts'
import type { ConfigInicialItem } from './nf-item-regras'
// @ts-ignore: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { flagsParaTexto } from './nf-item-regras.ts'

export type OrigemNota = 'sefaz' | 'xml' | 'manual'

const dmy = (iso: string | null): string | null => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}
const r2 = (n: number) => Math.round(n * 100) / 100

export type CabecalhoNota = {
  chave: string; numero: string; serie: string; modelo: string | null; emissao: string | null; valor: number
  fornecedor_nome: string; fornecedor_fantasia: string | null; fornecedor_cnpj: string; ie: string | null; natureza: string | null
  ambiente: string; full_object: Record<string, unknown>
}
export type ItemNota = {
  seq: number; c_prod: string; descricao: string; ncm: string | null; ean: string | null; cfop: string | null; qtde: number; unidade: string
  preco_unit: number; desconto: number; frete: number; total: number; full_object: Record<string, unknown>
}

/** Frete/seguro/outras despesas rateados por valor líquido de cada item. */
export function ratearFrete(nfe: NfeLida): number[] {
  const liq = nfe.itens.map((i) => i.valorTotal - i.desconto)
  const soma = liq.reduce((a, b) => a + b, 0)
  return liq.map((l) => (soma > 0 ? r2((nfe.valores.frete * l) / soma) : r2(nfe.valores.frete / Math.max(nfe.itens.length, 1))))
}

export function itensDaNota(nfe: NfeLida): ItemNota[] {
  const fretes = ratearFrete(nfe)
  return nfe.itens.map((i, idx) => ({
    seq: i.linha, c_prod: i.cProd, descricao: i.descricao, ncm: i.ncm, ean: i.ean, cfop: i.cfop, qtde: i.quantidade, unidade: i.unidade,
    preco_unit: i.valorUnitario, desconto: i.desconto, frete: fretes[idx], total: r2(i.valorTotal - i.desconto + fretes[idx]),
    full_object: { itensCabec: { nSequencia: i.linha, cCodigoProduto: i.cProd, cDescricaoProduto: i.descricao, cNCM: i.ncm, cEAN: i.ean, cCFOP: i.cfop, nQtdeNFe: i.quantidade, cUnidadeNfe: i.unidade, nPrecoUnit: i.valorUnitario }, sefaz: { icms: i.icms } },
  }))
}

export function cabecalhoDaNota(nfe: NfeLida, opts: { ambiente: '1' | '2'; origem: OrigemNota; alertas: string[]; nsu?: string | null; recebidoEm?: string }): CabecalhoNota {
  const total = nfe.valores.total
  return {
    chave: nfe.chave, numero: nfe.numero, serie: nfe.serie, modelo: nfe.modelo, emissao: nfe.emissao, valor: total,
    fornecedor_nome: nfe.fornecedor.nome, fornecedor_fantasia: nfe.fornecedor.fantasia, fornecedor_cnpj: nfe.fornecedor.cnpj, ie: nfe.fornecedor.ie,
    natureza: nfe.naturezaOperacao, ambiente: opts.ambiente,
    full_object: {
      cabec: { cCNPJ_CPF: nfe.fornecedor.cnpj, cInscricao: nfe.fornecedor.ie ?? '', cNaturezaOperacao: nfe.naturezaOperacao ?? '' },
      infoCadastro: { cRecebido: 'N', cFaturado: 'N', cCancelada: 'N', cDevolvido: 'N', cBloqueado: 'N' },
      transporte: {
        cNomeTransp: nfe.transporte.nome ?? undefined, cCnpjCpfTransp: nfe.transporte.cnpj ?? undefined, cTipoFrete: nfe.transporte.modFrete ?? undefined,
        nPesoBruto: nfe.transporte.pesoBruto ?? undefined, nPesoLiquido: nfe.transporte.pesoLiquido ?? undefined,
        nQtdeVolume: nfe.transporte.volumes ?? undefined, cEspecieVolume: nfe.transporte.especie ?? undefined,
        cInscricaoTransp: nfe.transporte.ie ?? undefined, cUFTransp: nfe.transporte.uf ?? undefined, cPlaca: nfe.transporte.placa ?? undefined,
        cUFPlaca: nfe.transporte.ufPlaca ?? undefined, cRNTRC: nfe.transporte.rntc ?? undefined, cMarcaVolume: nfe.transporte.marca ?? undefined,
        cNumeracaoVolume: nfe.transporte.numeracao ?? undefined, cLacres: nfe.transporte.lacres.length ? nfe.transporte.lacres.join(', ') : undefined,
      },
      parcelas: { parcelasLista: nfe.parcelas.map((p) => ({ nSequencia: p.seq, dVencimento: dmy(p.vencimento) ?? '', vParcela: p.valor, pParcela: total > 0 ? r2((p.valor / total) * 100) : 0 })) },
      // X7: as chaves do Omie (vSeguro é HIPÓTESE: o nome não aparece nas notas de D1)
      totais: {
        vTotalNFe: total, vTotalProdutos: nfe.valores.produtos, bcICMS: nfe.valores.bcIcms, vICMS: nfe.valores.icms, bcICMSST: nfe.valores.bcSt,
        vICMSSubstituicao: nfe.valores.st, vTotalIPI: nfe.valores.ipi, vTotalDescontos: nfe.valores.desconto, vOutrasDespesas: nfe.valores.vOutro,
        vTotalPIS: nfe.valores.pis, vTotalCOFINS: nfe.valores.cofins, vFrete: nfe.valores.vFrete, vSeguro: nfe.valores.vSeg, vAproxTributos: nfe.tributosAprox,
      },
      infoAdicionais: { dRegistro: dmy(new Date().toISOString().slice(0, 10)) ?? '', cInfoCompl: nfe.infCpl ?? undefined },
      sefaz: { origem: opts.origem, completo: true, alertas: opts.alertas, nsu: opts.nsu ?? null, recebidoEm: opts.recebidoEm ?? new Date().toISOString(), tipoOperacao: nfe.tipoOperacao, finalidade: nfe.finalidade, crt: nfe.crt },
    },
  }
}

/** Alertas que deixam a nota 'divergente' até alguém conferir (nunca bloqueiam o recebimento). */
export function alertasDaNota(nfe: NfeLida, cnpjLoja?: string | null): string[] {
  const a = [...nfe.avisos]
  if (cnpjLoja && nfe.destinatario.cnpj && nfe.destinatario.cnpj !== cnpjLoja.replace(/\D/g, '')) a.push('O destinatário da nota não é o CNPJ desta loja.')
  if (nfe.itens.some((i) => i.quantidade <= 0)) a.push('A nota tem item com quantidade zero.')
  if (Math.abs(totalEsperadoDaNota(nfe) - nfe.valores.total) > 0.1) a.push('O total da nota não bate com itens + frete − desconto.')
  return [...new Set(a)]
}

/** O que o total traz a mais que a soma dos itens (despesas e desconto que vieram só no ICMSTot), cada um separado. */
function soNoTotal(nfe: NfeLida): { frete: number; seguro: number; outras: number; desconto: number } {
  const soma = (f: (i: ItemNfe) => number) => nfe.itens.reduce((a, i) => a + f(i), 0)
  const resto = (tot: number, itens: number) => Math.max(0, r2(tot - itens))
  return {
    frete: resto(nfe.valores.vFrete, soma((i) => i.fiscal.frete)),
    seguro: resto(nfe.valores.vSeg, soma((i) => i.fiscal.seguro)),
    outras: resto(nfe.valores.vOutro, soma((i) => i.fiscal.outras)),
    desconto: resto(nfe.valores.desconto, soma((i) => i.desconto)),
  }
}

/** Valor esperado da nota: Σ vTotalItem + despesas só do total − desconto só do total − ICMS desonerado. */
export function totalEsperadoDaNota(nfe: NfeLida): number {
  const t = soNoTotal(nfe)
  return r2(nfe.itens.reduce((a, i) => a + i.valorTotalItem, 0) + t.frete + t.seguro + t.outras - t.desconto - nfe.valores.icmsDesonerado)
}

/** Rateio proporcional em centavos; o centavo que sobra vai para o maior item. */
function ratear(valor: number, bases: number[]): number[] {
  if (!(valor > 0) || !bases.length) return bases.map(() => 0)
  const soma = bases.reduce((a, b) => a + Math.max(0, b), 0)
  const partes = bases.map((b) => (soma > 0 ? r2((valor * Math.max(0, b)) / soma) : r2(valor / bases.length)))
  const sobra = r2(valor - partes.reduce((a, b) => a + b, 0))
  if (sobra !== 0) { const maior = bases.indexOf(Math.max(...bases)); partes[maior] = r2(partes[maior] + sobra) }
  return partes
}

/** Despesas e desconto que vieram só no total são rateados nos itens pelo valor líquido (vProd − vDesc), cada um no seu
 *  campo (fiscal.frete/seguro/outras, desconto) e no valorTotalItem. NF-e 4.0 já traz tudo por item: nada muda. */
export function itensComDespesasDoTotal(nfe: NfeLida): { itens: ItemNfe[]; aviso: string | null } {
  const t = soNoTotal(nfe)
  if (!t.frete && !t.seguro && !t.outras && !t.desconto) return { itens: nfe.itens, aviso: null }
  const bases = nfe.itens.map((i) => i.valorTotal - i.desconto)
  const [fr, sg, ou, ds] = [ratear(t.frete, bases), ratear(t.seguro, bases), ratear(t.outras, bases), ratear(t.desconto, bases)]
  const itens = nfe.itens.map((i, k) => ({
    ...i,
    desconto: r2(i.desconto + ds[k]),
    valorTotalItem: r2(i.valorTotalItem + fr[k] + sg[k] + ou[k] - ds[k]),
    fiscal: { ...i.fiscal, frete: r2(i.fiscal.frete + fr[k]), seguro: r2(i.fiscal.seguro + sg[k]), outras: r2(i.fiscal.outras + ou[k]) },
  }))
  return { itens, aviso: t.frete || t.seguro || t.outras ? 'Frete/despesas só no total da nota: rateados pelo valor dos itens.' : null }
}

/** Payload do item para registrar_compra_sefaz (migration 185): valores fiscais + configuração inicial (marcações em texto, CFOP só dígitos). */
export function itemCompraSefaz(i: ItemNfe, c: { codigoProduto: number | null; fator: number; origem: string | null; score: number | null; sugestao: number | null }, cfg: ConfigInicialItem): Record<string, unknown> {
  return {
    linha: i.linha, c_prod: i.cProd, ean: i.ean, descricao: i.descricao, ncm: i.ncm, cfop: i.cfop, unidade_compra: i.unidade, quantidade: i.quantidade,
    valor_unitario: i.valorUnitario, valor_total: i.valorTotal, desconto: i.desconto, icms_valor: i.icms, fator: c.fator,
    codigo_produto: c.codigoProduto, match_origem: c.origem, match_score: c.score, sugestao_codigo_produto: c.sugestao,
    valor_total_item: i.valorTotalItem, ipi_valor: i.fiscal.ipi, st_valor: i.fiscal.st, fcp_st_valor: i.fiscal.fcpSt,
    frete_valor: i.fiscal.frete, seguro_valor: i.fiscal.seguro, outras_valor: i.fiscal.outras, fiscal: i.fiscal,
    codigo_local_estoque: cfg.codigoLocal, cfop_entrada: cfg.cfopEntrada ? cfg.cfopEntrada.replace(/\D/g, '') : null, origem_cfop: cfg.origemCfop,
    unidade_estoque: cfg.unidadeEstoque, custo_flags: flagsParaTexto(cfg.flags), origem_flags: cfg.origemFlags,
    aliq_cred_pis: cfg.aliqCredPis, aliq_cred_cofins: cfg.aliqCredCofins, movimenta_estoque: cfg.movimentaEstoque, gera_conta_pagar: cfg.geraContaPagar,
  }
}

/** Resumo (resNFe) da distribuição: ainda sem itens. */
export function cabecalhoDoResumo(r: ResumoNfe, ambiente: '1' | '2', nsu: string): CabecalhoNota {
  return {
    chave: r.chave, numero: r.chave.slice(25, 34).replace(/^0+/, '') || '0', serie: r.chave.slice(22, 25).replace(/^0+/, '') || '0', modelo: r.chave.slice(20, 22),
    emissao: r.emissao, valor: r.valor, fornecedor_nome: r.nome, fornecedor_fantasia: null, fornecedor_cnpj: r.cnpj, ie: r.ie, natureza: null, ambiente,
    full_object: {
      cabec: { cCNPJ_CPF: r.cnpj, cInscricao: r.ie ?? '', cNaturezaOperacao: '' },
      infoCadastro: { cRecebido: 'N', cFaturado: 'N', cCancelada: r.situacao === '3' ? 'S' : 'N', cDevolvido: 'N', cBloqueado: 'N' },
      totais: { vTotalProdutos: r.valor },
      sefaz: { origem: 'sefaz', completo: false, alertas: [], nsu, recebidoEm: new Date().toISOString(), tipoOperacao: r.tipoOperacao },
    },
  }
}

export type ResumoNfe = { chave: string; cnpj: string; nome: string; ie: string | null; emissao: string | null; tipoOperacao: string | null; valor: number; situacao: string | null }
