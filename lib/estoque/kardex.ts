// Kardex da loja de estoque próprio: parâmetros da URL -> chamada ao RPC kardex_proprio (migration 137).
import { createServiceClient } from '@/lib/supabase/server'
import { hojeBahia, type LinhaKardex } from './kardex-tipos'

export { hojeBahia, ROTULO_TIPO, ROTULO_ORIGEM, OPCOES_ORIGEM, atalhosPeriodo, type LinhaKardex } from './kardex-tipos'

export type ParamsKardex = {
  produto?: string // busca livre: produto, código, ref, observação, usuário, OP/NF/pedido
  data_inicio?: string
  data_final?: string
  tm?: string // tipo: ENT SAI AJU TRF PRD EST
  og?: string // origem: VENDA COMPRA PRODUCAO TRANSFERENCIA AJUSTE INVENTARIO ESTORNO
  local?: string
  familia?: string
  us?: string // usuário
  neg?: string // '1' = só saldo negativo
  est?: string // '1' = só estornos
  ord?: string
  dir?: string
  page?: string
}

export const POR_PAGINA_KARDEX = 50
export const ORDENS_KARDEX = ['data', 'produto', 'quantidade', 'saldo', 'custo', 'local', 'tipo', 'origem'] as const

export type ResultadoKardex = {
  total: number
  entradas: number
  saidas: number
  valor_entradas: number
  valor_saidas: number
  linhas: LinhaKardex[]
}


/** Padrão: hoje (igual ao resto da tela de Movimentações). */
export function periodoKardex(sp: ParamsKardex): { ini: string; fim: string } {
  const hoje = hojeBahia()
  const ini = sp.data_inicio || hoje
  return { ini, fim: sp.data_final || sp.data_inicio || hoje }
}

export async function buscarKardex(lojaId: number, sp: ParamsKardex, opcoes: { limite?: number; offset?: number } = {}): Promise<ResultadoKardex> {
  const { ini, fim } = periodoKardex(sp)
  const ord = (ORDENS_KARDEX as readonly string[]).includes(sp.ord ?? '') ? sp.ord! : 'data'
  const page = Math.max(1, Number(sp.page) || 1)
  const limite = opcoes.limite ?? POR_PAGINA_KARDEX
  const { data, error } = await createServiceClient().rpc('kardex_proprio', {
    p_loja: lojaId,
    p_ini: ini,
    p_fim: fim,
    p_texto: sp.produto?.trim() || null,
    p_tipo: sp.tm || null,
    p_origem: sp.og || null,
    p_local: sp.local ? Number(sp.local) : null,
    p_familia: sp.familia || null,
    p_usuario: sp.us?.trim() || null,
    p_so_negativos: sp.neg === '1',
    p_so_estornos: sp.est === '1',
    p_ord: ord,
    p_dir: sp.dir === 'asc' ? 'asc' : 'desc',
    p_limite: limite,
    p_offset: opcoes.offset ?? (page - 1) * limite,
  })
  if (error) throw new Error(error.message)
  const r = data as ResultadoKardex
  return {
    total: Number(r.total) || 0,
    entradas: Number(r.entradas) || 0,
    saidas: Number(r.saidas) || 0,
    valor_entradas: Number(r.valor_entradas) || 0,
    valor_saidas: Number(r.valor_saidas) || 0,
    linhas: (r.linhas ?? []).map((l) => ({ ...l, quantidade: Number(l.quantidade), saldo_apos: Number(l.saldo_apos), custo: l.custo == null ? null : Number(l.custo) })),
  }
}

