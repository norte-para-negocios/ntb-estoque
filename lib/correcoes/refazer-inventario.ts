// Refazer inventário pela Central (15/10/2026): prévia (só leitura do Omie) e execução (uma escrita por vez, intenção
// gravada antes de cada escrita, para no primeiro erro). Regras em ./refazer-inventario-puro.ts; passo a passo para
// quem usa em docs/refazer-inventario.md. Só servidor (sem 'use server': exportar daqui viraria endpoint público).
import { createServiceClient } from '@/lib/supabase/server'
import { buscarKardexOmie } from '@/lib/omie/kardex'
import { excluirAjusteDetalhado, incluirAjusteComCusto, listarAjustesDoDia } from '@/lib/omie/ajuste'
import type { LojaEscrita } from '@/lib/estoque/contexto-escrita-omie'
import { isoParaBR, mesDoAjusteFechado, statusAposExclusao } from '@/lib/estoque/escrita-omie-puro'
import { diaDoMovimento } from '@/lib/estoque/quem-mexeu-puro'
import { dataCriacaoBahia, hojeBahiaISO } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'
import {
  assinaturaPlano, codIntRefazer, fmtQ, obsRefazer, passosRefazer, planejarRefazer, proximaEscrita,
  type CorrecaoAExcluir, type ModoRefazer, type Plano,
} from './refazer-inventario-puro'

export type PedidoRefazer = { modo: ModoRefazer; idAjuste: number; contagemCerta?: number | null }
export type PreviaRefazer = {
  passos: string[]; avisos: string[]; assinatura: string; produto: string; dataBR: string
  /** Já existe um refazer parado deste inventário: confirmar continua de onde parou. */
  continuar?: { status: string; erro: string | null; feitos: number }
}
export type RespostaRefazer = { ok: true; aviso: string; passos: string[] } | { error: string; previa?: PreviaRefazer; parado?: boolean }

type InvDb = { produto: number; local: number; dia: string; contagem: number | null }
type Linha = {
  id: number; loja_id: number; modo: ModoRefazer; id_ajuste_inventario: number; id_prod: number; codigo_local_estoque: number
  data_inventario: string; contagem_certa: number; quan: number; cmc: number | null; excluir: number[]; excluidos: number[]
  pendente: { acao: 'excluir' | 'incluir'; id?: number; em?: string } | null; id_ajuste_novo: number | null; cod_int_ajuste: string | null
  obs: string | null; passos: string[] | null; status: string; erro: string | null; user_nome: string | null; updated_at: string
}
const COLS = 'id, loja_id, modo, id_ajuste_inventario, id_prod, codigo_local_estoque, data_inventario, contagem_certa, quan, cmc, excluir, excluidos, pendente, id_ajuste_novo, cod_int_ajuste, obs, passos, status, erro, user_nome, updated_at'
const ABERTOS = ['andamento', 'parado', 'concluido']
const PAUSA_MS = 1500
/** Páginas de 50 ajustes ao procurar um ajuste num dia (dia cheio do Sertão passa de 150). */
const PAGINAS_CONFERIR = 20
/** Inclusão sem resposta: só concluir que "não entrou" depois disto (o Omie pode estar processando). */
const ESPERA_CONFERIR_MS = 3 * 60_000
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const n = (v: unknown) => Number(v)

