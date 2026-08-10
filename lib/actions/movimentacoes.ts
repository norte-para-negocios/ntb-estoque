'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { dataCriacaoBahia, dataOmieBR, hojeBahiaISO } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'

const TIPOS_MANUAIS = new Set(['ENT', 'SAI'])

type MovimentoManualRow = {
  id: number
  codigo_local_estoque: number
  id_prod: number
  quan: number
  tipo: 'ENT' | 'SAI'
  obs: string | null
  data: string // data de criacao do movimento (coluna `data`); vira dataOmieBR(data) no lancamento
  tentativas: number | null
}

/**
 * Reenvia ao Omie 1 movimento manual (ENT/SAI, `transferencia_id IS NULL`) ja
 * gravado em `movimentos`: busca o CMC e lanca o Ajuste de Estoque
 * (IncluirAjusteEstoque). Extraida de `criarAjusteManual` pra reuso entre o envio
 * na hora (criarAjusteManual) e o retry automatico do cron
 * (retryMovimentosManuaisPendentes), sem duplicar a chamada Omie duas vezes.
 * `mov.obs` ja vem com "<motivo digitado> · <carimbo do usuario>" (montado no
 * insert original); reusado tambem como descricao da auditoria em caso de sucesso.
 */
async function reenviarMovimentoManual(
  mov: MovimentoManualRow,
  loja: LojaOmie,
  lojaId: number
): Promise<{ id: number; status: string; erro?: string }> {
  const supabase = createServiceClient()

  try {
    const posicao = await getPosicaoProduto(loja, mov.codigo_local_estoque, mov.id_prod, dataOmieBR(null))
    const valor = posicao?.n_cmc ?? 0

    if (valor <= 0) {
      // Grava tentativas/ultima_tentativa_em tambem aqui (nao so no try/catch de
      // baixo) -- sem isso o throttle do retry automatico nunca reconhece uma
      // tentativa de 'Sem CMC' como "recente", e o cron reenviaria esse movimento a
      // cada 10 min pra sempre em vez de 1x/hora com teto (mesmo achado da Task 4
      // em lib/actions/inventario.ts -- gap que existia aqui tambem, corrigido
      // junto com esta extracao).
      await supabase
        .from('movimentos')
        .update({
          status: 'Sem CMC',
          descricao_status: 'Sem CMC',
          tentativas: (mov.tentativas ?? 0) + 1,
          ultima_tentativa_em: new Date().toISOString(),
        })
        .eq('id', mov.id)
      return { id: mov.id, status: 'Sem CMC' }
    }

    const param = {
      codigo_local_estoque: mov.codigo_local_estoque,
      id_prod: mov.id_prod,
      cod_int_ajuste: `MOV-${mov.id}`,
      data: dataOmieBR(mov.data),
      quan: mov.quan,
      valor,
      obs: mov.obs,
      origem: 'AJU',
      tipo: mov.tipo,
      motivo: mov.tipo,
    }

    const res = await omieRequest<{
      codigo_status?: string
      descricao_status?: string
      id_movest?: number
      id_ajuste?: number
    }>({
      loja_id: lojaId,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
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

    const sucesso = res.id_ajuste != null
    await supabase
      .from('movimentos')
      .update({
        status: sucesso ? 'Concluido' : 'Erro',
        codigo_status: res.codigo_status ?? null,
        descricao_status: res.descricao_status ?? (sucesso ? null : 'Omie nao retornou id do ajuste'),
        id_movest: res.id_movest ?? null,
        id_ajuste: res.id_ajuste ?? null,
        response: JSON.stringify(res),
        tentativas: sucesso ? 0 : (mov.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', mov.id)

    if (sucesso) await registrarAuditoria('criar', 'movimento', mov.id, `Ajuste manual ${mov.tipo} · ${mov.obs ?? ''}`)
    return { id: mov.id, status: sucesso ? 'Concluido' : 'Erro', erro: sucesso ? undefined : (res.descricao_status ?? 'Omie recusou o ajuste') }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase
      .from('movimentos')
      .update({
        status: 'Erro',
        descricao_status: msg,
        tentativas: (mov.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', mov.id)
    await logIntegrationAttempt({ loja_id: lojaId, model: 'Movimento', request: `movimento ${mov.id}`, error: true, error_message: msg })
    return { id: mov.id, status: 'Erro', erro: msg }
  }
}

/**
 * Cria um ajuste manual de saldo (entrada ou saida num unico local) direto da
 * tela de Movimentacoes, sem passar pela contagem de inventario. Perda/quebra e
 * transferencia entre locais continuam pelo fluxo /transferencia (que ja lanca
 * TPQ como TRF para um local de perda dedicado -- nao duplicar essa logica aqui).
 * Grava o `movimentos` local e lanca o Ajuste de Estoque no Omie na hora, via
 * `reenviarMovimentoManual` (mesma chamada usada por inventario/transferencia).
 */
export async function criarAjusteManual(input: {
  idProd: number
  tipo: 'ENT' | 'SAI'
  codigoLocalEstoque: number
  quantidade: number
  motivo: string
  data?: string // YYYY-MM-DD; vazio = hoje. Nao pode ser futura.
}) {
  if (!TIPOS_MANUAIS.has(input.tipo)) {
    return { error: 'Tipo de ajuste invalido' }
  }
  if (!(input.quantidade > 0)) {
    return { error: 'Quantidade precisa ser maior que zero' }
  }
  if (!input.motivo.trim()) {
    return { error: 'Informe o motivo do ajuste' }
  }
  const hojeBahia = hojeBahiaISO()
  if (input.data && input.data > hojeBahia) {
    return { error: 'A data nao pode ser futura' }
  }

  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes - Criar'))) {
    return { error: 'Sem permissao para criar movimento' }
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja nao encontrada' }

  const dataCriacao = dataCriacaoBahia(input.data) ?? dataCriacaoBahia(hojeBahia)!
  const obsCarimbo = `${input.motivo.trim()} · ${await carimboUsuario()}`
  const quan = input.tipo === 'SAI' ? -Math.abs(input.quantidade) : Math.abs(input.quantidade)

  const { data: mov } = await supabase
    .from('movimentos')
    .insert({
      loja_id: lojaId,
      tipo: input.tipo,
      origem: 'AJU',
      motivo: input.tipo,
      data: dataCriacao,
      id_prod: input.idProd,
      codigo_local_estoque: input.codigoLocalEstoque,
      quan,
      obs: obsCarimbo,
      status: 'Processando',
    })
    .select('id, tentativas')
    .single()
  if (!mov) return { error: 'Falha ao gravar o movimento' }

  const resultado = await reenviarMovimentoManual(
    {
      id: mov.id,
      codigo_local_estoque: input.codigoLocalEstoque,
      id_prod: input.idProd,
      quan,
      tipo: input.tipo,
      obs: obsCarimbo,
      data: dataCriacao,
      tentativas: mov.tentativas,
    },
    loja,
    lojaId
  )

  revalidatePath('/movimentacoes')
  return { id: resultado.id, status: resultado.status, erro: resultado.erro }
}

const SEM_CMC_MAX_TENTATIVAS = 20
const SEM_CMC_STALE_HORAS = 1
const PROCESSANDO_STALE_HORAS = 1
const TIPOS_MANUAIS_ARR = [...TIPOS_MANUAIS]

type MovimentoManualRetryRow = {
  id: number
  loja_id: number
  status: string | null
  tentativas: number | null
  id_ajuste: number | null
  quan: number | null
}

type MovimentoManualElegivel = {
  id: number
  id_prod: number
  codigo_local_estoque: number
  tipo: 'ENT' | 'SAI'
  obs: string | null
  data: string | null
  quan: number | null
  id_ajuste: number | null
  tentativas: number | null
}

/**
 * Varre movimentos manuais (ENT/SAI, `transferencia_id IS NULL`) pendentes de
 * lancamento no Omie (status 'Erro' ou 'Sem CMC') das lojas informadas e tenta
 * reenviar, reusando `reenviarMovimentoManual` -- serve o cron de 10 em 10 min.
 * Sem sessao de usuario (contexto de cron), por isso `lojaId` vem explicito. Mesma
 * filosofia de `retryAjustesInventarioPendentes` (`lib/actions/inventario.ts`, ja
 * revisada em 3 rounds): 'Erro' reenvia sempre, sem teto; 'Sem CMC' tem teto de
 * tentativas + throttle de 1h.
 *
 * CRITICO (auditoria de retry Omie, 2026-08-09/10): as 3 queries de elegibilidade
 * filtram por `tipo` (`TIPOS_MANUAIS_ARR` = ENT/SAI) alem de `transferencia_id IS
 * NULL`. Sem isso, linhas `TRF` (transferencia_id preenchido em outro fluxo, mas
 * que por algum motivo ficaram com `transferencia_id NULL` -- ou qualquer outro
 * tipo fora de ENT/SAI) eram reenviadas aqui em loop infinito: `reenviarMovimentoManual`
 * monta o payload do jeito manual (sem `codigo_local_estoque_destino`, que so o
 * fluxo de transferencia preenche), o Omie SEMPRE recusa, e como `status='Erro'`
 * generico nao tem teto de tentativas por design (falha transitoria se resolve
 * sozinha reenviando), essas linhas nunca saiam do loop -- gastando ~2 chamadas
 * Omie por linha a cada 10 min, pra sempre, 100% rejeitadas desde o deploy. Linhas
 * `TRF`/`transferencia_id NULL` presas em 'Erro' antes deste fix sao orfas
 * estruturalmente (nao tem `codigo_local_estoque_destino` pra reenviar por este
 * caminho nem pelo de transferencia.ts) -- ver AGENTS.md.
 *
 * Tambem reclama linhas travadas em 'Processando' ha mais de `PROCESSANDO_STALE_HORAS`
 * (crash/timeout no meio do envio anterior deixaria a linha invisivel pro filtro
 * de 'Erro'/'Sem CMC' pra sempre, sem esse reclaim) -- tratadas com a mesma
 * prioridade/sem teto de 'Erro' (achado Important #2 da mesma auditoria, replicado
 * aqui alem de `retryAjustesInventarioPendentes`/`retryMovimentosTransferenciaPendentes`
 * porque as 3 funcoes compartilham o mesmo padrao de trava 'Processando').
 *
 * Diferente de inventario/transferencia, o movimento manual NAO tem um "pai" com
 * itens -- a propria linha de `movimentos` ja tem tudo que `reenviarMovimentoManual`
 * precisa, so falta a `loja` (que ja vem no parametro `lojas`). Ainda assim, apos
 * marcar 'Processando' em lote, refazemos um fetch das linhas elegiveis (com
 * `error` destructurado, revertendo pra 'Erro' em caso de falha) -- mesma protecao
 * contra sobreposicao de execucoes/race do padrao de inventario.ts, e guarda contra
 * o registro ter mudado de estado (ex.: id_ajuste preenchido por outro caminho)
 * entre a selecao e o processamento. Processamento sequencial (sem paralelizar).
 */
export async function retryMovimentosManuaisPendentes(
  lojas: LojaOmie[],
  opts: { limitePorLoja?: number } = {}
): Promise<{ loja_id: number; tentadas: number; sucesso: number; falhas: number; erro?: string }[]> {
  const limitePorLoja = opts.limitePorLoja ?? 30
  const supabase = createServiceClient()
  const resultados: { loja_id: number; tentadas: number; sucesso: number; falhas: number; erro?: string }[] = []

  for (const loja of lojas) {
    const { data: errosGenericos, error: erroErros } = await supabase
      .from('movimentos')
      .select('id, loja_id, status, tentativas, id_ajuste, quan')
      .eq('loja_id', loja.id)
      .is('transferencia_id', null)
      .in('tipo', TIPOS_MANUAIS_ARR)
      .eq('status', 'Erro')
      .order('ultima_tentativa_em', { ascending: true, nullsFirst: true })
      .limit(limitePorLoja)

    const staleCutoff = new Date(Date.now() - SEM_CMC_STALE_HORAS * 3600_000).toISOString()
    const { data: semCmc, error: erroSemCmc } = await supabase
      .from('movimentos')
      .select('id, loja_id, status, tentativas, id_ajuste, quan')
      .eq('loja_id', loja.id)
      .is('transferencia_id', null)
      .in('tipo', TIPOS_MANUAIS_ARR)
      .eq('status', 'Sem CMC')
      .lt('tentativas', SEM_CMC_MAX_TENTATIVAS)
      .or(`ultima_tentativa_em.is.null,ultima_tentativa_em.lt.${staleCutoff}`)
      .order('ultima_tentativa_em', { ascending: true, nullsFirst: true })
      .limit(limitePorLoja)

    // Reclaim de linha travada em 'Processando' (Important #2, mesma auditoria):
    // um crash/timeout no meio de `reenviarMovimentoManual` (chamado tambem por
    // `criarAjusteManual`, fora do cron) pode deixar a linha em 'Processando' sem
    // nunca voltar pra 'Erro' -- invisivel aos 2 filtros acima pra sempre. Tratada
    // com a mesma prioridade/sem teto de 'Erro' (nao e um caso "sem CMC" que
    // precisa de acao humana, e sim uma tentativa que nunca terminou).
    const processandoCutoff = new Date(Date.now() - PROCESSANDO_STALE_HORAS * 3600_000).toISOString()
    const { data: processandoTravados, error: erroProcessando } = await supabase
      .from('movimentos')
      .select('id, loja_id, status, tentativas, id_ajuste, quan')
      .eq('loja_id', loja.id)
      .is('transferencia_id', null)
      .in('tipo', TIPOS_MANUAIS_ARR)
      .eq('status', 'Processando')
      .lt('ultima_tentativa_em', processandoCutoff)
      .order('ultima_tentativa_em', { ascending: true, nullsFirst: true })
      .limit(limitePorLoja)

    // Nao engolir erro de query: mesmo padrao de bug ja visto 3x neste repo
    // (AGENTS.md) -- reportar explicitamente por loja em vez de tratar como "0
    // pendentes".
    if (erroErros || erroSemCmc || erroProcessando) {
      resultados.push({
        loja_id: loja.id,
        tentadas: 0,
        sucesso: 0,
        falhas: 0,
        erro: (erroErros ?? erroSemCmc ?? erroProcessando)!.message,
      })
      continue
    }

    // Segunda camada de protecao: nunca reprocessar linha que ja tem id_ajuste
    // (duplicaria o lancamento no Omie) ou que ficou sem quan.
    // processandoTravados primeiro: sem isso, um backlog de 'Sem CMC' pode preencher
    // o limitePorLoja inteiro todo ciclo e nunca sobrar vaga pro reclaim de linha
    // presa (achado real da revisao final, 2026-08-10).
    const pendentes = [...(processandoTravados ?? []), ...(errosGenericos ?? []), ...(semCmc ?? [])]
      .filter((m) => m.id_ajuste === null && m.quan !== null)
      .slice(0, limitePorLoja) as MovimentoManualRetryRow[]

    if (pendentes.length === 0) {
      resultados.push({ loja_id: loja.id, tentadas: 0, sucesso: 0, falhas: 0 })
      continue
    }

    // Marca 'Processando' JA, antes de chamar o Omie: torna essas linhas invisiveis
    // pro filtro status='Erro'/'Sem CMC' de uma proxima execucao do cron que comece
    // antes desta terminar -- sem isso, duas execucoes concorrentes reenviariam os
    // MESMOS movimentos (double-send no Omie).
    const idsSelecionados = pendentes.map((m) => m.id)
    // ultima_tentativa_em precisa ser atualizada AQUI tambem -- sem isso, uma linha
    // 'Sem CMC' selecionada (que so entra elegivel quando ja tem >1h de idade) fica
    // reclamavel pelo reclaim de 'Processando' travado enquanto ainda esta em voo,
    // reabrindo o double-send que este marcador existe pra evitar (achado real da
    // revisao final, 2026-08-10).
    const { error: erroMarcar } = await supabase
      .from('movimentos')
      .update({ status: 'Processando', ultima_tentativa_em: new Date().toISOString() })
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
    const errosEstorno: string[] = []

    const { data: itensElegiveis, error: erroItens } = await supabase
      .from('movimentos')
      .select('id, id_prod, codigo_local_estoque, tipo, obs, data, quan, id_ajuste, tentativas')
      .in('id', idsSelecionados)

    if (erroItens) {
      const { error: erroEstorno } = await supabase
        .from('movimentos')
        .update({ status: 'Erro' })
        .in('id', idsSelecionados)
      if (erroEstorno) {
        errosEstorno.push(
          `estorno p/ movimento(s) [${idsSelecionados.join(',')}] (falha no refetch) falhou: ${erroEstorno.message}`
        )
      }
      resultados.push({
        loja_id: loja.id,
        tentadas: idsSelecionados.length,
        sucesso: 0,
        falhas: idsSelecionados.length,
        ...(errosEstorno.length > 0 ? { erro: errosEstorno.join(' | ') } : {}),
      })
      continue
    }

    // Se algum id elegivel nao vier no resultado (linha some entre selecao e
    // fetch), conta como falha E estorna o status desses ids especificos de volta
    // pra 'Erro' (nao precisa reconstruir o status original exato -- 'Erro' ja
    // garante que o proximo ciclo do cron tenta de novo).
    const idsEncontrados = new Set((itensElegiveis ?? []).map((m) => m.id))
    const idsNaoEncontrados = idsSelecionados.filter((id) => !idsEncontrados.has(id))
    if (idsNaoEncontrados.length > 0) {
      const { error: erroEstorno } = await supabase
        .from('movimentos')
        .update({ status: 'Erro' })
        .in('id', idsNaoEncontrados)
      if (erroEstorno) {
        errosEstorno.push(
          `estorno p/ movimento(s) [${idsNaoEncontrados.join(',')}] (sumiram no refetch) falhou: ${erroEstorno.message}`
        )
      }
      falhas += idsNaoEncontrados.length
    }

    for (const mov of (itensElegiveis ?? []) as MovimentoManualElegivel[]) {
      if (mov.id_ajuste !== null || mov.quan === null) {
        // Mudou de estado entre a selecao e agora (ex: id_ajuste preenchido por
        // outro caminho enquanto esperava na fila) -- nao reprocessa, so estorna
        // pra 'Erro' e deixa o proximo ciclo do cron reavaliar do zero.
        const { error: erroEstorno } = await supabase.from('movimentos').update({ status: 'Erro' }).eq('id', mov.id)
        if (erroEstorno) {
          errosEstorno.push(`estorno p/ movimento ${mov.id} (mudou de estado) falhou: ${erroEstorno.message}`)
        }
        falhas++
        continue
      }
      const resultado = await reenviarMovimentoManual(
        {
          id: mov.id,
          codigo_local_estoque: mov.codigo_local_estoque,
          id_prod: mov.id_prod,
          quan: mov.quan,
          tipo: mov.tipo,
          obs: mov.obs,
          data: mov.data ?? '',
          tentativas: mov.tentativas,
        },
        loja,
        loja.id
      )
      if (resultado.status === 'Concluido') sucesso++
      else falhas++
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
