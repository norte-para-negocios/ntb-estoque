import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

interface OmieNFCabec {
  nIdReceb: number
  nIdFornecedor: number
  cPessoaFisica: string
  cNome: string
  cRazaoSocial: string
  cInscricao: string
  cCNPJ_CPF: string
  cChaveNFe: string
  cEtapa: string
  cNumeroNFe: string
  cSerieNFe: string
  cModeloNFe: string
  dEmissaoNFe: string
  nValorNFe: number
  cAmbienteNFe: string
  cNaturezaOperacao: string
}

interface OmieNFItemCabec {
  nSequencia: number
  nIdItem: number
  nIdPedido: number
  nIdItPedido: number
  nIdProduto: number
  cCodigoProduto: string
  cDescricaoProduto: string
  cIgnorarItem: string
  cAdicionarNovo: string
  cAssociarExistente: string
  cItemDevolvido: string
  cNCM: string
  cEAN: string
  cCFOP: string
  nQtdeNFe: number
  cUnidadeNfe: string
  nPrecoUnit: number
}

interface OmieNF {
  cabec: OmieNFCabec
  itensRecebimento?: Array<{ itensCabec: OmieNFItemCabec }>
  [k: string]: unknown
}

interface OmieNFResponse {
  nPagina: number
  nTotalPaginas: number
  recebimentos?: OmieNF[]
}

interface NotaFiscalItemBulkRow {
  n_sequencia: number
  n_id_item: number
  n_id_pedido: number
  n_id_it_pedido: number
  n_id_produto: number
  c_codigo_produto: string
  c_descricao_produto: string
  c_ignorar_item: string
  c_adicionar_novo: string
  c_associar_existente: string
  c_item_devolvido: string
  c_ncm: string
  c_ean: string
  c_cfop: string
  n_qtde_nfe: number
  c_unidade_nfe: string
  n_preco_unit: number
  full_object: unknown
}

interface NotaFiscalBulkRow {
  n_id_receb: string
  n_id_fornecedor: number
  c_pessoa_fisica: string
  c_nome: string
  c_razao_social: string
  c_inscricao: string
  c_cnpj_cpf: string
  c_chave_nfe: string
  c_etapa: string
  c_numero_nfe: string
  c_serie_nfe: string
  c_modelo_nfe: string
  d_emissao_nfe: string | null
  n_valor_nfe: number
  c_ambiente_nfe: string
  c_natureza_operacao: string
  full_object: unknown
  itens: NotaFiscalItemBulkRow[]
}

