'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'
import { dataCriacaoBahia, dataOmieBR, hojeBahiaISO } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'

export async function createInventario(
  codigoLocalEstoque: number,
  dataEscolhida?: string,
  filtros?: { tipos?: string[]; familias?: string[] }
) {
  const hojeBahia = hojeBahiaISO()
  if (dataEscolhida && dataEscolhida > hojeBahia) {
    return { error: 'A data não pode ser futura' }
  }
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Criar'))) {
    return { error: 'Sem permissao para criar inventario' }
  }
  const userId = (await getUser()).id
  const supabase = createServiceClient()
  const dataInventario = dataCriacaoBahia(dataEscolhida) ?? dataCriacaoBahia(hojeBahia)!
  const { data: inv, error } = await supabase
    .from('inventarios')
    .insert({
      loja_id: lojaId,
      codigo_local_estoque: codigoLocalEstoque,
      status: 'Em contagem',
      user_id: userId,
      data: dataInventario,
    })
    .select('id')
    .single()
  if (error || !inv) return { error: 'Falha ao criar inventário' }
  await registrarAuditoria('criar', 'inventário', inv.id, null)

  // Auto-popular com produtos se filtros informados
  const temFiltro = filtros && ((filtros.tipos?.length ?? 0) > 0 || (filtros.familias?.length ?? 0) > 0)
  if (temFiltro) {
    let pq = supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao, descricao_familia')
      .eq('loja_id', lojaId)
      .eq('inativo', false)
    if (filtros!.tipos?.length) pq = pq.in('tipo_item', filtros!.tipos)
    if (filtros!.familias?.length) pq = pq.in('descricao_familia', filtros!.familias)
    const { data: prods } = await pq
    if (prods?.length) {
      await supabase.from('inventario_items').insert(
        prods.map((p) => ({
          loja_id: lojaId,
          inventario_id: inv.id,
          produto_codigo_produto: p.codigo_produto,
          produto_codigo: p.codigo,
          produto_descricao: p.descricao,
          produto_familia: p.descricao_familia,
          quan: null,
          status: 'Iniciado',
        }))
      )
    }
  }

  revalidatePath('/inventario')
  return inv
}

export async function addInventarioItem(
  inventarioId: number,
  produto: {
    produto_codigo_produto: number
    produto_codigo: string
    produto_descricao: string
    produto_familia: string | null
  }
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return null
  }
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('inventario_items')
    .insert({
      loja_id: lojaId,
      inventario_id: inventarioId,
      ...produto,
      status: 'Iniciado',
    })
    .select('id, produto_codigo, produto_descricao, produto_familia, quan, status')
    .single()
  revalidatePath(`/inventario/${inventarioId}/contagem`)
  return data
}

/**
 * Resultado do envio item-a-item devolvido para a UI atualizar a linha na hora.
 */
export type EnvioInventarioResult = {
  status: string
  descricao_status: string | null
  valor: number | null
  id_ajuste: number | null
  error?: string
}

/**
 * Envia UM item do inventario ao Omie na hora (item-a-item): grava a quantidade, e se
 * ela for valida (>= 0) busca o CMC e lanca o ajuste de estoque. Se o item ja tinha
 * sido lancado (tem id_ajuste), exclui o ajuste antigo antes de relancar (reprocessa
 * ao mexer na quantidade). Erro num item NAO trava os outros. Retorna o status final
 * para a UI atualizar a linha sem refresh.
 *
 * Obs.: no inventario a contagem PODE ser 0 (zerar o saldo e um ajuste valido), por
 * isso aceitamos quan === 0; so quan null (campo vazio) fica pendente em 'Iniciado'.
 */
