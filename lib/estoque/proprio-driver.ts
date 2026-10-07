// Driver "proprio" do Estoque (06/10/2026): cadastro de produto, familia e local de estoque SEM Omie.
// Nada aqui importa lib/omie: loja em modo 'proprio' nunca chama omieRequest. Modo 'omie' segue o caminho antigo
// das server actions (despacho no começo de cada uma).
import { createServiceClient } from '@/lib/supabase/server'
import { novoIdLocalProprio, novoIdProdutoProprio, proximoCodigoProduto } from './ledger'

export const FAMILIAS_PADRAO = ['Bebidas', 'Cozinha', 'Insumos', 'Limpeza', 'Embalagens'] as const
export const LOCAIS_PADRAO = [
  { descricao: 'Estoque Geral', padrao: 'S' },
  { descricao: 'Bar', padrao: 'N' },
  { descricao: 'Cozinha', padrao: 'N' },
] as const

type Resultado<T = object> = ({ ok: true } & T) | { error: string }

// -------------------------------------------------------------------------------- produto
export type ProdutoProprioInput = {
  descricao: string
  unidade: string
  ncm?: string | null
  valorUnitario?: number | null
  estoqueMinimo?: number | null
  pdv?: boolean
  tipoItem?: string | null
  codigoFamilia?: number | null
  descricaoFamilia?: string | null
}