/** O inventário (ajuste) como está no banco: item de inventário do app, contagem SLD do sync ou inventário já refeito. */
async function inventarioDoBanco(lojaId: number, idAjuste: number): Promise<InvDb | null> {
  const db = createServiceClient()
  const { data: m } = await db.from('movimentos').select('id_prod, codigo_local_estoque, data, tipo, quan, cod_int_ajuste')
    .eq('loja_id', lojaId).eq('id_ajuste', idAjuste).eq('status', 'Concluido').limit(1).maybeSingle()
  if (m && (m.tipo === 'SLD' || String(m.cod_int_ajuste ?? '').startsWith('INVR-'))) {
    return { produto: n(m.id_prod), local: n(m.codigo_local_estoque), dia: diaDoMovimento(String(m.data)), contagem: m.tipo === 'SLD' ? n(m.quan) : null }
  }
  const { data: it } = await db.from('inventario_items').select('produto_codigo_produto, quan, inventario_id')
    .eq('loja_id', lojaId).eq('id_ajuste', idAjuste).eq('status', 'Concluido').limit(1).maybeSingle()
  if (!it?.produto_codigo_produto) return null
  const { data: inv } = await db.from('inventarios').select('codigo_local_estoque, data').eq('loja_id', lojaId).eq('id', it.inventario_id).maybeSingle()
  if (!inv) return null
  return { produto: n(it.produto_codigo_produto), local: n(inv.codigo_local_estoque), dia: diaDoMovimento(String(inv.data)), contagem: it.quan == null ? null : n(it.quan) }
}

type Montado = { plano: Plano; previa: PreviaRefazer; inv: InvDb; obs: string; mesFechado: boolean }

/** Inventários do produto no local a partir do dia (item do app, SLD do sync ou INVR- refeito): id do ajuste e dia. */
async function inventariosDoProduto(lojaId: number, inv: InvDb): Promise<{ idAjuste: number; dia: string }[]> {
  const db = createServiceClient()
  const desde = new Date(Date.parse(`${inv.dia}T00:00:00Z`) - 86_400_000).toISOString()
  const out: { idAjuste: number; dia: string }[] = []
  const { data: invs } = await db.from('inventarios').select('id, data').eq('loja_id', lojaId).eq('codigo_local_estoque', inv.local).gte('data', desde).limit(2000)
  const diaInv = new Map((invs ?? []).map((x) => [n(x.id), diaDoMovimento(String(x.data))]))
  if (diaInv.size) {
    const { data: its } = await db.from('inventario_items').select('id_ajuste, inventario_id').eq('loja_id', lojaId).eq('produto_codigo_produto', inv.produto)
      .in('inventario_id', [...diaInv.keys()]).gt('id_ajuste', 0).limit(2000)
    for (const x of its ?? []) out.push({ idAjuste: n(x.id_ajuste), dia: diaInv.get(n(x.inventario_id)) ?? '' })
  }
  const { data: ms } = await db.from('movimentos').select('id_ajuste, data, tipo, cod_int_ajuste').eq('loja_id', lojaId).eq('id_prod', inv.produto)
    .eq('codigo_local_estoque', inv.local).eq('status', 'Concluido').gt('id_ajuste', 0).gte('data', desde)
    .or('tipo.eq.SLD,cod_int_ajuste.like.INVR-*').limit(2000)
  for (const x of ms ?? []) out.push({ idAjuste: n(x.id_ajuste), dia: diaDoMovimento(String(x.data)) })
  return out.filter((x) => x.dia >= inv.dia)
}

