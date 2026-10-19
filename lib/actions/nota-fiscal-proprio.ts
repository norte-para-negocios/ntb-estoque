'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { travaDaCompraLancada } from '@/lib/estoque/periodo-fechado'
import { criarProdutoProprio } from '@/lib/estoque/proprio-driver'
import { espelharNotaNoFrio } from '@/lib/estoque/nf-frio'
import { localPadraoEntrada } from '@/lib/estoque/nf-sefaz'
import { importarNotaPorChave, sincronizarSefaz } from '@/lib/estoque/sefaz-sync'
import { lerCte, ratearFreteCte, validarCteImportado } from '@/lib/estoque/cte-xml'
import { carregarCmc } from '@/lib/estoque/nf-memoria'
import { carregarCredencialLoja } from '@/lib/estoque/sefaz-certificado'
import { enviarManifestacao } from '@/lib/estoque/sefaz-rede'
import { decidirEnvioManifestacao, ehTipoManifestacao, resultadoManifestacao, validarJustificativa, type EstadoManifestacao, type TipoManifestacao } from '@/lib/estoque/sefaz-manifestacao'
import { avaliarItemCompra, decidirConferencia, flagsParaTexto, validarConfigItem, type AlertaItem, type ConfigItemNF, type ItemCompraGravado } from '@/lib/estoque/nf-item-regras'
import { decidirConfirmacaoEntrada, resultadoLancamento } from '@/lib/estoque/nf-entrada'

// Ações da tela de Notas Fiscais em loja de estoque próprio (sem Omie): conferir itens, confirmar a entrada, desfazer e excluir.

type Ctx = { lojaId: number; userId: string | null }

async function contexto(permissao: string): Promise<Ctx | { error: string }> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const user = await getUser()
  return { lojaId, userId: user?.id ?? null }
}

async function atualizarSituacao(lojaId: number, notaId: number) {
  await createServiceClient().rpc('sincronizar_situacao_nota', { p_loja: lojaId, p_nota: notaId })
  void espelharNotaNoFrio(lojaId, notaId)
  revalidatePath(`/nota-fiscal/${notaId}`)
  revalidatePath('/nota-fiscal')
  revalidatePath('/estoque')
}

async function compraDaNota(lojaId: number, notaId: number) {
  const { data } = await createServiceClient().from('compras_proprio').select('id, status, numero, codigo_local_estoque, conferida_em').eq('loja_id', lojaId).eq('nota_fiscal_id', notaId).maybeSingle()
  return data
}

/** 'Confirmar entrada': lança no estoque os itens já ligados a produto (os demais ficam pendentes e a nota fica parcial).
 *  Refaz no servidor os avisos de cada item (fator, custo, valor zero): com aviso, só entra com "Conferi os avisos" agora
 *  ou com a nota conferida depois da última mudança (mesma regra do marcarConferidaNF). Compra com a entrada desfeita
 *  (reaberta) entra de novo por aqui. */
export async function confirmarEntradaNF(notaId: number, codigoLocal?: number | null, opts?: { aceitarAvisos?: boolean }): Promise<{ ok: true; lancados: number; pendentes: number; status: string } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#confirmarEntradaNF', confirmarEntradaNF, [notaId, codigoLocal, opts]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota ainda não tem itens para conferir (só o resumo chegou da SEFAZ).' }
  if (compra.status === 'cancelada') return { error: 'Nota cancelada na SEFAZ ou excluída: não entra no estoque.' }
  const local = codigoLocal ?? (compra.codigo_local_estoque != null ? Number(compra.codigo_local_estoque) : await localPadraoEntrada(ctx.lojaId))
  if (!local) return { error: 'Cadastre um local de estoque para receber a mercadoria.' }
  const sb = createServiceClient()
  const avisos = await avisosDosItens(ctx.lojaId, compra.id, notaId)
  const dec = decidirConfirmacaoEntrada(avisos, { conferida: !!compra.conferida_em, aceitarAvisos: !!opts?.aceitarAvisos })
  if ('error' in dec) return dec
  const { data, error } = await sb.rpc('lancar_compra', {
    p_compra: { loja_id: ctx.lojaId, id: compra.id, itens: [], ...(dec.aceitos.length ? { avisos_aceitos: dec.aceitos } : {}) }, p_local: local, p_user: ctx.userId,
  })
  if (error) return { error: error.message }
  const r = resultadoLancamento(data as { ok?: boolean; status: string; lancados: number; pendentes: number; motivo?: string })
  if ('error' in r) { await atualizarSituacao(ctx.lojaId, notaId); return r }
  await registrarAuditoria('concluir', 'nota fiscal (entrada)', compra.numero ?? notaId, dec.aceitos.length ? `avisos aceitos: ${dec.aceitos.map((a) => `item ${a.linha} ${a.tipo}`).join(', ')}` : null)
  await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true, lancados: r.lancados, pendentes: r.pendentes, status: r.status }
}

