import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import { paradaPorDisjuntor } from './erros-omie'
import { colunasDaNota, colunasDosItens, faltasDoRecebimento } from './nf-recebimento-puro'
import {
  DIAS_RELEITURA, LIMITE_RELEITURA_POR_CICLO, TOPICOS_RELEITURA, consultasNota, escolherNotasParaReler, falhasReleitura, lojasForaDaReleitura,
  registrarConsultaNota, registrarFalhaReleitura,
  type AvisoNota, type NotaGravada,
} from './nf-releitura'

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

// Grava a nota (cabeçalho + itens) e espelha no Contabo. Mesmo mapeamento para ListarRecebimentos e
// ConsultarRecebimento (lib/omie/nf-recebimento-puro.ts). Resposta sem um campo obrigatório não sobrescreve a cópia
// que já está no banco: loga e devolve false.
async function saveNotaFiscal(loja: LojaOmie, nf: OmieNF): Promise<boolean> {
  const faltas = faltasDoRecebimento(nf)
  if (faltas.length) {
    console.error(`nota-fiscal: recebimento ${String((nf as { cabec?: { nIdReceb?: unknown } })?.cabec?.nIdReceb ?? '?')} da loja ${loja.id} sem ${faltas.slice(0, 5).join(', ')} — não gravado`)
    return false
  }
  const supabase = createServiceClient({ semAutor: true })
  const cab = colunasDaNota(nf)

  const { data: saved, error: errCabec } = await supabase
    .from('notas_fiscais')
    .upsert(
      { loja_id: loja.id, ...cab, full_object: nf, updated_at: new Date().toISOString() },
      { onConflict: 'loja_id,n_id_receb' }
    )
    .select('id')
    .single()

  // Sem checar o erro, uma falha (ex.: valor fora da faixa) descartava a NF + itens
  // em silêncio enquanto o status da loja virava "Concluido". Agora propaga.
  if (errCabec || !saved) {
    throw new Error(`Falha ao salvar NF ${cab.c_numero_nfe}: ${errCabec?.message ?? 'sem retorno'}`)
  }

  const itens = colunasDosItens(nf)
  if (itens.length) {
    const agora = new Date().toISOString()
    const rows = itens.map((it) => ({ loja_id: loja.id, nota_fiscal_id: saved.id, ...it, updated_at: agora }))
    const { error: errItens } = await supabase
      .from('nota_fiscal_items')
      .upsert(rows, { onConflict: 'loja_id,n_id_receb,n_sequencia' })
    if (errItens) {
      throw new Error(`Falha ao salvar itens da NF ${cab.c_numero_nfe}: ${errItens.message}`)
    }
  }

  await gravarNotaFiscalNoFrio(loja.id, {
    ...cab,
    full_object: nf,
    // o espelho do Contabo não tem produto_codigo
    itens: itens.map((it) => { const { produto_codigo, ...resto } = it; void produto_codigo; return resto }),
  } as NotaFiscalBulkRow)
  return true
}

export async function syncNotasFiscais(loja: LojaOmie, dataIni?: string, dataFim?: string) {
  const supabase = createServiceClient({ semAutor: true })
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
        is_test: loja.is_test,
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

export async function fetchNotaFiscal(loja: LojaOmie, nIdReceb: number, opcoes: { semRepetir?: boolean } = {}): Promise<boolean> {
  const res = await omieRequest<OmieNF>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    is_test: loja.is_test,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ConsultarRecebimento',
    data: { nIdReceb },
    semRepetir: opcoes.semRepetir,
  })
  if (!res?.cabec) return false
  return saveNotaFiscal(loja, res)
}

/**
 * Paridade 20/10/2026 (B7, lib/omie/nf-releitura.ts): relê as notas já gravadas cujo aviso de conclusão/reversão do Omie
 * é mais novo que a última gravação (o Omie não muda dAlt ao re-concluir, então o sync por dtAltDe não as pega). No
 * máximo LIMITE_RELEITURA_POR_CICLO por loja e ciclo, avisos dos últimos DIAS_RELEITURA dias, nunca nas lojas de
 * LOJAS_SEM_RELEITURA (4 e 7, + OMIE_NF_RELEITURA_LOJAS_FORA); não chama com qualquer método da chave bloqueado; pula nota
 * consultada há < 90 s (webhook); para no primeiro erro.
 * Só leitura no Omie (ConsultarRecebimento). Devolve quantas releu e o erro, se houve.
 */
