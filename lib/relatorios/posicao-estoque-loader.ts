import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escolherFoto, locaisSumidos, montarPosicao, SEM_FAMILIA, type InfoLocal, type LinhaFoto, type MetaProduto, type OpcoesPosicao, type VerPosicao } from '@/lib/relatorios/posicao-estoque-puro'

export type SpPosicao = Record<string, string | undefined>
const lista = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))
export const rotuloTipo = (c: string) => (c ? (TIPO_LABEL.get(c) ?? `Tipo ${c}`) : 'Não classificado')

export function lerOpcoesPosicao(sp: SpPosicao): OpcoesPosicao {
  const ver: VerPosicao = sp.ver === 'local' ? 'local' : sp.ver === 'sped' ? 'sped' : 'produto'
  return { ver, zerados: sp.zerados === '1', inativos: sp.inativos !== '0', tipos: lista(sp.tipo), familias: lista(sp.familia), q: (sp.q ?? '').slice(0, 80) }
}
export function paramsBasePosicao(o: OpcoesPosicao): Record<string, string> {
  return { ver: o.ver === 'produto' ? '' : o.ver, zerados: o.zerados ? '1' : '', inativos: o.inativos ? '' : '0', tipo: o.tipos.join(','), familia: o.familias.join(','), q: o.q }
}

type Cliente = Awaited<ReturnType<typeof createClient>>

// Foto valorizada pela regra única do banco (posicao_valorizada, migration 282): a foto crua (com a sentinela 0) e, numa
// chamada só, as linhas que o banco marca como custo suspeito (CMC trocado pela referência). As demais valem saldo × CMC,
// a mesma conta da função. Sem a 282 aplicada, as linhas ficam sem `valor` e o TS usa a regra antiga.
export async function lerFotoValorizada(supabase: Cliente, lojaId: number, dataFoto: string, anotar: (onde: string) => (e: { message: string }) => void): Promise<LinhaFoto[]> {
  const [crua, susp] = await Promise.all([
    buscarTodasLinhas<LinhaFoto>(
      (from, to) => supabase.from('posicao_estoques').select('n_cod_prod, codigo_local_estoque, n_saldo, n_cmc, reservado').eq('loja_id', lojaId).eq('data_posicao', dataFoto).order('id').range(from, to),
      undefined, anotar('posição de estoque')),
    supabase.rpc('posicao_valorizada', { p_loja_id: lojaId, p_data: dataFoto })
      .select('n_cod_prod, codigo_local_estoque, cmc_usado, valor, suspeito, referencia, valor_omie').eq('suspeito', true).limit(5000),
  ])
  if (susp.error) {
    const semFuncao = (susp.error as { code?: string }).code === 'PGRST202' || /posicao_valorizada/.test(susp.error.message)
    if (!semFuncao) anotar('custo suspeito')(susp.error)
    return crua
  }
  const chave = (p: number | string, l: number | string) => `${p}:${l}`
  const suspeitas = new Map(((susp.data ?? []) as LinhaFoto[]).map((x) => [chave(x.n_cod_prod, x.codigo_local_estoque), x]))
  return crua.map((f) => {
    if (Number(f.codigo_local_estoque) === 0) return f
    const x = suspeitas.get(chave(f.n_cod_prod, f.codigo_local_estoque))
    if (x) return { ...f, cmc_usado: x.cmc_usado, valor: x.valor, suspeito: true, referencia: x.referencia, valor_omie: x.valor_omie }
    const cmc = Number(f.n_cmc) > 0 ? Number(f.n_cmc) : 0
    return { ...f, cmc_usado: cmc, valor: Math.round((Number(f.n_saldo) || 0) * cmc * 100) / 100, suspeito: false }
  })
}

