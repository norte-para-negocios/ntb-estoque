// Monta a visão de Estoque de uma loja Omie a partir do espelho (posicao_estoques).
// Puro (sem banco, sem '@/'), testado em espelho-omie.test.ts.
// Regras: saldos só da foto mais recente (nunca misturar datas); local 0 = sentinela
// (mínimo + CMC do local padrão), nunca um local; CMC da foto mais recente se > 0,
// senão da anterior; CMC fora de (0, 1e7) é tratado como suspeito (o Omie devolve
// custos de bilhões em saldo negativo nas lojas 5 e 6).

export type Situacao = 'negativo' | 'zerado' | 'baixo' | 'ok'
export const CMC_MAX_PLAUSIVEL = 1e7

export type PosicaoRow = {
  data_posicao: string; codigo_local_estoque: number; n_cod_prod: number
  n_saldo: number | null; n_cmc: number | null; estoque_minimo: number | null; updated_at: string | null
}
export type ProdutoRow = {
  codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null
  tipo_item: string | null; codigo_familia: number | null; estoque_minimo: number | null
}
export type EntradaEspelho = {
  produtos: ProdutoRow[]
  posicoes: PosicaoRow[]
  locais: { codigo_local_estoque: number; descricao: string | null; inativo: string | null }[]
  familias: { codigo_familia: number; nome: string | null }[]
}

/** cmc = custo médio DO LOCAL na foto (o Omie guarda custo por produto × local); ausente/0 = sem custo próprio. */
export type SaldoLocal = { codigoLocal: number; local: string; saldo: number; minimo: number | null; cmc?: number }
export type LinhaEspelho = {
  codigoProduto: number; codigo: string; descricao: string; unidade: string; tipoItem: string | null
  codigoFamilia: number | null; familia: string; saldo: number; cmc: number; valor: number
  minimo: number | null; situacao: Situacao; locais: SaldoLocal[]; custoSuspeito?: boolean
}
export type VisaoEspelho = {
  linhas: LinhaEspelho[]
  locais: { codigoLocal: number; descricao: string; inativo: boolean }[]
  familias: { codigo: number; nome: string }[]
  atualizadoEm: string | null
  dataPosicao: string | null
  locaisSemLeitura: string[]
  /** Locais ativos sem nenhuma linha nas fotos guardadas: sem saldo no Omie ou nunca lidos. */
  locaisSemSaldo: string[]
  custoSuspeito: number
}

export function situacaoDe(saldo: number, minimo: number | null): Situacao {
  if (saldo < 0) return 'negativo'
  if (saldo === 0) return 'zerado'
  if (minimo != null && minimo > 0 && saldo < minimo) return 'baixo'
  return 'ok'
}

const plausivel = (c: number) => c > 0 && c < CMC_MAX_PLAUSIVEL

/**
 * Valor do produto = Σ saldo do local × custo DO LOCAL (como na Posição de Estoque do Omie: 89 de 91 produtos da loja 5
 * com 2+ locais têm custo diferente por local). Local sem custo próprio plausível usa o custo do produto (sentinela).
 */
export function valorPorLocal(locs: SaldoLocal[], cmcProduto: number): number {
  return locs.reduce((a, l) => a + l.saldo * (plausivel(Number(l.cmc ?? 0)) ? Number(l.cmc) : cmcProduto), 0)
}

