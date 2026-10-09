'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { revalidatePath } from 'next/cache'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarAuditoria } from '@/lib/auditoria'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { criarProdutoProprio } from '@/lib/estoque/proprio-driver'
import { lerNfe, type ItemNfe, type NfeLida } from '@/lib/estoque/nfe-xml'
import { gravarNotaCompleta } from '@/lib/estoque/nf-sefaz'
import { casarItem, montarContexto, type Depara, type ProdutoCad } from '@/lib/estoque/nf-conferencia'
import { espelharNotaNoFrio } from '@/lib/estoque/nf-frio'

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
  revalidatePath('/nota-fiscal')
  revalidatePath('/estoque')
}

const numero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export type ItemPrevia = ItemNfe & {
  codigoProduto: number | null
  fator: number
  sugestao: 'depara' | 'ean' | 'descricao' | null
  produto?: { codigo: string; descricao: string; unidade: string }
}
export type PreviaCompra = {
  nfe: NfeLida
  itens: ItemPrevia[]
  jaExiste: { id: number; status: string; notaId: number | null } | null
}

/** Lê o XML e sugere o produto de cada item (de-para do fornecedor, depois descrição igual). Não grava nada. */
export async function previaXml(xml: string): Promise<{ ok: true; previa: PreviaCompra } | { error: string }> {
  const __d = viaDesktop('compras-proprio#previaXml', previaXml, [xml]); if (__d) return __d as never
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  if (!xml || xml.length > TAMANHO_MAX_XML) return { error: 'Arquivo vazio ou grande demais (máximo 900 KB).' }
  let nfe: NfeLida
  try { nfe = lerNfe(xml) } catch (e) { return { error: e instanceof Error ? e.message : 'XML inválido' } }

  const sb = createServiceClient()
  const [{ data: depara }, { data: existente }, { data: produtos }] = await Promise.all([
    nfe.fornecedor.cnpj
      ? sb.from('fornecedor_produto_depara').select('c_prod, codigo_produto, fator').eq('loja_id', ctx.lojaId).eq('fornecedor_cnpj', nfe.fornecedor.cnpj)
      : Promise.resolve({ data: [] as Depara[] }),
    sb.from('compras_proprio').select('id, status, nota_fiscal_id').eq('loja_id', ctx.lojaId).eq('chave_acesso', nfe.chave).maybeSingle(),
    sb.from('produtos').select('codigo_produto, codigo, descricao, unidade, ean, inativo').eq('loja_id', ctx.lojaId).neq('inativo', true).limit(5000),
  ])
  const cad = montarContexto((produtos ?? []) as ProdutoCad[], (depara ?? []) as Depara[])
  const itens: ItemPrevia[] = nfe.itens.map((i) => {
    const m = casarItem({ cProd: i.cProd, ean: i.ean, descricao: i.descricao, unidade: i.unidade }, cad)
    const alvo = m.codigoProduto ?? m.sugestao
    const p = alvo != null ? cad.produtosPorCodigo.get(alvo) : undefined
    return {
      ...i, codigoProduto: alvo, fator: m.fator, sugestao: m.origem,
      produto: p ? { codigo: p.codigo, descricao: p.descricao, unidade: p.unidade ?? '' } : undefined,
    }
  })
  return { ok: true, previa: { nfe, itens, jaExiste: existente ? { id: Number(existente.id), status: existente.status, notaId: existente.nota_fiscal_id != null ? Number(existente.nota_fiscal_id) : null } : null } }
}

export type Mapeamento = { linha: number; codigoProduto: number | null; fator: number }
type ResultadoLancamento = { ok: true; compraId: number; notaId: number | null; status: string; lancados: number; pendentes: number; duplicado: boolean } | { error: string }

async function chamarLancar(lojaId: number, compra: Record<string, unknown>, local: number, userId: string | null): Promise<ResultadoLancamento> {
  // lancar_compra_com_lotes (migration 145) = lancar_compra + lote/validade de cada item até o gatilho de lotes.
  const { data, error } = await createServiceClient().rpc('lancar_compra_com_lotes', { p_compra: { ...compra, loja_id: lojaId }, p_local: local, p_user: userId })
  if (error) return { error: error.message }
  const r = data as { compra_id: number; status: string; lancados: number; pendentes: number; duplicado: boolean }
  return { ok: true, compraId: r.compra_id, notaId: null, status: r.status, lancados: r.lancados, pendentes: r.pendentes, duplicado: r.duplicado }
}

