'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'
import { dataCriacaoBahia, dataOmieBR, hojeBahiaISO } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'
import type { TipoTransferencia } from '@/lib/transferencia-tipos'

export async function createTransferencia(data: {
  codigoLocalOrigem: number
  codigoLocalDestino: number
  tipo: TipoTransferencia
  data?: string // YYYY-MM-DD; vazio = hoje. Pode ser retroativa, nao futura.
}) {
  if (data.codigoLocalOrigem === data.codigoLocalDestino) {
    return { error: 'Origem e destino não podem ser o mesmo local' }
  }
  if (data.tipo !== 'TRF' && data.tipo !== 'TPQ') {
    return { error: 'Tipo de transferência inválido' }
  }
  const hojeBahia = hojeBahiaISO()
  if (data.data && data.data > hojeBahia) {
    return { error: 'A data não pode ser futura' }
  }
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Criar'))) {
    return { error: 'Sem permissao para criar transferencia' }
  }
  const userId = (await getUser()).id
  const supabase = createServiceClient()
  // Sempre grava data ancorada ao meio-dia Bahia: a escolhida, ou hoje se vier
  // vazia (evita cair no now() do banco, que perde a ancoragem de fuso).
  const dataCriacao = dataCriacaoBahia(data.data) ?? dataCriacaoBahia(hojeBahia)!
  const { data: trans } = await supabase
    .from('transferencias')
    .insert({
      loja_id: lojaId,
      codigo_local_origem: data.codigoLocalOrigem,
      codigo_local_destino: data.codigoLocalDestino,
      motivo: data.tipo, // guarda o tipo (TRF/TPQ); vira o `tipo` do ajuste no Omie
      status: 'Em contagem',
      user_id: userId,
      data: dataCriacao,
    })
    .select('id')
    .single()
  await registrarAuditoria('criar', 'transferência', trans?.id ?? null, `${data.tipo === 'TPQ' ? 'Perda/quebra' : 'Transferência'}`)
  revalidatePath('/transferencia')
  return { id: trans?.id }
}

export async function addMovimento(
  transferenciaId: number,
  produto: { id_prod: number }
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return null
  }
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('codigo_local_origem, codigo_local_destino, motivo')
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single()

  if (!trans) return null

  // motivo da transferencia guarda o tipo escolhido (TRF/TPQ); fallback TRF.
  const tipo = trans.motivo === 'TPQ' ? 'TPQ' : 'TRF'

  const { data } = await supabase
    .from('movimentos')
    .insert({
      loja_id: lojaId,
      transferencia_id: transferenciaId,
      tipo,
      origem: 'AJU',
      motivo: tipo,
      data: new Date().toISOString(),
      id_prod: produto.id_prod,
      codigo_local_estoque: trans.codigo_local_origem,
      codigo_local_estoque_destino: trans.codigo_local_destino,
      status: 'Iniciado',
    })
    .select('id')
    .single()
  revalidatePath(`/transferencia/${transferenciaId}/contagem`)
  return data
}

/**
 * Resultado do envio item-a-item devolvido para a UI atualizar a linha na hora.
 */
export type EnvioMovimentoResult = {
  status: string
  descricao_status: string | null
  valor: number | null
  id_ajuste: number | null
  error?: string
}

/**
 * Envia UM movimento ao Omie na hora (item-a-item): grava a quantidade, e se ela
 * for valida (> 0) busca o CMC e lanca o ajuste de estoque. Se o item ja tinha sido
 * lancado (tem id_ajuste), exclui o ajuste antigo antes de relancar (reprocessa ao
 * mexer na quantidade). Erro num item NAO afeta os outros. Retorna o status final
 * para a UI atualizar a linha sem refresh.
 */
