import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { montarPosicao, type InfoLocal, type LinhaFoto, type MetaProduto } from '@/lib/relatorios/posicao-estoque-puro'

// Fase F: inventário tipo Bloco H numa data (plano R8), com a montagem da Fase D (montarPosicao, visão 'sped': produto
// ativo com saldo > 0, valor unitário = valor ÷ quantidade). Fonte:
//   - estoque próprio: posicao_proprio_em_data (migration 232), pelo ledger, exato na data;
//   - loja Omie: a foto de posicao_estoques com local real mais recente ATÉ a data (o Omie só deixa saldo em data pelo
//     espelho do kardex, que só existe na loja 5: Fase D item 5). A data da foto usada volta em `dataFoto`.

export async function carregarBlocoH(lojaId: number, dataISO: string) {
  const sb = await createClient()
  const modo = await modoDaLoja(lojaId)
  const erros: string[] = []
  const anotar = (onde: string) => (e: { message: string }) => { erros.push(onde); console.error(`bloco-h: ${onde}`, e.message) }

  let foto: LinhaFoto[] = []
  let dataFoto: string | null = null
  if (modo === 'proprio') {
    dataFoto = dataISO
    const rows = await buscarTodasLinhas<{ codigo_produto: number; codigo_local_estoque: number; saldo: number; cmc: number }>(
      (from, to) => sb.rpc('posicao_proprio_em_data', { p_loja: lojaId, p_data: dataISO }).order('codigo_produto').order('codigo_local_estoque').range(from, to),
      undefined, anotar('posição na data (migration 232)'))
    foto = rows.map((r) => ({ n_cod_prod: Number(r.codigo_produto), codigo_local_estoque: Number(r.codigo_local_estoque), n_saldo: Number(r.saldo), n_cmc: Number(r.cmc), reservado: 0 }))
  } else {
    const { data: ult, error } = await sb.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).neq('codigo_local_estoque', 0)
      .lte('data_posicao', dataISO).order('data_posicao', { ascending: false }).limit(1).maybeSingle()
    if (error) anotar('data da foto')(error)
    dataFoto = ult?.data_posicao ? String(ult.data_posicao) : null
    if (dataFoto) {
      foto = await buscarTodasLinhas<LinhaFoto>(
        (from, to) => sb.from('posicao_estoques').select('n_cod_prod, codigo_local_estoque, n_saldo, n_cmc, reservado').eq('loja_id', lojaId).eq('data_posicao', dataFoto).order('id').range(from, to),
        undefined, anotar('posição de estoque'))
    }
  }

  const [prods, locs] = await Promise.all([
    buscarTodasLinhas<{ codigo_produto: number; codigo: string | null; descricao: string | null; descricao_familia: string | null; tipo_item: string | null; unidade: string | null; ncm: string | null; inativo: boolean | null }>(
      (from, to) => sb.from('produtos').select('codigo_produto, codigo, descricao, descricao_familia, tipo_item, unidade, ncm, inativo').eq('loja_id', lojaId).order('id').range(from, to),
      undefined, anotar('cadastro de produtos')),
    buscarTodasLinhas<{ codigo_local_estoque: number; descricao: string | null; padrao: string | null }>(
      (from, to) => sb.from('local_estoques').select('codigo_local_estoque, descricao, padrao').eq('loja_id', lojaId).is('deleted_at', null).order('id').range(from, to),
      undefined, anotar('locais de estoque')),
  ])
  const produtos: MetaProduto[] = prods.map((p) => ({
    codigo_produto: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao, familia: p.descricao_familia, tipo: p.tipo_item,
    unidade: p.unidade, ncm: p.ncm, inativo: p.inativo === true,
  }))
  const locais = new Map<number, InfoLocal>(locs.map((l) => [Number(l.codigo_local_estoque), { descricao: l.descricao ?? String(l.codigo_local_estoque), padrao: l.padrao === 'S' }]))
  // mesma regra da Fase D para o Bloco H: produto ativo com saldo > 0 (um registro por produto)
  const r = montarPosicao(foto, produtos, locais, { ver: 'sped', zerados: false, inativos: true, tipos: [], familias: [], q: '' })
  return { ...r, modo, dataPedida: dataISO, dataFoto, erros: [...new Set(erros)] }
}