/** Cria o produto com código automático por tipo (90/80/70/60/50) e id próprio. Nunca chama o Omie. */
export async function criarProdutoProprio(lojaId: number, d: ProdutoProprioInput): Promise<Resultado<{ codigoProduto: number; codigo: string }>> {
  if (!d.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!d.unidade?.trim()) return { error: 'Informe a unidade (ex.: UN, KG)' }
  const ncm = (d.ncm || '').replace(/\D/g, '')
  if (ncm && ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos (ou deixe em branco)' }
  const tipoItem = d.tipoItem?.trim() || '04'

  const supabase = createServiceClient()
  const codigo = await proximoCodigoProduto(lojaId, tipoItem)
  const codigoProduto = await novoIdProdutoProprio()
  const { error } = await supabase.from('produtos').insert({
    loja_id: lojaId,
    codigo_produto: codigoProduto,
    codigo,
    descricao: d.descricao.trim(),
    unidade: d.unidade.trim(),
    ncm: ncm || null,
    valor_unitario: Number(d.valorUnitario) || 0,
    estoque_minimo: d.estoqueMinimo ?? null,
    pdv: d.pdv ?? false,
    tipo_item: tipoItem,
    codigo_familia: d.codigoFamilia || null,
    descricao_familia: d.descricaoFamilia || null,
    inativo: false,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  return { ok: true, codigoProduto, codigo }
}

export type ProdutoProprioEdicao = {
  descricao: string
  codigoFamilia: number | null
  descricaoFamilia: string | null
  tipoItem: string | null
  unidade: string
  ncm: string | null
  valorUnitario: number | null
  estoqueMinimo: number | null
  pdv: boolean
  inativo: boolean
}

/** Edita só no banco local. O código nunca muda (trigger do banco também barra). */
export async function editarProdutoProprio(lojaId: number, id: number, d: ProdutoProprioEdicao): Promise<Resultado<{ codigoProduto: number | null }>> {
  if (!d.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!d.unidade?.trim()) return { error: 'Informe a unidade (ex.: UN, KG)' }
  const ncm = (d.ncm || '').replace(/\D/g, '')
  if (ncm && ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos (ou deixe em branco)' }
  if (d.valorUnitario != null && (Number.isNaN(d.valorUnitario) || d.valorUnitario < 0)) return { error: 'Preço de venda inválido' }
  if (d.estoqueMinimo != null && (Number.isNaN(d.estoqueMinimo) || d.estoqueMinimo < 0)) return { error: 'Estoque mínimo inválido' }

  const supabase = createServiceClient()
  const { data: atual } = await supabase.from('produtos').select('codigo_produto, codigo').eq('id', id).eq('loja_id', lojaId).maybeSingle()
  if (!atual) return { error: 'Produto não encontrado' }
  const { error } = await supabase
    .from('produtos')
    .update({
      descricao: d.descricao.trim(),
      codigo_familia: d.codigoFamilia,
      descricao_familia: d.descricaoFamilia,
      tipo_item: d.tipoItem?.trim() || null,
      unidade: d.unidade.trim(),
      ncm: ncm || null,
      valor_unitario: d.valorUnitario,
      estoque_minimo: d.estoqueMinimo,
      pdv: d.pdv,
      inativo: d.inativo,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }
  // A mudança chega ao Norte Vendas pelo outbox do catálogo (gatilho no banco); sem PATCH direto.
  return { ok: true, codigoProduto: (atual.codigo_produto as number | null) ?? null }
}

/** Produto com movimento no ledger nunca é apagado: inative. */
export async function excluirProdutoProprio(lojaId: number, codigoProduto: number): Promise<Resultado> {
  const supabase = createServiceClient()
  const { count } = await supabase
    .from('estoque_movimentos')
    .select('id', { count: 'exact', head: true })
    .eq('loja_id', lojaId)
    .eq('codigo_produto', codigoProduto)
  if ((count ?? 0) > 0) return { error: 'O produto já tem movimentos de estoque: inative em vez de excluir.' }
  const { error } = await supabase.from('produtos').delete().eq('loja_id', lojaId).eq('codigo_produto', codigoProduto)
  if (error) return { error: error.message }
  return { ok: true }
}

// -------------------------------------------------------------------------------- familia
export async function criarFamiliaProprio(lojaId: number, d: { nome: string; codigo?: string | null; inativo?: boolean }): Promise<Resultado<{ codigoFamilia: number }>> {
  if (!d.nome?.trim()) return { error: 'Informe o nome da família' }
  const codigoFamilia = await novoIdProdutoProprio()
  const { error } = await createServiceClient().from('familias').insert({
    loja_id: lojaId,
    codigo_familia: codigoFamilia,
    nome: d.nome.trim(),
    codigo: d.codigo?.trim() || null,
    inativo: d.inativo ?? false,
    origem: 'local',
  })
  if (error) return { error: error.message }
  return { ok: true, codigoFamilia }
}

export async function editarFamiliaProprio(lojaId: number, id: number, d: { nome: string; codigo?: string | null; inativo: boolean }): Promise<Resultado> {
  if (!d.nome?.trim()) return { error: 'Informe o nome da família' }
  const { error } = await createServiceClient()
    .from('familias')
    .update({ nome: d.nome.trim(), codigo: d.codigo?.trim() || null, inativo: d.inativo, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('loja_id', lojaId)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function excluirFamiliaProprio(lojaId: number, id: number): Promise<Resultado> {
  const { error } = await createServiceClient().from('familias').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }
  return { ok: true }
}

// -------------------------------------------------------------------------------- local
/** Campos de um local de estoque do modo próprio (os mesmos que a tela de Locais mostra hoje). 'S'/'N' como no cadastro. */
export type LocalProprioCampos = {
  descricao: string
  codigo?: string | null
  tipo?: string | null
  padrao?: boolean
  inativo?: boolean
  dispOrdemProducao?: boolean
  dispConsumoOp?: boolean
  dispRemessa?: boolean
  dispVenda?: boolean
}

const sn = (v: boolean | undefined, padrao: 'S' | 'N'): 'S' | 'N' => (v === undefined ? padrao : v ? 'S' : 'N')

export async function criarLocalProprio(lojaId: number, d: LocalProprioCampos): Promise<Resultado<{ codigoLocalEstoque: number }>> {
  if (!d.descricao?.trim()) return { error: 'Informe a descrição do local' }
  const supabase = createServiceClient()
  if (d.padrao) await supabase.from('local_estoques').update({ padrao: 'N' }).eq('loja_id', lojaId)
  const codigoLocalEstoque = await novoIdLocalProprio()
  const { error } = await supabase.from('local_estoques').insert({
    loja_id: lojaId,
    codigo_local_estoque: codigoLocalEstoque,
    codigo: d.codigo?.trim() || null,
    descricao: d.descricao.trim(),
    tipo: d.tipo?.trim() || null,
    padrao: d.padrao ? 'S' : 'N',
    inativo: sn(d.inativo, 'N'),
    disp_venda: sn(d.dispVenda, 'S'),
    disp_consumo_op: sn(d.dispConsumoOp, 'S'),
    disp_ordem_producao: sn(d.dispOrdemProducao, 'S'),
    disp_remessa: sn(d.dispRemessa, 'S'),
  })
  if (error) return { error: error.message }
  return { ok: true, codigoLocalEstoque }
}

/** Edita só o que veio informado (campo ausente = não mexe). Marcar como padrão desmarca os outros; o padrão não pode ser inativado. */
export async function editarLocalProprio(lojaId: number, codigoLocalEstoque: number, d: LocalProprioCampos): Promise<Resultado> {
  if (!d.descricao?.trim()) return { error: 'Informe a descrição do local' }
  const supabase = createServiceClient()
  const { data: atual } = await supabase
    .from('local_estoques')
    .select('padrao')
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', codigoLocalEstoque)
    .maybeSingle<{ padrao: string | null }>()
  if (!atual) return { error: 'Local não encontrado' }
  const seraPadrao = d.padrao === undefined ? atual.padrao === 'S' : d.padrao
  if (d.inativo === true && seraPadrao) return { error: 'O local padrão não pode ser inativado. Defina outro local como padrão antes.' }
  if (d.padrao === true) await supabase.from('local_estoques').update({ padrao: 'N' }).eq('loja_id', lojaId)
  const campos: Record<string, string | null> = {
    descricao: d.descricao.trim(),
    codigo: d.codigo?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  if (d.tipo !== undefined) campos.tipo = d.tipo?.trim() || null
  if (d.padrao !== undefined) campos.padrao = d.padrao ? 'S' : 'N'
  if (d.inativo !== undefined) campos.inativo = d.inativo ? 'S' : 'N'
  if (d.dispVenda !== undefined) campos.disp_venda = d.dispVenda ? 'S' : 'N'
  if (d.dispConsumoOp !== undefined) campos.disp_consumo_op = d.dispConsumoOp ? 'S' : 'N'
  if (d.dispOrdemProducao !== undefined) campos.disp_ordem_producao = d.dispOrdemProducao ? 'S' : 'N'
  if (d.dispRemessa !== undefined) campos.disp_remessa = d.dispRemessa ? 'S' : 'N'
  const { error } = await supabase.from('local_estoques').update(campos).eq('loja_id', lojaId).eq('codigo_local_estoque', codigoLocalEstoque)
  if (error) return { error: error.message }
  return { ok: true }
}

/** Local com movimento ou saldo no ledger não é excluído (some do histórico): inativa em vez de excluir. */
export async function localTemMovimento(lojaId: number, codigoLocalEstoque: number): Promise<boolean> {
  const supabase = createServiceClient()
  const { count } = await supabase
    .from('estoque_movimentos')
    .select('id', { count: 'exact', head: true })
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', codigoLocalEstoque)
  return (count ?? 0) > 0
}

// -------------------------------------------------------------------------------- loja nova
/** Semeia uma loja recém-criada em modo 'proprio': locais (Estoque Geral é o padrão, Bar, Cozinha) e famílias padrão. Idempotente. */
export async function semearLojaProprio(lojaId: number): Promise<{ locais: number; familias: number }> {
  const supabase = createServiceClient()
  const { data: locaisAtuais } = await supabase.from('local_estoques').select('descricao').eq('loja_id', lojaId)
  const temLocal = new Set((locaisAtuais ?? []).map((l) => String(l.descricao).toLowerCase()))
  let locais = 0
  for (const l of LOCAIS_PADRAO) {
    if (temLocal.has(l.descricao.toLowerCase())) continue
    const r = await criarLocalProprio(lojaId, { descricao: l.descricao, padrao: l.padrao === 'S' })
    if ('ok' in r) locais++
  }
  // Bar e Cozinha viram os locais de baixa dos itens de bar e de cozinha (se a loja ainda não escolheu outros).
  const { data: todos } = await supabase.from('local_estoques').select('descricao, codigo_local_estoque').eq('loja_id', lojaId)
  const achar = (nome: string) => (todos ?? []).find((l) => String(l.descricao).toLowerCase() === nome)?.codigo_local_estoque ?? null
  const { data: lojaAtual } = await supabase.from('lojas').select('local_estoque_bar_codigo, local_estoque_cozinha_codigo').eq('id', lojaId).maybeSingle()
  const upd: Record<string, number> = {}
  if (!lojaAtual?.local_estoque_bar_codigo && achar('bar')) upd.local_estoque_bar_codigo = Number(achar('bar'))
  if (!lojaAtual?.local_estoque_cozinha_codigo && achar('cozinha')) upd.local_estoque_cozinha_codigo = Number(achar('cozinha'))
  if (Object.keys(upd).length) await supabase.from('lojas').update(upd).eq('id', lojaId)
  const { data: famAtuais } = await supabase.from('familias').select('nome').eq('loja_id', lojaId)
  const temFam = new Set((famAtuais ?? []).map((f) => String(f.nome).toLowerCase()))
  let familias = 0
  for (const nome of FAMILIAS_PADRAO) {
    if (temFam.has(nome.toLowerCase())) continue
    const r = await criarFamiliaProprio(lojaId, { nome })
    if ('ok' in r) familias++
  }
  return { locais, familias }
}

// -------------------------------------------------------------------------------- integração (Norte Vendas)
/** Aviso best-effort ao Vendas quando nome/preço de um produto mudam aqui (nunca derruba a edição). */
export async function notificarVendasProduto(lojaId: number, codigo: string, nome: string, preco: number): Promise<void> {
  const vendasUrl = process.env.NTB_VENDAS_INTERNAL_URL
  if (!vendasUrl) return
  try {
    const { data: loja } = await createServiceClient().from('lojas').select('integracao_api_key').eq('id', lojaId).maybeSingle()
    const chave = (loja as { integracao_api_key?: string | null } | null)?.integracao_api_key
    if (!chave) return
    await fetch(`${vendasUrl.replace(/\/$/, '')}/api/integracao/produtos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
      body: JSON.stringify({ updates: [{ omieCodigo: codigo, nome, preco }] }),
    }).catch(() => {})
  } catch { /* silencioso: a edição local já foi salva */ }
}

/**
 * Cadastro vindo do Vendas em loja 'proprio': se vier `codigo` e ele já existe aqui, só VINCULA (marca PDV, não duplica);
 * se vier `codigo` novo, cria com ele; sem `codigo`, gera pelo tipo do item (default 04 = vendável, prefixo 90).
 */
export async function vincularOuCriarProdutoProprio(
  lojaId: number,
  d: { nome: string; precoVenda: number; ncm?: string | null; unidade?: string | null; codigo?: string | null; tipoItem?: string | null }
): Promise<Resultado<{ codigo: string; codigoProduto: number; existente: boolean }>> {
  const supabase = createServiceClient()
  const codigoPedido = d.codigo?.trim() || null
  if (codigoPedido) {
    const { data: ja } = await supabase.from('produtos').select('codigo_produto, codigo').eq('loja_id', lojaId).eq('codigo', codigoPedido).maybeSingle()
    if (ja) {
      await supabase.from('produtos').update({ pdv: true, updated_at: new Date().toISOString() }).eq('loja_id', lojaId).eq('codigo_produto', ja.codigo_produto)
      return { ok: true, codigo: ja.codigo as string, codigoProduto: Number(ja.codigo_produto), existente: true }
    }
  }
  const ncm = (d.ncm || '').replace(/\D/g, '') || '21069090' // mesmo ponto de partida técnico da rota do Omie; o contador revisa
  if (!codigoPedido) {
    const tipoNovo = d.tipoItem || '04'
    const r = await criarProdutoProprio(lojaId, {
      descricao: d.nome, unidade: d.unidade?.trim() || 'UN', ncm, valorUnitario: d.precoVenda, pdv: tipoNovo === '04' || tipoNovo === '00', tipoItem: tipoNovo,
    })
    if ('error' in r) return { error: r.error }
    return { ok: true, codigo: r.codigo, codigoProduto: r.codigoProduto, existente: false }
  }
  const codigoProduto = await novoIdProdutoProprio()
  const { error } = await supabase.from('produtos').insert({
    loja_id: lojaId, codigo_produto: codigoProduto, codigo: codigoPedido, descricao: d.nome.trim(), unidade: d.unidade?.trim() || 'UN',
    ncm, valor_unitario: d.precoVenda, pdv: !d.tipoItem || d.tipoItem === '04' || d.tipoItem === '00', tipo_item: d.tipoItem || '04', inativo: false, updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  return { ok: true, codigo: codigoPedido, codigoProduto, existente: false }
}
