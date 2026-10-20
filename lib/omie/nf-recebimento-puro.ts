// Recebimento de NF-e do Omie → colunas de notas_fiscais / nota_fiscal_items. Um mapeamento só para ListarRecebimentos
// (cada elemento de `recebimentos`, o sync de 10 em 10 min) e ConsultarRecebimento (webhook e releitura do B7, paridade
// 20/10/2026). Pela documentação capturada (omie-rea/endpoints/public-api/stock-and-purchase-detail.md) a resposta do
// Consultar (`rcbtoConsultarResponse`) tem os MESMOS blocos do elemento do Listar (`recebimentos`: cabec,
// itensRecebimento, infoAdicionais, transporte, totais, parcelas, departamentos, categorias, infoCadastro,
// observacoes) + `cteCfopEntrada`. A doc escreve a chave como `cChaveNfe`; o dado real do Listar vem `cChaveNFe` — o
// mapeamento aceita as duas.
// Defensivo: se faltar um campo obrigatório (id, etapa, número, itens com sequência), não grava nada (a cópia que já
// está no banco fica) e quem chama registra no log. Puro: node --test lib/omie/nf-recebimento-puro.test.ts

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)

/** Campos obrigatórios que faltam (vazio = pode gravar). */
export function faltasDoRecebimento(nf: unknown): string[] {
  const r = obj(nf)
  const cab = obj(r?.cabec)
  const faltas: string[] = []
  if (!cab) return ['cabec']
  if (!(Number(cab.nIdReceb) > 0)) faltas.push('cabec.nIdReceb')
  if (typeof cab.cEtapa !== 'string' || !cab.cEtapa) faltas.push('cabec.cEtapa')
  if (cab.cNumeroNFe == null || cab.cNumeroNFe === '') faltas.push('cabec.cNumeroNFe')
  const itens = r?.itensRecebimento
  if (!Array.isArray(itens)) faltas.push('itensRecebimento')
  else itens.forEach((it, i) => { if (!(Number(obj(obj(it)?.itensCabec)?.nSequencia) > 0)) faltas.push(`itensRecebimento[${i}].itensCabec.nSequencia`) })
  return faltas
}

function parseDate(d: unknown): string | null {
  const m = typeof d === 'string' ? d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Colunas de notas_fiscais (sem loja_id/full_object/updated_at). */
export function colunasDaNota(nf: unknown) {
  const c = obj(obj(nf)?.cabec) ?? {}
  return {
    n_id_receb: String(c.nIdReceb),
    n_id_fornecedor: c.nIdFornecedor as number,
    c_pessoa_fisica: c.cPessoaFisica as string,
    c_nome: c.cNome as string,
    c_razao_social: c.cRazaoSocial as string,
    c_inscricao: c.cInscricao as string,
    c_cnpj_cpf: c.cCNPJ_CPF as string,
    c_chave_nfe: (c.cChaveNFe ?? c.cChaveNfe) as string,
    c_etapa: c.cEtapa as string,
    c_numero_nfe: c.cNumeroNFe as string,
    c_serie_nfe: c.cSerieNFe as string,
    c_modelo_nfe: c.cModeloNFe as string,
    d_emissao_nfe: parseDate(c.dEmissaoNFe),
    n_valor_nfe: c.nValorNFe as number,
    c_ambiente_nfe: c.cAmbienteNFe as string,
    c_natureza_operacao: c.cNaturezaOperacao as string,
  }
}

/** Colunas de nota_fiscal_items por item (sem loja_id/nota_fiscal_id/updated_at). */
export function colunasDosItens(nf: unknown) {
  const r = obj(nf) ?? {}
  const idReceb = String(obj(r.cabec)?.nIdReceb)
  return (Array.isArray(r.itensRecebimento) ? r.itensRecebimento : []).map((it) => {
    const c = obj(obj(it)?.itensCabec) ?? {}
    return {
      n_id_receb: idReceb,
      n_sequencia: c.nSequencia as number,
      produto_codigo: c.nIdProduto ? String(c.nIdProduto) : null,
      n_id_item: c.nIdItem as number,
      n_id_pedido: c.nIdPedido as number,
      n_id_it_pedido: c.nIdItPedido as number,
      n_id_produto: c.nIdProduto as number,
      c_codigo_produto: c.cCodigoProduto as string,
      c_descricao_produto: c.cDescricaoProduto as string,
      c_ignorar_item: c.cIgnorarItem as string,
      c_adicionar_novo: c.cAdicionarNovo as string,
      c_associar_existente: c.cAssociarExistente as string,
      c_item_devolvido: c.cItemDevolvido as string,
      c_ncm: c.cNCM as string,
      c_ean: c.cEAN as string,
      c_cfop: c.cCFOP as string,
      n_qtde_nfe: c.nQtdeNFe as number,
      c_unidade_nfe: c.cUnidadeNfe as string,
      n_preco_unit: c.nPrecoUnit as number,
      full_object: it,
    }
  })
}