/** Lê tudo (banco + kardex do dia no Omie, só leitura) e monta o plano e o passo a passo. */
export async function montarRefazer(loja: LojaEscrita, pedido: PedidoRefazer): Promise<Montado | { error: string }> {
  const db = createServiceClient()
  const lojaId = loja.id
  if (pedido.modo !== 'contagem' && pedido.modo !== 'fim_do_dia') return { error: 'Pedido inválido.' }
  const inv = await inventarioDoBanco(lojaId, n(pedido.idAjuste))
  if (!inv) return { error: 'Inventário não encontrado nesta loja (ou o lançamento não foi concluído).' }
  const dataBR = isoParaBR(inv.dia)
  const { data: p } = await db.from('produtos').select('descricao, unidade').eq('loja_id', lojaId).eq('codigo_produto', inv.produto).maybeSingle()
  const un = String(p?.unidade ?? '').trim()

  // Vendas sem nota vão ao Omie como ajuste comum (AJU): o banco diz quais ajustes do dia são baixa de venda.
  const ini = `${inv.dia}T00:00:00Z`
  const fim = new Date(Date.parse(`${inv.dia}T00:00:00Z`) + 2 * 86_400_000).toISOString()
  const { data: vendas } = await db.from('movimentos').select('id_ajuste').eq('loja_id', lojaId).eq('id_prod', inv.produto)
    .eq('codigo_local_estoque', inv.local).eq('motivo', 'PDV').not('id_ajuste', 'is', null).gte('data', ini).lt('data', fim).limit(5000)

  // Outros inventários do produto no local: no mesmo dia (outro depois deste = recusa) e nos dias seguintes (aviso).
  const outrosInv = await inventariosDoProduto(lojaId, inv)
  const proximoInv = outrosInv.filter((x) => x.idAjuste > n(pedido.idAjuste) && x.dia > inv.dia).reduce<number | null>((a, x) => (a == null || x.idAjuste < a ? x.idAjuste : a), null)
  const diasDepois = [...new Set(outrosInv.filter((x) => x.dia > inv.dia).map((x) => x.dia))].sort()

  // Correções lançadas depois para o mesmo erro (saída da Central/faxina): só no modo contagem, e só antes do
  // próximo inventário do produto no local (correção de outro inventário não é deste).
  const correcoes: CorrecaoAExcluir[] = []
  if (pedido.modo === 'contagem') {
    let q = db.from('movimentos').select('id_ajuste, data, tipo, quan')
      .eq('loja_id', lojaId).eq('id_prod', inv.produto).eq('codigo_local_estoque', inv.local).eq('status', 'Concluido')
      .in('tipo', ['ENT', 'SAI']).gt('id_ajuste', n(pedido.idAjuste)).gte('data', ini)
    if (proximoInv != null) q = q.lt('id_ajuste', proximoInv)
    const { data: cs } = await q
      .or('obs.ilike.*contagem corrigida*,obs.ilike.Correção de contagem*')
      .order('id_ajuste').limit(10)
    for (const c of cs ?? []) {
      const d = isoParaBR(diaDoMovimento(String(c.data)))
      if (!loja.is_test) {
        const { ajustes, completa } = await listarAjustesDoDia(loja, d, PAGINAS_CONFERIR)
        const achou = ajustes.some((a) => n(a.id_ajuste) === n(c.id_ajuste))
        if (!achou && !completa) return { error: `Não deu para conferir no Omie a correção ${c.id_ajuste} de ${d} (dia com ajustes demais). Confira no Omie antes de refazer.` }
        if (!achou) continue // já não existe no Omie
      }
      correcoes.push({ idAjuste: n(c.id_ajuste), data: d, tipo: String(c.tipo), quantidade: Math.abs(n(c.quan)) })
    }
  }

  let movs
  try {
    movs = await buscarKardexOmie(loja, inv.produto, inv.local, dataBR, dataBR)
  } catch (e) {
    return { error: `Não foi possível ler o kardex do Omie de ${dataBR}: ${msg(e)}` }
  }
  const plano = planejarRefazer({
    modo: pedido.modo, idAjusteInventario: n(pedido.idAjuste), contagemCerta: pedido.contagemCerta, contagemDb: inv.contagem,
    correcoes: correcoes.map((c) => c.idAjuste), vendasAju: (vendas ?? []).map((v) => n(v.id_ajuste)),
    inventariosDoDia: outrosInv.filter((x) => x.dia === inv.dia).map((x) => x.idAjuste),
    movs: movs.map((x) => ({
      idMov: n(x.idMov), idAjuste: x.idAjuste == null || n(x.idAjuste) === 0 ? null : n(x.idAjuste), codOrigem: String(x.codOrigem ?? ''),
      qtde: n(x.qtde ?? 0), saldo: x.saldo == null ? null : n(x.saldo), cmc: x.cmc == null ? null : n(x.cmc), cancelado: x.cancelamento === 'S',
    })),
  })
  if ('erro' in plano) return { error: plano.erro }
  const mesFechado = mesDoAjusteFechado(inv.dia, hojeBahiaISO(), process.env.ESTOQUE_MES_FECHADO_ATE ?? null)
  const passos = passosRefazer(plano, { dataBR, un, correcoes, mesFechado })
  return {
    plano, inv, mesFechado, obs: obsRefazer(plano, dataBR),
    previa: {
      passos, assinatura: assinaturaPlano(plano), produto: String(p?.descricao ?? inv.produto), dataBR,
      avisos: [...plano.avisos, ...(diasDepois.length ? [`Este produto tem inventário neste local depois de ${dataBR} (${diasDepois.slice(0, 5).map((d) => isoParaBR(d).slice(0, 5)).join(', ')}${diasDepois.length > 5 ? '…' : ''}): depois de refazer, confira no Omie se o saldo desses dias continua igual à contagem.`] : [])],
    },
  }
}