export async function enviarMovimento(
  movimentoId: number,
  quan: number | null
): Promise<EnvioMovimentoResult> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { status: 'Erro', descricao_status: 'Sem permissao para editar', valor: null, id_ajuste: null, error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()

  // Carrega o movimento + transferencia + loja num so passo.
  const { data: mov } = await supabase
    .from('movimentos')
    .select(
      'id, id_prod, codigo_local_estoque, codigo_local_estoque_destino, tipo, id_ajuste, tentativas, transferencia:transferencias(id, codigo_local_origem, motivo, data, status, loja:lojas(id, omie_app_key, omie_app_secret))'
    )
    .eq('id', movimentoId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      id_prod: number
      codigo_local_estoque: number
      codigo_local_estoque_destino: number
      tipo: string
      id_ajuste: number | null
      tentativas: number | null
      transferencia: {
        id: number
        codigo_local_origem: number
        motivo: string | null
        data: string | null
        status: string | null
        loja: LojaOmie
      } | null
    }>()

  if (!mov?.transferencia?.loja) {
    return { status: 'Erro', descricao_status: 'Movimento não encontrado', valor: null, id_ajuste: null, error: 'Movimento não encontrado' }
  }

  // Se ja foi lancado, exclui o ajuste antigo antes de relancar (mexeu na quantidade
  // -> reprocessa). Limpa os campos de integracao pra nao deixar estado velho.
  // Se a exclusao FALHAR (comunicacao), aborta: nao zera id_ajuste nem relança, senão
  // o ajuste antigo fica no Omie e o novo duplica (estoque dobrado, irreversível).
  if (mov.id_ajuste) {
    const ok = await excluirAjusteEstoque(mov.transferencia.loja, mov.id_ajuste)
    if (!ok) {
      return { status: 'Erro', descricao_status: 'Falha ao remover o ajuste antigo no Omie', valor: null, id_ajuste: mov.id_ajuste, error: 'Não foi possível remover o ajuste antigo no Omie. Tente reenviar.' }
    }
    await supabase
      .from('movimentos')
      .update({ id_ajuste: null, id_movest: null, codigo_status: null, descricao_status: null, response: null })
      .eq('id', mov.id)
  }

  // Quantidade vazia/zerada: so grava e marca 'Iniciado' (sem mandar pro Omie). Nao
  // apaga o item (evita o bug do produto que "some"); o usuario segue contando.
  if (quan === null || !(quan > 0)) {
    await supabase
      .from('movimentos')
      .update({ quan, status: 'Iniciado', updated_at: new Date().toISOString() })
      .eq('id', mov.id)
    revalidatePath('/transferencia')
    return { status: 'Iniciado', descricao_status: null, valor: null, id_ajuste: null }
  }

  await supabase
    .from('movimentos')
    .update({ quan, updated_at: new Date().toISOString() })
    .eq('id', mov.id)

  const trans: TransferenciaComMovimentos = {
    id: mov.transferencia.id,
    codigo_local_origem: mov.transferencia.codigo_local_origem,
    motivo: mov.transferencia.motivo,
    data: mov.transferencia.data,
    movimentos: [],
    loja: mov.transferencia.loja,
  }
  const movRow: MovimentoRow = {
    id: mov.id,
    id_prod: mov.id_prod,
    codigo_local_estoque: mov.codigo_local_estoque,
    codigo_local_estoque_destino: mov.codigo_local_estoque_destino,
    tipo: mov.tipo,
    quan,
    status: 'Iniciado',
    id_ajuste: null,
    tentativas: mov.tentativas,
  }

  const dataMov = dataOmieBR(mov.transferencia.data)
  await processarMovimento(trans, movRow, lojaId, dataMov, await carimboUsuario())

  // Le o resultado final que processarMovimento gravou.
  const { data: final } = await supabase
    .from('movimentos')
    .select('status, descricao_status, valor, id_ajuste')
    .eq('id', mov.id)
    .single<{ status: string | null; descricao_status: string | null; valor: number | null; id_ajuste: number | null }>()

  revalidatePath('/transferencia')
  return {
    status: final?.status ?? 'Erro',
    descricao_status: final?.descricao_status ?? null,
    valor: final?.valor ?? null,
    id_ajuste: final?.id_ajuste ?? null,
  }
}

