'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

// Central de correções (14/10/2026): estado dos problemas, "não controla estoque", lançar OP (preparo, prato, cupom)
// e o painel sob demanda. As outras correções chamam as ações de sempre da Fase 4 (ajusteOmie, acaoOPLote,
// corrigirCustoAjuste), que conferem as próprias permissões.

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { contextoEscritaOmie } from '@/lib/estoque/contexto-escrita-omie'
import { registrarAuditoria } from '@/lib/auditoria'
import { ajusteOmie } from '@/lib/actions/estoque-omie'
import { lancarOPCentral, type RespostaCentral } from '@/lib/correcoes/op-central'
import { carregarPainelDados, type AlvoPainel, type PainelDados } from '@/lib/correcoes/painel-dados'
import type { EstadoProblema } from '@/lib/correcoes/central-puro'


const ESTADOS: EstadoProblema[] = ['aberto', 'resolvido', 'ramon', 'ignorado']
const CHAVE = /^[a-z]+:[a-z]+:[A-Za-z0-9:._-]{1,80}$/
const texto = (s: string | null | undefined, max: number) => (s == null ? null : String(s).trim().slice(0, max) || null)

async function quem() {
  const user = await getUser()
  if (!user) return { id: null, nome: null }
  const { data } = await createServiceClient().from('profiles').select('name').eq('id', user.id).maybeSingle()
  return { id: user.id, nome: (data?.name as string | null) ?? null }
}

