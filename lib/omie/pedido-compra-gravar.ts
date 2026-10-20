import { omieRequest, logIntegrationAttempt, OmieError, type LojaOmie } from './client'
import { msRestantesBloqueio } from './erros-omie'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { createServiceClient } from '@/lib/supabase/server'
import {
  decidirFalhaPedido, ehPedidoJaExiste, ehPedidoNaoEncontrado, ENVIANDO_TRAVADO_MS, filtroFilaCron, gravacaoPedidosOmieLigada,
  incertoAposFalhaDaInclusao, JANELA_BLOQUEIO_PERSISTIDO_MS, montarIncluirPedCompra, motivoSemGravacaoPedidoOmie, msBloqueioPersistido,
  payloadParaGuardar, payloadsDivergem, pedidoIncluido, PREFIXO_LOG_BLOQUEIO,
  type IncluirPedCompra, type ItemPedidoOmie, type PedidoParaOmie, type RespostaIncluirPed,
} from '@/lib/compras/pedido-omie-gravar-puro'
import type { Parcela } from '@/lib/compras/pedido-puro'

// C1 (20/10/2026): grava no Omie (IncluirPedCompra) o pedido de compra aprovado no NTB numa loja de estoque Omie.
// DESLIGADO: só age com OMIE_GRAVAR_PEDIDOS_COMPRA=1, NTB_AMBIENTE=producao e lojas.omie_gravar_pedidos_compra = true
// (migration 270); loja 4 nunca.
// Idempotência: cCodIntPed = NTB-PC-<id do pedido>. Antes de chamar o IncluirPedCompra o estado vira `incerto` (com o
// payload guardado); só uma resposta de negócio do Omie (ou sucesso) tira o `incerto`. Tentativa com `incerto` (ou que
// retoma um 'enviando' esquecido) CONSULTA o Omie pelo código antes de incluir; "já existe" na inclusão também consulta e
// adota o nCodPed. Pedido adotado não troca o payload guardado e marca `divergente` se o pedido atual for diferente.
// Corrida com reabrir/cancelar: a reivindicação é a função pc_omie_reivindicar (trava a linha do pedido e confere etapa).
// Limite do Omie (10 erros no mesmo método = 30 min de bloqueio da chave): uma tentativa por pedido por vez, espera
// crescente, teto, bloqueio (em memória E o gravado em integration_attempts, que sobrevive a restart) não conta tentativa,
// e o cron para a loja no 1º erro do ciclo. Loja de teste: inclusão simulada pelo omieRequest, consulta pulada.

const ENDPOINT = 'v1/produtos/pedidocompra'
const INCLUIR = 'IncluirPedCompra'
const CONSULTAR = 'ConsultarPedCompra'

type LojaGravar = LojaOmie & {
  modo_estoque: string | null
  omie_gravar_pedidos_compra: boolean | null
  omie_pedido_categoria: string | null
  omie_pedido_email_aprovador: string | null
}

type Reivindicacao = { ok: true; status_antes: string; tentativas: number; cod_int: string; incerto: boolean; payload_antes: unknown }
type Fila = { pedidoId: number; codInt: string; tentativas: number; incerto: boolean; payloadAntes: unknown; reaberta: boolean; modo: 'enviar' | 'conferir' }

export type ResultadoEnvioPedido =
  | { status: 'desligado' | 'bloqueado'; motivo: string }
  | { status: 'ocupado'; motivo: string }
  | { status: 'enviado'; nCodPed: number; numero: string | null; jaExistia: boolean; divergente: boolean }
  | { status: 'pendente' | 'precisa_corrigir'; erro: string; proximaTentativaEm: string | null; contaTentativa: boolean }

const db = () => createServiceClient({ semAutor: true })

async function carregarLoja(lojaId: number): Promise<LojaGravar | null> {
  const { data } = await db().from('lojas')
    .select('id, modo_estoque, is_test, omie_app_key, omie_app_secret, omie_gravar_pedidos_compra, omie_pedido_categoria, omie_pedido_email_aprovador')
    .eq('id', lojaId).maybeSingle<LojaGravar>()
  return data ?? null
}