export async function removeMovimento(movimentoId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()
  // Se o movimento ja foi lancado no Omie (id_ajuste), exclui o ajuste de estoque
  // antes de remover a linha — senao o estoque ficaria ajustado sem o item no
  // sistema. Vale para transferencia finalizada tambem (editar pos-fato).
  const { data: mov } = await supabase
    .from('movimentos')
    .select('id, id_ajuste, transferencia:transferencias(loja:lojas(id, omie_app_key, omie_app_secret))')
    .eq('id', movimentoId)
    .eq('loja_id', lojaId)
    .single<{ id: number; id_ajuste: number | null; transferencia: { loja: LojaOmie } | null }>()
  if (mov?.id_ajuste && mov.transferencia?.loja) {
    // excluirAjusteEstoque nunca lança (sempre devolve boolean); precisa checar o
    // retorno, senão uma falha real de comunicação passa despercebida e o
    // movimento é apagado localmente com o ajuste ainda vivo no Omie.
    const ok = await excluirAjusteEstoque(mov.transferencia.loja, mov.id_ajuste)
    if (!ok) return { error: 'Não foi possível remover o ajuste antigo no Omie. Tente de novo.' }
  }
  await supabase.from('movimentos').delete().eq('id', movimentoId).eq('loja_id', lojaId)
  revalidatePath('/transferencia')
  return { ok: true }
}

type MovimentoRow = {
  id: number
  id_prod: number
  codigo_local_estoque: number
  codigo_local_estoque_destino: number
  tipo: string
  quan: number | null
  status: string | null
  id_ajuste: number | null
  tentativas: number | null
}

type TransferenciaComMovimentos = {
  id: number
  codigo_local_origem: number
  motivo: string | null
  data: string | null
  movimentos: MovimentoRow[]
  loja: LojaOmie
}

/**
 * Processa um unico movimento de transferencia contra o Omie: busca o CMC e lanca o
 * ajuste de estoque tipo TRF (origem -> destino). Extraido para reuso entre
 * finishTransferencia e forceSyncTransferencia.
 */
