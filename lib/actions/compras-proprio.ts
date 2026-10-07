'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { criarProdutoProprio } from '@/lib/estoque/proprio-driver'
import { lerNfe, type ItemNfe, type NfeLida } from '@/lib/estoque/nfe-xml'

// Compras / NF-e de entrada do Estoque próprio. Só vale em loja 'proprio'. Toda entrada passa por lancar_compra (ledger).

const TAMANHO_MAX_XML = 900_000 // o corpo de uma server action tem teto de 1 MB

async function contexto(permissao: string): Promise<{ lojaId: number; userId: string | null } | { error: string }> {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return { error: 'Esta loja não usa o estoque próprio.' }
  if (!(await requirePermissao(lojaId, permissao))) return { error: 'Sem permissão' }
  const user = await getUser()
  return { lojaId, userId: user?.id ?? null }
}

function atualizarTelas() {
  revalidatePath('/compras')
  revalidatePath('/estoque')
}

const numero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export type ItemPrevia = ItemNfe & {
  codigoProduto: number | null
  fator: number
  sugestao: 'depara' | 'descricao' | null
  produto?: { codigo: string; descricao: string; unidade: string }
}
export type PreviaCompra = {
  nfe: NfeLida
  itens: ItemPrevia[]
  jaExiste: { id: number; status: string } | null
}

/** Lê o XML e sugere o produto de cada item (de-para do fornecedor, depois descrição igual). Não grava nada. */
export async function previaXml(xml: string): Promise<{ ok: true; previa: PreviaCompra } | { error: string }> {
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  if (!xml || xml.length > TAMANHO_MAX_XML) return { error: 'Arquivo vazio ou grande demais (máximo 900 KB).' }
  let nfe: NfeLida
  try { nfe = lerNfe(xml) } catch (e) { return { error: e instanceof Error ? e.message : 'XML inválido' } }

  const sb = createServiceClient()
  const [{ data: depara }, { data: existente }, { data: produtos }] = await Promise.all([
    nfe.fornecedor.cnpj
      ? sb.from('fornecedor_produto_depara').select('c_prod, codigo_produto, fator').eq('loja_id', ctx.lojaId).eq('fornecedor_cnpj', nfe.fornecedor.cnpj)
      : Promise.resolve({ data: [] as { c_prod: string; codigo_produto: number; fator: number }[] }),
    sb.from('compras_proprio').select('id, status').eq('loja_id', ctx.lojaId).eq('chave_acesso', nfe.chave).maybeSingle(),
    sb.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', ctx.lojaId).neq('inativo', true).limit(5000),
  ])
  const porProduto = new Map((produtos ?? []).map((p) => [Number(p.codigo_produto), p]))
  const porDescricao = new Map((produtos ?? []).map((p) => [String(p.descricao ?? '').trim().toLowerCase(), p]))
  const dp = new Map((depara ?? []).map((d) => [d.c_prod, d]))

  const itens: ItemPrevia[] = nfe.itens.map((i) => {
    const d = dp.get(i.cProd)
    if (d && porProduto.has(Number(d.codigo_produto))) {
      const p = porProduto.get(Number(d.codigo_produto))!
      return { ...i, codigoProduto: Number(d.codigo_produto), fator: Number(d.fator) || 1, sugestao: 'depara', produto: { codigo: p.codigo, descricao: p.descricao, unidade: p.unidade } }
    }
    const p = porDescricao.get(i.descricao.trim().toLowerCase())
    if (p) return { ...i, codigoProduto: Number(p.codigo_produto), fator: 1, sugestao: 'descricao', produto: { codigo: p.codigo, descricao: p.descricao, unidade: p.unidade } }
    return { ...i, codigoProduto: null, fator: 1, sugestao: null }
  })
  return { ok: true, previa: { nfe, itens, jaExiste: existente ? { id: Number(existente.id), status: existente.status } : null } }
}

export type Mapeamento = { linha: number; codigoProduto: number | null; fator: number }
type ResultadoLancamento = { ok: true; compraId: number; status: string; lancados: number; pendentes: number; duplicado: boolean } | { error: string }

