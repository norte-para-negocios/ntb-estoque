import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { historicoDesde, lerEstado } from '@/lib/estoque/espelho-frentes'
import { carregarItens, type Opcao } from '@/lib/faturamento-itens-loader'
import { TIPO_NOME } from '@/lib/omie/faturamento'
import {
  custoMedioAtual, escolherFonteCmv, linhaVazia, montarLinhasEstimado, montarLinhasKardex,
  type DimCmv, type FonteCmv, type LinhaCmv, type LinhaRpcCmv, type MetaCmv,
} from '@/lib/relatorios/cmv-puro'

export type CmvCarregado = {
  fonte: FonteCmv; linhas: LinhaCmv[]; avisos: string[]; cobertura: { desde: string; ate: string } | null
  dataFoto: string | null; opcoes: { tipos: Opcao[]; familias: Opcao[] }; filtrosIgnorados: boolean
}

/** Período coberto pelo histórico completo do kardex (frente `kardex` em espelho_sync_estado), ou null. */
export async function coberturaKardex(lojaId: number): Promise<{ desde: string; ate: string } | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('espelho_sync_estado').select('estado').eq('loja_id', lojaId).eq('frente', 'kardex').maybeSingle()
  if (error || !data) return null
  const e = lerEstado(data.estado)
  const desde = historicoDesde(e)
  const ate = e.recente.coberto_ate
  return desde && ate && desde <= ate ? { desde, ate } : null
}

const rotuloTipo = (c: string) => (c ? (TIPO_NOME[c] ?? `Tipo ${c}`) : 'Não classificado')

// CMV do período nos dois modos (ver lib/relatorios/cmv-puro.ts). `por` só importa na loja própria, onde o
// agrupamento vem pronto do banco (lucro_proprio); nas lojas Omie o agrupamento é feito na tela (agruparCmv).
export async function carregarCmv(lojaId: number, ini: string, fim: string, filtros: { tipos: string[]; familias: string[] }, por: DimCmv): Promise<CmvCarregado> {
  const supabase = await createClient()
  const avisos: string[] = []
  const [modo, cobertura] = await Promise.all([modoDaLoja(lojaId), coberturaKardex(lojaId)])
  const fonte = escolherFonteCmv({ modo, kardexDesde: cobertura?.desde ?? null, kardexAte: cobertura?.ate ?? null, ini, fim })

  if (fonte === 'proprio') {
    const rows = await rpcTodos<{ rotulo: string; quantidade: number; faturamento: number; cmv: number; itens_sem_baixa: number; itens_sem_custo: number }>(
      supabase, 'lucro_proprio', { p_loja: lojaId, p_ini: ini, p_fim: fim, p_dim: por },
      (e) => avisos.push(`Falha ao ler o custo das vendas (${e.message}). Os valores podem estar incompletos.`))
    const linhas = rows.map((r) => ({
      ...linhaVazia(r.rotulo, r.rotulo, por === 'familia' ? { familia: r.rotulo } : por === 'tipo' ? { tipo: r.rotulo } : undefined),
      quant: Number(r.quantidade) || 0, faturamento: Number(r.faturamento) || 0, cmv: Number(r.cmv) || 0,
      semCusto: (Number(r.itens_sem_baixa) || 0) + (Number(r.itens_sem_custo) || 0),
    }))
    return { fonte, linhas, avisos, cobertura: null, dataFoto: null, opcoes: { tipos: [], familias: [] }, filtrosIgnorados: filtros.tipos.length + filtros.familias.length > 0 }
  }

  const vendas = await carregarItens(lojaId, ini, fim, { tipos: filtros.tipos, familias: filtros.familias, situacao: 'validas' })
  if (vendas.aviso) avisos.push(vendas.aviso)

  if (fonte === 'kardex') {
    const [rpc, prods] = await Promise.all([
      rpcTodos<LinhaRpcCmv>(supabase, 'relatorio_cmv_kardex', { p_loja_id: lojaId, p_ini: ini, p_fim: fim },
        (e) => avisos.push(`Falha ao ler o kardex (${e.message}). Os valores podem estar incompletos.`)),
      buscarTodasLinhas<{ codigo_produto: number; descricao: string | null; codigo: string | null; descricao_familia: string | null; tipo_item: string | null }>(
        (from, to) => supabase.from('produtos').select('codigo_produto, descricao, codigo, descricao_familia, tipo_item').eq('loja_id', lojaId).order('id').range(from, to),
        undefined, (e) => avisos.push(`Falha ao ler o cadastro (${e.message}).`)),
    ])
    const meta = new Map<number, MetaCmv>(prods.map((p) => [Number(p.codigo_produto), {
      rotulo: p.descricao || p.codigo || `Produto ${p.codigo_produto}`, familia: p.descricao_familia || 'Sem família', tipoCod: p.tipo_item ?? '', tipo: rotuloTipo(p.tipo_item ?? ''),
    }]))
    const passa = (cod: number) => {
      const m = meta.get(cod)
      return (!filtros.tipos.length || filtros.tipos.includes(m?.tipoCod || '_')) && (!filtros.familias.length || filtros.familias.includes(m?.familia || 'Sem família'))
    }
    const linhas = montarLinhasKardex(rpc.filter((r) => passa(Number(r.n_cod_prod))), vendas.linhas, meta)
    return { fonte, linhas, avisos, cobertura, dataFoto: null, opcoes: vendas.opcoes, filtrosIgnorados: false }
  }

  // estimado: custo médio da foto mais recente que tem local real
  const { data: ult } = await supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).neq('codigo_local_estoque', 0).order('data_posicao', { ascending: false }).limit(1).maybeSingle()
  const dataFoto = ult?.data_posicao ? String(ult.data_posicao) : null
  const foto = dataFoto
    ? await buscarTodasLinhas<{ n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number }>(
        (from, to) => supabase.from('posicao_estoques').select('n_cod_prod, codigo_local_estoque, n_saldo, n_cmc').eq('loja_id', lojaId).eq('data_posicao', dataFoto).order('id').range(from, to),
        undefined, (e) => avisos.push(`Falha ao ler o custo médio (${e.message}). O CMV pode estar incompleto.`))
    : []
  const linhas = montarLinhasEstimado(vendas.linhas, custoMedioAtual(foto))
  return { fonte, linhas, avisos, cobertura, dataFoto, opcoes: vendas.opcoes, filtrosIgnorados: false }
}
