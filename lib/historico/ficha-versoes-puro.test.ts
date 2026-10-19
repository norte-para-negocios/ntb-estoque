import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffVersoesFicha, type VersaoFicha } from './historico-puro.ts'

const nome = (c: number) => ({ 1: 'Farinha', 2: 'Ovo', 3: 'Leite' } as Record<number, string>)[c] ?? `#${c}`
const v = (versao: number, itens: VersaoFicha['itens'], extra: Partial<VersaoFicha> = {}): VersaoFicha => ({
  versao, rendimento: 10, expandirNaVenda: false, obs: null, ativa: false, criadaPor: 'Ana', criadaEm: `2026-10-${10 + versao}T12:00:00Z`, itens, ...extra,
})
const it = (codigoInsumo: number, quantidadeLiquida: number, perdaPct = 0, fatorCorrecao = 1) => ({ codigoInsumo, quantidadeLiquida, perdaPct, fatorCorrecao })

test('1ª versão = criou, com os insumos', () => {
  const m = diffVersoesFicha([v(1, [it(1, 0.5), it(2, 2)])], nome)
  assert.equal(m.length, 1)
  assert.equal(m[0].itens[0].tipo, 'criou')
  assert.equal(m[0].itens.filter((i) => i.tipo === 'item_incluido').length, 2)
})

test('versão nova: insumo incluído, removido, quantidade e rendimento alterados; mais nova primeiro', () => {
  const m = diffVersoesFicha([
    v(1, [it(1, 0.5), it(2, 2)]),
    v(2, [it(1, 0.6, 5), it(3, 1)], { rendimento: 12, ativa: true, criadaPor: 'Bia' }),
  ], nome)
  assert.equal(m.length, 2)
  const novo = m[0]
  assert.equal(novo.autor, 'Bia')
  const alterou = novo.itens.find((i) => i.tipo === 'alterou')!
  assert.deepEqual(alterou.mudancas.map((x) => [x.rotulo, x.de, x.para]), [['Rendimento', '10', '12']])
  const farinha = novo.itens.find((i) => i.tipo === 'item_alterado')!
  assert.equal(farinha.titulo, 'Farinha')
  assert.deepEqual(farinha.mudancas.map((x) => [x.rotulo, x.de, x.para]), [['Quantidade líquida', '0,5', '0,6'], ['Perda (%)', '0', '5']])
  assert.equal(novo.itens.find((i) => i.tipo === 'item_incluido')!.titulo, 'Leite')
  assert.equal(novo.itens.find((i) => i.tipo === 'item_removido')!.titulo, 'Ovo')
})

test('versão igual à anterior não gera momento vazio (só registra a regravação)', () => {
  const m = diffVersoesFicha([v(1, [it(1, 1)]), v(2, [it(1, 1)])], nome)
  assert.equal(m.length, 2)
  assert.equal(m[0].itens[0].tipo, 'alterou')
  assert.equal(m[0].itens[0].mudancas[0].rotulo, 'Versão')
})

test('versões fora de ordem são ordenadas pelo número', () => {
  const m = diffVersoesFicha([v(2, [it(1, 2)]), v(1, [it(1, 1)])], nome)
  assert.equal(m[1].itens[0].tipo, 'criou')
})