export async function enviarInventarioItem(
  itemId: number,
  quan: number | null
): Promise<EnvioInventarioResult> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { status: 'Erro', descricao_status: 'Sem permissao para editar', valor: null, id_ajuste: null, error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()

  const { data: item } = await supabase
    .from('inventario_items')
    .select(
      'id, produto_codigo, produto_codigo_produto, id_ajuste, tentativas, inventario:inventarios(id, codigo_local_estoque, tipo, origem, motivo, data, status, loja:lojas(id, omie_app_key, omie_app_secret))'
    )
    .eq('id', itemId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      produto_codigo: string
      produto_codigo_produto: number
      id_ajuste: number | null
      tentativas: number | null
      inventario: {
        id: number
        codigo_local_estoque: number
        tipo: string | null
        origem: string | null
        motivo: string | null
        data: string | null
        status: string | null
        loja: LojaOmie
      } | null
    }>()

  if (!item?.inventario?.loja) {
    return { status: 'Erro', descricao_status: 'Item não encontrado', valor: null, id_ajuste: null, error: 'Item não encontrado' }
  }

  // Ja lancado -> exclui o ajuste antigo antes de relancar (reprocessa ao mexer).
  // Falha real na exclusão: aborta (não zera id_ajuste nem relança) p/ não duplicar.
  if (item.id_ajuste) {
    const ok = await excluirAjusteEstoque(item.inventario.loja, item.id_ajuste)
    if (!ok) {
      return { status: 'Erro', descricao_status: 'Falha ao remover o ajuste antigo no Omie', valor: null, id_ajuste: item.id_ajuste, error: 'Não foi possível remover o ajuste antigo no Omie. Tente reenviar.' }
    }
    await supabase
      .from('inventario_items')
      .update({ id_ajuste: null, id_movest: null, codigo_status: null, descricao_status: null, response: null })
      .eq('id', item.id)
  }

  // Campo vazio (null): so grava e fica pendente em 'Iniciado'; nao apaga o item.
  if (quan === null) {
    await supabase
      .from('inventario_items')
      .update({ quan: null, status: 'Iniciado', updated_at: new Date().toISOString() })
      .eq('id', item.id)
    revalidatePath('/inventario')
    return { status: 'Iniciado', descricao_status: null, valor: null, id_ajuste: null }
  }

  await supabase
    .from('inventario_items')
    .update({ quan, updated_at: new Date().toISOString() })
    .eq('id', item.id)

  const inventario: InventarioComItens = {
    id: item.inventario.id,
    codigo_local_estoque: item.inventario.codigo_local_estoque,
    tipo: item.inventario.tipo,
    origem: item.inventario.origem,
    motivo: item.inventario.motivo,
    data: item.inventario.data,
    items: [],
    loja: item.inventario.loja,
  }
  const itemRow: InventarioItemRow = {
    id: item.id,
    produto_codigo: item.produto_codigo,
    produto_codigo_produto: item.produto_codigo_produto,
    quan,
    status: 'Iniciado',
    id_ajuste: null,
    tentativas: item.tentativas,
  }

  const dataAjuste = dataOmieBR(item.inventario.data)
  await processarItemInventario(inventario, itemRow, lojaId, dataAjuste)

  const { data: final } = await supabase
    .from('inventario_items')
    .select('status, descricao_status, valor, id_ajuste')
    .eq('id', item.id)
    .single<{ status: string | null; descricao_status: string | null; valor: number | null; id_ajuste: number | null }>()

  revalidatePath('/inventario')
  return {
    status: final?.status ?? 'Erro',
    descricao_status: final?.descricao_status ?? null,
    valor: final?.valor ?? null,
    id_ajuste: final?.id_ajuste ?? null,
  }
}

export async function removeInventarioItem(itemId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()
  // Se o item ja foi lancado no Omie (id_ajuste), exclui o ajuste de estoque
  // antes de remover a linha — senao o estoque ficaria ajustado sem o item no
  // sistema. Vale para item de inventario finalizado tambem (editar pos-fato).
  const { data: item } = await supabase
    .from('inventario_items')
    .select('id, id_ajuste, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', itemId)
    .eq('loja_id', lojaId)
    .single<{ id: number; id_ajuste: number | null; loja: LojaOmie }>()
  if (item?.id_ajuste && item.loja) {
    // excluirAjusteEstoque nunca lança (sempre devolve boolean); precisa checar o
    // retorno, senão uma falha real de comunicação passa despercebida e o item é
    // apagado localmente com o ajuste ainda vivo no Omie.
    const ok = await excluirAjusteEstoque(item.loja, item.id_ajuste)
    if (!ok) return { error: 'Não foi possível remover o ajuste antigo no Omie. Tente de novo.' }
  }
  await supabase.from('inventario_items').delete().eq('id', itemId).eq('loja_id', lojaId)
  revalidatePath('/inventario')
  return { ok: true }
}

