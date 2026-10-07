// Sincronização automática do catálogo com o Norte Vendas (lojas modo 'proprio').
// Regras e modelo: docs/superpowers/specs/2026-10-06-sync-catalogo-design.md
//   - o gatilho do banco coloca toda mudança no `sync_outbox`; aqui o outbox é entregue ao Vendas;
//   - o que chega do Vendas entra por `aplicar_catalogo_vendas` (sem eco);
//   - preço de venda: o Vendas manda; código/unidade/tipo/NCM/custo: o Estoque manda; nome/ativo/grupo: o mais novo.
import { createServiceClient } from '@/lib/supabase/server'

const MAX_TENTATIVAS = 8
const TIMEOUT_MS = 20_000

type Loja = { id: number; nome: string; cnpj: string | null; integracao_api_key: string | null; vendas_store_id: string | null }

export type GrupoSync = { estoque_id: number; vendas_ref: string | null; nome: string; pai_estoque_id: number | null; ordem: number; ativo: boolean; updated_at: string }
export type ProdutoSync = {
  codigo: string; vendas_ref: string | null; nome: string; preco: number; ativo: boolean; mae: boolean
  pai_codigo: string | null; grupo_estoque_id: number | null; atributos: Record<string, unknown>
  unidade: string | null; tipo_item: string | null; updated_at: string
}
export type PayloadParaVendas = { grupos: GrupoSync[]; produtos: ProdutoSync[] }
export type RespostaVendas = {
  ok: boolean
  grupos?: { estoque_id: number; vendas_ref: string }[]
  produtos?: { codigo: string; vendas_ref: string }[]
  error?: string
}

function urlVendas(): string | null {
  const u = process.env.NTB_VENDAS_INTERNAL_URL
  return u ? u.replace(/\/$/, '') : null
}

function urlPublica(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app-estoque.norteparanegocios.com.br'
}

async function postJson(url: string, key: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  } finally {
    clearTimeout(t)
  }
}

async function getJson(url: string, key: string): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal })
    return { status: res.status, json: await res.json().catch(() => ({})) }
  } finally {
    clearTimeout(t)
  }
}

/** Lojas do modo próprio (ativas) com a ligação ao Vendas já feita ou ainda por fazer. */
export async function lojasProprio(): Promise<Loja[]> {
  const { data } = await createServiceClient()
    .from('lojas')
    .select('id, nome, cnpj, integracao_api_key, vendas_store_id')
    .eq('modo_estoque', 'proprio')
    .eq('ativo', true)
    .order('id')
  return (data ?? []) as Loja[]
}

// ---------------------------------------------------------------------------------- ligação automática da loja
/**
 * Liga a loja ao Vendas sem passo manual: pede ao Vendas (rota bootstrap, idempotente por CNPJ) a loja correspondente,
 * grava `vendas_store_id` e configura a integração do outro lado com a chave desta loja.
 */
