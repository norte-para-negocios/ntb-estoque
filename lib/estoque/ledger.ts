import { createServiceClient } from '@/lib/supabase/server'

export type ModoEstoque = 'omie' | 'proprio' | 'nenhum'

export type ResultadoMovimento = {
  ok: boolean
  duplicado: boolean
  id: number
  saldo: number
  saldo_total?: number
  cmc: number | null
  negativo?: boolean
  custo_estimado?: boolean
}

export async function modoDaLoja(lojaId: number): Promise<ModoEstoque> {
  const { data } = await createServiceClient().from('lojas').select('modo_estoque').eq('id', lojaId).maybeSingle()
  const m = (data as { modo_estoque?: string } | null)?.modo_estoque
  return m === 'proprio' || m === 'nenhum' ? m : 'omie'
}

type Base = { lojaId: number; local: number; produto: number; origem: string; ref: string; user?: string | null; obs?: string | null; linha?: number; data?: string | null }

async function mover(tipo: 'ENT' | 'SAI' | 'AJU' | 'PRD', b: Base & { quantidade: number; custo?: number | null }): Promise<ResultadoMovimento> {
  const { data, error } = await createServiceClient().rpc('registrar_movimento', {
    p_loja: b.lojaId, p_local: b.local, p_produto: b.produto, p_tipo: tipo, p_origem: b.origem, p_ref: b.ref,
    p_quantidade: b.quantidade, p_custo: b.custo ?? null, p_user: b.user ?? null, p_obs: b.obs ?? null,
    p_linha: b.linha ?? 0, p_reverses: null, p_transferencia_ref: null, p_data: b.data ?? null,
  })
  if (error) throw new Error(error.message)
  return data as ResultadoMovimento
}

/** Entrada (compra, saldo inicial, devolução). `custo` ausente não dilui nem zera o custo médio. */
export const entrada = (b: Base & { quantidade: number; custo?: number | null }) => mover('ENT', b)
/** Saída (venda, consumo, perda). Nunca bloqueia por saldo: negativo é permitido e alertado. */
export const saida = (b: Base & { quantidade: number }) => mover('SAI', b)
/** Ajuste com sinal (inventário): quantidade positiva soma, negativa subtrai. */
export const ajuste = (b: Base & { quantidade: number; custo?: number | null }) => mover('AJU', b)
/** Produção: entrega do produto acabado/intermediário (quantidade positiva) ou consumo (negativa). */
export const producao = (b: Base & { quantidade: number; custo?: number | null }) => mover('PRD', b)

export async function estornar(id: number, user?: string | null, obs?: string | null): Promise<ResultadoMovimento> {
  const { data, error } = await createServiceClient().rpc('estornar_movimento', { p_id: id, p_user: user ?? null, p_obs: obs ?? null })
  if (error) throw new Error(error.message)
  return data as ResultadoMovimento
}

export async function transferir(b: { lojaId: number; de: number; para: number; produto: number; quantidade: number; ref: string; user?: string | null; obs?: string | null }) {
  const { data, error } = await createServiceClient().rpc('transferir_estoque', {
    p_loja: b.lojaId, p_de: b.de, p_para: b.para, p_produto: b.produto, p_quantidade: b.quantidade, p_ref: b.ref,
    p_user: b.user ?? null, p_obs: b.obs ?? null,
  })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; saida: ResultadoMovimento; entrada: ResultadoMovimento }
}

/** Código do produto no padrão por tipo de item (90 vendável, 80 matéria-prima, 70 intermediário, 60 consumo, 50 outros). */
export async function proximoCodigoProduto(lojaId: number, tipoItem: string): Promise<string> {
  const { data, error } = await createServiceClient().rpc('proximo_codigo_produto', { p_loja: lojaId, p_tipo_item: tipoItem })
  if (error) throw new Error(error.message)
  return data as string
}

export async function novoIdProdutoProprio(): Promise<number> {
  const { data, error } = await createServiceClient().rpc('novo_id_produto_proprio')
  if (error) throw new Error(error.message)
  return Number(data)
}

export async function novoIdLocalProprio(): Promise<number> {
  const { data, error } = await createServiceClient().rpc('novo_id_local_proprio')
  if (error) throw new Error(error.message)
  return Number(data)
}
