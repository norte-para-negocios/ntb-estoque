import { omieRequest, logIntegrationAttempt, OmieError, type LojaOmie } from './client'
import { msRestantesBloqueio } from './erros-omie'
import { pegarTravaSync, soltarTravaSync } from './trava-sync'
import { createServiceClient } from '@/lib/supabase/server'
import {
  decidirFalhaPedido, ehPedidoJaExiste, ENVIANDO_TRAVADO_MS, filtroFilaCron, filtroReivindicarPendente, ehPedidoNaoEncontrado, gravacaoPedidosOmieLigada, montarIncluirPedCompra, motivoSemGravacaoPedidoOmie,
  pedidoIncluido, type IncluirPedCompra, type ItemPedidoOmie, type PedidoParaOmie, type RespostaIncluirPed,
} from '@/lib/compras/pedido-omie-gravar-puro'
import type { Parcela } from '@/lib/compras/pedido-puro'

// C1 (20/10/2026): grava no Omie (IncluirPedCompra) o pedido de compra aprovado no NTB numa loja de estoque Omie.
// DESLIGADO: só age com OMIE_GRAVAR_PEDIDOS_COMPRA=1 E lojas.omie_gravar_pedidos_compra = true (migration 270); loja 4 nunca.
// Idempotência: cCodIntPed = NTB-PC-<id do pedido>; toda tentativa depois da 1ª (ou depois de um envio que ficou sem
// resposta) CONSULTA o Omie por esse código antes de incluir; "já existe" na inclusão também consulta e adota o nCodPed.
// Limite do Omie: 10 erros no mesmo método = 30 min de bloqueio da chave. Por isso: 1 chamada por pedido por vez
// (status 'enviando' reivindicado no banco), espera crescente entre tentativas, teto de tentativas, bloqueio não conta
// tentativa, e o cron para a loja no 1º erro do ciclo. Loja de teste: a inclusão é simulada pelo omieRequest e a consulta
// é pulada (o pedido nunca existiu no Omie real).

const ENDPOINT = 'v1/produtos/pedidocompra'
const INCLUIR = 'IncluirPedCompra'
const CONSULTAR = 'ConsultarPedCompra'

type LojaGravar = LojaOmie & {
  modo_estoque: string | null
  omie_gravar_pedidos_compra: boolean | null
  omie_pedido_categoria: string | null
  omie_pedido_email_aprovador: string | null
}

type LinhaFila = { pedido_id: number; loja_id: number; cod_int: string; status: string; tentativas: number; n_cod_ped: number | null; numero_omie: string | null }

export type ResultadoEnvioPedido =
  | { status: 'desligado' | 'bloqueado'; motivo: string }
  | { status: 'ocupado'; motivo: string }
  | { status: 'enviado'; nCodPed: number; numero: string | null; jaExistia: boolean }
  | { status: 'pendente' | 'precisa_corrigir'; erro: string; proximaTentativaEm: string | null; contaTentativa: boolean }

const db = () => createServiceClient({ semAutor: true })

async function carregarLoja(lojaId: number): Promise<LojaGravar | null> {
  const { data } = await db().from('lojas')
    .select('id, modo_estoque, is_test, omie_app_key, omie_app_secret, omie_gravar_pedidos_compra, omie_pedido_categoria, omie_pedido_email_aprovador')
    .eq('id', lojaId).maybeSingle<LojaGravar>()
  return data ?? null
}