type InventarioItemRow = {
  id: number
  produto_codigo: string
  produto_codigo_produto: number
  quan: number | null
  status: string | null
  id_ajuste: number | null
  tentativas: number | null
}

type InventarioComItens = {
  id: number
  codigo_local_estoque: number
  tipo: string | null
  origem: string | null
  motivo: string | null
  data: string | null
  items: InventarioItemRow[]
  loja: LojaOmie
}

/**
 * Processa um unico item do inventario contra o Omie: busca o CMC e lanca o
 * Ajuste de Estoque (IncluirAjusteEstoque). Extraido para reuso entre
 * finishInventario e forceSyncInventario.
 */
async function processarItemInventario(
  inventario: InventarioComItens,
  item: InventarioItemRow,
  lojaId: number,
  dataAjuste: string // DD/MM/YYYY: data do inventario (vai no lancamento)
) {
  const supabase = createServiceClient()

  if (item.quan === null) {
    await supabase.from('inventario_items').delete().eq('id', item.id)
    return
  }

  // CMC na posicao ATUAL (hoje): custo medio vigente. Apenas a data do lancamento
  // (param.data) usa a data do inventario, que pode ser D-1/retroativa.
  const hojeCmc = dataOmieBR(null)

  try {
    const posicao = await getPosicaoProduto(
      inventario.loja,
      inventario.codigo_local_estoque,
      item.produto_codigo_produto,
      hojeCmc
    )
    const valor = posicao?.n_cmc ?? 0

    if (valor <= 0) {
      // Grava tentativas/ultima_tentativa_em tambem aqui (nao so no try/catch de
      // baixo) -- sem isso o throttle do retry automatico nunca reconhece uma
      // tentativa de 'Sem CMC' como "recente", e o cron reenviaria esse item a
      // cada 10 min pra sempre em vez de 1x/hora com teto (achado na Task 4).
      await supabase
        .from('inventario_items')
        .update({
          status: 'Sem CMC',
          tentativas: (item.tentativas ?? 0) + 1,
          ultima_tentativa_em: new Date().toISOString(),
        })
        .eq('id', item.id)
      return
    }

    await supabase
      .from('inventario_items')
      .update({ status: 'Processando', valor })
      .eq('id', item.id)

    // Params do IncluirAjusteEstoque: nomes exatos conforme sistema Laravel original
    const param = {
      codigo_local_estoque: inventario.codigo_local_estoque,
      id_prod: item.produto_codigo_produto,
      cod_int_ajuste: `ITEM${item.id}`,
      data: dataAjuste,
      quan: item.quan,
      valor,
      obs: await carimboUsuario(),
      origem: inventario.origem || 'AJU',
      tipo: inventario.tipo || 'SLD',
      motivo: inventario.motivo || 'INV',
    }

    const res = await omieRequest<{
      codigo_status?: string
      descricao_status?: string
      id_movest?: number
      id_ajuste?: number
    }>({
      loja_id: lojaId,
      omie_app_key: inventario.loja.omie_app_key,
      omie_app_secret: inventario.loja.omie_app_secret,
      endpoint: 'v1/estoque/ajuste',
      call: 'IncluirAjusteEstoque',
      data: param,
    })

    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'InventarioItem',
      request: JSON.stringify(param),
      response: JSON.stringify(res),
      code: res.codigo_status ?? '200',
    })

    // Sucesso confiável = id_ajuste presente. O Omie pode recusar com codigo_status≠0
    // sem faultstring (200); sem id_ajuste, não marcar 'Concluido' (vira furo de estoque).
    const sucesso = res.id_ajuste != null
    await supabase
      .from('inventario_items')
      .update({
        status: sucesso ? 'Concluido' : 'Erro',
        codigo_status: res.codigo_status ?? null,
        descricao_status: res.descricao_status ?? (sucesso ? null : 'Omie não retornou id do ajuste'),
        id_movest: res.id_movest ?? null,
        id_ajuste: res.id_ajuste ?? null,
        response: JSON.stringify(res),
        tentativas: sucesso ? 0 : (item.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', item.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase
      .from('inventario_items')
      .update({
        status: 'Erro',
        response: msg,
        tentativas: (item.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', item.id)
    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'InventarioItem',
      request: `item ${item.id}`,
      error: true,
      error_message: msg,
    })
  }
}

/**
 * Finaliza o inventario: para cada item, busca o CMC (custo medio) da posicao de
 * estoque no Omie e lanca um Ajuste de Estoque (IncluirAjusteEstoque). Processamento
 * sequencial, sem retry manual item a item (corrige o bug do sistema antigo).
 */
export async function finishInventario(inventarioId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()

  await supabase
    .from('inventarios')
    .update({ status: 'Processando no Omie' })
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)

  const { data: inventario } = await supabase
    .from('inventarios')
    .select(
      'id, codigo_local_estoque, tipo, origem, motivo, data, items:inventario_items(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<InventarioComItens>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  // Data do ajuste = data do inventario (permite D-1/retroativa), nao a de hoje.
  const dataAjuste = dataOmieBR(inventario.data)

  // Os itens ja integram item-a-item ao sair do campo de quantidade; aqui so
  // processamos os pendentes (sem id_ajuste e ainda nao Concluido). Reprocessar um
  // item ja Concluido (que tem ajuste) duplicaria o lancamento no Omie.
  const pendentes = inventario.items.filter(
    (i) => i.status !== 'Concluido' && i.id_ajuste === null && i.quan !== null
  )
  for (const item of pendentes) {
    await processarItemInventario(inventario, item, lojaId, dataAjuste)
  }

  await supabase
    .from('inventarios')
    .update({ status: 'Finalizado', finalizado: new Date().toISOString() })
    .eq('id', inventarioId)

  revalidatePath('/inventario')
  return { ok: true }
}

/**
 * Reprocessa SOMENTE os itens com falha (status 'Erro' ou null) de um inventario
 * ja finalizado, sem mexer nos itens 'Concluido'. Espelha o forceSync do Laravel.
 */
export async function forceSyncInventario(inventarioId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select(
      'id, codigo_local_estoque, tipo, origem, motivo, data, items:inventario_items(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<InventarioComItens>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  await supabase
    .from('inventarios')
    .update({ status: 'Processando no Omie' })
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)

  // Data do ajuste = data do inventario (permite D-1/retroativa), nao a de hoje.
  const dataAjuste = dataOmieBR(inventario.data)

  // Reprocessa tudo que nao integrou (Erro/Sem CMC/Processando travado/Iniciado com
  // quantidade), sem tocar nos 'Concluido' (tem ajuste, relancar duplicaria).
  const pendentes = inventario.items.filter(
    (i) => i.status !== 'Concluido' && i.id_ajuste === null && i.quan !== null
  )

  for (const item of pendentes) {
    await processarItemInventario(inventario, item, lojaId, dataAjuste)
  }

  await supabase
    .from('inventarios')
    .update({ status: 'Finalizado', finalizado: new Date().toISOString() })
    .eq('id', inventarioId)

  revalidatePath('/inventario')
  return { ok: true }
}

const SEM_CMC_MAX_TENTATIVAS = 20
const SEM_CMC_STALE_HORAS = 1

type InventarioItemRetryRow = {
  id: number
  inventario_id: number
  loja_id: number
  status: string | null
  tentativas: number | null
  id_ajuste: number | null
  quan: number | null
}

type InventarioHeader = Omit<InventarioComItens, 'items'>

/**
 * Varre itens de inventario pendentes de lancamento no Omie (status 'Erro' ou
 * 'Sem CMC') das lojas informadas e tenta reenviar, reusando `processarItemInventario`
 * -- serve o cron de 10 em 10 min. Sem sessao de usuario (contexto de cron), por
 * isso `lojaId` vem explicito em vez de `getCurrentLojaId()`/`requirePermissao()`.
 * Mesma filosofia de `retryOPsPendentes` (`lib/actions/ordem-producao.ts`): 'Erro'
 * reenvia sempre, sem teto (falha transitoria se resolve sozinha reenviando);
 * 'Sem CMC' tem teto de tentativas + throttle de 1h (nao vai se resolver sem acao
 * humana no cadastro do Omie, entao nao adianta bater todo cron).
 *
 * Como `processarItemInventario` exige o objeto `inventario` completo (com `loja`
 * embutida), agrupamos os itens elegiveis por `inventario_id` e buscamos o
 * cabecalho de cada inventario 1x (sem os itens do pai -- mesmo padrao de
 * `enviarInventarioItem`), processando so os itens que bateram no filtro de retry
 * acima -- nao todos os "pendentes" do inventario. Processamento sequencial (sem
 * paralelizar), mesmo espirito comedido do resto deste arquivo agora que existe
 * retry automatico.
 */
export async function retryAjustesInventarioPendentes(
  lojas: LojaOmie[],
  opts: { limitePorLoja?: number } = {}
): Promise<{ loja_id: number; tentadas: number; sucesso: number; falhas: number; erro?: string }[]> {
  const limitePorLoja = opts.limitePorLoja ?? 30
  const supabase = createServiceClient()
  const resultados: { loja_id: number; tentadas: number; sucesso: number; falhas: number; erro?: string }[] = []

  for (const loja of lojas) {
    const { data: errosGenericos, error: erroErros } = await supabase
      .from('inventario_items')
      .select('id, inventario_id, loja_id, status, tentativas, id_ajuste, quan')
      .eq('loja_id', loja.id)
      .eq('status', 'Erro')
      .order('ultima_tentativa_em', { ascending: true, nullsFirst: true })
      .limit(limitePorLoja)

    const staleCutoff = new Date(Date.now() - SEM_CMC_STALE_HORAS * 3600_000).toISOString()
    const { data: semCmc, error: erroSemCmc } = await supabase
      .from('inventario_items')
      .select('id, inventario_id, loja_id, status, tentativas, id_ajuste, quan')
      .eq('loja_id', loja.id)
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
    // finishInventario/forceSyncInventario): nunca reprocessar item que ja tem
    // id_ajuste (duplicaria o lancamento no Omie) ou que ficou sem quan (seria
    // DELETADO por processarItemInventario em vez de processado).
    const pendentes = [...(errosGenericos ?? []), ...(semCmc ?? [])]
      .filter((i) => i.id_ajuste === null && i.quan !== null)
      .slice(0, limitePorLoja) as InventarioItemRetryRow[]

    if (pendentes.length === 0) {
      resultados.push({ loja_id: loja.id, tentadas: 0, sucesso: 0, falhas: 0 })
      continue
    }

    // Marca 'Processando' JA, antes de chamar o Omie: torna esses itens invisiveis
    // pro filtro status='Erro'/'Sem CMC' de uma proxima execucao do cron que comece
    // antes desta terminar (ex.: essa demorar mais que os 10 min do intervalo) --
    // sem isso, duas execucoes concorrentes reenviariam os MESMOS itens (double-send
    // no Omie).
    const idsSelecionados = pendentes.map((i) => i.id)
    await supabase.from('inventario_items').update({ status: 'Processando' }).in('id', idsSelecionados)

    let sucesso = 0
    let falhas = 0

    // Agrupa por inventario_id: 1 fetch do CABECALHO do inventario (sem
    // `items:inventario_items(*)` -- isso incluiria a coluna `response` de TODOS
    // os itens do inventario, ate 1626 num caso real, payload multi-MB a cada 10
    // min pra um Postgres de 500MB) + 1 fetch so das linhas elegiveis desse grupo.
    const porInventario = new Map<number, number[]>()
    for (const item of pendentes) {
      const lista = porInventario.get(item.inventario_id)
      if (lista) lista.push(item.id)
      else porInventario.set(item.inventario_id, [item.id])
    }

    for (const [inventarioId, itemIds] of porInventario) {
      const { data: inventarioHeader, error: erroHeader } = await supabase
        .from('inventarios')
        .select(
          'id, codigo_local_estoque, tipo, origem, motivo, data, loja:lojas(id, omie_app_key, omie_app_secret)'
        )
        .eq('id', inventarioId)
        .eq('loja_id', loja.id)
        .single<InventarioHeader>()

      // Qualquer saida antecipada daqui pra baixo precisa DEVOLVER o status de
      // 'Processando' pra 'Erro' nos itens que nao vao ser processados -- senao
      // eles ficam presos em 'Processando' pra sempre, invisiveis ao filtro
      // status='Erro'/'Sem CMC' do proximo ciclo do cron (achado da re-revisao,
      // Fix round 2: o marcar-como-'Processando' do round 1 precisa de um
      // "estorno" simetrico em todo caminho que nao termina em
      // processarItemInventario).
      if (erroHeader || !inventarioHeader?.loja) {
        await supabase.from('inventario_items').update({ status: 'Erro' }).in('id', itemIds)
        falhas += itemIds.length
        continue
      }

      const { data: itensElegiveis, error: erroItens } = await supabase
        .from('inventario_items')
        .select('id, produto_codigo, produto_codigo_produto, quan, status, id_ajuste, tentativas')
        .in('id', itemIds)

      if (erroItens) {
        await supabase.from('inventario_items').update({ status: 'Erro' }).in('id', itemIds)
        falhas += itemIds.length
        continue
      }

      const dataAjuste = dataOmieBR(inventarioHeader.data)
      const inventario: InventarioComItens = { ...inventarioHeader, items: [] }

      // Se algum id elegivel nao vier no resultado (linha some entre selecao e
      // fetch), conta como falha E estorna o status desses ids especificos de
      // volta pra 'Erro' (nao precisa reconstruir o status original exato tipo
      // 'Sem CMC' -- 'Erro' ja garante que o proximo ciclo do cron tenta de novo).
      const idsEncontrados = new Set((itensElegiveis ?? []).map((i) => i.id))
      const idsNaoEncontrados = itemIds.filter((id) => !idsEncontrados.has(id))
      if (idsNaoEncontrados.length > 0) {
        await supabase.from('inventario_items').update({ status: 'Erro' }).in('id', idsNaoEncontrados)
        falhas += idsNaoEncontrados.length
      }

      for (const item of (itensElegiveis ?? []) as InventarioItemRow[]) {
        await processarItemInventario(inventario, item, loja.id, dataAjuste)
        const { data: final } = await supabase
          .from('inventario_items')
          .select('status')
          .eq('id', item.id)
          .single<{ status: string | null }>()
        if (final?.status === 'Concluido') sucesso++
        else falhas++
      }
    }

    resultados.push({ loja_id: loja.id, tentadas: pendentes.length, sucesso, falhas })
  }

  return resultados
}

/**
 * Duplica um inventario: cria um novo (mesmo local, status 'Em contagem') e copia
 * os itens com quan zerada e status 'Iniciado'. Retorna o id do novo inventario.
 * dataEscolhida (opcional, 'YYYY-MM-DD'): data do novo inventario; sem ela cai em
 * hoje. Mesma regra do createInventario: nao aceita data futura.
 */
export async function duplicarInventario(inventarioId: number, dataEscolhida?: string) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Criar'))) {
    return { error: 'Sem permissao para criar inventario' }
  }
  const hojeBahia = hojeBahiaISO()
  if (dataEscolhida && dataEscolhida > hojeBahia) {
    return { error: 'A data não pode ser futura' }
  }
  const supabase = createServiceClient()

  const { data: original } = await supabase
    .from('inventarios')
    .select('id, codigo_local_estoque')
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<{ id: number; codigo_local_estoque: number }>()

  if (!original) return { error: 'Inventário não encontrado' }

  // A duplicata e uma NOVA contagem: responsavel = quem duplicou, data = a escolhida
  // (ou hoje, se nao informada). Antes ficava sem responsavel (user_id nulo) e sempre
  // com a data de hoje. Mesmo local e itens.
  const userId = (await getUser()).id
  const dataNova = dataCriacaoBahia(dataEscolhida) ?? dataCriacaoBahia(hojeBahia)!
  const { data: novo } = await supabase
    .from('inventarios')
    .insert({
      loja_id: lojaId,
      codigo_local_estoque: original.codigo_local_estoque,
      status: 'Em contagem',
      user_id: userId,
      data: dataNova,
    })
    .select('id')
    .single<{ id: number }>()

  if (!novo) return { error: 'Falha ao criar inventário' }

  const { data: itens } = await supabase
    .from('inventario_items')
    .select('produto_codigo_produto, produto_codigo, produto_descricao, produto_familia')
    .eq('inventario_id', inventarioId)

  if (itens?.length) {
    await supabase.from('inventario_items').insert(
      itens.map((i) => ({
        loja_id: lojaId,
        inventario_id: novo.id,
        produto_codigo_produto: i.produto_codigo_produto,
        produto_codigo: i.produto_codigo,
        produto_descricao: i.produto_descricao,
        produto_familia: i.produto_familia,
        quan: null,
        status: 'Iniciado',
      }))
    )
  }

  revalidatePath('/inventario')
  return { id: novo.id }
}

