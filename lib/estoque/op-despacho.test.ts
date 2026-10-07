// Regressão (06/10/2026): as telas de Ordem de Produção seguem iguais nos modos 'omie' e 'nenhum' (nenhuma mudança de caminho)
// e, em loja 'proprio', cada ação desvia para o motor local ANTES de qualquer chamada ao Omie. Confere a ORDEM no texto.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

function corpoDe(src: string, nome: string): string {
  const i = src.indexOf(`export async function ${nome}(`)
  assert.ok(i >= 0, `função ${nome} não encontrada`)
  const prox = src.indexOf('\nexport async function ', i + 10)
  return src.slice(i, prox < 0 ? undefined : prox)
}

const casos: [string, string][] = [
  ['criarOrdemProducao', 'incluirOrdemProducao('],
  ['criarOrdensProducao', 'incluirOrdemProducao('],
  ['setDataOP', 'alterarOrdemProducao('],
  ['setQtdPlanejadaOP', 'alterarOrdemProducao('],
  ['finishOP', 'executarConclusaoOP('],
  ['excluirOP', 'excluirOrdemProducao('],
  ['reverterOP', 'reverterOrdemProducao('],
  ['finishOPsEmLote', 'executarConclusaoOP('],
  ['reverterOPsEmLote', 'reverterOrdemProducao('],
]
for (const [fn, omie] of casos) {
  test(`${fn}: loja proprio desvia antes de ${omie}`, () => {
    const corpo = corpoDe(ler('lib/actions/ordem-producao.ts'), fn)
    const iProprio = corpo.indexOf('ehLojaProprio(')
    const iOmie = corpo.indexOf(omie)
    assert.ok(iProprio >= 0, 'sem despacho para loja proprio')
    assert.ok(iOmie < 0 || iProprio < iOmie, 'o Omie é chamado antes do despacho')
  })
}

test('o motor proprio da OP nunca importa o Omie', () => {
  const src = ler('lib/estoque/op-proprio.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(src, /from ['"][^'"]*omie[^'"]*['"]/i)
  assert.doesNotMatch(src, /omieRequest/)
})

test('a ficha técnica do modo proprio não chama o Omie (estrutura.ts despacha antes)', () => {
  const src = ler('lib/actions/estrutura.ts')
  for (const fn of ['verEstrutura', 'salvarEstrutura']) {
    const corpo = corpoDe(src, fn)
    const iProprio = corpo.indexOf('ehLojaProprio(')
    const iOmie = corpo.indexOf('consultarEstrutura(')
    assert.ok(iProprio >= 0 && (iOmie < 0 || iProprio < iOmie), `${fn}: despacho antes do Omie`)
  }
})