/** Grava o estado de um problema (resolvido, esperando Ramon, ignorado ou reaberto). Nada vai ao Omie. */
export async function marcarEstadoProblema(i: {
  chave: string; estado: EstadoProblema; motivo?: string | null; mensagem?: string | null; acao?: string | null; ate?: string | null; assinatura?: string | null
}): Promise<RespostaCentral> {
  const __d = viaDesktop('central#marcarEstadoProblema', marcarEstadoProblema, [i]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return { error: 'Sem permissão.' }
  if (!CHAVE.test(i.chave ?? '')) return { error: 'Problema inválido.' }
  if (!ESTADOS.includes(i.estado)) return { error: 'Estado inválido.' }
  if (i.ate != null && !/^\d{4}-\d{2}-\d{2}$/.test(i.ate)) return { error: 'Data inválida.' }
  if (i.estado === 'ramon' && !texto(i.mensagem, 2000)) return { error: 'Escreva a mensagem para o Ramon.' }
  const u = await quem()
  const { error } = await createServiceClient().from('central_problema_estado').upsert({
    loja_id: lojaId, chave: i.chave, estado: i.estado, motivo: texto(i.motivo, 500), mensagem: texto(i.mensagem, 2000), acao: texto(i.acao, 300),
    ate: i.estado === 'ignorado' ? (i.ate ?? null) : null, assinatura: texto(i.assinatura, 200), user_id: u.id, user_nome: u.nome,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'loja_id,chave' })
  if (error) return { error: /does not exist|42P01/.test(error.message) ? 'A Central ainda não foi ativada neste banco (migration 171).' : `Não foi possível guardar: ${error.message}` }
  revalidatePath('/estoque/correcoes')
  return { ok: true, aviso: i.estado === 'ramon' ? 'Pedido guardado: fica "Esperando Ramon" (nada foi enviado).' : i.estado === 'aberto' ? 'Reaberto.' : 'Guardado.' }
}

/** Marca (ou desmarca) um produto como "não controla estoque": só aqui, o cadastro do Omie não muda. */
export async function marcarNaoControla(i: { codigoProduto: number; motivo?: string | null; desfazer?: boolean }): Promise<RespostaCentral> {
  const __d = viaDesktop('central#marcarNaoControla', marcarNaoControla, [i]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return { error: 'Sem permissão.' }
  const db = createServiceClient()
  const { data: p } = await db.from('produtos').select('codigo_produto, descricao').eq('loja_id', lojaId).eq('codigo_produto', i.codigoProduto).maybeSingle()
  if (!p) return { error: 'Produto não encontrado nesta loja.' }
  const u = await quem()
  const { error } = i.desfazer
    ? await db.from('estoque_nao_controla').delete().eq('loja_id', lojaId).eq('codigo_produto', i.codigoProduto)
    : await db.from('estoque_nao_controla').upsert({ loja_id: lojaId, codigo_produto: i.codigoProduto, motivo: texto(i.motivo, 300), user_id: u.id, user_nome: u.nome }, { onConflict: 'loja_id,codigo_produto' })
  if (error) return { error: /does not exist|42P01/.test(error.message) ? 'A Central ainda não foi ativada neste banco (migration 171).' : `Não foi possível guardar: ${error.message}` }
  await registrarAuditoria('editar', 'produto', i.codigoProduto, `${p.descricao}: ${i.desfazer ? 'volta a controlar estoque' : 'não controla estoque'} (Central de correções)`)
  revalidatePath('/estoque/correcoes')
  return { ok: true, aviso: i.desfazer ? 'Voltou a aparecer na Central.' : 'Marcado: sai da Central (o Omie não muda).' }
}

/**
 * Lança uma OP pela Central (preparo/prato com quantidade e data escolhidas, ou o item de um cupom sem OP) e
 * conclui. Escreve no Omie: Correcoes - Executar + Ordens de Producao - Criar/Concluir; loja 4 bloqueada; loja de
 * teste simulada. Uma OP por chamada (a tela chama em sequência e para no primeiro bloqueio do Omie).
 */
export async function lancarOPCorrecao(i: {
  origem: 'cupom' | 'correcao'; codigoProduto: number; quantidade: number; dataISO: string; nIdCupom?: number | null; confirmarMesFechado?: boolean
  chave?: string | null; assinatura?: string | null; acao?: string | null
}): Promise<RespostaCentral> {
  const __d = viaDesktop('central#lancarOPCorrecao', lancarOPCorrecao, [i]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie('Correcoes - Executar', 'Ordens de Producao - Criar', 'Ordens de Producao - Concluir')
  if ('error' in ctx) return { error: ctx.error, parar: true }
  if (i.origem !== 'cupom' && i.origem !== 'correcao') return { error: 'Pedido inválido.' }
  const r = await lancarOPCentral(ctx, { origem: i.origem, codigoProduto: Number(i.codigoProduto), quantidade: Number(i.quantidade), dataISO: String(i.dataISO ?? ''), nIdCupom: i.nIdCupom == null ? null : Number(i.nIdCupom), confirmarMesFechado: i.confirmarMesFechado === true })
  revalidatePath('/estoque/correcoes')
  revalidatePath('/ordem-producao')
  return r
}

/** Dados do painel lateral (só leitura). */
export async function carregarPainel(alvo: AlvoPainel): Promise<PainelDados | { error: string }> {
  const __d = viaDesktop('central#carregarPainel', carregarPainel, [alvo]); if (__d) return __d as never
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return { error: 'Sem permissão.' }
  if (!['produto', 'op', 'nota', 'cupom', 'ajuste'].includes(alvo?.tipo) || !Number.isFinite(Number(alvo?.id))) return { error: 'Item inválido.' }
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'omie' && modo !== 'proprio') return { error: 'Esta loja não controla estoque.' }
  try {
    return await carregarPainelDados(lojaId, modo, { tipo: alvo.tipo, id: Number(alvo.id) })
  } catch (e) {
    return { error: `Não foi possível carregar: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * Corrige uma contagem de inventário digitada errado (ex.: 4.658 kg no lugar de 4,658 kg) lançando a diferença no Omie.
 * A contagem vem do banco (movimentos SLD), nunca da tela; trava por movimento: a marca `cc:mov:<id>` em
 * central_problema_estado é única, então a mesma contagem nunca é corrigida duas vezes (duas abas, reenvio, problema
 * que reaparece). Achado C2 da revisão final.
 */
export async function corrigirContagemCentral(i: { movimentoId: number; para: number }): Promise<RespostaCentral> {
  const __d = viaDesktop('central#corrigirContagemCentral', corrigirContagemCentral, [i]); if (__d) return __d as never
  const ctx = await contextoEscritaOmie('Correcoes - Executar')
  if ('error' in ctx) return { error: ctx.error }
  const para = Number(i.para)
  if (!Number.isFinite(para) || para < 0) return { error: 'Informe a contagem certa (zero ou mais).' }
  const db = createServiceClient()
  const { data: m } = await db.from('movimentos').select('id, tipo, quan, data, id_prod, codigo_local_estoque').eq('loja_id', ctx.lojaId).eq('id', Number(i.movimentoId)).maybeSingle()
  if (!m || m.tipo !== 'SLD') return { error: 'Contagem não encontrada nesta loja.' }
  const dif = Math.round((para - Number(m.quan)) * 1e6) / 1e6
  if (dif === 0) return { error: 'É a mesma contagem: nada a corrigir.' }
  const u = await quem()
  const chave = `cc:mov:${m.id}`
  const ins = await db.from('central_problema_estado').insert({
    loja_id: ctx.lojaId, chave, estado: 'resolvido', acao: `Contagem corrigida de ${m.quan} para ${para}`, mensagem: String(dif), user_id: u.id, user_nome: u.nome,
  })
  if (ins.error) {
    if (ins.error.code === '23505') {
      const { data: j } = await db.from('central_problema_estado').select('user_nome, atualizado_em').eq('loja_id', ctx.lojaId).eq('chave', chave).maybeSingle()
      return { error: `Esta contagem já foi corrigida${j?.user_nome ? ` por ${j.user_nome}` : ''}. Nada foi lançado de novo.` }
    }
    return { error: /does not exist|42P01/.test(ins.error.message) ? 'A Central ainda não foi ativada neste banco (migration 171).' : `Não foi possível registrar: ${ins.error.message}` }
  }
  const r = await ajusteOmie({ codigoProduto: Number(m.id_prod), codigoLocal: Number(m.codigo_local_estoque), motivo: `Central de correções: contagem corrigida (${m.quan} → ${para})`, diferenca: String(dif) })
  if ('error' in r) {
    // Nada foi gravado: libera para tentar de novo.
    await db.from('central_problema_estado').delete().eq('loja_id', ctx.lojaId).eq('chave', chave)
    return { error: r.error }
  }
  revalidatePath('/estoque/correcoes')
  return { ok: true, aviso: r.aviso ?? 'Contagem corrigida no Omie.' }
}