/**
 * Bloqueio do Omie registrado nos últimos 35 min em qualquer loja com a mesma chave (o disjuntor em memória some num
 * restart). Falha na consulta = trata como bloqueado (melhor esperar um ciclo que bater no Omie bloqueado).
 */
async function msBloqueioGravado(appKey: string): Promise<number> {
  const sb = db()
  const { data: ls, error } = await sb.from('lojas').select('id').eq('omie_app_key', appKey)
  if (error || !ls?.length) return error ? JANELA_BLOQUEIO_PERSISTIDO_MS : 0
  const { data, error: e2 } = await sb.from('integration_attempts').select('created_at')
    .in('loja_id', ls.map((l) => Number(l.id))).like('model', `${PREFIXO_LOG_BLOQUEIO}%`)
    .gte('created_at', new Date(Date.now() - JANELA_BLOQUEIO_PERSISTIDO_MS).toISOString())
    .order('created_at', { ascending: false }).limit(1)
  if (e2) { console.error('pedido-compra-omie: bloqueio gravado ilegível', e2.message); return JANELA_BLOQUEIO_PERSISTIDO_MS }
  return msBloqueioPersistido(data?.[0]?.created_at as string | undefined)
}

/** pc_omie_reivindicar (270): trava o pedido, confere etapa e horário e põe 'enviando'. null = nada a fazer agora. */
async function reivindicar(lojaId: number, pedidoId: number, modo: 'enviar' | 'conferir'): Promise<{ fila: Fila | null; motivo: string }> {
  const { data, error } = await db().rpc('pc_omie_reivindicar', { p_loja: lojaId, p_pedido: pedidoId, p_modo: modo, p_travado_seg: Math.round(ENVIANDO_TRAVADO_MS / 1000) })
  if (error) throw new Error(`fila do pedido ${pedidoId}: ${error.message}`)
  const r = data as Reivindicacao | { ok: false; motivo: string; proxima_tentativa_em?: string | null }
  if (!r.ok) {
    const quando = 'proxima_tentativa_em' in r && r.proxima_tentativa_em ? ` (próxima tentativa ${new Date(r.proxima_tentativa_em).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })})` : ''
    return { fila: null, motivo: `Nada a enviar agora: ${r.motivo}${quando}.` }
  }
  return {
    fila: { pedidoId, codInt: r.cod_int, tentativas: Number(r.tentativas) || 0, incerto: r.incerto === true, payloadAntes: r.payload_antes ?? null,
      reaberta: r.status_antes === 'enviando', modo },
    motivo: '',
  }
}