/** Importa o XML: relê no servidor (nunca confia nos valores do navegador), aplica o mapeamento e lança no ledger. */
export async function lancarCompraXml(dados: { xml: string; codigoLocal: number; icmsRecuperavel?: boolean; mapeamentos: Mapeamento[] }): Promise<ResultadoLancamento> {
  const __d = viaDesktop('compras-proprio#lancarCompraXml', lancarCompraXml, [dados]); if (__d) return __d as never
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  if (!dados.codigoLocal) return { error: 'Escolha o local que recebe a mercadoria.' }
  if (!dados.xml || dados.xml.length > TAMANHO_MAX_XML) return { error: 'Arquivo vazio ou grande demais.' }
  let nfe: NfeLida
  try { nfe = lerNfe(dados.xml) } catch (e) { return { error: e instanceof Error ? e.message : 'XML inválido' } }
  const mapa = new Map(dados.mapeamentos.map((m) => [m.linha, { codigoProduto: m.codigoProduto, fator: m.fator }]))
  const { data: loja } = await createServiceClient().from('lojas').select('cnpj').eq('id', ctx.lojaId).maybeSingle()
  let res
  try {
    res = await gravarNotaCompleta(ctx.lojaId, nfe, {
      ambiente: '1', origem: 'xml', autoLancar: false, lancarParcial: true, mapeamentos: mapa, icmsRecuperavel: !!dados.icmsRecuperavel,
      localEntrada: dados.codigoLocal, userId: ctx.userId, cnpjLoja: String(loja?.cnpj ?? '').replace(/\D/g, '') || null,
    })
  } catch (e) { return { error: e instanceof Error ? e.message : 'Falha ao lançar a nota' } }
  // guarda o XML completo (download na tela da nota; mesma tabela dos documentos recebidos da SEFAZ)
  await createServiceClient().from('sefaz_documentos').upsert({ loja_id: ctx.lojaId, nsu: `upload-${nfe.chave}`, schema: 'procNFe_upload', tipo: 'procNFe', chave: nfe.chave, completo: true, xml: dados.xml, nota_fiscal_id: res.notaId, processado: true }, { onConflict: 'loja_id,nsu', ignoreDuplicates: true })
  await registrarAuditoria('criar', 'compra (XML)', res.compraId ?? res.notaId, `NF ${nfe.numero} · ${nfe.fornecedor.nome}`)
  atualizarTelas()
  return { ok: true, compraId: res.compraId ?? 0, notaId: res.notaId, status: res.status, lancados: res.lancados, pendentes: res.pendentes, duplicado: !res.criada && res.lancados === 0 && res.pendentes === 0 }
}

export type ItemManual = { codigoProduto: number; quantidade: number | string; valorUnitario: number | string; unidade?: string; fator?: number | string; descricao?: string; lote?: string | null; validade?: string | null }

/** Compra sem XML (nota de papel, feira, mercado): fornecedor e itens digitados. */
export async function lancarCompraManual(dados: {
  codigoLocal: number; fornecedorNome?: string; fornecedorCnpj?: string; numero?: string; emissao?: string
  frete?: number | string; desconto?: number | string; obs?: string; itens: ItemManual[]
}): Promise<ResultadoLancamento> {
  const __d = viaDesktop('compras-proprio#lancarCompraManual', lancarCompraManual, [dados]); if (__d) return __d as never
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
      lote: i.lote?.trim() || null, validade: i.validade && /^\d{4}-\d{2}-\d{2}$/.test(i.validade) ? i.validade : null,
    })),
  }, dados.codigoLocal, ctx.userId)
  if ('error' in r) return r
  // A compra manual também aparece em Notas Fiscais (sem chave de acesso: nota de papel).
  const notaId = await criarNotaDaCompraManual(ctx.lojaId, r.compraId, dados, itens)
  await registrarAuditoria('criar', 'compra (manual)', r.compraId, dados.fornecedorNome?.trim() || null)
  atualizarTelas()
  return { ...r, notaId }
}