/** Desfaz a entrada no estoque (estorno movimento a movimento; o histórico fica). */
export async function desfazerEntradaNF(notaId: number): Promise<{ ok: true; estornados: number } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#desfazerEntradaNF', desfazerEntradaNF, [notaId]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Reverter')
  if ('error' in ctx) return ctx
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota não tem entrada lançada.' }
  const travado = await travaDaCompraLancada(ctx.lojaId, compra.id)
  if (travado) return { error: travado }
  const { data, error } = await createServiceClient().rpc('estornar_compra', { p_compra_id: compra.id, p_user: ctx.userId })
  if (error) return { error: error.message }
  await registrarAuditoria('reverter', 'nota fiscal (entrada)', compra.numero ?? notaId, null)
  await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true, estornados: Number((data as { estornados: number }).estornados) || 0 }
}

/** Tira a nota da lista (soft delete). Se já tinha entrada no estoque, a entrada é desfeita antes. */
export async function excluirNotaProprio(notaId: number): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#excluirNotaProprio', excluirNotaProprio, [notaId]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Excluir')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (compra) {
    const travado = await travaDaCompraLancada(ctx.lojaId, compra.id)
    if (travado) return { error: travado }
  }
  if (compra && compra.status !== 'cancelada') {
    const { error } = await sb.rpc('estornar_compra', { p_compra_id: compra.id, p_user: ctx.userId })
    if (error) return { error: error.message }
    // desfazer reabre a compra (185); a nota excluída fecha: não entra mais (nem sozinha, nem por "Confirmar entrada")
    const { error: ec } = await sb.from('compras_proprio').update({ status: 'cancelada', updated_at: new Date().toISOString() }).eq('id', compra.id).eq('loja_id', ctx.lojaId)
    if (ec) return { error: ec.message }
    await sb.from('compras_proprio_eventos').insert({ loja_id: ctx.lojaId, compra_id: compra.id, tipo: 'cancelada', detalhe: { motivo: 'nota excluída' }, user_id: ctx.userId })
  }
  const { error: ed } = await sb.from('notas_fiscais').update({ deleted_at: new Date().toISOString() }).eq('id', notaId).eq('loja_id', ctx.lojaId)
  if (ed) return { error: ed.message }
  await registrarAuditoria('excluir', 'nota fiscal', notaId, null)
  void espelharNotaNoFrio(ctx.lojaId, notaId)
  revalidatePath('/nota-fiscal')
  return { ok: true }
}

/** Liga um item da nota a um produto do cadastro (e o sistema aprende o de-para para as próximas notas do fornecedor). */
export async function vincularItemNF(compraItemId: number, codigoProduto: number, fator: number): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#vincularItemNF', vincularItemNF, [compraItemId, codigoProduto, fator]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const { data, error } = await createServiceClient().rpc('vincular_item_compra', { p_loja: ctx.lojaId, p_compra_item: compraItemId, p_produto: codigoProduto, p_fator: fator > 0 ? fator : 1, p_user: ctx.userId })
  if (error) return { error: error.message }
  const notaId = (data as { nota_id: number | null }).nota_id
  if (notaId) await atualizarSituacao(ctx.lojaId, Number(notaId))
  return { ok: true }
}

/** Lote e validade do item antes da entrada (o gatilho de lotes usa na hora do movimento). Item já lançado não muda. */
export async function definirLoteItemNF(compraItemId: number, lote: string | null, validade: string | null): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#definirLoteItemNF', definirLoteItemNF, [compraItemId, lote, validade]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const l = lote?.trim() || null
  const v = validade && /^\d{4}-\d{2}-\d{2}$/.test(validade) ? validade : null
  if (validade && !v) return { error: 'Validade inválida.' }
  if (l && l.length > 60) return { error: 'Lote muito longo.' }
  const sb = createServiceClient()
  const { data: it } = await sb.from('compras_proprio_itens').select('id, lancado').eq('id', compraItemId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!it) return { error: 'Item não encontrado.' }
  if (it.lancado) return { error: 'Este item já entrou no estoque: o lote não muda mais.' }
  const { error } = await sb.from('compras_proprio_itens').update({ lote: l, validade: v }).eq('id', compraItemId).eq('loja_id', ctx.lojaId)
  if (error) return { error: error.message }
  return { ok: true }
}