async function lerAberto(lojaId: number, idAjuste: number): Promise<Linha | null> {
  const { data } = await createServiceClient().from('estoque_refazer_inventario').select(COLS)
    .eq('loja_id', lojaId).eq('id_ajuste_inventario', idAjuste).in('status', ABERTOS).order('id', { ascending: false }).limit(1).maybeSingle<Linha>()
  return data ?? null
}

/** Prévia (só leitura). Se há um refazer parado deste inventário, mostra o passo a passo gravado e o que já foi feito. */
export async function previaRefazer(loja: LojaEscrita, pedido: PedidoRefazer): Promise<PreviaRefazer | { error: string }> {
  const aberto = await lerAberto(loja.id, n(pedido.idAjuste)).catch(() => null)
  if (aberto?.status === 'concluido') return { error: `Este inventário já foi refeito${aberto.user_nome ? ` por ${aberto.user_nome}` : ''}.` }
  if (aberto && !nadaEscrito(aberto)) {
    const { data: pr } = await createServiceClient().from('produtos').select('descricao').eq('loja_id', loja.id).eq('codigo_produto', aberto.id_prod).maybeSingle()
    return {
      passos: aberto.passos ?? [], avisos: [], assinatura: `continuar:${aberto.id}`, produto: String(pr?.descricao ?? aberto.id_prod), dataBR: isoParaBR(aberto.data_inventario),
      continuar: {
        status: aberto.status, erro: aberto.status === 'andamento' ? 'está sendo feito agora (outra aba ou pessoa)' : aberto.erro,
        feitos: (aberto.excluidos ?? []).length + (aberto.id_ajuste_novo ? 1 : 0),
      },
    }
  }
  const m = await montarRefazer(loja, pedido)
  return 'error' in m ? m : m.previa
}

/** Parado antes de qualquer escrita (nem intenção gravada): pode ser descartado e planejado de novo. */
const nadaEscrito = (l: Linha) => !(l.excluidos ?? []).length && !l.pendente && l.id_ajuste_novo == null

/**
 * Executa (ou continua) o refazer. `assinatura` = o que a pessoa viu na prévia: se o kardex mudou, nada é escrito e
 * volta a prévia nova. A linha em estoque_refazer_inventario é a trava (índice único) e o diário das escritas.
 */
