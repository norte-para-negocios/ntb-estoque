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
  const { data: atual } = await supabase.from('produtos').select('codigo_produto').eq('id', id).eq('loja_id', lojaId).maybeSingle()
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
export async function criarLocalProprio(lojaId: number, d: { descricao: string; codigo?: string | null; padrao?: boolean }): Promise<Resultado<{ codigoLocalEstoque: number }>> {
  if (!d.descricao?.trim()) return { error: 'Informe a descrição do local' }
  const supabase = createServiceClient()
  if (d.padrao) await supabase.from('local_estoques').update({ padrao: 'N' }).eq('loja_id', lojaId)
  const codigoLocalEstoque = await novoIdLocalProprio()
  const { error } = await supabase.from('local_estoques').insert({
    loja_id: lojaId,
    codigo_local_estoque: codigoLocalEstoque,
    codigo: d.codigo?.trim() || null,
    descricao: d.descricao.trim(),
    padrao: d.padrao ? 'S' : 'N',
    inativo: 'N',
    disp_venda: 'S',
    disp_consumo_op: 'S',
    disp_ordem_producao: 'S',
  })
  if (error) return { error: error.message }
  return { ok: true, codigoLocalEstoque }
}

export async function editarLocalProprio(lojaId: number, codigoLocalEstoque: number, d: { descricao: string; codigo?: string | null }): Promise<Resultado> {
  if (!d.descricao?.trim()) return { error: 'Informe a descrição do local' }
  const { error } = await createServiceClient()
    .from('local_estoques')
    .update({ descricao: d.descricao.trim(), codigo: d.codigo?.trim() || null, updated_at: new Date().toISOString() })
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', codigoLocalEstoque)
  if (error) return { error: error.message }
  return { ok: true }
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