/** Cria o produto a partir do item da nota (descrição, unidade e NCM da nota; código por tipo) e já liga o item a ele. */
export async function criarProdutoDoItemNF(compraItemId: number, tipoItem: string): Promise<{ ok: true; codigo: string } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#criarProdutoDoItemNF', criarProdutoDoItemNF, [compraItemId, tipoItem]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  if (!(await requirePermissao(ctx.lojaId, 'Produtos - Criar'))) return { error: 'Sem permissão para criar produto' }
  const sb = createServiceClient()
  const { data: it } = await sb.from('compras_proprio_itens').select('id, descricao, unidade_compra, ncm, lancado').eq('id', compraItemId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!it) return { error: 'Item não encontrado.' }
  if (it.lancado) return { error: 'Item já lançado no estoque.' }
  const r = await criarProdutoProprio(ctx.lojaId, { descricao: it.descricao ?? 'Produto da nota', unidade: it.unidade_compra || 'UN', tipoItem, ncm: it.ncm && /^\d{8}$/.test(it.ncm) ? it.ncm : null })
  if ('error' in r) return r
  await registrarAuditoria('criar', 'produto', r.codigoProduto, it.descricao ?? null)
  const v = await vincularItemNF(compraItemId, r.codigoProduto, 1)
  if ('error' in v) return v
  return { ok: true, codigo: r.codigo }
}

export type ProdutoNF = { codigoProduto: number; codigo: string; descricao: string; unidade: string }
export async function buscarProdutosNF(termo: string): Promise<ProdutoNF[]> {
  const __d = viaDesktop('nota-fiscal-proprio#buscarProdutosNF', buscarProdutosNF, [termo]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais')
  if ('error' in ctx) return []
  const q = termo.trim().replace(/[%,()]/g, ' ')
  if (q.length < 2) return []
  const { data } = await createServiceClient().from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', ctx.lojaId).neq('inativo', true)
    .or(`descricao.ilike.%${q}%,codigo.ilike.${q}%`).order('descricao').limit(15)
  return (data ?? []).map((p) => ({ codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }))
}

/** Liga/desliga a entrada automática e a ciência da operação para esta loja. */
export async function salvarConfigSefaz(cfg: { autoLancar: boolean; autoCiencia: boolean; ativo: boolean; ambiente: 1 | 2 }): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#salvarConfigSefaz', salvarConfigSefaz, [cfg]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Sincronizar')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const { data: loja } = await sb.from('lojas').select('cnpj').eq('id', ctx.lojaId).maybeSingle()
  const { error } = await sb.from('sefaz_nsu').upsert({ loja_id: ctx.lojaId, cnpj: String(loja?.cnpj ?? '').replace(/\D/g, '') || null, auto_lancar: cfg.autoLancar, auto_ciencia: cfg.autoCiencia, ativo: cfg.ativo, ambiente: cfg.ambiente, updated_at: new Date().toISOString() }, { onConflict: 'loja_id' })
  if (error) return { error: error.message }
  revalidatePath('/nota-fiscal')
  return { ok: true }
}

export async function sincronizarSefazAgora() {
  const __d = viaDesktop('nota-fiscal-proprio#sincronizarSefazAgora', sincronizarSefazAgora, []); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Sincronizar')
  if ('error' in ctx) return ctx
  const r = await sincronizarSefaz(ctx.lojaId)
  revalidatePath('/nota-fiscal')
  return r
}

/** Cria um produto pela conferência da nota (código por tipo). Mesmo formato do criar rápido das compras, com as permissões de Notas Fiscais. */
export async function criarProdutoParaNF(dados: { descricao: string; unidade: string; tipoItem: string; ncm?: string | null }): Promise<{ ok: true; produto: ProdutoNF } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#criarProdutoParaNF', criarProdutoParaNF, [dados]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  if (!(await requirePermissao(ctx.lojaId, 'Produtos - Criar'))) return { error: 'Sem permissão para criar produto' }
  const r = await criarProdutoProprio(ctx.lojaId, { descricao: dados.descricao, unidade: dados.unidade, tipoItem: dados.tipoItem, ncm: dados.ncm ?? null })
  if ('error' in r) return r
  await registrarAuditoria('criar', 'produto', r.codigoProduto, dados.descricao.trim())
  return { ok: true, produto: { codigoProduto: r.codigoProduto, codigo: r.codigo, descricao: dados.descricao.trim(), unidade: dados.unidade.trim() } }
}

