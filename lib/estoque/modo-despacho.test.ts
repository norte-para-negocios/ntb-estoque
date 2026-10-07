// Regressão do despacho por modo (06/10/2026), em nível de código-fonte: o modo 'omie' segue o caminho de sempre e
// loja 'proprio' nunca chega a nenhuma chamada do Omie. Sem mock de banco: confere a ORDEM no texto de cada action/rota.
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

const casos: [string, string, string][] = [
  ['lib/actions/produto.ts', 'criarProduto', 'incluirProduto('],
  ['lib/actions/produto.ts', 'editarProduto', 'alterarProduto('],
  ['lib/actions/produto.ts', 'excluirProduto', 'excluirProdutoOmie('],
  ['lib/actions/familia.ts', 'criarFamilia', 'incluirFamilia('],
  ['lib/actions/familia.ts', 'editarFamilia', 'alterarFamilia('],
  ['lib/actions/familia.ts', 'excluirFamilia', 'excluirFamiliaOmie('],
  ['lib/actions/familia.ts', 'puxarFamiliasDoOmie', 'syncFamilias('],
  ['lib/actions/local-estoque.ts', 'criarLocalEstoque', 'incluirLocalEstoque('],
  ['lib/actions/local-estoque.ts', 'editarLocalEstoque', 'alterarLocalEstoque('],
]

for (const [arquivo, funcao, chamadaOmie] of casos) {
  test(`${funcao}: o modo é checado antes de qualquer chamada ao Omie (${chamadaOmie})`, () => {
    const corpo = corpoDe(ler(arquivo), funcao)
    const iModo = corpo.indexOf('modoDaLoja(')
    const iOmie = corpo.indexOf(chamadaOmie)
    assert.ok(iModo >= 0, 'sem despacho por modo')
    assert.ok(iOmie < 0 || iModo < iOmie, 'o Omie é chamado antes do despacho por modo')
  })
}

test('o driver proprio e a baixa de venda nunca importam o Omie', () => {
  for (const f of ['lib/estoque/proprio-driver.ts', 'lib/estoque/venda-proprio.ts', 'lib/estoque/plano-baixa.ts', 'lib/estoque/ledger.ts']) {
    const src = ler(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n') // ignora comentários
    assert.doesNotMatch(src, /from ['"][^'"]*omie[^'"]*['"]/i, `${f} importa o Omie`)
    assert.doesNotMatch(src, /omieRequest/, `${f} usa omieRequest`)
  }
})

test('ordem-producao: proprio e nenhum respondem antes do caminho do Omie e antes de incluirOrdemProducao', () => {
  const src = ler('app/api/integracao/ordem-producao/route.ts')
  const iProprio = src.indexOf("modo_estoque === 'proprio'")
  const iNenhum = src.indexOf("modo_estoque === 'nenhum'")
  const iOmie = src.indexOf('processarItemVenda(')
  const iOp = src.indexOf('incluirOrdemProducao(loja')
  assert.ok(iProprio > 0 && iNenhum > 0)
  assert.ok(iProprio < iOmie && iNenhum < iOmie && iProprio < iOp && iNenhum < iOp)
})

test('estornar: proprio nunca chama estornarVenda (Omie)', () => {
  const src = ler('app/api/integracao/venda/estornar/route.ts')
  assert.ok(src.indexOf("modo_estoque === 'proprio'") < src.indexOf('estornarVenda(supabase, loja'))
})

test('produtos: proprio decide antes de incluirProduto (Omie)', () => {
  const src = ler('app/api/integracao/produtos/route.ts')
  assert.ok(src.indexOf("modo_estoque === 'proprio'") < src.indexOf('await incluirProduto('))
})