async function processarMovimento(
  trans: TransferenciaComMovimentos,
  mov: MovimentoRow,
  lojaId: number,
  dataMov: string, // DD/MM/YYYY: data da transferencia (vai no lancamento)
  obsCarimbo: string // "NTB Estoque · <usuario>" — quem fez a transferencia
) {
  const supabase = createServiceClient()

  if (mov.quan === null) {
    await supabase.from('movimentos').delete().eq('id', mov.id)
    return
  }

  // O CMC e buscado na posicao ATUAL (hoje): e o custo medio vigente. Buscar na
  // data retroativa marcaria "Sem CMC" produtos que so ganharam custo depois.
  // Apenas a DATA DO LANCAMENTO (param.data) usa a data da transferencia.
  const hojeCmc = dataOmieBR(null)

  try {
    const posicao = await getPosicaoProduto(
      trans.loja,
      mov.codigo_local_estoque,
      mov.id_prod,
      hojeCmc
    )
    const valor = posicao?.n_cmc ?? 0

    if (valor <= 0) {
      // 'Sem CMC' (nao 'Erro'): o produto ainda nao tem custo medio fechado no Omie.
      // Nao e falha de integracao nossa; o placar trata separado e reenviar resolve
      // quando o custo aparecer. Igual ao fluxo do inventario.
      // Grava tentativas/ultima_tentativa_em tambem aqui (nao so no try/catch de
      // baixo) -- sem isso o throttle do retry automatico nunca reconhece uma
      // tentativa de 'Sem CMC' como "recente", e o cron reenviaria esse movimento a
      // cada 10 min pra sempre em vez de 1x/hora com teto (mesmo achado da Task 4
      // em lib/actions/inventario.ts).
      await supabase
        .from('movimentos')
        .update({
          status: 'Sem CMC',
          descricao_status: 'Sem CMC',
          tentativas: (mov.tentativas ?? 0) + 1,
          ultima_tentativa_em: new Date().toISOString(),
        })
        .eq('id', mov.id)
      return
    }

    await supabase
      .from('movimentos')
      .update({ status: 'Processando', valor })
      .eq('id', mov.id)

    const param = {
      codigo_local_estoque: mov.codigo_local_estoque,
      id_prod: mov.id_prod,
      cod_int_ajuste: `MOV-${mov.id}`,
      data: dataMov,
      quan: mov.quan,
      valor,
      obs: obsCarimbo,
      origem: 'AJU',
      // O `tipo` do ajuste no Omie só aceita ENT/SAI/SLD/TRF. A transferência (inclusive
      // Perda e Quebra) é sempre um TRF entre locais; o "TPQ" é o MOTIVO, não o tipo.
      // Sem isto, a TPQ dava "preenchimento inválido da tag [tipo]".
      tipo: mov.tipo === 'TPQ' ? 'TRF' : mov.tipo,
      // Omie nao aceita 'TPQ' no campo motivo; TPQ e um tipo interno que mapeia para TRF
      motivo: (trans.motivo === 'TPQ' ? 'TRF' : trans.motivo) || 'TRF',
      codigo_local_estoque_destino: mov.codigo_local_estoque_destino,
    }

    const res = await omieRequest<{
      codigo_status?: string
      descricao_status?: string
      id_movest?: number
      id_ajuste?: number
    }>({
      loja_id: lojaId,
      omie_app_key: trans.loja.omie_app_key,
      omie_app_secret: trans.loja.omie_app_secret,
      endpoint: 'v1/estoque/ajuste',
      call: 'IncluirAjusteEstoque',
      data: param,
    })

    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'Movimento',
      request: JSON.stringify(param),
      response: JSON.stringify(res),
      code: res.codigo_status ?? '200',
    })

    // O omieRequest só lança em faultstring/HTTP-erro. Mas o IncluirAjusteEstoque pode
    // recusar com codigo_status≠0 SEM faultstring (200). O sinal confiável de sucesso é
    // ter id_ajuste; sem ele, NÃO marcar 'Concluido' (senão vira furo de estoque que
    // nunca é reenviado, pois o filtro de pendentes exclui 'Concluido').
    const sucesso = res.id_ajuste != null
    await supabase
      .from('movimentos')
      .update({
        status: sucesso ? 'Concluido' : 'Erro',
        codigo_status: res.codigo_status ?? null,
        descricao_status: res.descricao_status ?? (sucesso ? null : 'Omie não retornou id do ajuste'),
        id_movest: res.id_movest ?? null,
        id_ajuste: res.id_ajuste ?? null,
        response: JSON.stringify(res),
        tentativas: sucesso ? 0 : (mov.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', mov.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase
      .from('movimentos')
      .update({
        status: 'Erro',
        response: msg,
        tentativas: (mov.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', mov.id)
    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'Movimento',
      request: `movimento ${mov.id}`,
      error: true,
      error_message: msg,
    })
  }
}

/**
 * Finaliza a transferencia: para cada movimento, busca o CMC e lanca o ajuste de
 * estoque tipo TRF (origem -> destino) no Omie. Sequencial, sem retry manual.
 */
export async function finishTransferencia(transferenciaId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()

  await supabase
    .from('transferencias')
    .update({ status: 'Processando no Omie' })
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)

  const { data: trans } = await supabase
    .from('transferencias')
    .select(
      'id, codigo_local_origem, motivo, data, movimentos(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<TransferenciaComMovimentos>()

  if (!trans?.loja) return { error: 'Transferência não encontrada' }

  // Data do ajuste = data da transferencia (permite retroativa), nao a de hoje.
  const dataMov = dataOmieBR(trans.data)

  // Como os itens ja integram item-a-item ao sair do campo de quantidade, aqui so
  // processamos os que ficaram pendentes (sem id_ajuste e ainda nao Concluido).
  // Reprocessar um 'Concluido' (que ja tem ajuste) duplicaria o lancamento no Omie.
  const pendentes = trans.movimentos.filter(
    (m) => m.status !== 'Concluido' && m.id_ajuste === null && m.quan !== null && m.quan > 0
  )
  for (const mov of pendentes) {
    await processarMovimento(trans, mov, lojaId, dataMov, await carimboUsuario())
  }

  await supabase
    .from('transferencias')
    .update({ status: 'Concluido', updated_at: new Date().toISOString() })
    .eq('id', transferenciaId)

  revalidatePath('/transferencia')
  return { ok: true }
}

/**
 * Reprocessa SOMENTE os movimentos com falha (status 'Erro' ou null) de uma
 * transferencia ja concluida, sem mexer nos 'Concluido'. Espelha o forceSync do Laravel.
 */
export async function forceSyncTransferencia(transferenciaId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select(
      'id, codigo_local_origem, motivo, data, movimentos(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<TransferenciaComMovimentos>()

  if (!trans?.loja) return { error: 'Transferência não encontrada' }

  await supabase
    .from('transferencias')
    .update({ status: 'Processando no Omie' })
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)

  // Data do ajuste = data da transferencia (permite retroativa), nao a de hoje.
  const dataMov = dataOmieBR(trans.data)

  // Reprocessa tudo que nao integrou ainda (Erro/Processando travado/Iniciado com
  // quantidade), sem tocar nos 'Concluido' (tem ajuste, relancar duplicaria).
  const pendentes = trans.movimentos.filter(
    (m) =>
      m.status !== 'Concluido' &&
      m.id_ajuste === null &&
      m.quan !== null &&
      m.quan > 0
  )

  for (const mov of pendentes) {
    await processarMovimento(trans, mov, lojaId, dataMov, await carimboUsuario())
  }

  await supabase
    .from('transferencias')
    .update({ status: 'Concluido', updated_at: new Date().toISOString() })
    .eq('id', transferenciaId)

  revalidatePath('/transferencia')
  return { ok: true }
}

const SEM_CMC_MAX_TENTATIVAS = 20
const SEM_CMC_STALE_HORAS = 1

type MovimentoTransferenciaRetryRow = {
  id: number
  transferencia_id: number
  loja_id: number
  status: string | null
  tentativas: number | null
  id_ajuste: number | null
  quan: number | null
}

type TransferenciaHeader = Omit<TransferenciaComMovimentos, 'movimentos'>

/**
 * Varre movimentos de transferencia pendentes de lancamento no Omie (status 'Erro'
 * ou 'Sem CMC', `transferencia_id IS NOT NULL`) das lojas informadas e tenta
 * reenviar, reusando `processarMovimento` -- serve o cron de 10 em 10 min. Sem
 * sessao de usuario (contexto de cron), por isso `lojaId` vem explicito em vez de
 * `getCurrentLojaId()`/`requirePermissao()`. Mesma filosofia de
 * `retryAjustesInventarioPendentes` (`lib/actions/inventario.ts`, ja revisada em 3
 * rounds): 'Erro' reenvia sempre, sem teto (falha transitoria se resolve sozinha
 * reenviando); 'Sem CMC' tem teto de tentativas + throttle de 1h (nao vai se
 * resolver sem acao humana no cadastro do Omie, entao nao adianta bater todo cron).
 *
 * Como `processarMovimento` exige o objeto `trans` completo (com `loja` embutida),
 * agrupamos os movimentos elegiveis por `transferencia_id` e buscamos o cabecalho
 * de cada transferencia 1x (SEM `movimentos(*)` do pai inteiro -- mesmo motivo do
 * inventario.ts: isso incluiria a coluna `response` de TODOS os movimentos irmaos
 * a cada 10 min, payload multi-MB desnecessario), processando so os movimentos que
 * bateram no filtro de retry acima -- nao todos os "pendentes" da transferencia.
 * Processamento sequencial (sem paralelizar).
 */
export async function retryMovimentosTransferenciaPendentes(
  lojas: LojaOmie[],
  opts: { limitePorLoja?: number } = {}
): Promise<{ loja_id: number; tentadas: number; sucesso: number; falhas: number; erro?: string }[]> {
  const limitePorLoja = opts.limitePorLoja ?? 30
  const supabase = createServiceClient()
  const resultados: { loja_id: number; tentadas: number; sucesso: number; falhas: number; erro?: string }[] = []

  for (const loja of lojas) {
    const { data: errosGenericos, error: erroErros } = await supabase
      .from('movimentos')
      .select('id, transferencia_id, loja_id, status, tentativas, id_ajuste, quan')
      .eq('loja_id', loja.id)
      .not('transferencia_id', 'is', null)
      .eq('status', 'Erro')
      .order('ultima_tentativa_em', { ascending: true, nullsFirst: true })
      .limit(limitePorLoja)

    const staleCutoff = new Date(Date.now() - SEM_CMC_STALE_HORAS * 3600_000).toISOString()
    const { data: semCmc, error: erroSemCmc } = await supabase
      .from('movimentos')
      .select('id, transferencia_id, loja_id, status, tentativas, id_ajuste, quan')
      .eq('loja_id', loja.id)
      .not('transferencia_id', 'is', null)
      .eq('status', 'Sem CMC')
      .lt('tentativas', SEM_CMC_MAX_TENTATIVAS)
      .or(`ultima_tentativa_em.is.null,ultima_tentativa_em.lt.${staleCutoff}`)
      .order('ultima_tentativa_em', { ascending: true, nullsFirst: true })
      .limit(limitePorLoja)

    // Nao engolir erro de query: se qualquer uma falhar (timeout, URI longa, erro
    // de parse do .or()), reportar explicitamente por loja em vez de tratar como
    // "0 pendentes" -- mesmo padrao de bug ja visto 3x neste repo (AGENTS.md: RPC
    // que engolia erro escondeu 90 dias de Compras, buscarFrio devolvendo [],
    // buscarTudoPaginado tratando erro como fim de pagina).
    if (erroErros || erroSemCmc) {
      resultados.push({
        loja_id: loja.id,
        tentadas: 0,
        sucesso: 0,
        falhas: 0,
        erro: (erroErros ?? erroSemCmc)!.message,
      })
      continue
    }

    // Segunda camada de protecao (defesa em profundidade, mesmo criterio de
    // finishTransferencia/forceSyncTransferencia): nunca reprocessar movimento que
    // ja tem id_ajuste (duplicaria o lancamento no Omie) ou que ficou sem quan/quan
    // <= 0 (seria DELETADO ou nunca deveria ter sido enviado por processarMovimento).
    const pendentes = [...(errosGenericos ?? []), ...(semCmc ?? [])]
      .filter((m) => m.id_ajuste === null && m.quan !== null && m.quan > 0)
      .slice(0, limitePorLoja) as MovimentoTransferenciaRetryRow[]

    if (pendentes.length === 0) {
      resultados.push({ loja_id: loja.id, tentadas: 0, sucesso: 0, falhas: 0 })
      continue
    }

    // Marca 'Processando' JA, antes de chamar o Omie: torna esses movimentos
    // invisiveis pro filtro status='Erro'/'Sem CMC' de uma proxima execucao do cron
    // que comece antes desta terminar -- sem isso, duas execucoes concorrentes
    // reenviariam os MESMOS movimentos (double-send no Omie).
    const idsSelecionados = pendentes.map((m) => m.id)
    const { error: erroMarcar } = await supabase
      .from('movimentos')
      .update({ status: 'Processando' })
      .in('id', idsSelecionados)
    if (erroMarcar) {
      resultados.push({
        loja_id: loja.id,
        tentadas: 0,
        sucesso: 0,
        falhas: 0,
        erro: `falha ao marcar 'Processando': ${erroMarcar.message}`,
      })
      continue
    }

    let sucesso = 0
    let falhas = 0
    // Erros dos proprios updates de estorno ('Processando' -> 'Erro') abaixo --
    // se o estorno em si falhar (erro transiente de banco, timeout), o movimento
    // fica preso em 'Processando' de novo. Sem retry automatico pra esse update
    // especifico, mas nao pode passar em silencio: acumula e sobe no `erro` do
    // resultado da loja (mesmo cuidado do fix round 3 de retryAjustesInventarioPendentes).
    const errosEstorno: string[] = []

    const porTransferencia = new Map<number, number[]>()
    for (const mov of pendentes) {
      const lista = porTransferencia.get(mov.transferencia_id)
      if (lista) lista.push(mov.id)
      else porTransferencia.set(mov.transferencia_id, [mov.id])
    }

    for (const [transferenciaId, movIds] of porTransferencia) {
      const { data: transHeader, error: erroHeader } = await supabase
        .from('transferencias')
        .select('id, codigo_local_origem, motivo, data, loja:lojas(id, omie_app_key, omie_app_secret)')
        .eq('id', transferenciaId)
        .eq('loja_id', loja.id)
        .single<TransferenciaHeader>()

      // Qualquer saida antecipada daqui pra baixo precisa DEVOLVER o status de
      // 'Processando' pra 'Erro' nos movimentos que nao vao ser processados --
      // senao eles ficam presos em 'Processando' pra sempre, invisiveis ao filtro
      // status='Erro'/'Sem CMC' do proximo ciclo do cron.
      if (erroHeader || !transHeader?.loja) {
        const { error: erroEstorno } = await supabase
          .from('movimentos')
          .update({ status: 'Erro' })
          .in('id', movIds)
        if (erroEstorno) {
          errosEstorno.push(
            `estorno p/ movimento(s) [${movIds.join(',')}] (transferencia ${transferenciaId}, falha no header) falhou: ${erroEstorno.message}`
          )
        }
        falhas += movIds.length
        continue
      }

      const { data: movsElegiveis, error: erroMovs } = await supabase
        .from('movimentos')
        .select('id, id_prod, codigo_local_estoque, codigo_local_estoque_destino, tipo, quan, status, id_ajuste, tentativas')
        .in('id', movIds)

      if (erroMovs) {
        const { error: erroEstorno } = await supabase
          .from('movimentos')
          .update({ status: 'Erro' })
          .in('id', movIds)
        if (erroEstorno) {
          errosEstorno.push(
            `estorno p/ movimento(s) [${movIds.join(',')}] (transferencia ${transferenciaId}, falha no refetch) falhou: ${erroEstorno.message}`
          )
        }
        falhas += movIds.length
        continue
      }

      const dataMov = dataOmieBR(transHeader.data)
      const trans: TransferenciaComMovimentos = { ...transHeader, movimentos: [] }

      // Se algum id elegivel nao vier no resultado (linha some entre selecao e
      // fetch), conta como falha E estorna o status desses ids especificos de
      // volta pra 'Erro' (nao precisa reconstruir o status original exato --
      // 'Erro' ja garante que o proximo ciclo do cron tenta de novo).
      const idsEncontrados = new Set((movsElegiveis ?? []).map((m) => m.id))
      const idsNaoEncontrados = movIds.filter((id) => !idsEncontrados.has(id))
      if (idsNaoEncontrados.length > 0) {
        const { error: erroEstorno } = await supabase
          .from('movimentos')
          .update({ status: 'Erro' })
          .in('id', idsNaoEncontrados)
        if (erroEstorno) {
          errosEstorno.push(
            `estorno p/ movimento(s) [${idsNaoEncontrados.join(',')}] (transferencia ${transferenciaId}, sumiram no refetch) falhou: ${erroEstorno.message}`
          )
        }
        falhas += idsNaoEncontrados.length
      }

      for (const mov of (movsElegiveis ?? []) as MovimentoRow[]) {
        await processarMovimento(trans, mov, loja.id, dataMov, await carimboUsuario())
        const { data: final } = await supabase
          .from('movimentos')
          .select('status')
          .eq('id', mov.id)
          .single<{ status: string | null }>()
        if (final?.status === 'Concluido') sucesso++
        else falhas++
      }
    }

    resultados.push({
      loja_id: loja.id,
      tentadas: pendentes.length,
      sucesso,
      falhas,
      ...(errosEstorno.length > 0 ? { erro: errosEstorno.join(' | ') } : {}),
    })
  }

  return resultados
}

/**
 * Duplica uma transferencia: copia origem/destino/motivo (status 'Em contagem') e
 * os movimentos com quan zerada e status 'Iniciado'. Retorna o id da nova.
 * novaData (YYYY-MM-DD, opcional): data escolhida pelo usuario; cai em hoje se
 * vazia. Nao pode ser futura (mesma regra de createTransferencia).
 */
export async function duplicarTransferencia(transferenciaId: number, novaData?: string) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Criar'))) {
    return { error: 'Sem permissao para criar transferencia' }
  }
  const hojeBahia = hojeBahiaISO()
  if (novaData && novaData > hojeBahia) {
    return { error: 'A data não pode ser futura' }
  }
  const supabase = createServiceClient()

  const { data: original } = await supabase
    .from('transferencias')
    .select('id, codigo_local_origem, codigo_local_destino, motivo')
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      codigo_local_origem: number
      codigo_local_destino: number
      motivo: string | null
    }>()

  if (!original) return { error: 'Transferência não encontrada' }

  // A duplicata e uma NOVA transferencia: responsavel = quem duplicou, data
  // escolhida pelo usuario (ou hoje se nao informada).
  const userId = (await getUser()).id
  const dataNova = dataCriacaoBahia(novaData) ?? dataCriacaoBahia(hojeBahia)!
  const { data: nova } = await supabase
    .from('transferencias')
    .insert({
      loja_id: lojaId,
      codigo_local_origem: original.codigo_local_origem,
      codigo_local_destino: original.codigo_local_destino,
      motivo: original.motivo,
      status: 'Em contagem',
      user_id: userId,
      data: dataNova,
    })
    .select('id')
    .single<{ id: number }>()

  if (!nova) return { error: 'Falha ao criar transferência' }

  const { data: movimentos } = await supabase
    .from('movimentos')
    .select('id_prod, codigo_local_estoque, codigo_local_estoque_destino')
    .eq('transferencia_id', transferenciaId)

  if (movimentos?.length) {
    const tipo = original.motivo === 'TPQ' ? 'TPQ' : 'TRF'
    await supabase.from('movimentos').insert(
      movimentos.map((m) => ({
        loja_id: lojaId,
        transferencia_id: nova.id,
        id_prod: m.id_prod,
        codigo_local_estoque: m.codigo_local_estoque,
        codigo_local_estoque_destino: m.codigo_local_estoque_destino,
        tipo,
        origem: 'AJU',
        motivo: tipo,
        data: new Date().toISOString(),
        quan: null,
        status: 'Iniciado',
      }))
    )
  }

  revalidatePath('/transferencia')
  return { id: nova.id }
}

