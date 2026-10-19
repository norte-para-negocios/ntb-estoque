import { createClient } from '@/lib/supabase/server'
import { diffVersoesFicha, type VersaoFicha } from '@/lib/historico/historico-puro'
import { ListaMomentos, SecaoHistorico } from './ListaMomentos'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Histórico da ficha técnica (estoque próprio): diferença entre as versões já gravadas (nada novo no banco). */
export async function HistoricoFicha({ lojaId, codigoProduto }: { lojaId: number; codigoProduto: number }) {
  const supabase = await createClient()
  const { data: fichas, error } = await supabase
    .from('fichas_tecnicas')
    .select('id, versao, rendimento, expandir_na_venda, ativa, obs, criada_por, created_at')
    .eq('loja_id', lojaId)
    .eq('codigo_produto', codigoProduto)
    .order('versao')
  if (error || !fichas?.length) {
    if (error) console.error('HistoricoFicha: falha ao ler fichas_tecnicas', error.message)
    return null
  }
  const ids = fichas.map((f) => f.id as number)
  const { data: itens } = await supabase
    .from('ficha_tecnica_itens')
    .select('ficha_id, codigo_insumo, quantidade_liquida, fator_correcao, perda_pct')
    .in('ficha_id', ids)
  const insumos = [...new Set((itens ?? []).map((i) => i.codigo_insumo as number))]
  const autores = [...new Set(fichas.map((f) => f.criada_por as string | null).filter((x): x is string => !!x && RE_UUID.test(x)))]
  const [{ data: prods }, { data: perfis }] = await Promise.all([
    insumos.length
      ? supabase.from('produtos').select('codigo_produto, codigo, descricao').eq('loja_id', lojaId).in('codigo_produto', insumos.slice(0, 500))
      : Promise.resolve({ data: [] as { codigo_produto: number; codigo: string | null; descricao: string | null }[] }),
    autores.length ? supabase.from('profiles').select('id, name').in('id', autores) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const nomeProd = new Map((prods ?? []).map((p) => [Number(p.codigo_produto), `${p.descricao ?? ''}${p.codigo ? ` (${p.codigo})` : ''}`]))
  const nomePessoa = new Map((perfis ?? []).map((p) => [p.id as string, p.name as string]))
  const porFicha = new Map<number, VersaoFicha['itens']>()
  for (const i of itens ?? []) {
    const lista = porFicha.get(i.ficha_id as number) ?? []
    lista.push({ codigoInsumo: Number(i.codigo_insumo), quantidadeLiquida: Number(i.quantidade_liquida), fatorCorrecao: Number(i.fator_correcao), perdaPct: Number(i.perda_pct) })
    porFicha.set(i.ficha_id as number, lista)
  }
  const versoes: VersaoFicha[] = fichas.map((f) => ({
    versao: Number(f.versao), rendimento: Number(f.rendimento), expandirNaVenda: !!f.expandir_na_venda, obs: (f.obs as string | null) ?? null,
    ativa: !!f.ativa, criadaEm: f.created_at as string,
    criadaPor: f.criada_por ? nomePessoa.get(f.criada_por as string) ?? (RE_UUID.test(f.criada_por as string) ? 'Usuário' : (f.criada_por as string)) : null,
    itens: porFicha.get(f.id as number) ?? [],
  }))
  const momentos = diffVersoesFicha(versoes, (c) => nomeProd.get(c) ?? `Produto ${c}`)
  const ativa = versoes.find((v) => v.ativa)
  return (
    <SecaoHistorico
      titulo="Histórico da ficha técnica"
      descricao={`${versoes.length} versão${versoes.length === 1 ? '' : 'ões'} · ${ativa ? `em uso: versão ${ativa.versao}` : 'ficha desativada'}`}
    >
      <ListaMomentos momentos={momentos} />
    </SecaoHistorico>
  )
}
