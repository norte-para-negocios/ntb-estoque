import { createClient } from '@/lib/supabase/server'
import { saldoPedidosCompraOmie } from '@/lib/omie/pedidos-compra'
import {
  diasInclusivos, montarLinhasSugestao, periodosPadrao, rpcDaSugestao,
  type BaseProjecao, type LinhaBruta, type LinhaSugestao, type ModoLoja,
} from './sugestao-puro'

export type ParamsSugestao = { ini: string; fim: string; projIni: string; projFim: string; base: BaseProjecao }

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Períodos da URL (aIni/aFim = análise, eIni/eFim = estimativa); inválido ou invertido = padrão do Omie. Análise até 366 dias. */
export function lerParamsSugestao(sp: Record<string, string | undefined>, hoje: string): ParamsSugestao & { diasAnalise: number; diasEstimativa: number } {
  const pad = periodosPadrao(hoje)
  let ini = ISO.test(sp.aIni ?? '') ? sp.aIni! : pad.analise.ini
  let fim = ISO.test(sp.aFim ?? '') ? sp.aFim! : pad.analise.fim
  if (fim > hoje) fim = hoje
  if (diasInclusivos(ini, fim) === 0 || diasInclusivos(ini, fim) > 366) { ini = pad.analise.ini; fim = pad.analise.fim }
  let projIni = ISO.test(sp.eIni ?? '') ? sp.eIni! : pad.estimativa.ini
  let projFim = ISO.test(sp.eFim ?? '') ? sp.eFim! : pad.estimativa.fim
  if (diasInclusivos(projIni, projFim) === 0 || diasInclusivos(projIni, projFim) > 366) { projIni = pad.estimativa.ini; projFim = pad.estimativa.fim }
  return { ini, fim, projIni, projFim, base: sp.proj === 'previsao' ? 'previsao' : 'consumo', diasAnalise: diasInclusivos(ini, fim), diasEstimativa: diasInclusivos(projIni, projFim) }
}

/** Lê a função do modo da loja (despacho em rpcDaSugestao) e monta as linhas com a fórmula do Omie. */
export async function carregarSugestao(lojaId: number, modo: ModoLoja, p: ParamsSugestao & { diasAnalise: number; diasEstimativa: number }):
  Promise<{ linhas: LinhaSugestao[]; erro: string | null; avisos: string[] }> {
  const fn = rpcDaSugestao(modo)
  if (!fn) return { linhas: [], erro: 'Esta loja não controla estoque.', avisos: [] }
  const supabase = await createClient()
  const avisos: string[] = []
  const [{ data, error }, pedidosOmie] = await Promise.all([
    supabase.rpc(fn, { p_loja: lojaId, p_ini: p.ini, p_fim: p.fim, p_proj_ini: p.projIni, p_proj_fim: p.projFim }),
    modo === 'omie' ? saldoPedidosCompraOmie(lojaId, p.projFim) : Promise.resolve({ saldo: null, aviso: null }),
  ])
  if (error) {
    console.error(`sugestao-compra: ${fn} falhou`, error.message)
    return { linhas: [], erro: 'Não foi possível calcular a sugestão agora (a função do banco falhou ou ainda não foi instalada).', avisos }
  }
  if (pedidosOmie.aviso) avisos.push(pedidosOmie.aviso)
  const brutas = (Array.isArray(data) ? data : []) as LinhaBruta[]
  return { linhas: montarLinhasSugestao(brutas, { ...p, pedidosExtra: pedidosOmie.saldo ?? undefined }), erro: null, avisos }
}