async function criarNotaDaCompraManual(
  lojaId: number, compraId: number,
  dados: { fornecedorNome?: string; fornecedorCnpj?: string; numero?: string; emissao?: string; frete?: number | string; desconto?: number | string },
  itens: ItemManual[]
): Promise<number | null> {
  try {
    const sb = createServiceClient()
    const { data: prods } = await sb.from('produtos').select('codigo_produto, descricao').eq('loja_id', lojaId).in('codigo_produto', itens.map((i) => i.codigoProduto))
    const nome = new Map((prods ?? []).map((p) => [Number(p.codigo_produto), p.descricao as string]))
    const total = (n: number) => Math.round(n * 100) / 100
    const produtos = total(itens.reduce((a, i) => a + numero(i.quantidade) * numero(i.valorUnitario), 0))
    const valor = total(produtos + numero(dados.frete) - numero(dados.desconto))
    const cnpj = (dados.fornecedorCnpj ?? '').replace(/\D/g, '')
    const { data: g, error } = await sb.rpc('gravar_nota_sefaz', {
      p_loja: lojaId,
      p_cab: {
        numero: dados.numero?.trim() || null, emissao: dados.emissao || null, valor, fornecedor_nome: dados.fornecedorNome?.trim() || 'Compra sem nota', fornecedor_cnpj: cnpj || null,
        ambiente: '1', natureza: 'Compra lançada manualmente',
        full_object: {
          cabec: { cCNPJ_CPF: cnpj, cInscricao: '', cNaturezaOperacao: 'Compra lançada manualmente' },
          infoCadastro: { cRecebido: 'N', cFaturado: 'N', cCancelada: 'N', cDevolvido: 'N', cBloqueado: 'N' },
          totais: { vTotalProdutos: produtos }, sefaz: { origem: 'manual', completo: true, alertas: [] },
        },
      },
      p_itens: itens.map((i, idx) => ({
        seq: idx + 1, c_prod: null, descricao: i.descricao ?? nome.get(i.codigoProduto) ?? `Item ${idx + 1}`, qtde: numero(i.quantidade), unidade: i.unidade ?? null,
        preco_unit: numero(i.valorUnitario), desconto: 0, frete: 0, total: total(numero(i.quantidade) * numero(i.valorUnitario)), n_id_produto: String(i.codigoProduto),
      })),
    })
    if (error) throw new Error(error.message)
    const notaId = Number((g as { nota_id: number }).nota_id)
    await sb.from('compras_proprio').update({ nota_fiscal_id: notaId }).eq('id', compraId).eq('loja_id', lojaId)
    await sb.rpc('sincronizar_situacao_nota', { p_loja: lojaId, p_nota: notaId })
    void espelharNotaNoFrio(lojaId, notaId)
    return notaId
  } catch (e) {
    console.error('compra manual: a compra entrou no estoque, mas a nota não foi criada em Notas Fiscais', e)
    return null
  }
}

/** Mapeia os itens pendentes de uma compra já importada e lança só eles. */
export async function mapearPendentes(dados: { compraId: number; mapeamentos: Mapeamento[] }): Promise<ResultadoLancamento> {
  const __d = viaDesktop('compras-proprio#mapearPendentes', mapearPendentes, [dados]); if (__d) return __d as never
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
  await sincronizarNotaDaCompra(ctx.lojaId, dados.compraId)
  await registrarAuditoria('editar', 'compra (mapeamento)', dados.compraId, null)
  atualizarTelas()
  return r
}

export async function estornarCompra(compraId: number): Promise<{ ok: true; estornados: number } | { error: string }> {
  const __d = viaDesktop('compras-proprio#estornarCompra', estornarCompra, [compraId]); if (__d) return __d as never
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  const sb = createServiceClient()
  const { data: compra } = await sb.from('compras_proprio').select('id, numero').eq('id', compraId).eq('loja_id', ctx.lojaId).maybeSingle()
  if (!compra) return { error: 'Compra não encontrada.' }
  const { data, error } = await sb.rpc('estornar_compra', { p_compra_id: compraId, p_user: ctx.userId })
  if (error) return { error: error.message }
  await sincronizarNotaDaCompra(ctx.lojaId, compraId)
  await registrarAuditoria('excluir', 'compra (estorno)', compraId, compra.numero ?? null)
  atualizarTelas()
  return { ok: true, estornados: Number((data as { estornados: number }).estornados) }
}

export type ProdutoBusca = { codigoProduto: number; codigo: string; descricao: string; unidade: string }

export async function buscarProdutosCompra(termo: string): Promise<ProdutoBusca[]> {
  const __d = viaDesktop('compras-proprio#buscarProdutosCompra', buscarProdutosCompra, [termo]); if (__d) return __d as never
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
  const __d = viaDesktop('compras-proprio#criarProdutoRapido', criarProdutoRapido, [dados]); if (__d) return __d as never
  const ctx = await contexto('Compras - Criar')
  if ('error' in ctx) return ctx
  if (!(await requirePermissao(ctx.lojaId, 'Produtos - Criar'))) return { error: 'Sem permissão para criar produto' }
  const r = await criarProdutoProprio(ctx.lojaId, { descricao: dados.descricao, unidade: dados.unidade, tipoItem: dados.tipoItem, ncm: dados.ncm ?? null })
  if ('error' in r) return r
  await registrarAuditoria('criar', 'produto', r.codigoProduto, dados.descricao.trim())
  return { ok: true, produto: { codigoProduto: r.codigoProduto, codigo: r.codigo, descricao: dados.descricao.trim(), unidade: dados.unidade.trim() } }
}

async function sincronizarNotaDaCompra(lojaId: number, compraId: number) {
  const sb = createServiceClient()
  const { data } = await sb.from('compras_proprio').select('nota_fiscal_id').eq('id', compraId).eq('loja_id', lojaId).maybeSingle()
  if (data?.nota_fiscal_id) {
    await sb.rpc('sincronizar_situacao_nota', { p_loja: lojaId, p_nota: Number(data.nota_fiscal_id) })
    void espelharNotaNoFrio(lojaId, Number(data.nota_fiscal_id))
  }
}
