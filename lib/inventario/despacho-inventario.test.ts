// Regressão do despacho por modo no Inventário e em Movimentações (06/10/2026), em nível de código-fonte:
// loja 'proprio' nunca chega a uma chamada do Omie e o caminho 'omie' segue o de sempre.
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

const inv = ler('lib/actions/inventario.ts')
const casos: [string, string][] = [
  ['enviarInventarioItem', 'excluirAjusteEstoque('],
  ['removeInventarioItem', 'excluirAjusteEstoque('],
  ['finishInventario', 'processarItemInventario('],
  ['forceSyncInventario', 'processarItemInventario('],
  ['excluirInventario', 'excluirAjusteEstoque('],
  ['editQuantidadeInventarioItem', 'excluirAjusteEstoque('],
]
for (const [funcao, chamadaOmie] of casos) {
  test(`${funcao}: o modo é checado antes de qualquer chamada ao Omie`, () => {
    const corpo = corpoDe(inv, funcao)
    const iModo = corpo.indexOf("modoDaLoja(lojaId)) === 'proprio'")
    const iOmie = corpo.indexOf(chamadaOmie)
    assert.ok(iModo >= 0, 'sem despacho por modo')
    assert.ok(iOmie < 0 || iModo < iOmie, 'o Omie é chamado antes do despacho')
  })
}

test('criarAjusteManual: loja de estoque próprio vai para o ledger antes do Omie', () => {
  const corpo = corpoDe(ler('lib/actions/movimentacoes.ts'), 'criarAjusteManual')
  assert.ok(corpo.indexOf("modoDaLoja(lojaId)) === 'proprio'") >= 0)
  assert.ok(corpo.indexOf("modoDaLoja(lojaId)) === 'proprio'") < corpo.indexOf('reenviarMovimentoManual('))
})

test('o módulo do inventário próprio nunca importa o Omie', () => {
  const src = ler('lib/inventario/proprio.ts').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.ok(!/lib\/omie/.test(src))
})

test('as telas escolhem a aba pelo modo: Omie intacto, próprio usa o kardex', () => {
  const pagina = ler('app/(app)/movimentacoes/page.tsx')
  assert.match(pagina, /proprio\s*\n?\s*\? <MovimentosProprio/)
  assert.match(pagina, /: <MovimentosTab/)
})