// ---------------------------------------------------------------- Fase B: item da nota e conferência

const COLUNAS_FLAGS = ['custo_icms', 'custo_icms_st', 'custo_ipi', 'custo_seguro', 'custo_pis', 'custo_cofins', 'custo_frete', 'custo_outras'] as const

/** Linha de compras_proprio_itens → entrada de avaliarItemCompra (marcações em texto na ordem do Omie). */
function itemGravado(r: Record<string, unknown>): ItemCompraGravado {
  const n = (k: string) => Number(r[k] ?? 0) || 0
  const flags = r.custo_icms == null ? null : COLUNAS_FLAGS.map((c) => (r[c] ? 'S' : 'N')).join('')
  return {
    quantidade: n('quantidade'), valor_unitario: n('valor_unitario'), valor_total_item: r.valor_total_item == null ? null : n('valor_total_item'), desconto: n('desconto'),
    ipi_valor: n('ipi_valor'), st_valor: n('st_valor'), fcp_st_valor: n('fcp_st_valor'), icms_valor: n('icms_valor'), frete_valor: n('frete_valor'),
    seguro_valor: n('seguro_valor'), outras_valor: n('outras_valor'), frete_cte: n('frete_cte'), flags, aliq_cred_pis: n('aliq_cred_pis'), aliq_cred_cofins: n('aliq_cred_cofins'),
    quantidade_recebida: r.quantidade_recebida == null ? null : n('quantidade_recebida'), fator: n('fator') || 1, unidade_compra: (r.unidade_compra as string) ?? null,
    unidade_estoque: (r.unidade_estoque as string) ?? null, codigo_produto: r.codigo_produto == null ? null : Number(r.codigo_produto), movimenta_estoque: r.movimenta_estoque !== false,
    csosn: ((r.fiscal as Record<string, unknown> | null)?.csosn as string) ?? null, cred_icms_sn: Number((r.fiscal as Record<string, unknown> | null)?.credIcmsSn ?? 0) || 0,
  }
}

/** Avisos de cada item ainda não lançado que movimenta estoque (mesma conta da tela: avaliarItemCompra). */
async function avisosDosItens(lojaId: number, compraId: number, notaId: number): Promise<{ linha: number; alertas: AlertaItem[] }[]> {
  const sb = createServiceClient()
  const [{ data: itens }, { data: nota }] = await Promise.all([
    sb.from('compras_proprio_itens').select('*').eq('compra_id', compraId).eq('loja_id', lojaId).order('linha'),
    sb.from('notas_fiscais').select('full_object').eq('id', notaId).eq('loja_id', lojaId).maybeSingle(),
  ])
  const linhas = ((itens ?? []) as Record<string, unknown>[]).filter((r) => !r.lancado && r.movimenta_estoque !== false)
  const finalidade = ((nota?.full_object as { sefaz?: { finalidade?: string } } | null)?.sefaz?.finalidade) ?? null
  const cmc = await carregarCmc(lojaId, linhas.map((r) => Number(r.codigo_produto)).filter((c) => Number.isFinite(c) && c > 0))
  return linhas.map((r) => {
    const g = itemGravado(r)
    return { linha: Number(r.linha), alertas: avaliarItemCompra(g, { cmc: g.codigo_produto != null ? cmc.get(g.codigo_produto) ?? null : null, finalidade }).alertas }
  })
}

/** Editor do item: local, CFOP de entrada, quantidade recebida, unidade, marcações, alíquotas, movimenta / gera conta a pagar.
 *  Grava só o que veio em `cfg`; mexer no item tira a conferência (R9). */
