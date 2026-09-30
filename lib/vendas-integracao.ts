// Venda do ntb-vendas -> estoque no Omie (2026-09-28, virada do Sertao pra loja 4 real).
//
// Regra do dono: toda venda BAIXA estoque, com ou sem nota fiscal, e o que o Omie
// recusar por frequencia fica na fila e vai depois. Por item vendido:
//   1. Ordem de Producao criada+concluida (consome os insumos da ficha tecnica e
//      da entrada no produto pronto). Produto sem estrutura (revenda: cerveja,
//      refrigerante) o Omie recusa -- guardado em produto_sem_estrutura pra nao
//      tentar de novo a cada venda.
//   2. Saida (ajuste SAI) do produto vendido no mesmo local da OP, pelo mesmo
//      caminho dos ajustes manuais (tabela `movimentos`), que ja tem retry
//      automatico no cron retry-ajustes-movimentos. Venda COM nota vai pro Omie com
//      origem "PDV" (movimento do PDV); venda SEM nota e baixa comum ("AJU") -- regra 30/09.
// Falha TRANSITORIA na OP (ou na nota, ver app/api/integracao/nota-fiscal) vai
// pra vendas_integracao_fila e o cron retry-integracao-vendas reenvia.
import { comEsperaDeCmc, repetirSeCalculoPendente } from '@/lib/vendas/saida-com-espera'
import type { SupabaseClient } from '@supabase/supabase-js'
import { incluirOrdemProducao, concluirOrdemProducao, fetchOrdemProducao } from '@/lib/omie/ordem-producao'
import { incluirNfce, type IncluirNfcePayload } from '@/lib/omie/nota-fiscal-venda'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { msRestantesBloqueio, classificarErroOmie, proximaTentativa, type TipoErroOmie } from '@/lib/omie/erros-omie'
import { reenviarMovimentoManual } from '@/lib/movimentos/reenviar-manual'
import { dataCriacaoBahia, hojeBahiaISO } from '@/lib/data-bahia'
import { localDaVenda, origemDaVenda, type LojaLocais } from '@/lib/vendas/local-venda'

export type LojaVenda = LojaOmie & LojaLocais

const MAX_TENTATIVAS_FILA = 60

async function localPadrao(supabase: SupabaseClient, lojaId: number): Promise<number | null> {
  const { data } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque')
    .eq('loja_id', lojaId)
    .eq('padrao', 'S')
    .limit(1)
    .maybeSingle<{ codigo_local_estoque: number }>()
  return data?.codigo_local_estoque ?? null
}

export type PayloadOp = {
  codigo: string
  codigo_produto: number
  quantidade: number
  cCodIntOP: string
  obs: string
  codigoLocalEstoque: number | null
  dData: string // d/m/Y
}

type ResultadoOp = { ok: boolean; nCodOP?: number; semEstrutura?: boolean; naFila?: boolean; erro?: string }