// Envia a NF (cabecalho + itens) pro Contabo, fire-and-forget -- mesma
// filosofia de gravarMovimentosNoFrio (lib/omie/sync-ajustes.ts): o upsert no
// Supabase, que sustenta o sync hoje, nunca pode quebrar por causa do
// dual-write.
async function gravarNotaFiscalNoFrio(lojaId: number, nota: NotaFiscalBulkRow): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    const resp = await fetch(`${url}/notas_fiscais_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
      body: JSON.stringify({ loja_id: lojaId, notas: [nota] }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
  } catch (e) {
    console.error('nota-fiscal: falha ao gravar NF no Contabo', e)
  }
}

async function saveNotaFiscal(loja: LojaOmie, nf: OmieNF) {
  const supabase = createServiceClient()
  if (!nf.cabec) return

  const { data: saved, error: errCabec } = await supabase
    .from('notas_fiscais')
    .upsert(
      {
        loja_id: loja.id,
        n_id_receb: String(nf.cabec.nIdReceb),
        n_id_fornecedor: nf.cabec.nIdFornecedor,
        c_pessoa_fisica: nf.cabec.cPessoaFisica,
        c_nome: nf.cabec.cNome,
        c_razao_social: nf.cabec.cRazaoSocial,
        c_inscricao: nf.cabec.cInscricao,
        c_cnpj_cpf: nf.cabec.cCNPJ_CPF,
        c_chave_nfe: nf.cabec.cChaveNFe,
        c_etapa: nf.cabec.cEtapa,
        c_numero_nfe: nf.cabec.cNumeroNFe,
        c_serie_nfe: nf.cabec.cSerieNFe,
        c_modelo_nfe: nf.cabec.cModeloNFe,
        d_emissao_nfe: parseDate(nf.cabec.dEmissaoNFe),
        n_valor_nfe: nf.cabec.nValorNFe,
        c_ambiente_nfe: nf.cabec.cAmbienteNFe,
        c_natureza_operacao: nf.cabec.cNaturezaOperacao,
        full_object: nf,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'loja_id,n_id_receb' }
    )
    .select('id')
    .single()

  // Sem checar o erro, uma falha (ex.: valor fora da faixa) descartava a NF + itens
  // em silêncio enquanto o status da loja virava "Concluido". Agora propaga.
  if (errCabec || !saved) {
    throw new Error(`Falha ao salvar NF ${nf.cabec.cNumeroNFe}: ${errCabec?.message ?? 'sem retorno'}`)
  }

  const itens = nf.itensRecebimento ?? []
  if (saved && itens.length) {
    const rows = itens.map((it) => ({
      loja_id: loja.id,
      nota_fiscal_id: saved.id,
      n_id_receb: String(nf.cabec.nIdReceb),
      n_sequencia: it.itensCabec.nSequencia,
      produto_codigo: it.itensCabec.nIdProduto ? String(it.itensCabec.nIdProduto) : null,
      n_id_item: it.itensCabec.nIdItem,
      n_id_pedido: it.itensCabec.nIdPedido,
      n_id_it_pedido: it.itensCabec.nIdItPedido,
      n_id_produto: it.itensCabec.nIdProduto,
      c_codigo_produto: it.itensCabec.cCodigoProduto,
      c_descricao_produto: it.itensCabec.cDescricaoProduto,
      c_ignorar_item: it.itensCabec.cIgnorarItem,
      c_adicionar_novo: it.itensCabec.cAdicionarNovo,
      c_associar_existente: it.itensCabec.cAssociarExistente,
      c_item_devolvido: it.itensCabec.cItemDevolvido,
      c_ncm: it.itensCabec.cNCM,
      c_ean: it.itensCabec.cEAN,
      c_cfop: it.itensCabec.cCFOP,
      n_qtde_nfe: it.itensCabec.nQtdeNFe,
      c_unidade_nfe: it.itensCabec.cUnidadeNfe,
      n_preco_unit: it.itensCabec.nPrecoUnit,
      full_object: it,
      updated_at: new Date().toISOString(),
    }))
    const { error: errItens } = await supabase
      .from('nota_fiscal_items')
      .upsert(rows, { onConflict: 'loja_id,n_id_receb,n_sequencia' })
    if (errItens) {
      throw new Error(`Falha ao salvar itens da NF ${nf.cabec.cNumeroNFe}: ${errItens.message}`)
    }
  }

  await gravarNotaFiscalNoFrio(loja.id, {
    n_id_receb: String(nf.cabec.nIdReceb),
    n_id_fornecedor: nf.cabec.nIdFornecedor,
    c_pessoa_fisica: nf.cabec.cPessoaFisica,
    c_nome: nf.cabec.cNome,
    c_razao_social: nf.cabec.cRazaoSocial,
    c_inscricao: nf.cabec.cInscricao,
    c_cnpj_cpf: nf.cabec.cCNPJ_CPF,
    c_chave_nfe: nf.cabec.cChaveNFe,
    c_etapa: nf.cabec.cEtapa,
    c_numero_nfe: nf.cabec.cNumeroNFe,
    c_serie_nfe: nf.cabec.cSerieNFe,
    c_modelo_nfe: nf.cabec.cModeloNFe,
    d_emissao_nfe: parseDate(nf.cabec.dEmissaoNFe),
    n_valor_nfe: nf.cabec.nValorNFe,
    c_ambiente_nfe: nf.cabec.cAmbienteNFe,
    c_natureza_operacao: nf.cabec.cNaturezaOperacao,
    full_object: nf,
    itens: itens.map((it) => ({
      n_sequencia: it.itensCabec.nSequencia,
      n_id_item: it.itensCabec.nIdItem,
      n_id_pedido: it.itensCabec.nIdPedido,
      n_id_it_pedido: it.itensCabec.nIdItPedido,
      n_id_produto: it.itensCabec.nIdProduto,
      c_codigo_produto: it.itensCabec.cCodigoProduto,
      c_descricao_produto: it.itensCabec.cDescricaoProduto,
      c_ignorar_item: it.itensCabec.cIgnorarItem,
      c_adicionar_novo: it.itensCabec.cAdicionarNovo,
      c_associar_existente: it.itensCabec.cAssociarExistente,
      c_item_devolvido: it.itensCabec.cItemDevolvido,
      c_ncm: it.itensCabec.cNCM,
      c_ean: it.itensCabec.cEAN,
      c_cfop: it.itensCabec.cCFOP,
      n_qtde_nfe: it.itensCabec.nQtdeNFe,
      c_unidade_nfe: it.itensCabec.cUnidadeNfe,
      n_preco_unit: it.itensCabec.nPrecoUnit,
      full_object: it,
    })),
  })
}

export async function syncNotasFiscais(loja: LojaOmie, dataIni?: string, dataFim?: string) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ nota_fiscal_status: 'Processando' }).eq('id', loja.id)

  try {
    let pagina = 1
    let totalPaginas = 1

    do {
      const data: Record<string, unknown> = {
        nPagina: pagina,
        nRegistrosPorPagina: 100,
        cExibirDetalhes: 'S',
      }
      if (dataIni) data.dtAltDe = dataIni
      if (dataFim) data.dtAltAte = dataFim

      const res = await omieRequest<OmieNFResponse>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/produtos/recebimentonfe',
        call: 'ListarRecebimentos',
        data,
      })

      totalPaginas = res.nTotalPaginas || 1
      for (const nf of res.recebimentos ?? []) {
        await saveNotaFiscal(loja, nf)
      }

      pagina++
    } while (pagina <= totalPaginas)

    await supabase
      .from('lojas')
      .update({
        nota_fiscal_status: 'Concluido',
        nota_fiscal_ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', loja.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('lojas').update({ nota_fiscal_status: 'Erro' }).eq('id', loja.id)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'NotaFiscal',
      request: 'syncNotasFiscais',
      error: true,
      error_message: msg,
    })
    throw e
  }
}

export async function fetchNotaFiscal(loja: LojaOmie, nIdReceb: number) {
  const res = await omieRequest<OmieNF>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ConsultarRecebimento',
    data: { nIdReceb },
  })
  if (res?.cabec) await saveNotaFiscal(loja, res)
}

// Marca o recebimento como CONCLUÍDO no Omie (ConcluirRecebimento) --
// equivalente a "manifestar": move da coluna Pendente pra Recebido no
// Kanban de Compras da Omie. A Omie rejeita a chamada com "Preencha apenas
// a Tag [nIdReceb] ou a tag [cChaveNfe]!" se as duas forem enviadas juntas
// (confirmado ao vivo em produção) -- manda só nIdReceb, que já é obrigatório.
export async function concluirRecebimento(loja: LojaOmie, nIdReceb: number) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ConcluirRecebimento',
    data: { nIdReceb, cEtapa: '60' },
  })
}

// Desfaz a conclusao (ReverterRecebimento) -- volta pra Pendente. Mesmo
// motivo acima: só nIdReceb, nunca junto com cChaveNfe.
export async function reverterRecebimento(loja: LojaOmie, nIdReceb: number) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ReverterRecebimento',
    data: { nIdReceb, cEtapa: '40' },
  })
}

// Remove o recebimento inteiro do Omie (ExcluirRecebimento) -- so aceita
// nIdReceb, nao tem cChaveNfe nesse metodo especifico (confirmado na doc).
export async function excluirRecebimento(loja: LojaOmie, nIdReceb: number) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ExcluirRecebimento',
    data: { nIdReceb },
  })
}

// Mesma logica de lib/omie/ordem-producao.ts:pareceOPNaoExiste -- detecta
// pelo texto do erro quando o recebimento ja nao existe mais do lado da
// Omie (excluido direto por la, ou id invalido).
export function pareceRecebimentoNaoExiste(msg: string): boolean {
  return /nao cadastrada|não cadastrada|nao encontrado|não encontrado/i.test(msg)
}

function parseDate(d: string | null | undefined): string | null {
  if (!d) return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * Checa se já existe nota fiscal com essa chave de acesso (44 dígitos) na loja,
 * independente da origem (Omie ou SEFAZ direto). Uma futura integração de consulta
 * direta à SEFAZ deve chamar isso antes de inserir, já que ela não tem n_id_receb
 * (a chave usada no dedup do sync Omie) — a chave de acesso é o identificador comum
 * entre as duas origens.
 */
export async function existeNotaFiscalComChave(lojaId: number, chaveNfe: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { count } = await supabase
    .from('notas_fiscais')
    .select('id', { count: 'exact', head: true })
    .eq('loja_id', lojaId)
    .eq('c_chave_nfe', chaveNfe)
    .is('deleted_at', null)
  return (count ?? 0) > 0
}