/** Pedido + itens + cadastros do espelho, no formato da montagem pura. */
async function carregarPedido(lojaId: number, pedidoId: number): Promise<{ pedido: PedidoParaOmie; locais: number[] } | null> {
  const sb = db()
  const { data: c } = await sb.from('pedidos_compra')
    .select('id, numero, etapa, fornecedor_id, fornecedor_nome, fornecedor_cnpj, previsao_entrega, frete, outras_despesas, parcelas, numero_fornecedor, contato, obs, obs_interna')
    .eq('loja_id', lojaId).eq('id', pedidoId).maybeSingle()
  if (!c) return null
  const [{ data: its, error: eIt }, { data: locs, error: eLoc }] = await Promise.all([
    sb.from('pedidos_compra_itens').select('linha, codigo_produto, descricao, unidade, fator, quantidade, preco_unitario, codigo_local_estoque, obs').eq('pedido_id', pedidoId).eq('loja_id', lojaId).order('linha'),
    sb.from('local_estoques').select('codigo_local_estoque, inativo').eq('loja_id', lojaId).is('deleted_at', null),
  ])
  if (eIt || eLoc) throw new Error(`pedido ${pedidoId}: ${(eIt ?? eLoc)!.message}`)
  const codigos = [...new Set((its ?? []).map((i) => Number(i.codigo_produto)))]
  const prods = new Map<number, boolean>()
  for (let i = 0; i < codigos.length; i += 200) {
    const { data, error } = await sb.from('produtos').select('codigo_produto, inativo').eq('loja_id', lojaId).in('codigo_produto', codigos.slice(i, i + 200))
    if (error) throw new Error(`produtos do pedido ${pedidoId}: ${error.message}`)
    for (const p of data ?? []) prods.set(Number(p.codigo_produto), p.inativo === true)
  }
  let fornecedor: PedidoParaOmie['fornecedor'] = { id: null, nome: c.fornecedor_nome, cnpj: c.fornecedor_cnpj, codigoOmie: null, origem: null }
  if (c.fornecedor_id) {
    const { data: f } = await sb.from('fornecedores').select('id, codigo_omie, origem, cnpj_cpf').eq('loja_id', lojaId).eq('id', c.fornecedor_id).maybeSingle()
    if (f) fornecedor = { id: Number(f.id), nome: c.fornecedor_nome, cnpj: c.fornecedor_cnpj ?? f.cnpj_cpf, codigoOmie: f.codigo_omie == null ? null : Number(f.codigo_omie), origem: f.origem ?? null }
  }
  const itens: ItemPedidoOmie[] = (its ?? []).map((i) => ({
    linha: Number(i.linha), codigoProduto: Number(i.codigo_produto), descricao: i.descricao, unidade: i.unidade, fator: Number(i.fator) || 1,
    quantidade: Number(i.quantidade), precoUnitario: Number(i.preco_unitario), codigoLocal: i.codigo_local_estoque == null ? null : Number(i.codigo_local_estoque),
    obs: i.obs, produto: prods.has(Number(i.codigo_produto)) ? { existe: true, inativo: prods.get(Number(i.codigo_produto))! } : { existe: false, inativo: false },
  }))
  return {
    pedido: {
      id: Number(c.id), numero: Number(c.numero), etapa: c.etapa, previsaoEntrega: c.previsao_entrega, frete: Number(c.frete) || 0,
      outrasDespesas: Number(c.outras_despesas) || 0, parcelas: (Array.isArray(c.parcelas) ? c.parcelas : []) as Parcela[],
      numeroFornecedor: c.numero_fornecedor, contato: c.contato, obs: c.obs, obsInterna: c.obs_interna, fornecedor, itens,
    },
    locais: (locs ?? []).filter((l) => l.inativo !== 'S').map((l) => Number(l.codigo_local_estoque)),
  }
}

/** Grava o estado da fila. Lança se não gravou: o passo seguinte (chamar o Omie) depende disso estar no banco. */
async function gravarFila(pedidoId: number, campos: Record<string, unknown>) {
  const { error } = await db().from('pedidos_compra_omie').update({ ...campos, updated_at: new Date().toISOString() }).eq('pedido_id', pedidoId)
  if (error) throw new Error(`não gravou o estado do pedido ${pedidoId} na fila do Omie: ${error.message}`)
}

/** Evento no histórico do pedido (etapa não muda: de/para = a etapa atual). */
async function evento(lojaId: number, pedidoId: number, etapa: string | null, tipo: string, detalhe: Record<string, unknown>) {
  const { error } = await db().from('pedidos_compra_eventos').insert({ loja_id: lojaId, pedido_id: pedidoId, tipo, de_etapa: etapa, para_etapa: etapa, detalhe })
  if (error) console.error(`pedido-compra-omie: evento ${tipo} do pedido ${pedidoId}: ${error.message}`)
}

async function log(lojaId: number, call: string, request: unknown, r: { response?: unknown; erro?: string }) {
  try {
    await logIntegrationAttempt({
      loja_id: lojaId, model: call, request: JSON.stringify(request).slice(0, 20000),
      response: r.response === undefined ? undefined : JSON.stringify(r.response).slice(0, 5000),
      error: !!r.erro, error_message: r.erro?.slice(0, 1000),
    })
  } catch { /* log é só diagnóstico */ }
}

/** ConsultarPedCompra pelo código de integração: nCodPed se o pedido já está no Omie, null se não está. Lança em outro erro. */
async function consultarPorCodigo(loja: LojaGravar, codInt: string): Promise<{ nCodPed: number; numero: string | null } | null> {
  const data = { nCodPed: 0, cCodIntPed: codInt, cNumero: '' }
  try {
    const r = await omieRequest<{ cabecalho_consulta?: { nCodPed?: number; cNumero?: string } }>({
      loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
      endpoint: ENDPOINT, call: CONSULTAR, data, semRepetir: true,
    })
    await log(loja.id, CONSULTAR, data, { response: r?.cabecalho_consulta ?? r })
    return pedidoIncluido({ nCodPed: r?.cabecalho_consulta?.nCodPed, cNumero: r?.cabecalho_consulta?.cNumero })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log(loja.id, CONSULTAR, data, { erro: msg })
    if (ehPedidoNaoEncontrado(msg)) return null
    throw e
  }
}