export async function executarRefazer(loja: LojaEscrita, pedido: PedidoRefazer, assinatura: string, user: { id: string | null; nome: string | null }): Promise<RespostaRefazer> {
  const db = createServiceClient()
  const aberto = await lerAberto(loja.id, n(pedido.idAjuste))
  if (aberto?.status === 'concluido') return { error: `Este inventário já foi refeito${aberto.user_nome ? ` por ${aberto.user_nome}` : ''}. Nada foi lançado de novo.` }
  if (aberto && aberto.status === 'andamento' && Date.now() - Date.parse(aberto.updated_at) < 10 * 60_000) return { error: 'Este inventário está sendo refeito agora (outra aba ou pessoa). Espere alguns minutos.' }
  if (aberto && nadaEscrito(aberto)) {
    // Nada foi ao Omie: descarta e segue como um refazer novo (com o plano lido agora e conferido pela assinatura).
    await db.from('estoque_refazer_inventario').update({ status: 'cancelado', erro: 'descartado: nada tinha sido escrito', updated_at: new Date().toISOString() })
      .eq('id', aberto.id).eq('updated_at', aberto.updated_at)
  } else if (aberto) {
    // Continuar exige que a tela tenha mostrado o que já foi feito (prévia de "continuar"), nunca a prévia de um plano novo.
    if (assinatura !== `continuar:${aberto.id}`) {
      const pv = await previaRefazer(loja, pedido)
      return { error: 'Já existe um refazer deste inventário que parou no meio: confira o que já foi feito e confirme para continuar.', ...('error' in pv ? {} : { previa: pv }) }
    }
    const { data: pega } = await db.from('estoque_refazer_inventario').update({ status: 'andamento', updated_at: new Date().toISOString() })
      .eq('id', aberto.id).eq('status', aberto.status).eq('updated_at', aberto.updated_at).select('id')
    if (!pega?.length) return { error: 'Outra pessoa já está continuando este refazer.' }
    return continuar(loja, { ...aberto, status: 'andamento' }, user)
  }

  const m = await montarRefazer(loja, pedido)
  if ('error' in m) return m
  if (m.previa.assinatura !== assinatura) return { error: 'O kardex do Omie mudou desde a prévia: confira o passo a passo novo e confirme de novo.', previa: m.previa }
  const { plano, inv } = m
  const { data: linha, error } = await db.from('estoque_refazer_inventario').insert({
    loja_id: loja.id, modo: plano.modo, id_ajuste_inventario: plano.idAjusteInventario, id_prod: inv.produto, codigo_local_estoque: inv.local,
    data_inventario: inv.dia, contagem_lancada: plano.contagemLancada, contagem_certa: plano.contagemCerta, saldo_antes: plano.saldoAntes,
    vendas_depois: plano.vendasDepois.soma, quan: plano.quan, cmc: plano.cmc, excluir: plano.excluir, excluidos: [], obs: m.obs,
    passos: m.previa.passos, mes_fechado: m.mesFechado, status: 'andamento', user_id: user.id, user_nome: user.nome,
  }).select(COLS).single<Linha>()
  if (error || !linha) {
    if (error?.code === '23505') return { error: 'Este inventário já está sendo refeito (outra aba ou pessoa).' }
    if (error?.code === '42P01' || /estoque_refazer_inventario/.test(error?.message ?? '')) return { error: 'Refazer inventário ainda não ativado neste banco (migration 172).' }
    return { error: `Não foi possível registrar: ${error?.message ?? 'erro desconhecido'}` }
  }
  const cod = codIntRefazer(linha.id)
  await db.from('estoque_refazer_inventario').update({ cod_int_ajuste: cod }).eq('id', linha.id)
  return continuar(loja, { ...linha, cod_int_ajuste: cod }, user)
}

