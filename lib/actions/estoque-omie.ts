'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// "Nosso Omie" Fase 4: escrever no Omie pelas telas de estoque da loja Omie. Reaproveita as actions de sempre
// (criarAjusteManual, transferência), que leem o CMC ao vivo. Loja 4 bloqueada; loja de teste = escrita simulada.

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getUser } from '@/lib/auth'
import { contextoEscritaOmie, type LojaEscrita } from '@/lib/estoque/contexto-escrita-omie'
import {
  codIntCorrecao, decidirRelancamento, deltaDoAjuste, isoParaBR, mesDoAjusteFechado, motivoNaoCorrige, proximaEtapaCorrecao,
  respostaDoLancamento, statusAposExclusao, validarCustoNovo, type RespostaLancamento,
} from '@/lib/estoque/escrita-omie-puro'
import { diaDoMovimento } from '@/lib/estoque/quem-mexeu-puro'
import { excluirAjusteDetalhado, incluirAjusteComCusto, listarAjustesDoDia } from '@/lib/omie/ajuste'
import { registrarAuditoria } from '@/lib/auditoria'
import { formatCustoUnit } from '@/lib/num-br'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { dataOmieBR, hojeBahiaISO } from '@/lib/data-bahia'
import { criarAjusteManual } from '@/lib/actions/movimentacoes'
import { addMovimento, createTransferencia, enviarMovimento, finishTransferencia, salvarObservacaoTransferencia } from '@/lib/actions/transferencia'

type Resposta = RespostaLancamento

const PERM = 'Estoque - Lancar no Omie'

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function atualizarTelas() {
  revalidatePath('/estoque')
  revalidatePath('/estoque/produto/[codigo]', 'page')
  revalidatePath('/estoque/local/[codigo]', 'page')
  revalidatePath('/estoque/ajustes')
  revalidatePath('/movimentacoes')
}