async function chamarLancar(lojaId: number, compra: Record<string, unknown>, local: number, userId: string | null): Promise<ResultadoLancamento> {
  const { data, error } = await createServiceClient().rpc('lancar_compra', { p_compra: { ...compra, loja_id: lojaId }, p_local: local, p_user: userId })
  if (error) return { error: error.message }
  const r = data as { compra_id: number; status: string; lancados: number; pendentes: number; duplicado: boolean }
  return { ok: true, compraId: r.compra_id, status: r.status, lancados: r.lancados, pendentes: r.pendentes, duplicado: r.duplicado }
}

/** Importa o XML: relê no servidor (nunca confia nos valores do navegador), aplica o mapeamento e lança no ledger. */
export async function lancarCompraXml(dados: { xml: string; codigoLocal: number; icmsRecuperavel?: boolean; mapeamentos: Mapeamento[] }): Promise<ResultadoLancamento> {
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  if (!dados.codigoLocal) return { error: 'Escolha o local que recebe a mercadoria.' }
  if (!dados.xml || dados.xml.length > TAMANHO_MAX_XML) return { error: 'Arquivo vazio ou grande demais.' }
  let nfe: NfeLida
  try { nfe = lerNfe(dados.xml) } catch (e) { return { error: e instanceof Error ? e.message : 'XML inválido' } }
  const mapa = new Map(dados.mapeamentos.map((m) => [m.linha, m]))
  const r = await chamarLancar(ctx.lojaId, {
    origem: 'xml', chave_acesso: nfe.chave, numero: nfe.numero, serie: nfe.serie,
    fornecedor_cnpj: nfe.fornecedor.cnpj, fornecedor_nome: nfe.fornecedor.nome, emissao: nfe.emissao,
    valor_frete: nfe.valores.frete, valor_desconto: nfe.valores.descontoNota, icms_recuperavel: !!dados.icmsRecuperavel,
    itens: nfe.itens.map((i) => {
      const m = mapa.get(i.linha)
      return {
        linha: i.linha, c_prod: i.cProd, ean: i.ean, descricao: i.descricao, ncm: i.ncm, cfop: i.cfop, unidade_compra: i.unidade,
        quantidade: i.quantidade, valor_unitario: i.valorUnitario, valor_total: i.valorTotal, desconto: i.desconto, icms_valor: i.icms,
        fator: m?.fator && m.fator > 0 ? m.fator : 1, codigo_produto: m?.codigoProduto ?? null,
      }
    }),
  }, dados.codigoLocal, ctx.userId)
  if ('error' in r) return r
  await registrarAuditoria('criar', 'compra (XML)', r.compraId, `NF ${nfe.numero} · ${nfe.fornecedor.nome}`)
  atualizarTelas()
  return r
}

export type ItemManual = { codigoProduto: number; quantidade: number | string; valorUnitario: number | string; unidade?: string; fator?: number | string; descricao?: string }

/** Compra sem XML (nota de papel, feira, mercado): fornecedor e itens digitados. */
export async function lancarCompraManual(dados: {
  codigoLocal: number; fornecedorNome?: string; fornecedorCnpj?: string; numero?: string; emissao?: string
  frete?: number | string; desconto?: number | string; obs?: string; itens: ItemManual[]
}): Promise<ResultadoLancamento> {
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  if (!dados.codigoLocal) return { error: 'Escolha o local que recebe a mercadoria.' }
  const itens = (dados.itens ?? []).filter((i) => i.codigoProduto && numero(i.quantidade) > 0)
  if (!itens.length) return { error: 'Inclua ao menos um item com produto e quantidade.' }
  if (itens.some((i) => numero(i.valorUnitario) < 0)) return { error: 'Valor unitário não pode ser negativo.' }
  const r = await chamarLancar(ctx.lojaId, {
    origem: 'manual', numero: dados.numero?.trim() || null, fornecedor_cnpj: dados.fornecedorCnpj || null,
    fornecedor_nome: dados.fornecedorNome?.trim() || null, emissao: dados.emissao || null,
    valor_frete: numero(dados.frete), valor_desconto: numero(dados.desconto), obs: dados.obs?.trim() || null,
    itens: itens.map((i, idx) => ({
      linha: idx + 1, c_prod: null, descricao: i.descricao ?? null, unidade_compra: i.unidade ?? null,
      quantidade: numero(i.quantidade), valor_unitario: numero(i.valorUnitario), valor_total: Math.round(numero(i.quantidade) * numero(i.valorUnitario) * 100) / 100,
      fator: numero(i.fator) > 0 ? numero(i.fator) : 1, codigo_produto: i.codigoProduto,
    })),
  }, dados.codigoLocal, ctx.userId)
  if ('error' in r) return r
  await registrarAuditoria('criar', 'compra (manual)', r.compraId, dados.fornecedorNome?.trim() || null)
  atualizarTelas()
  return r
}