async function continuar(loja: LojaEscrita, l: Linha, user: { id: string | null; nome: string | null }): Promise<RespostaRefazer> {
  const db = createServiceClient()
  const salvar = async (campos: Partial<Linha> & Record<string, unknown>) => {
    Object.assign(l, campos)
    const { error } = await db.from('estoque_refazer_inventario').update({ ...campos, updated_at: new Date().toISOString() }).eq('id', l.id)
    if (error) throw new Error(`não foi possível gravar o andamento: ${error.message}`)
  }
  const dataBR = isoParaBR(l.data_inventario)
  // Sempre derivado do id da linha (nunca da coluna, que pode ter ficado vazia se o update depois do insert falhou).
  const cod = codIntRefazer(l.id)
  const tipo: 'ENT' | 'SAI' | null = n(l.quan) > 0 ? 'SAI' : n(l.quan) < 0 ? 'ENT' : null
  const feitos: string[] = []
  const parar = async (texto: string, manterPendente: boolean): Promise<RespostaRefazer> => {
    await salvar({ status: 'parado', erro: texto.slice(0, 1000), ...(manterPendente ? {} : { pendente: null }) }).catch(() => {})
    const ja = feitos.length ? ` Já feito: ${feitos.join(' ')}` : ''
    return { error: `Parei: ${texto}.${ja} Nada mais foi escrito; use "Continuar" depois de conferir.`, parado: true }
  }
  let escritas = 0
  try {
    for (let volta = 0; volta < 20; volta++) {
      const passo = proximaEscrita({ excluir: (l.excluir ?? []).map(n), excluidos: (l.excluidos ?? []).map(n), tipo, idNovo: l.id_ajuste_novo == null ? null : n(l.id_ajuste_novo), pendente: l.pendente })
      if (passo.acao === 'fim') break
      if (escritas++ > 0 && !loja.is_test) await dormir(PAUSA_MS)
      if (passo.acao === 'excluir') {
        await salvar({ pendente: { acao: 'excluir', id: passo.id, em: new Date().toISOString() } })
        const r = await excluirAjusteDetalhado(loja, passo.id)
        if (!r.ok) return parar(`o Omie ${statusAposExclusao(r.msg) === 'excluindo' ? 'não respondeu' : 'recusou'} ao excluir o ajuste ${passo.id} (${r.msg})`, true)
        await salvar({ excluidos: [...(l.excluidos ?? []), passo.id], pendente: null })
        feitos.push(`ajuste ${passo.id} excluído.`)
      } else if (passo.acao === 'conferir_inclusao') {
        const desde = Date.parse(l.pendente?.em ?? '') || 0
        if (Date.now() - desde < ESPERA_CONFERIR_MS) return parar(`o lançamento do inventário refeito ficou sem resposta do Omie há pouco; espere uns 3 minutos para o sistema conferir se ele entrou`, true)
        let lista
        try { lista = await listarAjustesDoDia(loja, dataBR, PAGINAS_CONFERIR) } catch (e) { return parar(`não deu para conferir no Omie se o ajuste novo já entrou (${msg(e)})`, true) }
        const ja = lista.ajustes.find((a) => a.cod_int_ajuste === cod)
        if (ja) await salvar({ id_ajuste_novo: n(ja.id_ajuste), pendente: null })
        else if (lista.completa) await salvar({ pendente: null })
        else return parar(`o dia ${dataBR} tem ajustes demais para conferir se ${cod} já entrou: confira no Omie`, true)
      } else {
        await salvar({ pendente: { acao: 'incluir', em: new Date().toISOString() } })
        let res
        try {
          res = await incluirAjusteComCusto(loja, {
            codigo_local_estoque: n(l.codigo_local_estoque), id_prod: n(l.id_prod), cod_int_ajuste: cod, data: dataBR,
            quan: Math.abs(n(l.quan)), valor: Number(n(l.cmc).toFixed(4)), obs: `${l.obs ?? ''} · ${user.nome ?? 'NTB Estoque'}`.slice(0, 400), origem: 'AJU', tipo: tipo!, motivo: 'INV',
          }, { model: 'RefazerInventario', semRepetir: true })
        } catch (e) {
          const m = msg(e)
          // Mesmo recusa explícita mantém a intenção: o Continuar sempre confere no Omie antes de lançar de novo.
          return parar(`o Omie ${statusAposExclusao(m) === 'excluindo' ? 'não respondeu' : 'recusou'} ao lançar o inventário refeito (${m})`, true)
        }
        if (res?.id_ajuste == null) return parar(`o Omie não devolveu o ajuste novo (${res?.descricao_status ?? 'sem resposta'})`, true)
        await salvar({ id_ajuste_novo: n(res.id_ajuste), pendente: null })
        feitos.push(`inventário refeito lançado (${tipo === 'SAI' ? 'saída' : 'entrada'} de ${fmtQ(Math.abs(n(l.quan)))}).`)
      }
    }
  } catch (e) {
    return parar(msg(e), true)
  }
  const fimDeVerdade = proximaEscrita({ excluir: (l.excluir ?? []).map(n), excluidos: (l.excluidos ?? []).map(n), tipo, idNovo: l.id_ajuste_novo == null ? null : n(l.id_ajuste_novo), pendente: l.pendente })
  if (fimDeVerdade.acao !== 'fim') return parar('passos demais numa só vez', true)
  return concluir(loja, l, tipo, user)
}

