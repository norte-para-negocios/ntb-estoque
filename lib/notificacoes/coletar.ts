// Notificações (Fase G, migration 222): contagens de uma loja para o cron /api/cron/gerar-notificacoes.
// Só LEITURA do banco (service role); nenhuma chamada ao Omie. Cada consulta que falha vira null (o tipo fica fora de
// "avaliados" e a notificação que já existe não some por engano).
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { NAO_CANCELADA_OR } from '@/lib/nf-status'
import { JANELA_NOTAS_DIAS, montarNotificacoes, type DadosNotificacao } from './regras-puro'

type Sb = ReturnType<typeof createServiceClient>

/** Nota parada a partir de quantos dias; validade de OP (modo Omie) vencida olhada até quantos dias para trás. */
export const DIAS_NOTA_PARADA = 3
const DIAS_VENCIDO_OMIE = 30
const DIAS_VENCENDO_OMIE = 7
const TETO_TENTATIVAS_AJUSTE = 30
const SALDO_OR = 'quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)'

function somar(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000)

async function contar(q: PromiseLike<{ count: number | null; error: { message: string } | null }>, rotulo: string, lojaId: number): Promise<number | null> {
  const { count, error } = await q
  if (error) {
    console.error(`notificacoes: loja ${lojaId}, consulta "${rotulo}" falhou: ${error.message}`)
    return null
  }
  return count ?? 0
}

async function validade(sb: Sb, lojaId: number, modo: DadosNotificacao['modo'], hoje: string): Promise<DadosNotificacao['validade']> {
  if (modo === 'proprio') {
    const { data: cfg } = await sb.from('estoque_config').select('validade_alerta_dias').eq('loja_id', lojaId).maybeSingle()
    const dias = Number(cfg?.validade_alerta_dias) || 7
    const [v, p] = await Promise.all([
      contar(sb.from('estoque_lotes').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).gt('saldo', 0).lt('validade', hoje), 'lotes vencidos', lojaId),
      contar(sb.from('estoque_lotes').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId).gt('saldo', 0).gte('validade', hoje).lte('validade', somar(hoje, dias)), 'lotes vencendo', lojaId),
    ])
    return v == null || p == null ? null : { vencidos: v, vencendo: p, dias }
  }
  const [v, p] = await Promise.all([
    contar(sb.from('ordens_producao').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)
      .gte('validade', somar(hoje, -DIAS_VENCIDO_OMIE)).lt('validade', hoje).or(SALDO_OR), 'OPs vencidas', lojaId),
    contar(sb.from('ordens_producao').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)
      .gte('validade', hoje).lte('validade', somar(hoje, DIAS_VENCENDO_OMIE)).or(SALDO_OR), 'OPs vencendo', lojaId),
  ])
  return v == null || p == null ? null : { vencidos: v, vencendo: p, dias: DIAS_VENCENDO_OMIE }
}

async function abaixoMinimo(sb: Sb, lojaId: number, modo: DadosNotificacao['modo']): Promise<number | null> {
  if (modo === 'proprio') {
    return contar(sb.from('sugestao_compra').select('codigo_produto', { count: 'exact', head: true }).eq('loja_id', lojaId), 'reposição', lojaId)
  }
  let falhou = false
  const linhas = await rpcTodos<number>(sb, 'produtos_repor', { p_loja_id: lojaId }, () => { falhou = true })
  return falhou ? null : linhas.length
}

async function notasParadas(sb: Sb, lojaId: number, hoje: string): Promise<DadosNotificacao['notasParadas']> {
  const { data, count, error } = await sb.from('notas_fiscais').select('d_emissao_nfe', { count: 'exact' })
    .eq('loja_id', lojaId).is('deleted_at', null).neq('c_etapa', '60').or(NAO_CANCELADA_OR)
    .gte('d_emissao_nfe', somar(hoje, -JANELA_NOTAS_DIAS)).lte('d_emissao_nfe', somar(hoje, -DIAS_NOTA_PARADA))
    .order('d_emissao_nfe', { ascending: true }).limit(1)
  if (error) {
    console.error(`notificacoes: loja ${lojaId}, consulta "notas paradas" falhou: ${error.message}`)
    return null
  }
  const maisAntiga = (data?.[0]?.d_emissao_nfe as string | undefined)?.slice(0, 10)
  return { quantidade: count ?? 0, diasMaisAntiga: maisAntiga ? diasEntre(maisAntiga, hoje) : 0, dias: DIAS_NOTA_PARADA }
}

