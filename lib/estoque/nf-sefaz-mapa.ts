// Converte a NF-e lida do XML para o formato das tabelas notas_fiscais / nota_fiscal_items (as mesmas que o Omie alimenta),
// para a tela de Notas Fiscais e todos os relatórios funcionarem sem mudança. Puro e testável com `node --test`.
import type { NfeLida } from './nfe-xml.ts'

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
      },
      parcelas: { parcelasLista: nfe.parcelas.map((p) => ({ nSequencia: p.seq, dVencimento: dmy(p.vencimento) ?? '', vParcela: p.valor, pParcela: total > 0 ? r2((p.valor / total) * 100) : 0 })) },
      totais: { vTotalProdutos: nfe.valores.produtos, vAproxTributos: nfe.tributosAprox },
      infoAdicionais: { dRegistro: dmy(new Date().toISOString().slice(0, 10)) ?? '', cInfoCompl: nfe.infCpl ?? undefined },
      sefaz: { origem: opts.origem, completo: true, alertas: opts.alertas, nsu: opts.nsu ?? null, recebidoEm: opts.recebidoEm ?? new Date().toISOString(), tipoOperacao: nfe.tipoOperacao },
    },
  }
}

/** Alertas que deixam a nota 'divergente' até alguém conferir (nunca bloqueiam o recebimento). */
export function alertasDaNota(nfe: NfeLida, cnpjLoja?: string | null): string[] {
  const a = [...nfe.avisos]
  if (cnpjLoja && nfe.destinatario.cnpj && nfe.destinatario.cnpj !== cnpjLoja.replace(/\D/g, '')) a.push('O destinatário da nota não é o CNPJ desta loja.')
  if (nfe.itens.some((i) => i.quantidade <= 0)) a.push('A nota tem item com quantidade zero.')
  const somaItens = nfe.itens.reduce((s, i) => s + i.valorTotal - i.desconto, 0)
  const esperado = somaItens + nfe.valores.frete - nfe.valores.descontoNota
  if (Math.abs(esperado - nfe.valores.total) > 0.1) a.push('O total da nota não bate com itens + frete − desconto.')
  return [...new Set(a)]
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