export async function vincularLojaAoVendas(loja: Loja): Promise<{ ok: true; storeId: string } | { ok: false; error: string }> {
  const base = urlVendas()
  const segredo = process.env.CROSS_SYSTEM_BOOTSTRAP_KEY
  if (!base || !segredo) return { ok: false, error: 'Integração cross-sistema não configurada neste servidor' }
  const supabase = createServiceClient()

  let chave = loja.integracao_api_key
  if (!chave) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    chave = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    const { error } = await supabase.from('lojas').update({ integracao_api_key: chave }).eq('id', loja.id)
    if (error) return { ok: false, error: error.message }
  }

  const r = await postJson(`${base}/api/integracao/lojas`, segredo, { nome: loja.nome, cnpj: loja.cnpj ?? undefined, stockMode: 'proprio' })
  const j = r.json as { ok?: boolean; storeId?: string; error?: string }
  if (r.status >= 300 || !j.ok || !j.storeId) return { ok: false, error: j.error || `Vendas respondeu HTTP ${r.status}` }

  const cfg = await fetch(`${base}/api/integracao/configurar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId: j.storeId, url: urlPublica(), apiKey: chave, ativo: true }),
  })
  const cj = (await cfg.json().catch(() => ({}))) as { success?: boolean; message?: string }
  if (!cfg.ok || !cj.success) return { ok: false, error: cj.message || 'Falha ao configurar a integração no Vendas' }

  await supabase.from('lojas').update({ vendas_store_id: j.storeId }).eq('id', loja.id)
  return { ok: true, storeId: j.storeId }
}

// ---------------------------------------------------------------------------------- montagem do payload
type ProdutoRow = {
  codigo: string | null; descricao: string | null; valor_unitario: number | null; inativo: boolean | null; eh_mae: boolean
  produto_pai_codigo: number | null; grupo_id: number | null; atributos: Record<string, unknown> | null
  unidade: string | null; tipo_item: string | null; vendas_ref: string | null; updated_at: string; codigo_produto: number
}

async function montarPayload(lojaId: number, produtos: string[], grupos: number[]): Promise<PayloadParaVendas> {
  const supabase = createServiceClient()
  const out: PayloadParaVendas = { grupos: [], produtos: [] }

  if (grupos.length) {
    // inclui os ancestrais: o Vendas precisa do pai antes do filho
    const { data: todos } = await supabase.from('grupos_produto').select('id, pai_id, nome, ordem, ativo, vendas_ref, updated_at').eq('loja_id', lojaId)
    const porId = new Map((todos ?? []).map((g) => [g.id as number, g]))
    const incluir = new Set<number>()
    for (const id of grupos) {
      let atual = porId.get(id)
      while (atual && !incluir.has(atual.id as number)) {
        incluir.add(atual.id as number)
        atual = atual.pai_id ? porId.get(atual.pai_id as number) : undefined
      }
    }
    const profundidade = (g: { id: number; pai_id: number | null }): number => {
      let n = 0
      let a: typeof g | undefined = g
      while (a?.pai_id) { n++; a = porId.get(a.pai_id) as typeof g | undefined }
      return n
    }
    out.grupos = [...incluir]
      .map((id) => porId.get(id)!)
      .sort((a, b) => profundidade(a as never) - profundidade(b as never) || (a.ordem as number) - (b.ordem as number))
      .map((g) => ({
        estoque_id: g.id as number, vendas_ref: (g.vendas_ref as string | null) ?? null, nome: g.nome as string,
        pai_estoque_id: (g.pai_id as number | null) ?? null, ordem: (g.ordem as number) ?? 0, ativo: g.ativo as boolean, updated_at: g.updated_at as string,
      }))
  }

  if (produtos.length) {
    const { data } = await supabase
      .from('produtos')
      .select('codigo, descricao, valor_unitario, inativo, eh_mae, produto_pai_codigo, grupo_id, atributos, unidade, tipo_item, vendas_ref, updated_at, codigo_produto')
      .eq('loja_id', lojaId)
      .in('codigo', produtos)
      .eq('pdv', true).in('tipo_item', ['00', '04'])  // só o que é vendável vai para o cardápio (insumos ficam só no Estoque)
    const rows = (data ?? []) as ProdutoRow[]
    // mãe precisa existir no Vendas antes das variações; busca também as mães referenciadas
    const paiIds = [...new Set(rows.map((r) => r.produto_pai_codigo).filter((x): x is number => x != null))]
    const codigoDoPai = new Map<number, string>()
    if (paiIds.length) {
      const { data: pais } = await supabase.from('produtos').select('codigo_produto, codigo').eq('loja_id', lojaId).in('codigo_produto', paiIds)
      for (const p of pais ?? []) codigoDoPai.set(p.codigo_produto as number, p.codigo as string)
    }
    const lista: ProdutoSync[] = rows
      .filter((r) => r.codigo)
      .map((r) => ({
        codigo: r.codigo as string, vendas_ref: r.vendas_ref, nome: r.descricao ?? '', preco: Number(r.valor_unitario) || 0, ativo: !r.inativo,
        mae: r.eh_mae, pai_codigo: r.produto_pai_codigo != null ? codigoDoPai.get(r.produto_pai_codigo) ?? null : null,
        grupo_estoque_id: r.grupo_id, atributos: r.atributos ?? {}, unidade: r.unidade, tipo_item: r.tipo_item, updated_at: r.updated_at,
      }))
    out.produtos = lista.sort((a, b) => Number(b.mae) - Number(a.mae))
    // grupos dos produtos também vão junto
    const gruposDosProdutos = [...new Set(rows.map((r) => r.grupo_id).filter((x): x is number => x != null))].filter((id) => !grupos.includes(id))
    if (gruposDosProdutos.length) {
      const extra = await montarPayload(lojaId, [], gruposDosProdutos)
      const ja = new Set(out.grupos.map((g) => g.estoque_id))
      out.grupos = [...out.grupos, ...extra.grupos.filter((g) => !ja.has(g.estoque_id))]
    }
  }
  return out
}

// ---------------------------------------------------------------------------------- entrega do outbox
function proximaTentativa(tentativas: number): string {
  const minutos = Math.min(60, 2 ** Math.max(1, tentativas))
  return new Date(Date.now() + minutos * 60_000).toISOString()
}

export async function drenarOutbox(lojaId: number, limite = 100): Promise<{ entregues: number; falhas: number; pendentes: number }> {
  const supabase = createServiceClient()
  const { data: loja } = await supabase.from('lojas').select('id, integracao_api_key, vendas_store_id').eq('id', lojaId).maybeSingle()
  const base = urlVendas()
  if (!loja?.integracao_api_key || !loja.vendas_store_id || !base) return { entregues: 0, falhas: 0, pendentes: 0 }

  const { data: fila } = await supabase
    .from('sync_outbox').select('id, entidade, ref, operacao, tentativas')
    .eq('loja_id', lojaId).eq('status', 'pending').lte('proxima_tentativa', new Date().toISOString())
    .order('id').limit(limite)
  if (!fila?.length) return { entregues: 0, falhas: 0, pendentes: 0 }

  const produtos = fila.filter((f) => f.entidade === 'produto').map((f) => f.ref as string)
  const grupos = fila.filter((f) => f.entidade === 'grupo').map((f) => Number(f.ref)).filter((n) => Number.isFinite(n))
  const payload = await montarPayload(lojaId, produtos, grupos)
  // produto apagado no Estoque: o Vendas só desativa (nunca apaga)
  const apagados = fila.filter((f) => f.operacao === 'delete' && f.entidade === 'produto').map((f) => f.ref as string)
  const existentes = new Set(payload.produtos.map((p) => p.codigo))
  for (const codigo of apagados) {
    if (!existentes.has(codigo)) {
      payload.produtos.push({ codigo, vendas_ref: null, nome: '', preco: 0, ativo: false, mae: false, pai_codigo: null, grupo_estoque_id: null, atributos: {}, unidade: null, tipo_item: null, updated_at: new Date().toISOString() })
    }
  }

  let resposta: RespostaVendas | null = null
  let erro: string | null = null
  try {
    const r = await postJson(`${base}/api/integracao/catalogo`, loja.integracao_api_key as string, { origem: 'estoque', ...payload })
    resposta = r.json as RespostaVendas
    if (r.status >= 300 || !resposta?.ok) erro = resposta?.error || `Vendas respondeu HTTP ${r.status}`
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e)
  }

  const ids = fila.map((f) => f.id as number)
  if (!erro && resposta) {
    await supabase.from('sync_outbox').update({ status: 'ok', erro: null, atualizado_em: new Date().toISOString() }).in('id', ids)
    await supabase.rpc('registrar_mapa_vendas', {
      p_loja: lojaId,
      p_mapa: { grupos: resposta.grupos ?? [], produtos: resposta.produtos ?? [], codigos: payload.produtos.map((x) => x.codigo) },
    })
    await supabase.from('sync_divergencias').update({ resolvido_em: new Date().toISOString() })
      .eq('loja_id', lojaId).eq('tipo', 'erro_entrega').is('resolvido_em', null)
    return { entregues: ids.length, falhas: 0, pendentes: 0 }
  }

  let falhas = 0
  for (const f of fila) {
    const t = (f.tentativas as number) + 1
    falhas++
    const esgotou = t >= MAX_TENTATIVAS
    await supabase.from('sync_outbox').update({
      tentativas: t, erro, status: esgotou ? 'erro' : 'pending', proxima_tentativa: proximaTentativa(t), atualizado_em: new Date().toISOString(),
    }).eq('id', f.id)
    if (esgotou) {
      await supabase.from('sync_divergencias').upsert(
        { loja_id: lojaId, entidade: f.entidade, ref: f.ref, tipo: 'erro_entrega', detalhe: erro },
        { onConflict: 'loja_id,entidade,ref,tipo', ignoreDuplicates: true }
      )
    }
  }
  return { entregues: 0, falhas, pendentes: fila.length }
}

/** Chamado logo depois de uma gravação (sem esperar o cron). Nunca lança. */
export async function entregarAgora(lojaId: number): Promise<void> {
  try { await drenarOutbox(lojaId, 50) } catch (e) { console.error('sync-catalogo: entrega imediata falhou:', e) }
}

// ---------------------------------------------------------------------------------- reconciliação
/**
 * Compara os dois catálogos inteiros e fecha o que o outbox perdeu:
 *  (1) puxa o catálogo do Vendas e aplica (idempotente; preço do Vendas manda);
 *  (2) enfileira o que o Estoque tem e o Vendas ainda não conhece (sem vendas_ref) ou que mudou depois da última entrega.
 */
export async function reconciliarCatalogo(lojaId: number): Promise<{ aplicadoDoVendas: number; enfileirados: number; erro?: string }> {
  const supabase = createServiceClient()
  const { data: loja } = await supabase.from('lojas').select('id, integracao_api_key, vendas_store_id').eq('id', lojaId).maybeSingle()
  const base = urlVendas()
  if (!loja?.integracao_api_key || !loja.vendas_store_id || !base) return { aplicadoDoVendas: 0, enfileirados: 0 }

  let aplicado = 0
  try {
    const r = await getJson(`${base}/api/integracao/catalogo`, loja.integracao_api_key as string)
    const snap = r.json as { ok?: boolean; grupos?: unknown[]; produtos?: unknown[]; error?: string }
    if (r.status >= 300 || !snap.ok) return { aplicadoDoVendas: 0, enfileirados: 0, erro: snap.error || `Vendas respondeu HTTP ${r.status}` }
    const { data: mapa, error } = await supabase.rpc('aplicar_catalogo_vendas', { p_loja: lojaId, p_payload: { grupos: snap.grupos ?? [], produtos: snap.produtos ?? [] } })
    if (error) return { aplicadoDoVendas: 0, enfileirados: 0, erro: error.message }
    // O Vendas aprende os códigos criados aqui (produto que só existia no Vendas ganha código por tipo).
    const m = mapa as { produtos?: { vendas_ref: string; codigo: string; criado?: boolean }[] } | null
    const novos = (m?.produtos ?? []).filter((x) => x.criado)
    if (novos.length) await postJson(`${base}/api/integracao/catalogo`, loja.integracao_api_key as string, { origem: 'estoque', mapa: { produtos: novos.map((x) => ({ vendas_ref: x.vendas_ref, codigo: x.codigo })) } })
    aplicado = (snap.produtos?.length ?? 0) + (snap.grupos?.length ?? 0)
  } catch (e) {
    return { aplicadoDoVendas: 0, enfileirados: 0, erro: e instanceof Error ? e.message : String(e) }
  }

  // o que o Estoque tem e o Vendas nunca recebeu / mudou depois da última sincronização
  const { data: pend } = await supabase
    .from('produtos').select('codigo, vendas_ref, updated_at, sync_atualizado_em')
    .eq('loja_id', lojaId).not('codigo', 'is', null).eq('pdv', true).eq('inativo', false)
  const deveEnviar = (pend ?? []).filter((p) => !p.vendas_ref || !p.sync_atualizado_em || (p.updated_at as string) > (p.sync_atualizado_em as string))
  let enfileirados = 0
  for (const p of deveEnviar) {
    const { error } = await supabase.from('sync_outbox').upsert(
      { loja_id: lojaId, entidade: 'produto', ref: p.codigo, operacao: 'upsert' },
      { onConflict: 'loja_id,entidade,ref', ignoreDuplicates: true }
    )
    if (!error) enfileirados++
  }
  const { data: gp } = await supabase.from('grupos_produto').select('id').eq('loja_id', lojaId).is('vendas_ref', null)
  for (const g of gp ?? []) {
    const { error } = await supabase.from('sync_outbox').upsert(
      { loja_id: lojaId, entidade: 'grupo', ref: String(g.id), operacao: 'upsert' },
      { onConflict: 'loja_id,entidade,ref', ignoreDuplicates: true }
    )
    if (!error) enfileirados++
  }
  return { aplicadoDoVendas: aplicado, enfileirados }
}

// ---------------------------------------------------------------------------------- rodada completa (cron)
export async function rodarSyncCatalogo(): Promise<{ lojas: number; ok: number; falhas: number; detalhes: Record<string, unknown>[] }> {
  const lojas = await lojasProprio()
  const detalhes: Record<string, unknown>[] = []
  let ok = 0
  for (const loja of lojas) {
    try {
      let vinculo = loja.vendas_store_id
      let aviso: string | undefined
      if (!vinculo) {
        const v = await vincularLojaAoVendas(loja)
        if (v.ok) vinculo = v.storeId
        else aviso = v.error
      }
      if (!vinculo) { detalhes.push({ loja: loja.id, erro: aviso ?? 'sem vínculo' }); continue }
      const rec = await reconciliarCatalogo(loja.id)
      const ent = await drenarOutbox(loja.id)
      detalhes.push({ loja: loja.id, ...rec, ...ent })
      if (!rec.erro) ok++
    } catch (e) {
      detalhes.push({ loja: loja.id, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return { lojas: lojas.length, ok, falhas: lojas.length - ok, detalhes }
}
