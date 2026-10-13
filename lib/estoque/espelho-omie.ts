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

export type SaldoLocal = { codigoLocal: number; local: string; saldo: number; minimo: number | null }
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
  custoSuspeito: number
}

export function situacaoDe(saldo: number, minimo: number | null): Situacao {
  if (saldo < 0) return 'negativo'
  if (saldo === 0) return 'zerado'
  if (minimo != null && minimo > 0 && saldo < minimo) return 'baixo'
  return 'ok'
}

export function montarVisaoOmie(e: EntradaEspelho): VisaoEspelho {
  const datas = [...new Set(e.posicoes.map((p) => p.data_posicao))].sort().reverse()
  const [dataAtual = null, dataAnterior = null] = datas
  const atual = e.posicoes.filter((p) => p.data_posicao === dataAtual)
  const anterior = e.posicoes.filter((p) => p.data_posicao === dataAnterior)

  const locais = e.locais.map((l) => ({
    codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque), inativo: l.inativo === 'S',
  }))
  const nomeLocal = new Map(locais.map((l) => [l.codigoLocal, l.descricao]))
  const familias = e.familias.map((f) => ({ codigo: Number(f.codigo_familia), nome: f.nome ?? String(f.codigo_familia) }))
  const nomeFamilia = new Map(familias.map((f) => [f.codigo, f.nome]))

  const cmcDe = (rows: PosicaoRow[]) => new Map(rows.filter((r) => Number(r.codigo_local_estoque) === 0).map((r) => [Number(r.n_cod_prod), Number(r.n_cmc ?? 0)]))
  const cmcAtual = cmcDe(atual), cmcAnterior = cmcDe(anterior)
  const minimoOmie = new Map(atual.filter((r) => Number(r.codigo_local_estoque) === 0 && Number(r.estoque_minimo ?? 0) > 0).map((r) => [Number(r.n_cod_prod), Number(r.estoque_minimo)]))

  const saldos = new Map<number, SaldoLocal[]>()
  for (const r of atual) {
    const loc = Number(r.codigo_local_estoque)
    if (loc === 0) continue
    const arr = saldos.get(Number(r.n_cod_prod)) ?? []
    arr.push({ codigoLocal: loc, local: nomeLocal.get(loc) ?? String(loc), saldo: Number(r.n_saldo ?? 0), minimo: null })
    saldos.set(Number(r.n_cod_prod), arr)
  }

  let nSuspeito = 0
  const linhas: LinhaEspelho[] = e.produtos.map((p) => {
    const cod = Number(p.codigo_produto)
    const locs = saldos.get(cod) ?? []
    const saldo = locs.reduce((a, l) => a + l.saldo, 0)
    const bruto = (cmcAtual.get(cod) ?? 0) > 0 ? cmcAtual.get(cod)! : (cmcAnterior.get(cod) ?? 0)
    const suspeito = bruto < 0 || bruto >= CMC_MAX_PLAUSIVEL
    if (suspeito) nSuspeito++
    const cmc = suspeito ? 0 : bruto
    const minimo = minimoOmie.get(cod) ?? (p.estoque_minimo != null && Number(p.estoque_minimo) > 0 ? Number(p.estoque_minimo) : null)
    return {
      codigoProduto: cod, codigo: p.codigo ?? String(cod), descricao: p.descricao ?? '(sem descrição)', unidade: p.unidade ?? 'UN',
      tipoItem: p.tipo_item, codigoFamilia: p.codigo_familia == null ? null : Number(p.codigo_familia),
      familia: p.codigo_familia == null ? 'Sem família' : (nomeFamilia.get(Number(p.codigo_familia)) ?? 'Sem família'),
      saldo, cmc, valor: cmc === 0 ? 0 : saldo * cmc, minimo, situacao: situacaoDe(saldo, minimo), locais: locs,
      ...(suspeito ? { custoSuspeito: true } : {}),
    }
  })

  const locaisHoje = new Set(atual.map((r) => Number(r.codigo_local_estoque)))
  const locaisOntem = new Set(anterior.map((r) => Number(r.codigo_local_estoque)))
  const locaisSemLeitura = locais
    .filter((l) => !l.inativo && l.codigoLocal !== 0 && locaisOntem.has(l.codigoLocal) && !locaisHoje.has(l.codigoLocal))
    .map((l) => l.descricao)

  const atualizadoEm = atual.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null)
  return { linhas, locais, familias, atualizadoEm, dataPosicao: dataAtual, locaisSemLeitura, custoSuspeito: nSuspeito }
}