export async function configurarItemNF(compraItemId: number, cfg: ConfigItemNF): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#configurarItemNF', configurarItemNF, [compraItemId, cfg]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const erro = validarConfigItem(cfg)
  if (erro) return { error: erro }
  const p: Record<string, unknown> = {}
  if (cfg.codigoLocal !== undefined) p.codigo_local_estoque = cfg.codigoLocal
  if (cfg.cfopEntrada !== undefined) p.cfop_entrada = cfg.cfopEntrada ? cfg.cfopEntrada.replace(/\D/g, '') : null
  if (cfg.quantidadeRecebida !== undefined) p.quantidade_recebida = cfg.quantidadeRecebida
  if (cfg.unidadeEstoque !== undefined) p.unidade_estoque = cfg.unidadeEstoque
  if (cfg.flags !== undefined) p.custo_flags = flagsParaTexto(cfg.flags)
  if (cfg.aliqCredPis !== undefined) p.aliq_cred_pis = cfg.aliqCredPis
  if (cfg.aliqCredCofins !== undefined) p.aliq_cred_cofins = cfg.aliqCredCofins
  if (cfg.movimentaEstoque !== undefined) p.movimenta_estoque = cfg.movimentaEstoque
  if (cfg.geraContaPagar !== undefined) p.gera_conta_pagar = cfg.geraContaPagar
  if (!Object.keys(p).length) return { ok: true }
  const { data, error } = await createServiceClient().rpc('configurar_item_compra', { p_loja: ctx.lojaId, p_item: compraItemId, p_cfg: p, p_user: ctx.userId })
  if (error) return { error: error.message }
  const notaId = (data as { nota_id: number | null }).nota_id
  if (notaId) await atualizarSituacao(ctx.lojaId, Number(notaId))
  return { ok: true }
}

/** Etapa "Conferida": recalcula no servidor os avisos de cada item (fator, custo, valor zero) e só aceita com "Conferi os avisos". */
export async function marcarConferidaNF(notaId: number, opts: { aceitarAvisos: boolean }): Promise<{ ok: true } | { error: string; pendencias?: { linha: number; motivo: string }[] }> {
  const __d = viaDesktop('nota-fiscal-proprio#marcarConferidaNF', marcarConferidaNF, [notaId, opts]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota ainda não tem itens para conferir (só o resumo chegou da SEFAZ).' }
  const alertas = await avisosDosItens(ctx.lojaId, compra.id, notaId)
  const dec = decidirConferencia(alertas, !!opts.aceitarAvisos)
  if ('error' in dec) return dec
  const { data, error } = await sb.rpc('marcar_compra_conferida', { p_loja: ctx.lojaId, p_compra: compra.id, p_user: ctx.userId, p_detalhe: { avisos_aceitos: dec.aceitos } })
  if (error) return { error: error.message }
  const r = data as { ok: boolean; pendencias?: { linha: number; motivo: string }[] }
  if (!r.ok) {
    const MOTIVO: Record<string, string> = { sem_produto: 'sem produto', local_invalido: 'local inválido', quantidade_zero: 'quantidade zero' }
    return { error: `Itens pendentes: ${(r.pendencias ?? []).map((p) => `item ${p.linha} (${MOTIVO[p.motivo] ?? p.motivo})`).join(', ')}.`, pendencias: r.pendencias }
  }
  await registrarAuditoria('editar', 'nota fiscal (conferida)', compra.numero ?? notaId, null)
  await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true }
}

/** Observações da nota própria (aba Observações): texto livre da compra, com registro no histórico. */
export async function salvarObservacaoNF(notaId: number, obs: string): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#salvarObservacaoNF', salvarObservacaoNF, [notaId, obs]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const texto = (obs ?? '').trim()
  if (texto.length > 2000) return { error: 'A observação passa de 2.000 caracteres.' }
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota ainda não tem itens (só o resumo chegou da SEFAZ).' }
  const sb = createServiceClient()
  const { error } = await sb.from('compras_proprio').update({ obs: texto || null, updated_at: new Date().toISOString() }).eq('id', compra.id).eq('loja_id', ctx.lojaId)
  if (error) return { error: error.message }
  await sb.from('compras_proprio_eventos').insert({ loja_id: ctx.lojaId, compra_id: compra.id, tipo: 'observacao', detalhe: { texto: texto.slice(0, 200) }, user_id: ctx.userId })
  revalidatePath(`/nota-fiscal/${notaId}`)
  return { ok: true }
}

// ---------------------------------------------------------------- Fase B: manifestação do destinatário (R12)

/** Manifestação conclusiva na SEFAZ (Confirmar / Desconhecer / Operação não realizada). SÓ por botão, com confirmação na
 *  tela; no máximo um envio em andamento por nota (índice único parcial + decidirEnvioManifestacao). Precisa de internet:
 *  fica FORA da política do desktop offline. */
