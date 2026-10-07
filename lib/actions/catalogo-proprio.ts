'use server'

// Catálogo do estoque próprio: grupos/subgrupos em árvore, produto mãe com variações e atributos.
// A sincronização com o Vendas é automática (gatilho -> outbox); aqui só se chama `entregarAgora` para não esperar o cron.
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { criarProdutoProprio } from '@/lib/estoque/proprio-driver'
import { entregarAgora, rodarSyncCatalogo } from '@/lib/estoque/catalogo-sync'

type Erro = { error: string }

export type GrupoLinha = { id: number; pai_id: number | null; nome: string; ordem: number; ativo: boolean; produtos: number; vinculado: boolean }

async function lojaProprio(permissao: string): Promise<{ lojaId: number } | Erro> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa estoque próprio' }
  return { lojaId }
}

function sincronizar(lojaId: number) {
  after(() => entregarAgora(lojaId))
}

// ---------------------------------------------------------------------------------------------- grupos
export async function listarGrupos(): Promise<GrupoLinha[]> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const [{ data: grupos }, { data: usos }] = await Promise.all([
    supabase.from('grupos_produto').select('id, pai_id, nome, ordem, ativo, vendas_ref').eq('loja_id', lojaId).order('ordem').order('nome'),
    supabase.from('produtos').select('grupo_id').eq('loja_id', lojaId).not('grupo_id', 'is', null).limit(20000),
  ])
  const contagem = new Map<number, number>()
  for (const u of usos ?? []) contagem.set(u.grupo_id as number, (contagem.get(u.grupo_id as number) ?? 0) + 1)
  return (grupos ?? []).map((g) => ({
    id: g.id as number, pai_id: (g.pai_id as number | null) ?? null, nome: g.nome as string, ordem: (g.ordem as number) ?? 0,
    ativo: g.ativo as boolean, produtos: contagem.get(g.id as number) ?? 0, vinculado: !!g.vendas_ref,
  }))
}

export async function criarGrupo(dados: { nome: string; paiId: number | null }): Promise<{ ok: true; id: number } | Erro> {
  const ctx = await lojaProprio('Familias - Criar')
  if ('error' in ctx) return ctx
  const nome = dados.nome?.trim()
  if (!nome) return { error: 'Informe o nome do grupo' }
  const supabase = createServiceClient()
  const { data: irmaos } = await supabase.from('grupos_produto').select('ordem').eq('loja_id', ctx.lojaId).is('pai_id', dados.paiId as never).order('ordem', { ascending: false }).limit(1)
  const ordem = ((irmaos?.[0]?.ordem as number | undefined) ?? 0) + 1
  const { data, error } = await supabase.from('grupos_produto').insert({ loja_id: ctx.lojaId, pai_id: dados.paiId, nome, ordem }).select('id').single()
  if (error) return { error: error.code === '23505' ? 'Já existe um grupo com esse nome neste nível' : error.message }
  await registrarAuditoria('criar', 'grupo de produto', data.id as number, nome)
  revalidatePath('/grupo-produto'); sincronizar(ctx.lojaId)
  return { ok: true, id: data.id as number }
}

export async function editarGrupo(id: number, dados: { nome?: string; paiId?: number | null; ordem?: number; ativo?: boolean }): Promise<{ ok: true } | Erro> {
  const ctx = await lojaProprio('Familias - Editar')
  if ('error' in ctx) return ctx
  const upd: Record<string, unknown> = {}
  if (dados.nome !== undefined) { if (!dados.nome.trim()) return { error: 'Informe o nome do grupo' }; upd.nome = dados.nome.trim() }
  if (dados.paiId !== undefined) upd.pai_id = dados.paiId
  if (dados.ordem !== undefined) upd.ordem = dados.ordem
  if (dados.ativo !== undefined) upd.ativo = dados.ativo
  const { error } = await createServiceClient().from('grupos_produto').update(upd).eq('id', id).eq('loja_id', ctx.lojaId)
  if (error) return { error: error.code === '23505' ? 'Já existe um grupo com esse nome neste nível' : error.message }
  await registrarAuditoria('editar', 'grupo de produto', id, dados.nome ?? null)
  revalidatePath('/grupo-produto'); sincronizar(ctx.lojaId)
  return { ok: true }
}

