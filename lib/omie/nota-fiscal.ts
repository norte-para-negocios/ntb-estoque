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
  cChaveNfe: string
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
  nQtde: number
  cUnidade: string
  nValorUnitario: number
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

async function saveNotaFiscal(loja: LojaOmie, nf: OmieNF) {
  const supabase = createServiceClient()
  if (!nf.cabec) return

  const { data: saved } = await supabase
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
        c_chave_nfe: nf.cabec.cChaveNfe,
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
      n_qtde_nfe: it.itensCabec.nQtde,
      c_unidade_nfe: it.itensCabec.cUnidade,
      n_preco_unit: it.itensCabec.nValorUnitario,
      full_object: it,
      updated_at: new Date().toISOString(),
    }))
    await supabase
      .from('nota_fiscal_items')
      .upsert(rows, { onConflict: 'loja_id,n_id_receb,n_sequencia' })
  }
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

function parseDate(d: string | null | undefined): string | null {
  if (!d) return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}