/** Entrada no Omie (ENT) pelo custo médio atual do produto (lido na hora). */
export async function entradaOmie(dados: { codigoProduto: number; codigoLocal: number; quantidade: number | string; obs?: string }): Promise<Resposta> {
  const __d = viaDesktop('estoque-omie#entradaOmie', entradaOmie, [dados]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM, 'Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  const quantidade = numero(dados.quantidade)
  if (quantidade == null || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }
  const r = await criarAjusteManual({
    idProd: dados.codigoProduto, tipo: 'ENT', codigoLocalEstoque: dados.codigoLocal, quantidade,
    motivo: dados.obs?.trim() || 'Entrada pela tela de estoque',
  })
  atualizarTelas()
  return respostaDoLancamento(r as { error?: string; status?: string; erro?: string; id?: number }, ctx.loja.is_test ? 'Loja de teste: lançamento simulado, nada foi enviado ao Omie.' : 'Lançada no Omie.')
}

/**
 * Ajuste no Omie: "saldo contado" (lê o saldo do local ao vivo no Omie e lança a diferença) ou "diferença"
 * (+ sobra, − falta). Vira uma entrada ou saída pelo custo médio atual.
 */
export async function ajusteOmie(dados: {
  codigoProduto: number; codigoLocal: number; motivo: string; novoSaldo?: number | string | null; diferenca?: number | string | null
}): Promise<Resposta> {
  const __d = viaDesktop('estoque-omie#ajusteOmie', ajusteOmie, [dados]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM, 'Movimentacoes - Criar')
  if ('error' in ctx) return ctx
  if (!dados.motivo?.trim()) return { error: 'Informe o motivo do ajuste.' }
  const contagem = dados.novoSaldo != null && String(dados.novoSaldo).trim() !== ''
  const valor = numero(contagem ? dados.novoSaldo : dados.diferenca)
  if (valor == null) return { error: 'Valor inválido.' }
  let saldoAtual = 0
  if (contagem) {
    try {
      const pos = await getPosicaoProduto(ctx.loja, dados.codigoLocal, dados.codigoProduto, dataOmieBR(null))
      saldoAtual = pos?.n_saldo ?? 0
    } catch (e) {
      return { error: `Não foi possível ler o saldo atual no Omie: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const d = deltaDoAjuste({ modo: contagem ? 'contagem' : 'diferenca', valor, saldoAtual })
  if ('erro' in d) return { error: d.erro }
  const r = await criarAjusteManual({
    idProd: dados.codigoProduto, tipo: d.tipo, codigoLocalEstoque: dados.codigoLocal, quantidade: d.quantidade, motivo: dados.motivo.trim(),
  })
  atualizarTelas()
  const feito = `${d.tipo === 'ENT' ? 'Entrada' : 'Saída'} de ${d.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${contagem ? ` (saldo no Omie era ${saldoAtual.toLocaleString('pt-BR', { maximumFractionDigits: 3 })})` : ''}`
  return respostaDoLancamento(r as { error?: string; status?: string; erro?: string; id?: number }, ctx.loja.is_test ? `Loja de teste: ${feito} simulada, nada foi enviado ao Omie.` : `${feito} lançada no Omie.`)
}

/**
 * Transferência de um produto entre dois locais no Omie: cria a transferência, o item e envia na hora (mesmo
 * caminho da tela de Transferências: TRF pelo custo médio). Se o Omie não confirmar, ela fica pendente lá e o
 * cron reenvia; só fecha (sem nova chamada ao Omie) quando o item concluiu.
 */
export async function transferirOmie(dados: { codigoProduto: number; de: number; para: number; quantidade: number | string; obs?: string }): Promise<Resposta> {
  const __d = viaDesktop('estoque-omie#transferirOmie', transferirOmie, [dados]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM, 'Transferencias - Criar', 'Transferencias - Editar')
  if ('error' in ctx) return ctx
  if (dados.de === dados.para) return { error: 'Origem e destino não podem ser o mesmo local.' }
  const quantidade = numero(dados.quantidade)
  if (quantidade == null || quantidade <= 0) return { error: 'Informe uma quantidade maior que zero.' }

  const t = await createTransferencia({ codigoLocalOrigem: dados.de, codigoLocalDestino: dados.para, tipo: 'TRF' })
  if ('error' in t && t.error) return { error: t.error }
  const id = (t as { id?: number }).id
  if (!id) return { error: 'Não foi possível criar a transferência.' }
  if (dados.obs?.trim()) await salvarObservacaoTransferencia(id, dados.obs)
  const mov = await addMovimento(id, { id_prod: dados.codigoProduto })
  if (!mov?.id) return { error: `Transferência ${id} criada, mas o item não foi gravado. Termine pela tela de Transferências.` }
  const envio = await enviarMovimento(mov.id, quantidade)
  atualizarTelas()
  revalidatePath('/transferencia')
  if (envio.status === 'Concluido') {
    await finishTransferencia(id)
    return { ok: true, aviso: ctx.loja.is_test ? 'Loja de teste: transferência simulada, nada foi enviado ao Omie.' : 'Transferida no Omie.' }
  }
  // Gravada: o item fica pendente e o cron reenvia. Devolver erro levaria a pessoa a transferir de novo (duplicaria).
  if (envio.status === 'Sem CMC') return { ok: true, alerta: true, aviso: `Transferência ${id} gravada, mas o produto está sem custo médio no Omie: fica pendente e o sistema reenvia sozinho. NÃO transfira de novo.` }
  return { ok: true, alerta: true, aviso: `Transferência ${id} gravada, mas o Omie não confirmou (${envio.descricao_status ?? envio.error ?? envio.status}). O sistema tenta de novo: NÃO transfira de novo; acompanhe em Transferências.` }
}

// ---------------------------------------------------------------------------------------------------------------
// Corrigir o custo de um ajuste: excluir o ajuste no Omie e relançar igual (produto, local, quantidade, data, tipo)
// com o custo novo. Trava e registro em estoque_correcao_custo (migration 162): uma correção em andamento por ajuste;
// se o relançamento falhar depois da exclusão, fica 'pendente_relancar' para o "Refazer" (que procura o
// cod_int_ajuste CUSTO-<id> no Omie antes de incluir de novo, para nunca duplicar).

const PERM_CUSTO = 'Estoque - Corrigir custo'
const MOTIVOS_OMIE = new Set(['INV', 'OPS', 'PER', 'PDV'])
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e))

export type RespostaCusto = { ok: true; aviso: string } | { error: string; precisaConfirmarMesFechado?: boolean; pendente?: boolean }

type MovRow = {
  id: number; id_prod: number; tipo: string; quan: number | null; valor: number | null; codigo_local_estoque: number | null
  data: string; motivo: string | null; obs: string | null; origem: string | null; transferencia_id: number | null
  id_ajuste: number | null; cod_int_ajuste?: string | null; origem_ajuste?: string | null
}
type CorrecaoRow = {
  id: number; loja_id: number; movimento_id: number; id_ajuste_antigo: number; id_prod: number; codigo_local_estoque: number
  tipo: 'ENT' | 'SAI'; quantidade: number; data_ajuste: string; motivo: string | null; obs_original: string | null
  custo_antigo: number | null; custo_novo: number; status: string; updated_at: string
}
const COLS_CORRECAO = 'id, loja_id, movimento_id, id_ajuste_antigo, id_prod, codigo_local_estoque, tipo, quantidade, data_ajuste, motivo, obs_original, custo_antigo, custo_novo, status, updated_at'

function telasDeAjuste() {
  revalidatePath('/estoque/ajustes')
  revalidatePath('/estoque/produto/[codigo]', 'page')
  revalidatePath('/movimentacoes')
}

async function marcar(id: number, status: string, extra: Record<string, unknown> = {}) {
  const { error } = await createServiceClient().from('estoque_correcao_custo').update({ status, updated_at: new Date().toISOString(), ...extra }).eq('id', id)
  if (error) console.error(`[correcao-custo] ${id} → ${status}: ${error.message}`)
}

/** Depois que o ajuste novo existe no Omie: fecha a correção e aponta a linha de movimentos para ele. */
async function finalizarCorrecao(loja: LojaEscrita, c: CorrecaoRow, idNovo: number, obs: string): Promise<RespostaCusto> {
  const svc = createServiceClient()
  await marcar(c.id, 'concluido', { id_ajuste_novo: idNovo, erro: null })
  const agora = new Date().toISOString()
  let { error } = await svc.from('movimentos')
    .update({ id_ajuste: idNovo, valor: c.custo_novo, obs, cod_int_ajuste: codIntCorrecao(c.id), updated_at: agora })
    .eq('id', c.movimento_id).eq('loja_id', c.loja_id)
  if (error && /cod_int_ajuste/.test(error.message)) {
    // Sem a migration 160 (coluna cod_int_ajuste).
    ({ error } = await svc.from('movimentos').update({ id_ajuste: idNovo, valor: c.custo_novo, obs, updated_at: agora }).eq('id', c.movimento_id).eq('loja_id', c.loja_id))
  }
  if (error?.code === '23505') {
    // O sync-ajustes já trouxe o ajuste novo numa linha própria: a linha antiga (ajuste excluído) sai.
    ({ error } = await svc.from('movimentos').delete().eq('id', c.movimento_id).eq('loja_id', c.loja_id))
  }
  if (error) await marcar(c.id, 'concluido', { id_ajuste_novo: idNovo, erro: `Omie certo; tela de ajustes não atualizada: ${error.message}` })
  await registrarAuditoria('editar', 'ajuste de estoque', idNovo,
    `${loja.is_test ? '[simulado] ' : ''}custo corrigido de ${formatCustoUnit(c.custo_antigo)} para ${formatCustoUnit(c.custo_novo)} (ajuste ${c.id_ajuste_antigo} excluído, relançado como ${idNovo})`)
  telasDeAjuste()
  return { ok: true, aviso: loja.is_test ? 'Loja de teste: correção simulada, nada foi enviado ao Omie.' : 'Custo corrigido no Omie (ajuste excluído e relançado).' }
}

/** Relança o ajuste com o custo novo (o antigo já foi excluído). Com `procurarAntes`, acha um relançamento anterior pelo código. */
async function relancar(loja: LojaEscrita, c: CorrecaoRow, procurarAntes: boolean): Promise<RespostaCusto> {
  const dataBR = isoParaBR(c.data_ajuste)
  const obs = `${await carimboUsuario()} | custo corrigido de ${formatCustoUnit(c.custo_antigo)} para ${formatCustoUnit(c.custo_novo)} | ${c.obs_original ?? ''}`.slice(0, 400)
  const pendente = async (motivo: string): Promise<RespostaCusto> => {
    await marcar(c.id, 'pendente_relancar', { erro: motivo.slice(0, 1000) })
    telasDeAjuste()
    return {
      error: `O ajuste antigo FOI EXCLUÍDO no Omie, mas o novo não entrou (${motivo}). O estoque está sem esse lançamento: a correção ficou em "Correções pendentes" nesta tela; use Refazer.`,
      pendente: true,
    }
  }
  if (procurarAntes && !loja.is_test) {
    try {
      const { ajustes, completa } = await listarAjustesDoDia(loja, dataBR)
      const ja = ajustes.find((a) => a.cod_int_ajuste === codIntCorrecao(c.id))
      const passo = decidirRelancamento({ achado: !!ja, completa })
      if (passo === 'finalizar') return finalizarCorrecao(loja, c, Number(ja!.id_ajuste), obs)
      if (passo === 'parar') return pendente(`o dia tem ajustes demais para conferir se ${codIntCorrecao(c.id)} já entrou: confira no Omie antes de refazer`)
    } catch (e) {
      return pendente(`não deu para conferir no Omie se já foi relançado: ${msgDe(e)}`)
    }
    await dormir(1000)
  }
  let res
  try {
    res = await incluirAjusteComCusto(loja, {
      codigo_local_estoque: c.codigo_local_estoque, id_prod: c.id_prod, cod_int_ajuste: codIntCorrecao(c.id), data: dataBR,
      quan: Math.abs(Number(c.quantidade)), valor: Number(c.custo_novo), obs, origem: 'AJU', tipo: c.tipo,
      motivo: c.motivo && MOTIVOS_OMIE.has(c.motivo) ? c.motivo : c.tipo,
    })
  } catch (e) {
    return pendente(msgDe(e))
  }
  if (res.id_ajuste == null) return pendente(res.descricao_status ?? 'o Omie não devolveu o id do ajuste')
  return finalizarCorrecao(loja, c, Number(res.id_ajuste), obs)
}

export async function corrigirCustoAjuste(input: {
  movimentoId: number; custoNovo: number; custoAtualVisto: number; confirmarMesFechado?: boolean
}): Promise<RespostaCusto> {
  const __d = viaDesktop('estoque-omie#corrigirCustoAjuste', corrigirCustoAjuste, [input]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM_CUSTO)
  if ('error' in ctx) return ctx
  const { loja, lojaId } = ctx
  const svc = createServiceClient()
  const base = 'id, id_prod, tipo, quan, valor, codigo_local_estoque, data, motivo, obs, origem, transferencia_id, id_ajuste'
  const lerMov = (cols: string) => svc.from('movimentos').select(cols).eq('id', input.movimentoId).eq('loja_id', lojaId)
    .maybeSingle() as unknown as PromiseLike<{ data: MovRow | null; error: { message: string } | null }>
  let { data: mov, error } = await lerMov(`${base}, cod_int_ajuste, origem_ajuste`)
  if (error) ({ data: mov, error } = await lerMov(base))
  if (error || !mov) return { error: 'Ajuste não encontrado nesta loja.' }

  const naoPode = motivoNaoCorrige({
    tipo: mov.tipo, id_ajuste: mov.id_ajuste == null ? null : Number(mov.id_ajuste), transferencia_id: mov.transferencia_id,
    cod_int_ajuste: mov.cod_int_ajuste ?? null, origem: mov.origem, motivo: mov.motivo, origem_ajuste: mov.origem_ajuste ?? null,
    quan: mov.quan == null ? null : Number(mov.quan), valor: mov.valor == null ? null : Number(mov.valor),
    codigo_local_estoque: mov.codigo_local_estoque == null ? null : Number(mov.codigo_local_estoque),
  }, { aceitaIdSimulado: loja.is_test })
  if (naoPode) return { error: naoPode }
  const custoAtual = Number(mov.valor ?? 0)
  if (!Number.isFinite(input.custoAtualVisto) || Math.abs(custoAtual - input.custoAtualVisto) > 1e-6) {
    return { error: 'O custo deste ajuste mudou desde que a tela abriu. Atualize a página e confira.' }
  }
  const invalido = validarCustoNovo(Number(input.custoNovo), custoAtual)
  if (invalido) return { error: invalido }
  const dataISO = diaDoMovimento(String(mov.data))
  const fechado = mesDoAjusteFechado(dataISO, hojeBahiaISO(), process.env.ESTOQUE_MES_FECHADO_ATE ?? null)
  if (fechado && input.confirmarMesFechado !== true) {
    return { error: `O mês deste ajuste (${dataISO.slice(5, 7)}/${dataISO.slice(0, 4)}) já foi enviado à contabilidade. Confirme de novo para corrigir mesmo assim.`, precisaConfirmarMesFechado: true }
  }

  const tipo = mov.tipo as 'ENT' | 'SAI'
  const quantidade = Math.abs(Number(mov.quan))
  const idAntigo = Number(mov.id_ajuste)
  const user = await getUser()
  const { data: perfil } = await svc.from('profiles').select('name').eq('id', user.id).maybeSingle<{ name: string | null }>()
  const { data: corr, error: eIns } = await svc.from('estoque_correcao_custo').insert({
    loja_id: lojaId, movimento_id: mov.id, id_ajuste_antigo: idAntigo, id_prod: mov.id_prod,
    codigo_local_estoque: mov.codigo_local_estoque, tipo, quantidade, data_ajuste: dataISO, motivo: mov.motivo, obs_original: mov.obs,
    custo_antigo: custoAtual, custo_novo: Number(input.custoNovo), mes_fechado: fechado, status: 'excluindo',
    user_id: user.id, user_nome: perfil?.name ?? null,
  }).select(COLS_CORRECAO).single<CorrecaoRow>()
  if (eIns || !corr) {
    if (eIns?.code === '23505') return { error: 'Já existe uma correção de custo em andamento para este ajuste (outra aba ou pessoa). Veja "Correções pendentes".' }
    if (eIns?.code === '42P01' || /estoque_correcao_custo/.test(eIns?.message ?? '')) return { error: 'Correção de custo ainda não ativada nesta instalação (migration 162 pendente).' }
    return { error: `Não foi possível registrar a correção: ${eIns?.message ?? 'erro desconhecido'}` }
  }

  // Confere o ajuste no Omie antes de excluir (loja de teste: o ajuste é simulado, não existe no Omie real).
  if (!loja.is_test) {
    try {
      const { ajustes, completa } = await listarAjustesDoDia(loja, isoParaBR(dataISO))
      const a = ajustes.find((x) => Number(x.id_ajuste) === idAntigo)
      if (!a) {
        const m = completa ? 'O ajuste não está no Omie nesse dia (já foi excluído ou mudou de data).' : 'Não achei o ajuste nas 150 primeiras linhas do dia no Omie.'
        await marcar(corr.id, 'cancelada', { erro: m })
        return { error: `${m} Nada foi mudado.` }
      }
      const igual = Number(a.id_prod) === Number(mov.id_prod) && Number(a.codigo_local_estoque) === Number(mov.codigo_local_estoque)
        && a.tipo === tipo && Math.abs(Math.abs(Number(a.quantidade)) - quantidade) < 1e-6 && Math.abs(Number(a.valor) - custoAtual) < 0.005
      if (!igual) {
        const m = `O ajuste no Omie está diferente do que esta tela mostra (quantidade ${a.quantidade}, custo ${a.valor}).`
        await marcar(corr.id, 'cancelada', { erro: m })
        return { error: `${m} Nada foi mudado; espere a próxima leitura dos ajustes e confira.` }
      }
    } catch (e) {
      await marcar(corr.id, 'cancelada', { erro: msgDe(e) })
      return { error: `Não foi possível conferir o ajuste no Omie: ${msgDe(e)}. Nada foi mudado.` }
    }
    await dormir(1000)
  }

  const exc = await excluirAjusteDetalhado(loja, idAntigo)
  if (!exc.ok) {
    const st = statusAposExclusao(exc.msg)
    await marcar(corr.id, st, { erro: `ExcluirAjusteEstoque: ${exc.msg}`.slice(0, 1000) })
    telasDeAjuste()
    return st === 'falha_exclusao'
      ? { error: `O Omie recusou excluir o ajuste (${exc.msg}). Nada foi mudado.` }
      : { error: `O Omie não respondeu à exclusão (${exc.msg}): o ajuste pode ter sido excluído. A correção ficou em "Correções pendentes"; em 10 minutos use Refazer (ele confere no Omie antes de relançar).`, pendente: true }
  }
  await marcar(corr.id, 'relancando')
  if (!loja.is_test) await dormir(1000)
  return relancar(loja, corr, false)
}

/** "Refazer" de uma correção parada: relança (procurando antes o CUSTO-<id> no Omie) ou confere se a exclusão aconteceu. */
export async function relancarCorrecaoCusto(correcaoId: number): Promise<RespostaCusto> {
  const __d = viaDesktop('estoque-omie#relancarCorrecaoCusto', relancarCorrecaoCusto, [correcaoId]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie(PERM_CUSTO)
  if ('error' in ctx) return ctx
  const { loja, lojaId } = ctx
  const svc = createServiceClient()
  const { data: c, error } = await svc.from('estoque_correcao_custo').select(COLS_CORRECAO).eq('id', correcaoId).eq('loja_id', lojaId).maybeSingle<CorrecaoRow>()
  if (error || !c) return { error: 'Correção não encontrada.' }
  const etapa = proximaEtapaCorrecao(c.status, c.updated_at, Date.now())
  if (!etapa) return { error: c.status === 'concluido' ? 'Esta correção já foi concluída.' : 'Esta correção está em andamento agora. Espere alguns minutos.' }
  // Reivindica a linha: só um "Refazer" passa (o update condicional pelo status e pelo updated_at lidos).
  const { data: pega } = await svc.from('estoque_correcao_custo')
    .update({ status: 'relancando', updated_at: new Date().toISOString() })
    .eq('id', c.id).eq('status', c.status).eq('updated_at', c.updated_at).select('id')
  if (!pega?.length) return { error: 'Outra pessoa já está refazendo esta correção.' }

  if (etapa === 'verificar_exclusao' && !loja.is_test) {
    try {
      const { ajustes, completa } = await listarAjustesDoDia(loja, isoParaBR(c.data_ajuste))
      if (ajustes.some((a) => Number(a.id_ajuste) === Number(c.id_ajuste_antigo))) {
        await marcar(c.id, 'cancelada', { erro: 'o ajuste antigo ainda existe no Omie: a exclusão não aconteceu' })
        telasDeAjuste()
        return { error: 'O ajuste antigo ainda está no Omie (a exclusão não aconteceu). Nada foi mudado; corrija de novo se quiser.' }
      }
      if (!completa) {
        await marcar(c.id, c.status === 'excluindo' ? 'excluindo' : 'pendente_relancar', { erro: 'dia com muitos ajustes: não deu para conferir' })
        return { error: 'O dia tem ajustes demais para conferir pela tela. Confira no Omie antes de refazer.' }
      }
    } catch (e) {
      await marcar(c.id, 'excluindo', { erro: msgDe(e) })
      return { error: `Não foi possível conferir no Omie: ${msgDe(e)}` }
    }
    await dormir(1000)
  }
  return relancar(loja, c, true)
}