/** Cria e conclui 1 OP. Nao grava fila: quem chama decide o que fazer com o erro. */
async function tentarOp(supabase: SupabaseClient, loja: LojaVenda, p: PayloadOp): Promise<ResultadoOp & { tipoErro?: TipoErroOmie }> {
  let nCodOP: number | undefined
  let erroConclusao: string | undefined
  try {
    const criada = await incluirOrdemProducao(loja, {
      cCodIntOP: p.cCodIntOP,
      nCodProduto: p.codigo_produto,
      dData: p.dData,
      nQtde: p.quantidade,
      obs: p.obs,
      codigoLocalEstoque: p.codigoLocalEstoque ?? undefined,
    })
    nCodOP = criada?.nCodOP
    if (!nCodOP) return { ok: false, erro: 'Omie não retornou a OP criada', tipoErro: 'transitorio' }
    // "Movimentos pendentes de cálculo" logo após criar a OP é passageiro: espera e tenta de novo (ex.: ½ Portuguesa,
    // 29/09 — ficou criada e não concluída porque nada a reenviava).
    const opCriada = nCodOP
    await repetirSeCalculoPendente(() => concluirOrdemProducao(loja, opCriada, p.dData, p.quantidade, 'Concluída automaticamente (venda ntb-vendas)'))
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'OrdemProducao',
      request: `venda codigo=${p.codigo} qtde=${p.quantidade} · ${p.obs ?? ''}`.slice(0, 500),
      // `code` é varchar(3): o nº da OP (10 dígitos) só vai no response, senão o insert do log falha em silêncio.
      response: `nCodOP=${nCodOP}`,
    })
    return { ok: true, nCodOP }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida na chamada Omie'
    if (nCodOP) erroConclusao = msg
    const tipoErro = classificarErroOmie(msg)
    if (tipoErro === 'sem_estrutura') {
      await supabase
        .from('produto_sem_estrutura')
        .upsert({ loja_id: loja.id, codigo_produto: p.codigo_produto, visto_em: new Date().toISOString() })
    }
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'OrdemProducao',
      request: `venda codigo=${p.codigo} qtde=${p.quantidade} · ${p.obs ?? ''}`.slice(0, 500),
      error: tipoErro !== 'sem_estrutura',
      error_message: nCodOP ? `[OP ${nCodOP} criada, conclusão falhou] ${msg}` : msg,
    })
    // OP criada mas conclusao falhou: a OP existe no Omie; o sync + retry-op-conclusao
    // (crons existentes) cuidam da conclusao. Nao reenfileirar (duplicaria a OP).
    if (nCodOP) return { ok: false, nCodOP, erro: msg, tipoErro: 'permanente' }
    return { ok: false, semEstrutura: tipoErro === 'sem_estrutura', erro: msg, tipoErro }
  } finally {
    if (nCodOP && !loja.is_test) {
      await fetchOrdemProducao(loja, nCodOP).catch(() => {})
      // Marca a origem na OP local ("Venda ntb-vendas #pedido [Produção]"): a tela de OPs mostra "Norte Vendas".
      // O sync do Omie não sobrescreve `observacao`, então a marca fica.
      await supabase
        .from('ordens_producao')
        .update({
          observacao: p.obs,
          // OP criada mas não concluída: marca pro cron retry-op-conclusao concluir depois (antes ficava esquecida).
          ...(erroConclusao ? { conclusao_status: 'Erro', conclusao_erro_msg: erroConclusao.slice(0, 500), conclusao_tentativas: 1, conclusao_ultima_tentativa_em: new Date().toISOString() } : {}),
        })
        .eq('loja_id', loja.id)
        .eq('identificacao_n_cod_op', nCodOP)
    }
  }
}

async function enfileirar(
  supabase: SupabaseClient,
  lojaId: number,
  tipo: 'op' | 'nfce',
  ref: string | null,
  payload: unknown,
  erro: string
) {
  const { error } = await supabase.from('vendas_integracao_fila').insert({
    loja_id: lojaId,
    tipo,
    ref,
    payload,
    tentativas: 1,
    proximo_em: proximaTentativa(1),
    ultimo_erro: erro.slice(0, 1000),
  })
  if (error) console.error('vendas-integracao: falha ao enfileirar', tipo, error.message)
  return !error
}