/** Omie certo: fecha o refazer e acerta o espelho local (ajustes excluídos saem, o novo entra). */
async function concluir(loja: LojaEscrita, l: Linha, tipo: 'ENT' | 'SAI' | null, user: { id: string | null; nome: string | null }): Promise<RespostaRefazer> {
  const db = createServiceClient()
  const excluidos = (l.excluidos ?? []).map(n)
  const avisos: string[] = []
  const { data: apagar, error: eSel } = await db.from('movimentos').select('id, id_ajuste, tipo, quan, data, obs').eq('loja_id', loja.id).in('id_ajuste', excluidos)
  if (eSel) avisos.push(`espelho local não lido: ${eSel.message}`)
  if (apagar?.length) {
    const { error } = await db.from('movimentos').delete().eq('loja_id', loja.id).in('id', apagar.map((x) => x.id))
    if (error) avisos.push(`ajustes excluídos ainda aparecem aqui: ${error.message}`)
  }
  const { data: jaTem } = l.id_ajuste_novo != null
    ? await db.from('movimentos').select('id').eq('loja_id', loja.id).eq('id_ajuste', l.id_ajuste_novo).limit(1)
    : { data: [] as { id: number }[] }
  if (l.id_ajuste_novo != null && tipo && !jaTem?.length) {
    const { error } = await db.from('movimentos').insert({
      loja_id: loja.id, tipo, origem: 'AJU', motivo: 'INV', data: dataCriacaoBahia(l.data_inventario), id_prod: l.id_prod,
      codigo_local_estoque: l.codigo_local_estoque, quan: tipo === 'SAI' ? -Math.abs(n(l.quan)) : Math.abs(n(l.quan)), valor: l.cmc,
      obs: l.obs, status: 'Concluido', id_ajuste: l.id_ajuste_novo, cod_int_ajuste: codIntRefazer(l.id), origem_ajuste: 'app', autor: user.nome,
    })
    if (error) avisos.push(`ajuste novo ainda não aparece aqui: ${error.message}`)
  }
  const { error: eFim } = await db.from('estoque_refazer_inventario').update({ status: 'concluido', erro: avisos.length ? avisos.join('; ').slice(0, 1000) : null, apagados_local: apagar ?? [], updated_at: new Date().toISOString() }).eq('id', l.id)
  if (eFim) console.error(`[refazer-inventario] ${l.id}: concluído no Omie, status não gravado: ${eFim.message}`)
  if (avisos.length) console.error(`[refazer-inventario] ${l.id}: ${avisos.join('; ')}`)
  await registrarAuditoria('editar', 'inventário', l.id_ajuste_inventario,
    `${loja.is_test ? '[simulado] ' : ''}inventário de ${isoParaBR(l.data_inventario)} refeito (${l.modo}): ajustes ${excluidos.join(', ')} excluídos${l.id_ajuste_novo ? `, lançado ${l.id_ajuste_novo}` : ', nada lançado'}`)
  return {
    ok: true, passos: l.passos ?? [],
    aviso: loja.is_test ? 'Loja de teste: refazer simulado, nada foi enviado ao Omie.' : `Inventário de ${isoParaBR(l.data_inventario)} refeito no Omie.`,
  }
}