/** Só apaga grupo vazio (sem subgrupos nem produtos); senão, inative. */
export async function excluirGrupo(id: number): Promise<{ ok: true } | Erro> {
  const ctx = await lojaProprio('Familias - Excluir')
  if ('error' in ctx) return ctx
  const supabase = createServiceClient()
  const [{ count: filhos }, { count: produtos }] = await Promise.all([
    supabase.from('grupos_produto').select('id', { count: 'exact', head: true }).eq('loja_id', ctx.lojaId).eq('pai_id', id),
    supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('loja_id', ctx.lojaId).eq('grupo_id', id),
  ])
  if ((filhos ?? 0) > 0) return { error: 'O grupo tem subgrupos: mova ou apague os subgrupos antes (ou inative).' }
  if ((produtos ?? 0) > 0) return { error: 'O grupo tem produtos: mova os produtos antes (ou inative).' }
  const { error } = await supabase.from('grupos_produto').delete().eq('id', id).eq('loja_id', ctx.lojaId)
  if (error) return { error: error.message }
  await registrarAuditoria('excluir', 'grupo de produto', id, null)
  revalidatePath('/grupo-produto')
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------- produto mãe / variações
export type VariacaoInput = { descricao: string; preco: number; atributos: Record<string, string> }
export type ProdutoCatalogoInput = {
  descricao: string; unidade: string; ncm?: string | null; tipoItem?: string | null; valorUnitario?: number | null
  estoqueMinimo?: number | null; pdv?: boolean; codigoFamilia?: number | null; descricaoFamilia?: string | null
  grupoId?: number | null; atributos?: Record<string, string>
  ean?: string | null
  /** Prazo de validade em dias (lote de compra/produção sem validade informada vence em entrada + N dias). */
  validadeDias?: number | null
  /** Campos de detalhe (origem, CEST, marca, modelo, pesos, medidas, descrição detalhada, observações): guardados em full_object.extras. */
  extras?: Record<string, string | number>
  /** Cria como produto mãe com estas variações (cada uma vira um produto com código e saldo próprios). */
  variacoes?: VariacaoInput[]
}

function validadeOk(n?: number | null): number | null {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) && v > 0 && v <= 3650 ? v : null
}

function limparAtributos(a?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(a ?? {})) {
    const chave = k.trim(); const valor = String(v ?? '').trim()
    if (chave && valor) out[chave] = valor
  }
  return out
}

export async function criarProdutoCatalogo(d: ProdutoCatalogoInput): Promise<{ ok: true; codigo: string; codigoProduto: number; variacoes: { codigo: string; descricao: string }[] } | Erro> {
  const ctx = await lojaProprio('Produtos - Criar')
  if ('error' in ctx) return ctx
  const supabase = createServiceClient()
  const variacoes = (d.variacoes ?? []).filter((v) => v.descricao?.trim())
  const ehMae = variacoes.length > 0
  if (ehMae) {
    const nomes = variacoes.map((v) => v.descricao.trim().toLowerCase())
    if (new Set(nomes).size !== nomes.length) return { error: 'Há variações com o mesmo nome' }
    if (variacoes.some((v) => !(v.preco >= 0))) return { error: 'Preço de variação inválido' }
  }
  const menorPreco = ehMae ? Math.min(...variacoes.map((v) => v.preco)) : Number(d.valorUnitario) || 0

  const r = await criarProdutoProprio(ctx.lojaId, { ...d, valorUnitario: menorPreco, pdv: d.pdv ?? false })
  if ('error' in r) return { error: r.error }
  const extra: Record<string, unknown> = {
    grupo_id: d.grupoId ?? null, atributos: limparAtributos(d.atributos), ean: d.ean?.trim() || null,
    full_object: { extras: d.extras ?? {} }, validade_dias: validadeOk(d.validadeDias),
  }
  if (ehMae) extra.eh_mae = true
  const { error: e1 } = await supabase.from('produtos').update(extra).eq('loja_id', ctx.lojaId).eq('codigo_produto', r.codigoProduto)
  if (e1) return { error: e1.message }

  const filhos: { codigo: string; descricao: string }[] = []
  for (const v of variacoes) {
    const rv = await criarProdutoProprio(ctx.lojaId, {
      descricao: v.descricao.trim(), unidade: d.unidade, ncm: d.ncm, valorUnitario: v.preco, estoqueMinimo: d.estoqueMinimo,
      pdv: d.pdv ?? false, tipoItem: d.tipoItem, codigoFamilia: d.codigoFamilia, descricaoFamilia: d.descricaoFamilia,
    })
    if ('error' in rv) return { error: `Mãe criada, mas a variação "${v.descricao}" falhou: ${rv.error}` }
    const { error: e2 } = await supabase.from('produtos').update({
      grupo_id: d.grupoId ?? null, produto_pai_codigo: r.codigoProduto, atributos: limparAtributos(v.atributos), validade_dias: validadeOk(d.validadeDias),
    }).eq('loja_id', ctx.lojaId).eq('codigo_produto', rv.codigoProduto)
    if (e2) return { error: `Variação "${v.descricao}" criada, mas não foi ligada à mãe: ${e2.message}` }
    filhos.push({ codigo: rv.codigo, descricao: v.descricao.trim() })
  }
  await registrarAuditoria('criar', ehMae ? 'produto mãe' : 'produto', r.codigoProduto, d.descricao)
  revalidatePath('/produto'); sincronizar(ctx.lojaId)
  return { ok: true, codigo: r.codigo, codigoProduto: r.codigoProduto, variacoes: filhos }
}