/** Saida (SAI) do produto vendido, pelo fluxo de `movimentos` (retry automatico no cron). */
async function darSaida(
  supabase: SupabaseClient,
  loja: LojaVenda,
  codigoProduto: number,
  quantidade: number,
  local: number,
  obs: string,
  origem: 'PDV' | 'AJU'
): Promise<{ ok: boolean; status: string; erro?: string }> {
  const data = dataCriacaoBahia(hojeBahiaISO())!
  const { data: mov, error } = await supabase
    .from('movimentos')
    .insert({
      loja_id: loja.id,
      tipo: 'SAI',
      origem,
      motivo: 'PDV',
      data,
      id_prod: codigoProduto,
      codigo_local_estoque: local,
      quan: -Math.abs(quantidade),
      obs,
      status: 'Processando',
    })
    .select('id, tentativas')
    .single<{ id: number; tentativas: number | null }>()
  if (error || !mov) return { ok: false, status: 'Erro', erro: error?.message ?? 'Falha ao gravar movimento' }
  // Logo após a OP o Omie ainda calcula o custo do que foi produzido ("Sem CMC" por alguns segundos): espera e tenta
  // de novo aqui mesmo em vez de deixar pro cron de 1 h. "Sem CMC" não lança nada no Omie, então repetir é seguro.
  let tentativas = mov.tentativas ?? 0
  const r = await comEsperaDeCmc(async () => {
    const res = await reenviarMovimentoManual(
      { id: mov.id, codigo_local_estoque: local, id_prod: codigoProduto, quan: -Math.abs(quantidade), tipo: 'SAI', motivo: 'PDV', origem, obs, data, tentativas },
      loja,
      loja.id,
      { auditar: false }
    )
    if (res.status === 'Sem CMC') tentativas++
    return res
  }, { esperasMs: [6000, 12000, 20000] })
  // 'Erro'/'Sem CMC' ficam em `movimentos` e o cron retry-ajustes-movimentos reenvia.
  return { ok: r.status === 'Concluido', status: r.status, erro: r.erro }
}

export type ItemVenda = { codigo: string; quantidade: number; destination?: 'kitchen' | 'bar' | null; setor?: string | null; comNota?: boolean | null }

export type ResultadoItemVenda = {
  codigo: string
  ok: boolean
  nCodOP?: number
  op: 'criada' | 'sem_estrutura' | 'na_fila' | 'erro' | 'pulada'
  baixa: string
  erro?: string
}