/**
 * Exclui uma transferencia: para cada movimento ja lancado no Omie (id_ajuste),
 * exclui o ajuste de estoque; depois deleta a transferencia (cascade remove os movimentos).
 */
export async function excluirTransferencia(transferenciaId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Excluir'))) {
    return { error: 'Sem permissão para excluir' }
  }
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('id, movimentos(id, id_ajuste), loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      movimentos: Array<{ id: number; id_ajuste: number | null }>
      loja: LojaOmie
    }>()

  if (!trans?.loja) return { error: 'Transferência não encontrada' }

  for (const mov of trans.movimentos) {
    if (mov.id_ajuste) {
      // excluirAjusteEstoque nunca lança, sempre devolve boolean: se ignorado, uma
      // falha real de comunicação passa despercebida e a transferência é apagada
      // localmente com ajustes ainda vivos (órfãos) no Omie.
      const ok = await excluirAjusteEstoque(trans.loja, mov.id_ajuste)
      if (!ok) {
        return { error: `Não foi possível remover o ajuste do movimento ${mov.id} no Omie. Tente excluir de novo.` }
      }
    }
  }

  await supabase.from('transferencias').delete().eq('id', transferenciaId).eq('loja_id', lojaId)

  await registrarAuditoria('excluir', 'transferência', transferenciaId, null)
  revalidatePath('/transferencia')
  return { ok: true }
}