/**
 * Exclui um inventario: para cada item ja lancado no Omie (id_ajuste), exclui o
 * ajuste de estoque; depois deleta o inventario (cascade remove os itens).
 */
export async function excluirInventario(inventarioId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Excluir'))) {
    return { error: 'Sem permissão para excluir' }
  }
  const supabase = createServiceClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select('id, items:inventario_items(id, id_ajuste), loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      items: Array<{ id: number; id_ajuste: number | null }>
      loja: LojaOmie
    }>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  for (const item of inventario.items) {
    if (item.id_ajuste) {
      // excluirAjusteEstoque nunca lança, sempre devolve boolean: se ignorado, uma
      // falha real de comunicação passa despercebida e o inventário é apagado
      // localmente com ajustes ainda vivos (órfãos) no Omie.
      const ok = await excluirAjusteEstoque(inventario.loja, item.id_ajuste)
      if (!ok) {
        return { error: `Não foi possível remover o ajuste do item ${item.id} no Omie. Tente excluir de novo.` }
      }
    }
  }

  await supabase.from('inventarios').delete().eq('id', inventarioId).eq('loja_id', lojaId)

  await registrarAuditoria('excluir', 'inventário', inventarioId, null)
  revalidatePath('/inventario')
  return { ok: true }
}

/**
 * Edita a quantidade de um item. Se o item ja foi lancado no Omie (tem id_ajuste),
 * exclui o ajuste primeiro, limpa os campos de integracao e volta o status para
 * 'Iniciado' antes de gravar a nova quantidade. Espelha editQuantidade do Laravel.
 */
export async function editQuantidadeInventarioItem(itemId: number, quan: number | null) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()

  const { data: item } = await supabase
    .from('inventario_items')
    .select('id, id_ajuste, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', itemId)
    .eq('loja_id', lojaId)
    .single<{ id: number; id_ajuste: number | null; loja: LojaOmie }>()

  if (!item) return { error: 'Item não encontrado' }

  if (item.id_ajuste && item.loja) {
    const ok = await excluirAjusteEstoque(item.loja, item.id_ajuste)
    if (!ok) return { error: 'Não foi possível remover o ajuste antigo no Omie. Tente de novo.' }
    await supabase
      .from('inventario_items')
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
      .eq('id', itemId)
      .eq('loja_id', lojaId)
  } else {
    await supabase
      .from('inventario_items')
      .update({ quan, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('loja_id', lojaId)
  }

  revalidatePath('/inventario')
  return { ok: true }
}