export function montarVisaoOmie(e: EntradaEspelho): VisaoEspelho {
  const datas = [...new Set(e.posicoes.map((p) => p.data_posicao))].sort().reverse()
  // Foto dos SALDOS = a mais recente que já tem linha de algum local real. O sync grava primeiro
  // a sentinela (local 0) e depois local por local: enquanto a foto do dia só tem sentinela, os
  // saldos continuam vindo da foto anterior (senão tudo apareceria zerado durante o sync).
  const comLocal = new Set(e.posicoes.filter((p) => Number(p.codigo_local_estoque) !== 0).map((p) => p.data_posicao))
  const dataAtual = datas.find((d) => comLocal.has(d)) ?? null
  const dataAnterior = datas.find((d) => dataAtual != null && d < dataAtual) ?? null
  const atual = e.posicoes.filter((p) => p.data_posicao === dataAtual)
  const anterior = e.posicoes.filter((p) => p.data_posicao === dataAnterior)
  // CMC: a sentinela mais nova com custo > 0 (mesmo de uma foto só com sentinela).
  const sentinelas = datas.map((d) => e.posicoes.filter((p) => p.data_posicao === d && Number(p.codigo_local_estoque) === 0))

  const locais = e.locais.map((l) => ({
    codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque), inativo: l.inativo === 'S',
  }))
  const nomeLocal = new Map(locais.map((l) => [l.codigoLocal, l.descricao]))
  const familias = e.familias.map((f) => ({ codigo: Number(f.codigo_familia), nome: f.nome ?? String(f.codigo_familia) }))
  const nomeFamilia = new Map(familias.map((f) => [f.codigo, f.nome]))

  const cmcPorProduto = new Map<number, number>()
  for (const rows of sentinelas) for (const r of rows) {
    const cod = Number(r.n_cod_prod), c = Number(r.n_cmc ?? 0)
    if (!cmcPorProduto.has(cod) && c !== 0) cmcPorProduto.set(cod, c)
  }
  const minimoOmie = new Map(atual.filter((r) => Number(r.codigo_local_estoque) === 0 && Number(r.estoque_minimo ?? 0) > 0).map((r) => [Number(r.n_cod_prod), Number(r.estoque_minimo)]))

  const saldos = new Map<number, SaldoLocal[]>()
  for (const r of atual) {
    const loc = Number(r.codigo_local_estoque)
    if (loc === 0) continue
    const arr = saldos.get(Number(r.n_cod_prod)) ?? []
    arr.push({ codigoLocal: loc, local: nomeLocal.get(loc) ?? String(loc), saldo: Number(r.n_saldo ?? 0), minimo: null, cmc: Number(r.n_cmc ?? 0) })
    saldos.set(Number(r.n_cod_prod), arr)
  }

  let nSuspeito = 0
  const linhas: LinhaEspelho[] = e.produtos.map((p) => {
    const cod = Number(p.codigo_produto)
    const locs = saldos.get(cod) ?? []
    const saldo = locs.reduce((a, l) => a + l.saldo, 0)
    const bruto = cmcPorProduto.get(cod) ?? 0
    const suspeito = bruto < 0 || bruto >= CMC_MAX_PLAUSIVEL
    if (suspeito) nSuspeito++
    const cmc = suspeito ? 0 : bruto
    const minimo = minimoOmie.get(cod) ?? (p.estoque_minimo != null && Number(p.estoque_minimo) > 0 ? Number(p.estoque_minimo) : null)
    return {
      codigoProduto: cod, codigo: p.codigo ?? String(cod), descricao: p.descricao ?? '(sem descrição)', unidade: p.unidade ?? 'UN',
      tipoItem: p.tipo_item, codigoFamilia: p.codigo_familia == null ? null : Number(p.codigo_familia),
      familia: p.codigo_familia == null ? 'Sem família' : (nomeFamilia.get(Number(p.codigo_familia)) ?? 'Sem família'),
      saldo, cmc, valor: valorPorLocal(locs, cmc), minimo, situacao: situacaoDe(saldo, minimo), locais: locs,
      ...(suspeito ? { custoSuspeito: true } : {}),
    }
  })

  const locaisHoje = new Set(atual.map((r) => Number(r.codigo_local_estoque)))
  const locaisOntem = new Set(anterior.map((r) => Number(r.codigo_local_estoque)))
  const locaisSemLeitura = locais
    .filter((l) => !l.inativo && l.codigoLocal !== 0 && locaisOntem.has(l.codigoLocal) && !locaisHoje.has(l.codigoLocal))
    .map((l) => l.descricao)
  const locaisComLinha = new Set(e.posicoes.map((r) => Number(r.codigo_local_estoque)))
  const locaisSemSaldo = locais.filter((l) => !l.inativo && l.codigoLocal !== 0 && !locaisComLinha.has(l.codigoLocal)).map((l) => l.descricao)

  const atualizadoEm = atual.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null)
  return { linhas, locais, familias, atualizadoEm, dataPosicao: dataAtual, locaisSemLeitura, locaisSemSaldo, custoSuspeito: nSuspeito }
}