/** Gravado (incluído agora) ou adotado (já estava no Omie, de uma tentativa anterior). */
async function sucesso(lojaId: number, fila: Fila, etapa: string | null, r: { nCodPed: number; numero: string | null },
  adotado: { payloadAtual: IncluirPedCompra | null } | null): Promise<ResultadoEnvioPedido> {
  const divergente = adotado ? (adotado.payloadAtual ? payloadsDivergem(fila.payloadAntes, adotado.payloadAtual) : true) : false
  // Adotado: o payload guardado continua o da tentativa que criou o pedido (é o que o Omie tem).
  await gravarFila(fila.pedidoId, {
    status: 'enviado', n_cod_ped: r.nCodPed, numero_omie: r.numero, enviado_em: new Date().toISOString(), ultimo_erro: null,
    proxima_tentativa_em: null, incerto: false, divergente,
  })
  await evento(lojaId, fila.pedidoId, etapa, 'omie_enviado', { n_cod_ped: r.nCodPed, numero_omie: r.numero, ja_existia: !!adotado, divergente })
  return { status: 'enviado', nCodPed: r.nCodPed, numero: r.numero, jaExistia: !!adotado, divergente }
}

async function falha(lojaId: number, fila: Fila, etapa: string | null, e: unknown, incerto: boolean): Promise<ResultadoEnvioPedido> {
  const msg = e instanceof Error ? e.message : String(e)
  if (fila.modo === 'conferir') {
    // Só consultou: volta para precisa_corrigir (continua incerto); não mexe nas tentativas de inclusão.
    await gravarFila(fila.pedidoId, { status: 'precisa_corrigir', ultimo_erro: `Conferência no Omie falhou: ${msg}`.slice(0, 500) })
    return { status: 'precisa_corrigir', erro: msg.slice(0, 500), proximaTentativaEm: null, contaTentativa: false }
  }
  const d = decidirFalhaPedido(msg, e instanceof OmieError ? e.faultCode : undefined, fila.tentativas)
  await gravarFila(fila.pedidoId, { status: d.status, tentativas: d.tentativas, proxima_tentativa_em: d.proximaTentativaEm, ultimo_erro: d.erro, incerto })
  if (d.status === 'precisa_corrigir') await evento(lojaId, fila.pedidoId, etapa, 'omie_erro', { erro: d.erro, tentativas: d.tentativas, incerto })
  return { status: d.status, erro: d.erro, proximaTentativaEm: d.proximaTentativaEm, contaTentativa: d.contaTentativa }
}

/**
 * Uma tentativa de gravar (modo 'enviar') ou de só conferir no Omie (modo 'conferir', pedido incerto que saiu da fila).
 * Nunca lança: devolve o resultado (o estado fica em pedidos_compra_omie). Não pula a espera da próxima tentativa.
 */