export async function manifestarNotaSefaz(notaId: number, tipo: TipoManifestacao, justificativa?: string | null): Promise<{ ok: true; status: 'registrada' | 'recusada'; cStat: string | null; xMotivo: string | null } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#manifestarNotaSefaz', manifestarNotaSefaz, [notaId, tipo, justificativa]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar na SEFAZ')
  if ('error' in ctx) return ctx
  if (!ehTipoManifestacao(tipo)) return { error: 'Tipo de manifestação inválido.' }
  const erroJust = validarJustificativa(tipo, justificativa)
  if (erroJust) return { error: erroJust }
  const sb = createServiceClient()
  const [{ data: nota }, { data: loja }, { data: nsu }] = await Promise.all([
    sb.from('notas_fiscais').select('id, c_chave_nfe').eq('id', notaId).eq('loja_id', ctx.lojaId).is('deleted_at', null).maybeSingle(),
    sb.from('lojas').select('cnpj, is_test').eq('id', ctx.lojaId).maybeSingle(),
    sb.from('sefaz_nsu').select('ambiente').eq('loja_id', ctx.lojaId).maybeSingle(),
  ])
  const chave = nota?.c_chave_nfe as string | null | undefined
  if (!nota || !chave || !/^\d{44}$/.test(chave)) return { error: 'Esta nota não tem chave de acesso: não dá para manifestar na SEFAZ.' }
  if (loja?.is_test) return { error: 'Loja de teste: a manifestação não vai para a SEFAZ.' }
  const cnpj = String(loja?.cnpj ?? '').replace(/\D/g, '')
  if (cnpj.length !== 14) return { error: 'A loja precisa de um CNPJ válido.' }
  const tpAmb: 1 | 2 = nsu?.ambiente === 2 ? 2 : 1

  const { data: estados } = await sb.from('sefaz_manifestacoes').select('id, tp_evento, status, criado_em').eq('loja_id', ctx.lojaId).eq('chave', chave).order('id')
  const linhas = (estados ?? []) as (EstadoManifestacao & { id: number })[]
  const agora = new Date()
  const decisao = decidirEnvioManifestacao(linhas, tipo, agora)
  if (decisao.acao === 'bloquear') return { error: decisao.motivo }

  let linhaId: number
  if (decisao.acao === 'enviar') {
    const { data: ins, error } = await sb.from('sefaz_manifestacoes')
      .insert({ loja_id: ctx.lojaId, chave, tp_evento: tipo, status: 'enviando', justificativa: justificativa?.trim() || null, user_id: ctx.userId })
      .select('id').single()
    if (error) return { error: error.code === '23505' ? 'Já há um envio em andamento para esta nota.' : error.message }
    linhaId = Number(ins.id)
  } else {
    // reenvio do MESMO envio que ficou sem resposta: a troca de estado é condicional (dois cliques ao mesmo tempo → só um passa)
    const alvo = [...linhas].reverse().find((l) => l.tp_evento === tipo && (l.status === 'incerta' || l.status === 'enviando'))
    if (!alvo) return { error: 'Envio anterior não encontrado: atualize a página.' }
    let q = sb.from('sefaz_manifestacoes').update({ status: 'enviando', criado_em: agora.toISOString(), user_id: ctx.userId }).eq('id', alvo.id).eq('status', alvo.status)
    if (alvo.status === 'enviando') q = q.lt('criado_em', new Date(agora.getTime() - 5 * 60 * 1000).toISOString())
    const { data: upd, error } = await q.select('id')
    if (error) return { error: error.code === '23505' ? 'Já há um envio em andamento para esta nota.' : error.message }
    if (!upd?.length) return { error: 'Já há um envio em andamento para esta nota.' }
    linhaId = alvo.id
  }

  let resultado: { cStat: string | null; xMotivo: string | null; protocolo: string | null }
  try {
    const cred = await carregarCredencialLoja(ctx.lojaId)
    resultado = await enviarManifestacao({ chave, cnpj, tpAmb, tipo, justificativa, cred })
  } catch (e) {
    // tempo esgotado / rede: não se sabe se a SEFAZ registrou — fica "sem resposta" e o reenvio é do mesmo tipo (573 se já tinha)
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    await sb.from('sefaz_manifestacoes').update({ status: 'incerta', xmotivo: msg, respondido_em: new Date().toISOString() }).eq('id', linhaId)
    await atualizarSituacao(ctx.lojaId, notaId)
    return { error: `Sem resposta da SEFAZ: ${msg}. Tente de novo em alguns minutos (o mesmo envio é repetido).` }
  }
  const status = resultadoManifestacao(resultado.cStat)
  await sb.from('sefaz_manifestacoes').update({ status, cstat: resultado.cStat, xmotivo: resultado.xMotivo, protocolo: resultado.protocolo, respondido_em: new Date().toISOString() }).eq('id', linhaId)
  if (status === 'registrada' && tipo !== '210200') {
    const compra = await compraDaNota(ctx.lojaId, notaId)
    if (compra) await sb.from('compras_proprio_eventos').insert({ loja_id: ctx.lojaId, compra_id: compra.id, tipo: 'recusada', detalhe: { tp_evento: tipo, cstat: resultado.cStat }, user_id: ctx.userId })
  }
  await registrarAuditoria('editar', `nota fiscal (manifestação ${tipo})`, notaId, `${status} ${resultado.cStat ?? ''}`.trim())
  await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true, status, cStat: resultado.cStat, xMotivo: resultado.xMotivo }
}

