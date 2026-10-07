// Regressão em nível de código-fonte: a baixa por receita só vale com ficha ATIVA; sem ficha o produto baixa a si mesmo,
// e o estorno da venda acha também os movimentos "pedido|produto|linha" gerados pela receita.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fonte = readFileSync(new URL('./venda-proprio.ts', import.meta.url), 'utf8')

test('só consulta fichas ativas da loja e cai na saída direta quando não há receita', () => {
  assert.match(fonte, /from\('fichas_tecnicas'\)[\s\S]*\.eq\('ativa', true\)/)
  assert.match(fonte, /if \(comReceita\.has\(p\.produto!\)\)/)
  assert.match(fonte, /if \(c\.tem_receita\)[\s\S]*continue[\s\S]*await saida\(/)
})

test('estorno da venda encontra os movimentos da receita (ref com sufixo |produto|linha)', () => {
  assert.match(fonte, /ref\.like\.\$\{pedidoRef\}\|\*/)
})