export async function relerNotasComAvisoPendente(loja: LojaOmie): Promise<{ relidas: number; erro: string | null }> {
  if (loja.is_test || lojasForaDaReleitura(process.env.OMIE_NF_RELEITURA_LOJAS_FORA).has(loja.id)) return { relidas: 0, erro: null }
  const supabase = createServiceClient({ semAutor: true })
  const desde = new Date(Date.now() - DIAS_RELEITURA * 86400000).toISOString()
  // índice parcial (loja_id, n_id_receb) where n_id_receb is not null (migration 191): só os avisos de recebimento
  const { data: avisos, error: e1 } = await supabase
    .from('webhooks')
    .select('n_id_receb, created_at')
    .eq('loja_id', loja.id)
    .not('n_id_receb', 'is', null)
    .gte('created_at', desde)
    .in('message->>topic', [...TOPICOS_RELEITURA])
    .order('id', { ascending: false })  // mais novos primeiro (o limite corta os antigos)
    .limit(5000)
  if (e1) return { relidas: 0, erro: `avisos: ${e1.message}` }
  const ids = [...new Set(((avisos ?? []) as AvisoNota[]).map((a) => String(a.n_id_receb)))]
  if (!ids.length) return { relidas: 0, erro: null }
  const notas: NotaGravada[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('notas_fiscais')
      .select('n_id_receb, updated_at, deleted_at')
      .eq('loja_id', loja.id)
      .in('n_id_receb', ids.slice(i, i + 200))
    if (error) return { relidas: 0, erro: `notas: ${error.message}` }
    notas.push(...((data ?? []) as NotaGravada[]))
  }
  const fila = escolherNotasParaReler((avisos ?? []) as AvisoNota[], notas, { limite: LIMITE_RELEITURA_POR_CICLO, falhas: falhasReleitura(), consultas: consultasNota() })
  let relidas = 0
  for (const nIdReceb of fila) {
    if (paradaPorDisjuntor(loja)) break  // qualquer método da chave bloqueado: não chama (um 2º bloqueio trava a chave toda)
    registrarConsultaNota(nIdReceb)
    try {
      // resposta sem a nota: não grava nada, então espera 6 h para não reconsultar a cada ciclo
      if (await fetchNotaFiscal(loja, Number(nIdReceb), { semRepetir: true })) relidas++
      else registrarFalhaReleitura(nIdReceb)
    } catch (e) {
      registrarFalhaReleitura(nIdReceb)
      return { relidas, erro: e instanceof Error ? e.message : String(e) }
    }
  }
  return { relidas, erro: null }
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
    is_test: loja.is_test,
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
    is_test: loja.is_test,
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
    is_test: loja.is_test,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ExcluirRecebimento',
    data: { nIdReceb },
  })
}

// Mesma logica de lib/omie/ordem-producao.ts:pareceOPNaoExiste -- detecta
// pelo texto do erro quando o recebimento ja nao existe mais do lado da
// Omie (excluido direto por la, ou id invalido). "nao encontrado" fica de
// fora de proposito: e generico demais na Omie (aparece em erros nao
// relacionados a "registro nao existe mais"), classificaria erro real como
// fantasma e apagaria a nota localmente mesmo com o recebimento ainda
// existindo na Omie.
export function pareceRecebimentoNaoExiste(msg: string): boolean {
  return /nao cadastrada|não cadastrada/i.test(msg)
}

/**
 * Checa se já existe nota fiscal com essa chave de acesso (44 dígitos) na loja,
 * independente da origem (Omie ou SEFAZ direto). Uma futura integração de consulta
 * direta à SEFAZ deve chamar isso antes de inserir, já que ela não tem n_id_receb
 * (a chave usada no dedup do sync Omie) — a chave de acesso é o identificador comum
 * entre as duas origens.
 */
export async function existeNotaFiscalComChave(lojaId: number, chaveNfe: string): Promise<boolean> {
  const supabase = createServiceClient({ semAutor: true })
  const { count } = await supabase
    .from('notas_fiscais')
    .select('id', { count: 'exact', head: true })
    .eq('loja_id', lojaId)
    .eq('c_chave_nfe', chaveNfe)
    .is('deleted_at', null)
  return (count ?? 0) > 0
}