export type ProdutoCatalogo = {
  id: number; codigo: string; codigoProduto: number; descricao: string; unidade: string; ncm: string | null; tipoItem: string | null
  valorUnitario: number; estoqueMinimo: number | null; pdv: boolean; inativo: boolean; codigoFamilia: number | null
  grupoId: number | null; ehMae: boolean; paiCodigoProduto: number | null; atributos: Record<string, string>; vinculado: boolean
  ean: string | null; extras: Record<string, string | number>; validadeDias: number | null
  variacoes: { id: number; codigo: string; codigoProduto: number; descricao: string; valorUnitario: number; inativo: boolean; atributos: Record<string, string> }[]
}

export async function carregarProdutoCatalogo(codigo: string): Promise<ProdutoCatalogo | null> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const cols = 'id, codigo, codigo_produto, descricao, unidade, ncm, tipo_item, valor_unitario, estoque_minimo, pdv, inativo, codigo_familia, grupo_id, eh_mae, produto_pai_codigo, atributos, vendas_ref, ean, full_object, validade_dias'
  const { data: p } = await supabase.from('produtos').select(cols).eq('loja_id', lojaId).eq('codigo', codigo).maybeSingle()
  if (!p) return null
  const { data: filhos } = await supabase.from('produtos').select('id, codigo, codigo_produto, descricao, valor_unitario, inativo, atributos')
    .eq('loja_id', lojaId).eq('produto_pai_codigo', p.codigo_produto as number).order('id')
  return {
    id: p.id as number, codigo: p.codigo as string, codigoProduto: p.codigo_produto as number, descricao: (p.descricao as string) ?? '', unidade: (p.unidade as string) ?? 'UN',
    ncm: (p.ncm as string | null) ?? null, tipoItem: (p.tipo_item as string | null) ?? null, valorUnitario: Number(p.valor_unitario) || 0,
    estoqueMinimo: (p.estoque_minimo as number | null) ?? null, pdv: !!p.pdv, inativo: !!p.inativo, codigoFamilia: (p.codigo_familia as number | null) ?? null,
    grupoId: (p.grupo_id as number | null) ?? null, ehMae: !!p.eh_mae, paiCodigoProduto: (p.produto_pai_codigo as number | null) ?? null,
    atributos: (p.atributos as Record<string, string>) ?? {}, vinculado: !!p.vendas_ref,
    ean: (p.ean as string | null) ?? null, extras: ((p.full_object as { extras?: Record<string, string | number> } | null)?.extras) ?? {},
    validadeDias: (p.validade_dias as number | null) ?? null,
    variacoes: (filhos ?? []).map((f) => ({
      id: f.id as number, codigo: f.codigo as string, codigoProduto: f.codigo_produto as number, descricao: (f.descricao as string) ?? '',
      valorUnitario: Number(f.valor_unitario) || 0, inativo: !!f.inativo, atributos: (f.atributos as Record<string, string>) ?? {},
    })),
  }
}