/** Processa 1 item vendido: OP (se o produto tem estrutura) + saida de estoque. */
export async function processarItemVenda(
  supabase: SupabaseClient,
  loja: LojaVenda,
  item: ItemVenda,
  ctx: { pedidoRef: string | null; obs: string; dData: string; indice: number }
): Promise<ResultadoItemVenda> {
  const { data: produto } = await supabase
    .from('produtos')
    .select('codigo_produto')
    .eq('loja_id', loja.id)
    .eq('codigo', item.codigo)
    .maybeSingle<{ codigo_produto: number }>()
  if (!produto) return { codigo: item.codigo, ok: false, op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro correspondente no ntb-estoque' }

  // Setor (ex.: Pizzaria -> PIZZA) > cozinha/bar > local padrão da loja.
  const localMapeado = localDaVenda(loja, item)
  const local = localMapeado ?? (await localPadrao(supabase, loja.id))

  const { data: sem } = await supabase
    .from('produto_sem_estrutura')
    .select('codigo_produto')
    .eq('loja_id', loja.id)
    .eq('codigo_produto', produto.codigo_produto)
    .maybeSingle()

  let op: ResultadoItemVenda['op'] = 'sem_estrutura'
  let nCodOP: number | undefined
  let erroOp: string | undefined
  if (!sem) {
    const payload: PayloadOp = {
      codigo: item.codigo,
      codigo_produto: produto.codigo_produto,
      quantidade: item.quantidade,
      cCodIntOP: `NTBV${Date.now()}${ctx.indice}`.slice(0, 20),
      obs: ctx.obs,
      codigoLocalEstoque: localMapeado ?? null,
      dData: ctx.dData,
    }
    const r = await tentarOp(supabase, loja, payload)
    nCodOP = r.nCodOP
    if (r.ok) op = 'criada'
    else if (r.semEstrutura) op = 'sem_estrutura'
    else if (r.tipoErro === 'transitorio' && (await enfileirar(supabase, loja.id, 'op', ctx.pedidoRef, payload, r.erro ?? ''))) op = 'na_fila'
    else {
      op = 'erro'
      erroOp = r.erro
    }
  }

  let baixa = 'sem local de estoque'
  if (local) {
    const s = await darSaida(supabase, loja, produto.codigo_produto, item.quantidade, local, `${ctx.obs} · saída automática da venda`, origemDaVenda(item.comNota))
    baixa = s.status
  }

  return { codigo: item.codigo, ok: op !== 'erro', nCodOP, op, baixa, erro: erroOp }
}

/** Envia a NFC-e pro Omie; falha transitoria vai pra fila. */
export async function enviarNfceOuEnfileirar(supabase: SupabaseClient, loja: LojaOmie, payload: IncluirNfcePayload) {
  try {
    const resultado = await incluirNfce(loja, payload)
    return { ok: true as const, resultado }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida na chamada Omie'
    if (classificarErroOmie(msg) === 'transitorio' && (await enfileirar(supabase, loja.id, 'nfce', payload.chNFe, payload, msg))) {
      return { ok: false as const, naFila: true, reason: msg }
    }
    return { ok: false as const, naFila: false, reason: msg }
  }
}

type LinhaFila = { id: number; loja_id: number; tipo: 'op' | 'nfce'; payload: unknown; tentativas: number }

/** Cron: reenvia o que esta na fila e ja passou da hora. Sequencial, respeita bloqueio do Omie. */
export async function processarFilaVendas(supabase: SupabaseClient, limitePorLoja = 10) {
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test, local_estoque_cozinha_codigo, local_estoque_bar_codigo, local_estoque_por_setor, local_estoque_por_produto')
    .eq('ativo', true)
    .returns<LojaVenda[]>()
  const resumo: { loja_id: number; tentadas: number; sucesso: number; falhas: number }[] = []
  for (const loja of lojas ?? []) {
    if (!loja.omie_app_key || msRestantesBloqueio(loja.omie_app_key) > 0) continue
    const { data: linhas } = await supabase
      .from('vendas_integracao_fila')
      .select('id, loja_id, tipo, payload, tentativas')
      .eq('loja_id', loja.id)
      .eq('status', 'Pendente')
      .lte('proximo_em', new Date().toISOString())
      .order('proximo_em', { ascending: true })
      .limit(limitePorLoja)
      .returns<LinhaFila[]>()
    if (!linhas?.length) continue
    const r = { loja_id: loja.id, tentadas: 0, sucesso: 0, falhas: 0 }
    for (const linha of linhas) {
      r.tentadas++
      let ok = false
      let erro = ''
      let resultado: unknown = null
      let definitivo = false
      if (linha.tipo === 'op') {
        const t = await tentarOp(supabase, loja, linha.payload as PayloadOp)
        if (t.ok || t.semEstrutura || t.tipoErro === 'ja_existe') {
          ok = true
          resultado = { nCodOP: t.nCodOP ?? null, semEstrutura: !!t.semEstrutura, jaExistia: t.tipoErro === 'ja_existe' }
        } else {
          erro = t.erro ?? 'Falha'
          definitivo = t.tipoErro === 'permanente'
        }
      } else {
        try {
          resultado = await incluirNfce(loja, linha.payload as IncluirNfcePayload)
          ok = true
        } catch (e) {
          erro = e instanceof Error ? e.message : String(e)
          definitivo = classificarErroOmie(erro) !== 'transitorio'
        }
      }
      const tentativas = linha.tentativas + 1
      if (ok) r.sucesso++
      else r.falhas++
      await supabase
        .from('vendas_integracao_fila')
        .update({
          status: ok ? 'Concluido' : definitivo || tentativas >= MAX_TENTATIVAS_FILA ? 'Erro' : 'Pendente',
          tentativas,
          proximo_em: proximaTentativa(tentativas),
          ultimo_erro: ok ? null : erro.slice(0, 1000),
          resultado,
          updated_at: new Date().toISOString(),
        })
        .eq('id', linha.id)
      if (msRestantesBloqueio(loja.omie_app_key) > 0) break
    }
    resumo.push(r)
  }
  return resumo
}