export async function enviarPedidoCompraOmie(lojaId: number, pedidoId: number, o: { modo?: 'enviar' | 'conferir' } = {}): Promise<ResultadoEnvioPedido> {
  if (!gravacaoPedidosOmieLigada(process.env)) return { status: 'desligado', motivo: 'Gravação de pedidos de compra no Omie desligada.' }
  let fila: Fila | null = null
  let etapa: string | null = null
  try {
    const loja = await carregarLoja(lojaId)
    if (!loja) return { status: 'bloqueado', motivo: 'Loja inexistente.' }
    const motivo = motivoSemGravacaoPedidoOmie(process.env, { id: loja.id, modo: loja.modo_estoque, optIn: loja.omie_gravar_pedidos_compra === true })
    if (motivo) return { status: 'bloqueado', motivo }
    if (!loja.omie_app_key || !loja.omie_app_secret) return { status: 'bloqueado', motivo: 'Loja sem chave do Omie.' }
    // Bloqueio do Omie (disjuntor em memória e o gravado no banco): nem reivindica, não gasta tentativa, não chama o Omie.
    if (!loja.is_test) {
      const bloq = Math.max(msRestantesBloqueio(loja.omie_app_key, Date.now(), INCLUIR), msRestantesBloqueio(loja.omie_app_key, Date.now(), CONSULTAR),
        await msBloqueioGravado(loja.omie_app_key))
      if (bloq > 0) return { status: 'pendente', erro: `API do Omie bloqueada para esta loja (libera em ~${Math.ceil(bloq / 60000)} min).`, proximaTentativaEm: new Date(Date.now() + bloq).toISOString(), contaTentativa: false }
    }

    const r = await reivindicar(lojaId, pedidoId, o.modo ?? 'enviar')
    if (!r.fila) return { status: 'ocupado', motivo: r.motivo }
    fila = r.fila

    const dados = await carregarPedido(lojaId, pedidoId)
    etapa = dados?.pedido.etapa ?? null
    const montado = dados
      ? montarIncluirPedCompra(dados.pedido, { categoria: loja.omie_pedido_categoria, emailAprovador: loja.omie_pedido_email_aprovador, locais: dados.locais })
      : { erros: ['Pedido inexistente.'] }
    const payloadAtual = 'payload' in montado ? montado.payload : null

    // Pode já estar no Omie (inclusão anterior sem resposta, ou tentativa que morreu no meio): consulta antes de tudo.
    if (!loja.is_test && (fila.incerto || fila.reaberta || fila.modo === 'conferir')) {
      const existente = await consultarPorCodigo(loja, fila.codInt)
      if (existente) return await sucesso(lojaId, fila, etapa, existente, { payloadAtual })
      await gravarFila(pedidoId, { incerto: false })
      fila = { ...fila, incerto: false }
      if (fila.modo === 'conferir') {
        await gravarFila(pedidoId, { status: 'precisa_corrigir', ultimo_erro: 'Conferido: o pedido não está no Omie. Corrija e aprove de novo para reenviar.' })
        return { status: 'precisa_corrigir', erro: 'Conferido: o pedido não está no Omie.', proximaTentativaEm: null, contaTentativa: false }
      }
    }
    if (fila.modo === 'conferir') { // loja de teste: nada foi ao Omie de verdade
      await gravarFila(pedidoId, { status: 'precisa_corrigir', incerto: false })
      return { status: 'precisa_corrigir', erro: 'Loja de teste: nada foi ao Omie.', proximaTentativaEm: null, contaTentativa: false }
    }

    if ('erros' in montado) {
      // Falta dado no NTB: nada vai ao Omie; sai da fila até alguém corrigir e aprovar de novo.
      const erro = montado.erros.join(' ').slice(0, 1000)
      await gravarFila(pedidoId, { status: 'precisa_corrigir', ultimo_erro: erro, proxima_tentativa_em: null })
      await evento(lojaId, pedidoId, etapa, 'omie_erro', { erro, antes_do_omie: true })
      return { status: 'precisa_corrigir', erro, proximaTentativaEm: null, contaTentativa: false }
    }

    // Antes da inclusão: incerto + payload no banco. Se o processo morrer no meio, a retomada consulta antes de incluir.
    const guardado = payloadParaGuardar(montado.payload)
    await gravarFila(pedidoId, { incerto: true, payload: guardado })
    fila = { ...fila, incerto: true, payloadAntes: guardado }
    try {
      const resp = await omieRequest<RespostaIncluirPed>({
        loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
        endpoint: ENDPOINT, call: INCLUIR, data: montado.payload as unknown as Record<string, unknown>, semRepetir: true,
      })
      await log(loja.id, INCLUIR, guardado, { response: resp })
      const ok = pedidoIncluido(resp)
      if (!ok) {
        // 200 sem nCodPed: não dá para saber se gravou → continua incerto (a próxima tentativa consulta).
        return await falha(lojaId, fila, etapa, new Error(`Resposta do Omie sem nCodPed: ${JSON.stringify(resp).slice(0, 300)}`), true)
      }
      return await sucesso(lojaId, fila, etapa, ok, null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await log(loja.id, INCLUIR, guardado, { erro: msg })
      if (!loja.is_test && ehPedidoJaExiste(msg)) {
        const existente = await consultarPorCodigo(loja, fila.codInt)
        if (existente) return await sucesso(lojaId, fila, etapa, existente, { payloadAtual })
      }
      const faultCode = e instanceof OmieError ? e.faultCode : undefined
      return await falha(lojaId, fila, etapa, e, incertoAposFalhaDaInclusao(msg, faultCode, e instanceof OmieError))
    }
  } catch (e) {
    if (!fila) {
      console.error(`pedido-compra-omie: pedido ${pedidoId} (loja ${lojaId}):`, e instanceof Error ? e.message : e)
      return { status: 'pendente', erro: 'Não foi possível preparar o envio agora.', proximaTentativaEm: null, contaTentativa: false }
    }
    try {
      // Erro fora da inclusão (banco, consulta): não mexe no `incerto` já gravado.
      return await falha(lojaId, fila, etapa, e, fila.incerto)
    } catch (e2) {
      console.error(`pedido-compra-omie: pedido ${pedidoId}: estado não gravado (fica 'enviando'; a retomada em 1 h consulta antes):`, e2 instanceof Error ? e2.message : e2)
      return { status: 'pendente', erro: 'Falha ao gravar o estado do envio.', proximaTentativaEm: null, contaTentativa: false }
    }
  }
}

/** Põe o pedido aprovado na fila (pc_omie_enfileirar, migration 270). Sem a migration/opt-in: devolve o erro, não lança. */
export async function enfileirarPedidoCompraOmie(lojaId: number, pedidoId: number): Promise<{ ok: true; status: string } | { error: string }> {
  const { data, error } = await db().rpc('pc_omie_enfileirar', { p_loja: lojaId, p_pedido: pedidoId })
  if (error) return { error: error.code === '22023' && error.message ? error.message : 'Não foi possível pôr o pedido na fila do Omie.' }
  return { ok: true, status: (data as { status: string }).status }
}

export type ResumoCicloLoja = { loja: number; tentados: number; enviados: number; erros: number; parouNoErro: boolean; erro?: string }

/**
 * Cron: até `limite` pedidos por loja liberada, um por vez; a loja para no 1º resultado que não seja "enviado"
 * (no máximo 1 erro por método por ciclo de 10 min, longe dos 10 que bloqueiam a chave). 'ocupado' não conta.
 */
export async function processarFilaPedidosCompraOmie(limite = 5): Promise<ResumoCicloLoja[]> {
  if (!gravacaoPedidosOmieLigada(process.env)) return []
  const sb = db()
  const { data: lojas, error } = await sb.from('lojas').select('id').eq('modo_estoque', 'omie').eq('omie_gravar_pedidos_compra', true).eq('ativo', true)
  if (error) throw new Error(`lojas liberadas: ${error.message}`)
  const out: ResumoCicloLoja[] = []
  for (const { id: lojaId } of lojas ?? []) {
    const res: ResumoCicloLoja = { loja: lojaId, tentados: 0, enviados: 0, erros: 0, parouNoErro: false }
    out.push(res)
    if (!(await pegarTravaSync(lojaId, 'pedidos-compra-envio', 300))) continue
    try {
      const { data: fila, error: e2 } = await sb.from('pedidos_compra_omie').select('pedido_id, pedidos_compra!inner(etapa)')
        .eq('loja_id', lojaId).eq('pedidos_compra.etapa', 'aprovado')
        .or(filtroFilaCron(Date.now()))
        .order('pedido_id').limit(limite)
      if (e2) { res.erro = e2.message; continue }
      for (const f of fila ?? []) {
        const r = await enviarPedidoCompraOmie(lojaId, Number(f.pedido_id))
        if (r.status === 'ocupado') continue
        res.tentados++
        if (r.status === 'enviado') { res.enviados++; continue }
        res.erros++
        res.parouNoErro = true
        break
      }
    } finally {
      await soltarTravaSync(lojaId, 'pedidos-compra-envio')
    }
  }
  return out
}