export async function salvarProdutoCatalogo(
  codigo: string,
  d: { descricao: string; unidade: string; ncm: string | null; estoqueMinimo: number | null; pdv: boolean; inativo: boolean; valorUnitario: number | null; grupoId: number | null; atributos: Record<string, string>; ean?: string | null; extras?: Record<string, string | number>; validadeDias?: number | null },
  variacoes: { codigo: string | null; descricao: string; preco: number; inativo: boolean; atributos: Record<string, string> }[] = []
): Promise<{ ok: true } | Erro> {
  const ctx = await lojaProprio('Produtos - Editar')
  if ('error' in ctx) return ctx
  const supabase = createServiceClient()
  if (!d.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!d.unidade?.trim()) return { error: 'Informe a unidade' }
  const ncm = (d.ncm || '').replace(/\D/g, '')
  if (ncm && ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos (ou deixe em branco)' }
  const { data: p } = await supabase.from('produtos').select('id, codigo_produto, eh_mae, tipo_item, codigo_familia, descricao_familia').eq('loja_id', ctx.lojaId).eq('codigo', codigo).maybeSingle()
  if (!p) return { error: 'Produto não encontrado' }

  const ativas = variacoes.filter((v) => !v.inativo && v.descricao.trim())
  const preco = p.eh_mae && ativas.length ? Math.min(...ativas.map((v) => v.preco)) : d.valorUnitario
  const { error } = await supabase.from('produtos').update({
    descricao: d.descricao.trim(), unidade: d.unidade.trim(), ncm: ncm || null, estoque_minimo: d.estoqueMinimo, pdv: d.pdv,
    inativo: d.inativo, valor_unitario: preco, grupo_id: d.grupoId, atributos: limparAtributos(d.atributos), ean: d.ean?.trim() || null,
    full_object: { extras: d.extras ?? {} }, updated_at: new Date().toISOString(),
    ...(d.validadeDias !== undefined ? { validade_dias: validadeOk(d.validadeDias) } : {}),
  }).eq('id', p.id as number)
  if (error) return { error: error.message }

  if (p.eh_mae) {
    for (const v of variacoes) {
      if (v.codigo) {
        const { error: ev } = await supabase.from('produtos').update({
          descricao: v.descricao.trim(), valor_unitario: v.preco, inativo: v.inativo, atributos: limparAtributos(v.atributos), grupo_id: d.grupoId, updated_at: new Date().toISOString(),
        }).eq('loja_id', ctx.lojaId).eq('codigo', v.codigo).eq('produto_pai_codigo', p.codigo_produto as number)
        if (ev) return { error: `Variação "${v.descricao}": ${ev.message}` }
      } else if (v.descricao.trim()) {
        const rv = await criarProdutoProprio(ctx.lojaId, {
          descricao: v.descricao.trim(), unidade: d.unidade, ncm: ncm || null, valorUnitario: v.preco, estoqueMinimo: d.estoqueMinimo, pdv: d.pdv,
          tipoItem: (p.tipo_item as string | null) ?? '04', codigoFamilia: p.codigo_familia as number | null, descricaoFamilia: p.descricao_familia as string | null,
        })
        if ('error' in rv) return { error: `Nova variação "${v.descricao}": ${rv.error}` }
        await supabase.from('produtos').update({ grupo_id: d.grupoId, produto_pai_codigo: p.codigo_produto as number, atributos: limparAtributos(v.atributos) })
          .eq('loja_id', ctx.lojaId).eq('codigo_produto', rv.codigoProduto)
      }
    }
  }
  await registrarAuditoria('editar', 'produto', p.codigo_produto as number, d.descricao)
  revalidatePath('/produto'); revalidatePath(`/produto/${codigo}`); sincronizar(ctx.lojaId)
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------- sincronização
export async function sincronizarAgora(): Promise<{ ok: true; resumo: string } | Erro> {
  const ctx = await lojaProprio('Produtos - Editar')
  if ('error' in ctx) return ctx
  const r = await rodarSyncCatalogo()
  const minha = r.detalhes.find((d) => d.loja === ctx.lojaId)
  if (minha?.erro) return { error: String(minha.erro) }
  revalidatePath('/sync-catalogo')
  return { ok: true, resumo: `Entregues ${Number(minha?.entregues ?? 0)} · enfileirados ${Number(minha?.enfileirados ?? 0)} · aplicados do Vendas ${Number(minha?.aplicadoDoVendas ?? 0)}` }
}