// Lê a foto mais recente com local real (posicao_estoques: lojas Omie = sync do Omie; estoque próprio = projeção
// do ledger, migrations 132/144), o cadastro e os locais, e monta a posição. Vale para os dois modos.
export async function carregarPosicao(lojaId: number, op: OpcoesPosicao) {
  const supabase = await createClient()
  const erros: string[] = []
  const anotar = (onde: string) => (e: { message: string }) => { erros.push(onde); console.error(`posicao-estoque: ${onde}`, e.message) }

  const [ultima, ultimaReal] = await Promise.all([
    supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).order('data_posicao', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).neq('codigo_local_estoque', 0).order('data_posicao', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (ultima.error) anotar('data da foto')(ultima.error)
  if (ultimaReal.error) anotar('data da foto')(ultimaReal.error)
  const datas = [
    ...(ultima.data ? [{ data: String(ultima.data.data_posicao), temLocalReal: ultimaReal.data?.data_posicao === ultima.data.data_posicao }] : []),
    ...(ultimaReal.data ? [{ data: String(ultimaReal.data.data_posicao), temLocalReal: true }] : []),
  ]
  const dataFoto = escolherFoto(datas)
  const fotoEmLeitura = !!ultima.data && dataFoto !== null && String(ultima.data.data_posicao) > dataFoto

  // Locais da foto anterior (para avisar local ativo que não veio na leitura atual, como na tela de Estoque).
  const anteriorQ = dataFoto
    ? await supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).neq('codigo_local_estoque', 0).lt('data_posicao', dataFoto).order('data_posicao', { ascending: false }).limit(1).maybeSingle()
    : null
  const dataAnterior = anteriorQ?.data?.data_posicao ? String(anteriorQ.data.data_posicao) : null

  const [foto, prods, locs, locaisAnteriores] = await Promise.all([
    dataFoto ? lerFotoValorizada(supabase, lojaId, dataFoto, anotar) : Promise.resolve<LinhaFoto[]>([]),
    buscarTodasLinhas<{ codigo_produto: number; codigo: string | null; descricao: string | null; descricao_familia: string | null; tipo_item: string | null; unidade: string | null; ncm: string | null; inativo: boolean | null }>(
      (from, to) => supabase.from('produtos').select('codigo_produto, codigo, descricao, descricao_familia, tipo_item, unidade, ncm, inativo').eq('loja_id', lojaId).order('id').range(from, to),
      undefined, anotar('cadastro de produtos')),
    buscarTodasLinhas<{ codigo_local_estoque: number; descricao: string | null; padrao: string | null; inativo: string | null }>(
      (from, to) => supabase.from('local_estoques').select('codigo_local_estoque, descricao, padrao, inativo').eq('loja_id', lojaId).is('deleted_at', null).order('id').range(from, to),
      undefined, anotar('locais de estoque')),
    dataAnterior
      ? buscarTodasLinhas<{ codigo_local_estoque: number }>(
          (from, to) => supabase.from('posicao_estoques').select('codigo_local_estoque').eq('loja_id', lojaId).eq('data_posicao', dataAnterior).neq('codigo_local_estoque', 0).order('id').range(from, to),
          undefined, anotar('foto anterior'))
      : Promise.resolve<{ codigo_local_estoque: number }[]>([]),
  ])
  const produtos: MetaProduto[] = prods.map((p) => ({
    codigo_produto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, familia: p.descricao_familia, tipo: p.tipo_item,
    unidade: p.unidade, ncm: p.ncm, inativo: p.inativo === true,
  }))
  const locais = new Map<number, InfoLocal>(locs.map((l) => [Number(l.codigo_local_estoque), { descricao: l.descricao ?? String(l.codigo_local_estoque), padrao: l.padrao === 'S' }]))
  const r = montarPosicao(foto, produtos, locais, op)
  const ativos = new Set(locs.filter((l) => l.inativo !== 'S').map((l) => Number(l.codigo_local_estoque)))
  const sumidos = locaisSumidos(foto.map((f) => Number(f.codigo_local_estoque)), locaisAnteriores.map((l) => Number(l.codigo_local_estoque)), ativos)
    .map((c) => locais.get(c)?.descricao ?? String(c))
  const tipos = [...new Set(produtos.map((p) => p.tipo ?? ''))].sort().map((c) => ({ value: c || '_', label: rotuloTipo(c) }))
  const familias = [...new Set(produtos.map((p) => p.familia || SEM_FAMILIA))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((f) => ({ value: f, label: f }))
  return { ...r, dataFoto, fotoEmLeitura, locaisSumidos: sumidos, erros: [...new Set(erros)], opcoes: { tipos, familias } }
}