// ---------------------------------------------------------------- Fase B: CT-e de frete (R13) e nota pela chave (R14)

const TAMANHO_MAX_CTE = 900_000

/** Liga um CT-e (XML do transportador) à nota: grava o CT-e (mesma chave = reaproveita), reparte entre as notas da loja
 *  que ele transporta (pelo valor da nota) e dentro de cada nota pelo valor líquido do item. Só antes da entrada. */
export async function importarCteNF(notaId: number, xml: string): Promise<{ ok: true; notas: number } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#importarCteNF', importarCteNF, [notaId, xml]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  if (!xml || xml.length > TAMANHO_MAX_CTE) return { error: 'Arquivo vazio ou grande demais.' }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { error: 'O XML tem DOCTYPE/ENTITY: não é um CT-e válido.' }
  let cte
  try { cte = lerCte(xml) } catch (e) { return { error: e instanceof Error ? e.message : 'XML inválido' } }
  const sb = createServiceClient()
  const { data: loja } = await sb.from('lojas').select('cnpj, is_test').eq('id', ctx.lojaId).maybeSingle()
  const erros = validarCteImportado(cte, String(loja?.cnpj ?? '').replace(/\D/g, '') || null)
  if (erros.length) return { error: erros.join(' ') }
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota ainda não tem itens (só o resumo chegou da SEFAZ).' }
  const { data: nota } = await sb.from('notas_fiscais').select('c_chave_nfe').eq('id', notaId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!nota?.c_chave_nfe || !cte.chavesNfe.includes(nota.c_chave_nfe)) return { error: 'Este CT-e não transporta esta nota.' }
  // notas da loja que o CT-e transporta (as que ainda não chegaram ficam de fora: o rateio é entre as que existem)
  const { data: compras } = await sb.from('compras_proprio').select('id, nota_fiscal_id, valor_total, chave_acesso').eq('loja_id', ctx.lojaId).in('chave_acesso', cte.chavesNfe)
  const lista = (compras ?? []) as { id: number; nota_fiscal_id: number | null; valor_total: number | string; chave_acesso: string }[]
  const ids = lista.map((c) => c.nota_fiscal_id).filter((x): x is number => x != null)
  const { data: notas } = ids.length ? await sb.from('notas_fiscais').select('id, n_valor_nfe').eq('loja_id', ctx.lojaId).in('id', ids) : { data: [] as { id: number; n_valor_nfe: number }[] }
  const valorNota = new Map((notas ?? []).map((n) => [Number(n.id), Number(n.n_valor_nfe) || 0]))
  const rateio = ratearFreteCte(cte.valorPrestacao, lista.map((c) => ({ compraId: Number(c.id), valorNota: (c.nota_fiscal_id != null ? valorNota.get(Number(c.nota_fiscal_id)) : undefined) ?? (Number(c.valor_total) || 0) })))
  // grava o CT-e (unique (loja_id, chave): mesma chave = o mesmo CT-e)
  let cteId: number
  const { data: existente } = await sb.from('compras_proprio_cte').select('id').eq('loja_id', ctx.lojaId).eq('chave', cte.chave).maybeSingle()
  if (existente) cteId = Number(existente.id)
  else {
    const { data: ins, error } = await sb.from('compras_proprio_cte').insert({
      loja_id: ctx.lojaId, chave: /^\d{44}$/.test(cte.chave) ? cte.chave : null, numero: cte.numero || null, serie: cte.serie || null, emissao: cte.emissao,
      transportadora_cnpj: cte.emitente.cnpj || null, transportadora_nome: cte.emitente.nome || null, valor: cte.valorPrestacao, icms: cte.icms, cfop: cte.cfop,
      origem: 'xml', xml, user_id: ctx.userId,
    }).select('id').single()
    if (error) {
      if (error.code !== '23505') return { error: error.message }
      const { data: outro } = await sb.from('compras_proprio_cte').select('id').eq('loja_id', ctx.lojaId).eq('chave', cte.chave).maybeSingle()
      if (!outro) return { error: error.message }
      cteId = Number(outro.id)
    } else cteId = Number(ins.id)
  }
  const { data, error } = await sb.rpc('vincular_cte_compra', { p_loja: ctx.lojaId, p_cte: cteId, p_rateio: rateio.map((x) => ({ compra_id: x.compraId, valor: x.valor })), p_user: ctx.userId })
  if (error) return { error: error.message }
  for (const c of lista) if (c.nota_fiscal_id != null) await atualizarSituacao(ctx.lojaId, Number(c.nota_fiscal_id))
  await registrarAuditoria('editar', 'nota fiscal (CT-e)', notaId, `CT-e ${cte.numero} · ${cte.valorPrestacao}`)
  return { ok: true, notas: Number((data as { notas: number }).notas) || 0 }
}