async function bloqueios(sb: Sb, lojaId: number): Promise<DadosNotificacao['bloqueiosOmie']> {
  const desde = new Date(Date.now() - 6 * 3_600_000).toISOString()
  const { data, count, error } = await sb.from('integration_attempts').select('model', { count: 'exact' })
    .eq('loja_id', lojaId).like('model', '[BLOQUEIO OMIE]%').gte('created_at', desde).order('created_at', { ascending: false }).limit(1)
  if (error) {
    console.error(`notificacoes: loja ${lojaId}, consulta "bloqueios" falhou: ${error.message}`)
    return null
  }
  const metodo = (data?.[0]?.model as string | undefined)?.replace('[BLOQUEIO OMIE]', '').trim() || null
  return { quantidade: count ?? 0, metodo }
}

export async function coletarDados(sb: Sb, lojaId: number, modo: DadosNotificacao['modo'], hoje = hojeBahiaISO()): Promise<DadosNotificacao> {
  const omie = modo === 'omie'
  const catorzeDias = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const seteDias = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [val, minimo, notas, opsCorrigir, teto, bloq, fila, pedidos] = await Promise.all([
    modo === 'nenhum' ? Promise.resolve(null) : validade(sb, lojaId, modo, hoje),
    modo === 'nenhum' ? Promise.resolve(null) : abaixoMinimo(sb, lojaId, modo),
    notasParadas(sb, lojaId, hoje),
    omie ? contar(sb.from('ordens_producao').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)
      .eq('conclusao_status', 'Precisa corrigir no Omie').eq('concluida', false), 'OPs para corrigir', lojaId) : Promise.resolve(null),
    omie ? contar(sb.from('movimentos').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)
      .eq('status', 'Erro').gte('tentativas', TETO_TENTATIVAS_AJUSTE).gte('ultima_tentativa_em', catorzeDias), 'ajustes no teto', lojaId) : Promise.resolve(null),
    omie ? bloqueios(sb, lojaId) : Promise.resolve(null),
    omie ? contar(sb.from('vendas_integracao_fila').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)
      .eq('status', 'Erro').gte('updated_at', seteDias), 'fila do Vendas', lojaId) : Promise.resolve(null),
    modo === 'proprio' ? contar(sb.from('pedidos_compra').select('id', { count: 'exact', head: true }).eq('loja_id', lojaId)
      .eq('etapa', 'aguardando_aprovacao'), 'pedidos aguardando', lojaId) : Promise.resolve(null),
  ])
  return {
    modo, hoje, validade: val, abaixoMinimo: minimo, notasParadas: notas, opsCorrigirOmie: opsCorrigir, movimentosTeto: teto,
    bloqueiosOmie: bloq, vendasFilaErro: fila, pedidosAguardando: pedidos,
  }
}

export type ResultadoLoja = { loja: number; ok: boolean; erro?: string; avaliados: number; ativas: number }

/** Gera e grava as notificações de todas as lojas ativas (uma por vez). */
export async function gerarNotificacoes(): Promise<ResultadoLoja[]> {
  const sb = createServiceClient()
  const { data: lojas, error } = await sb.from('lojas').select('id, modo_estoque').eq('ativo', true).order('id')
  if (error) throw new Error(`lojas: ${error.message}`)
  const out: ResultadoLoja[] = []
  for (const l of lojas ?? []) {
    const lojaId = Number(l.id)
    const modo = l.modo_estoque === 'proprio' || l.modo_estoque === 'nenhum' ? l.modo_estoque : 'omie'
    try {
      const { avaliados, itens } = montarNotificacoes(await coletarDados(sb, lojaId, modo))
      const { error: e } = await sb.rpc('notificacoes_sincronizar', { p_loja: lojaId, p_tipos: avaliados, p_itens: itens })
      if (e) throw new Error(e.message)
      out.push({ loja: lojaId, ok: true, avaliados: avaliados.length, ativas: itens.length })
    } catch (e) {
      out.push({ loja: lojaId, ok: false, erro: e instanceof Error ? e.message : String(e), avaliados: 0, ativas: 0 })
    }
  }
  return out
}