/** Mapeia os itens pendentes de uma compra já importada e lança só eles. */
export async function mapearPendentes(dados: { compraId: number; mapeamentos: Mapeamento[] }): Promise<ResultadoLancamento> {
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  const { data: compra } = await createServiceClient().from('compras_proprio').select('id, codigo_local_estoque').eq('id', dados.compraId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!compra) return { error: 'Compra não encontrada.' }
  if (!compra.codigo_local_estoque) return { error: 'A compra não tem local de destino.' }
  const r = await chamarLancar(ctx.lojaId, {
    id: dados.compraId,
    itens: dados.mapeamentos.filter((m) => m.codigoProduto).map((m) => ({ linha: m.linha, codigo_produto: m.codigoProduto, fator: m.fator > 0 ? m.fator : 1 })),
  }, Number(compra.codigo_local_estoque), ctx.userId)
  if ('error' in r) return r
  await registrarAuditoria('editar', 'compra (mapeamento)', dados.compraId, null)
  atualizarTelas()
  return r
}

export async function estornarCompra(compraId: number): Promise<{ ok: true; estornados: number } | { error: string }> {
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const { data: compra } = await sb.from('compras_proprio').select('id, numero').eq('id', compraId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!compra) return { error: 'Compra não encontrada.' }
  const { data, error } = await sb.rpc('estornar_compra', { p_compra_id: compraId, p_user: ctx.userId })
  if (error) return { error: error.message }
  await registrarAuditoria('excluir', 'compra (estorno)', compraId, compra.numero ?? null)
  atualizarTelas()
  return { ok: true, estornados: Number((data as { estornados: number }).estornados) }
}

export type ProdutoBusca = { codigoProduto: number; codigo: string; descricao: string; unidade: string }

export async function buscarProdutosCompra(termo: string): Promise<ProdutoBusca[]> {
  const ctx = await contexto('Compras')
  if ('error' in ctx) return []
  const q = termo.trim().replace(/[%,()]/g, ' ')
  if (q.length < 2) return []
  const { data } = await createServiceClient().from('produtos').select('codigo_produto, codigo, descricao, unidade')
    .eq('loja_id', ctx.lojaId).neq('inativo', true).or(`descricao.ilike.%${q}%,codigo.ilike.${q}%`).order('descricao').limit(15)
  return (data ?? []).map((p) => ({ codigoProduto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }))
}

/** Cria o produto na hora, com código por tipo (90 revenda, 80 matéria-prima, 70 intermediário, 60 consumo, 50 outros). */
export async function criarProdutoRapido(dados: { descricao: string; unidade: string; tipoItem: string; ncm?: string | null }): Promise<{ ok: true; produto: ProdutoBusca } | { error: string }> {
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  if (!(await requirePermissao(ctx.lojaId, 'Produtos - Criar'))) return { error: 'Sem permissão para criar produto' }
  const r = await criarProdutoProprio(ctx.lojaId, { descricao: dados.descricao, unidade: dados.unidade, tipoItem: dados.tipoItem, ncm: dados.ncm ?? null })
  if ('error' in r) return r
  await registrarAuditoria('criar', 'produto', r.codigoProduto, dados.descricao.trim())
  return { ok: true, produto: { codigoProduto: r.codigoProduto, codigo: r.codigo, descricao: dados.descricao.trim(), unidade: dados.unidade.trim() } }
}