/** Frete sem XML (valor digitado): CT-e "manual" só desta nota. */
export async function informarFreteNF(notaId: number, dados: { valor: number; transportadora?: string; numero?: string }): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#informarFreteNF', informarFreteNF, [notaId, dados]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const valor = Math.round(Number(dados.valor) * 100) / 100
  if (!(valor > 0)) return { error: 'Informe o valor do frete.' }
  const compra = await compraDaNota(ctx.lojaId, notaId)
  if (!compra) return { error: 'Esta nota ainda não tem itens (só o resumo chegou da SEFAZ).' }
  const sb = createServiceClient()
  const { data: ins, error } = await sb.from('compras_proprio_cte').insert({
    loja_id: ctx.lojaId, numero: dados.numero?.trim().slice(0, 30) || null, transportadora_nome: dados.transportadora?.trim().slice(0, 120) || null, valor, origem: 'manual', user_id: ctx.userId,
  }).select('id').single()
  if (error) return { error: error.message }
  const { error: ev } = await sb.rpc('vincular_cte_compra', { p_loja: ctx.lojaId, p_cte: Number(ins.id), p_rateio: [{ compra_id: compra.id, valor }], p_user: ctx.userId })
  if (ev) { await sb.from('compras_proprio_cte').delete().eq('id', ins.id).eq('loja_id', ctx.lojaId); return { error: ev.message } }
  await registrarAuditoria('editar', 'nota fiscal (frete)', notaId, String(valor))
  await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true }
}

/** Desliga um CT-e das notas (o frete sai do custo dos itens). Só antes da entrada. */
export async function desvincularCteNF(notaId: number, cteId: number): Promise<{ ok: true } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#desvincularCteNF', desvincularCteNF, [notaId, cteId]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Manifestar')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const { data: ligadas } = await sb.from('compras_proprio_cte_compra').select('compra_id').eq('cte_id', cteId).eq('loja_id', ctx.lojaId)
  const { error } = await sb.rpc('desvincular_cte_compra', { p_loja: ctx.lojaId, p_cte: cteId, p_user: ctx.userId })
  if (error) return { error: error.message }
  const compras = (ligadas ?? []).map((l) => Number(l.compra_id))
  if (compras.length) {
    const { data: cs } = await sb.from('compras_proprio').select('nota_fiscal_id').eq('loja_id', ctx.lojaId).in('id', compras)
    for (const c of cs ?? []) if (c.nota_fiscal_id != null) await atualizarSituacao(ctx.lojaId, Number(c.nota_fiscal_id))
  } else await atualizarSituacao(ctx.lojaId, notaId)
  return { ok: true }
}

/** Busca na SEFAZ uma NF-e pela chave digitada (só leitura; 1 tentativa por chave por hora). Precisa de internet:
 *  fica FORA da política do desktop offline. */
export async function buscarNotaPorChaveNF(chave: string): Promise<{ ok: true; situacao: 'completa' | 'resumo' | 'nao_encontrada'; notaId: number | null } | { error: string }> {
  const __d = viaDesktop('nota-fiscal-proprio#buscarNotaPorChaveNF', buscarNotaPorChaveNF, [chave]); if (__d) return __d as never
  const ctx = await contexto('Notas Fiscais - Sincronizar')
  if ('error' in ctx) return ctx
  const r = await importarNotaPorChave(ctx.lojaId, chave)
  revalidatePath('/nota-fiscal')
  return r
}