/**
 * Edita a quantidade de um movimento. Se ja foi lancado no Omie (tem id_ajuste),
 * exclui o ajuste primeiro, limpa os campos de integracao e volta o status para
 * 'Iniciado' antes de gravar a nova quantidade. Espelha editQuantidade do Laravel.
 */
export async function editQuantidadeMovimento(movId: number, quan: number | null) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()

  const { data: mov } = await supabase
    .from('movimentos')
    .select('id, id_ajuste, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', movId)
    .eq('loja_id', lojaId)
    .single<{ id: number; id_ajuste: number | null; loja: LojaOmie }>()

  if (!mov) return { error: 'Movimento não encontrado' }

  if (mov.id_ajuste && mov.loja) {
    // Falha real ao excluir o ajuste antigo: aborta para não zerar a referência e
    // duplicar o ajuste no Omie depois.
    const ok = await excluirAjusteEstoque(mov.loja, mov.id_ajuste)
    if (!ok) return { error: 'Não foi possível remover o ajuste antigo no Omie. Tente de novo.' }
    await supabase
      .from('movimentos')
      .update({
        quan,
        status: 'Iniciado',
        id_ajuste: null,
        id_movest: null,
        codigo_status: null,
        descricao_status: null,
        response: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', movId)
      .eq('loja_id', lojaId)
  } else {
    await supabase
      .from('movimentos')
      .update({ quan, updated_at: new Date().toISOString() })
      .eq('id', movId)
      .eq('loja_id', lojaId)
  }

  revalidatePath('/transferencia')
  return { ok: true }
}