/** Reivindica o pedido (pendente na hora certa, ou 'enviando' esquecido). Só uma tentativa por vez no banco. */
async function reivindicar(lojaId: number, pedidoId: number, manual: boolean): Promise<{ fila: LinhaFila; reaberta: boolean } | null> {
  const agora = new Date()
  const iso = agora.toISOString()
  let q = db().from('pedidos_compra_omie').update({ status: 'enviando', ultima_tentativa_em: iso, updated_at: iso })
    .eq('pedido_id', pedidoId).eq('loja_id', lojaId).eq('status', 'pendente')
  q = q.or(filtroReivindicarPendente(agora.getTime(), manual))
  const { data, error } = await q.select('pedido_id, loja_id, cod_int, status, tentativas, n_cod_ped, numero_omie')
  if (error) throw new Error(`fila do pedido ${pedidoId}: ${error.message}`)
  if (data?.length) return { fila: data[0] as LinhaFila, reaberta: false }
  const { data: velho, error: e2 } = await db().from('pedidos_compra_omie').update({ status: 'enviando', ultima_tentativa_em: iso, updated_at: iso })
    .eq('pedido_id', pedidoId).eq('loja_id', lojaId).eq('status', 'enviando').lt('ultima_tentativa_em', new Date(agora.getTime() - ENVIANDO_TRAVADO_MS).toISOString())
    .select('pedido_id, loja_id, cod_int, status, tentativas, n_cod_ped, numero_omie')
  if (e2) throw new Error(`fila do pedido ${pedidoId}: ${e2.message}`)
  return velho?.length ? { fila: velho[0] as LinhaFila, reaberta: true } : null
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

async function gravarFila(pedidoId: number, campos: Record<string, unknown>) {
  const { error } = await db().from('pedidos_compra_omie').update({ ...campos, updated_at: new Date().toISOString() }).eq('pedido_id', pedidoId)
  if (error) console.error(`pedido-compra-omie: não gravou o estado do pedido ${pedidoId}: ${error.message}`)
}

async function evento(lojaId: number, pedidoId: number, tipo: string, detalhe: Record<string, unknown>) {
  const { error } = await db().from('pedidos_compra_eventos').insert({ loja_id: lojaId, pedido_id: pedidoId, tipo, de_etapa: 'aprovado', para_etapa: 'aprovado', detalhe })
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

async function sucesso(lojaId: number, pedidoId: number, r: { nCodPed: number; numero: string | null }, jaExistia: boolean, payload: IncluirPedCompra | null): Promise<ResultadoEnvioPedido> {
  const agora = new Date().toISOString()
  await gravarFila(pedidoId, {
    status: 'enviado', n_cod_ped: r.nCodPed, numero_omie: r.numero, enviado_em: agora, ultimo_erro: null, proxima_tentativa_em: null,
    ...(payload ? { payload } : {}),
  })
  await evento(lojaId, pedidoId, 'omie_enviado', { n_cod_ped: r.nCodPed, numero_omie: r.numero, ja_existia: jaExistia })
  return { status: 'enviado', nCodPed: r.nCodPed, numero: r.numero, jaExistia }
}

async function falha(lojaId: number, fila: LinhaFila, e: unknown): Promise<ResultadoEnvioPedido> {
  const msg = e instanceof Error ? e.message : String(e)
  const d = decidirFalhaPedido(msg, e instanceof OmieError ? e.faultCode : undefined, fila.tentativas)
  await gravarFila(fila.pedido_id, { status: d.status, tentativas: d.tentativas, proxima_tentativa_em: d.proximaTentativaEm, ultimo_erro: d.erro })
  if (d.status === 'precisa_corrigir') await evento(lojaId, fila.pedido_id, 'omie_erro', { erro: d.erro, tentativas: d.tentativas })
  return { status: d.status, erro: d.erro, proximaTentativaEm: d.proximaTentativaEm, contaTentativa: d.contaTentativa }
}

/**
 * Uma tentativa de gravar o pedido no Omie. Nunca lança: devolve o resultado (o estado fica em pedidos_compra_omie).
 * `manual`: botão "Enviar agora" (ignora a espera da próxima tentativa, mas não o bloqueio do Omie nem o intervalo de 2 min).
 */
export async function enviarPedidoCompraOmie(lojaId: number, pedidoId: number, o: { manual?: boolean } = {}): Promise<ResultadoEnvioPedido> {
  if (!gravacaoPedidosOmieLigada(process.env)) return { status: 'desligado', motivo: 'Gravação de pedidos de compra no Omie desligada.' }
  let fila: LinhaFila | null = null
  try {
    const loja = await carregarLoja(lojaId)
    if (!loja) return { status: 'bloqueado', motivo: 'Loja inexistente.' }
    const motivo = motivoSemGravacaoPedidoOmie(process.env, { id: loja.id, modo: loja.modo_estoque, optIn: loja.omie_gravar_pedidos_compra === true })
    if (motivo) return { status: 'bloqueado', motivo }
    if (!loja.omie_app_key || !loja.omie_app_secret) return { status: 'bloqueado', motivo: 'Loja sem chave do Omie.' }
    // Disjuntor aberto: nem reivindica (não gasta tentativa, não chama o Omie).
    const bloq = Math.max(msRestantesBloqueio(loja.omie_app_key, Date.now(), INCLUIR), msRestantesBloqueio(loja.omie_app_key, Date.now(), CONSULTAR))
    if (bloq > 0) return { status: 'pendente', erro: `API do Omie bloqueada para esta loja (libera em ~${Math.ceil(bloq / 60000)} min).`, proximaTentativaEm: new Date(Date.now() + bloq).toISOString(), contaTentativa: false }

    const r = await reivindicar(lojaId, pedidoId, !!o.manual)
    if (!r) return { status: 'ocupado', motivo: 'O pedido não está na fila agora (já enviado, em envio, ou esperando a próxima tentativa).' }
    fila = r.fila

    const dados = await carregarPedido(lojaId, pedidoId)
    if (!dados) { await gravarFila(pedidoId, { status: 'pendente' }); return { status: 'bloqueado', motivo: 'Pedido inexistente.' } }
    const montado = montarIncluirPedCompra(dados.pedido, { categoria: loja.omie_pedido_categoria, emailAprovador: loja.omie_pedido_email_aprovador, locais: dados.locais })
    if ('erros' in montado) {
      // Falta dado no NTB: nada vai ao Omie; sai da fila até alguém corrigir e aprovar de novo.
      const erro = montado.erros.join(' ').slice(0, 1000)
      await gravarFila(pedidoId, { status: 'precisa_corrigir', ultimo_erro: erro, proxima_tentativa_em: null })
      await evento(lojaId, pedidoId, 'omie_erro', { erro, antes_do_omie: true })
      return { status: 'precisa_corrigir', erro, proximaTentativaEm: null, contaTentativa: false }
    }

    // Retentativa (ou envio anterior sem resposta): o pedido pode já estar no Omie. Consulta antes de incluir de novo.
    if (!loja.is_test && (r.reaberta || fila.tentativas > 0)) {
      const existente = await consultarPorCodigo(loja, fila.cod_int)
      if (existente) return await sucesso(lojaId, pedidoId, existente, true, montado.payload)
    }

    try {
      const resp = await omieRequest<RespostaIncluirPed>({
        loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
        endpoint: ENDPOINT, call: INCLUIR, data: montado.payload as unknown as Record<string, unknown>, semRepetir: true,
      })
      await log(loja.id, INCLUIR, montado.payload, { response: resp })
      const ok = pedidoIncluido(resp)
      if (!ok) throw new OmieError(`Resposta do Omie sem nCodPed: ${JSON.stringify(resp).slice(0, 300)}`)
      return await sucesso(lojaId, pedidoId, ok, false, montado.payload)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!(e instanceof OmieError && /sem nCodPed/.test(msg))) await log(loja.id, INCLUIR, montado.payload, { erro: msg })
      if (!loja.is_test && ehPedidoJaExiste(msg)) {
        const existente = await consultarPorCodigo(loja, fila.cod_int)
        if (existente) return await sucesso(lojaId, pedidoId, existente, true, montado.payload)
      }
      throw e
    }
  } catch (e) {
    if (!fila) {
      console.error(`pedido-compra-omie: pedido ${pedidoId} (loja ${lojaId}):`, e instanceof Error ? e.message : e)
      return { status: 'pendente', erro: 'Não foi possível preparar o envio agora.', proximaTentativaEm: null, contaTentativa: false }
    }
    return falha(lojaId, fila, e)
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
 * (no máximo 1 erro por método por ciclo de 10 min, longe dos 10 que bloqueiam a chave).
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
        res.tentados++
        const r = await enviarPedidoCompraOmie(lojaId, Number(f.pedido_id))
        if (r.status === 'enviado') { res.enviados++; continue }
        if (r.status === 'ocupado') continue
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
