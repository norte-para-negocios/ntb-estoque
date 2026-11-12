import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FichaArvore } from '../estoque/arvore-custo-puro.ts'
import { diasAte, explodirEvento, formatarData, listaDeCompras, listaDeProducao, porFamilia, porcoesNoEvento, quantidadeTexto, resumoEvento, SEM_FAMILIA, textoWhatsApp } from './eventos-puro.ts'

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`)

// Prato 1 (risoto): 0,2 kg de arroz (10 = arroz) + 0,1 kg de molho (20, preparação que rende 1 kg).
// Molho 20: 0,8 kg de tomate (30) com 25% de perda + 0,05 l de azeite (40).
// Prato 2 (salada): 0,15 kg de tomate (30) + 0,01 l de azeite (40).
const ficha = (codigoProduto: number, itens: [number, number, number?][], rendimento = 1): FichaArvore => ({
  codigoProduto, rendimento, expandirNaVenda: true,
  itens: itens.map(([codigoInsumo, quantidadeLiquida, perdaPct = 0]) => ({ codigoInsumo, quantidadeLiquida, fatorCorrecao: 1, perdaPct })),
})
const fichas = new Map<number, FichaArvore>([
  [1, ficha(1, [[10, 0.2], [20, 0.1]])],
  [2, ficha(2, [[30, 0.15], [40, 0.01]])],
  [20, ficha(20, [[30, 0.8, 25], [40, 0.05]])],
])
const cmc = new Map<number, number | null>([[10, 8], [30, 10], [40, 40]])

test('porções do evento = convidados × porções por convidado', () => {
  assert.equal(porcoesNoEvento(100, 0.5), 50)
  assert.equal(porcoesNoEvento(0, 1), 0)
  assert.equal(porcoesNoEvento(10, -1), 0)
})

test('resumo: custo total, por pessoa, sugerido (÷ meta, ,90), margem e CMV', () => {
  const r = resumoEvento(100, [{ porcoesPorConvidado: 1, custoPorPorcao: 12 }, { porcoesPorConvidado: 0.5, custoPorPorcao: 8 }], 0.3, 80)
  perto(r.custoTotal, 1200 + 400)
  perto(r.custoPorPessoa, 16)
  perto(r.precoSugeridoPorPessoa, 53.9) // 16 / 0,3 = 53,33 → 53,90
  perto(r.receita as number, 8000)
  perto(r.margem as number, (80 - 16) / 80)
  perto(r.cmv as number, 0.2)
  perto(r.sobra as number, 6400)
})

test('resumo sem preço: margem e receita nulas; sem convidados não divide por zero', () => {
  const r = resumoEvento(50, [{ porcoesPorConvidado: 1, custoPorPorcao: 10 }], 0.3, null)
  assert.equal(r.margem, null); assert.equal(r.receita, null); assert.equal(r.sobra, null)
  const z = resumoEvento(0, [{ porcoesPorConvidado: 1, custoPorPorcao: 10 }], 0.3, 50)
  assert.equal(z.custoPorPessoa, 0); assert.equal(z.precoSugeridoPorPessoa, 0)
})

test('explosão soma o mesmo insumo vindo de pratos e preparações diferentes', () => {
  const e = explodirEvento(fichas, cmc, [{ codigo: 1, porcoes: 10 }, { codigo: 2, porcoes: 20 }])
  // Molho: 10 × 0,1 = 1 kg
  perto(e.preparacoes.get(20)!.quantidade, 1)
  assert.equal(e.preparacoes.size, 1)
  // Arroz: 10 × 0,2 = 2 kg
  perto(e.insumos.get(10)!.quantidade, 2)
  // Tomate: molho 1 × 0,8 × 1,25 = 1 kg + salada 20 × 0,15 = 3 kg
  perto(e.insumos.get(30)!.quantidade, 4)
  // Azeite: molho 1 × 0,05 + salada 20 × 0,01 = 0,25 l
  perto(e.insumos.get(40)!.quantidade, 0.25)
  perto(e.insumos.get(30)!.custo, 40)
  assert.deepEqual(e.semFicha, [])
})

test('explosão: prato sem ficha é avisado e porção zero é ignorada', () => {
  const e = explodirEvento(fichas, cmc, [{ codigo: 99, porcoes: 5 }, { codigo: 1, porcoes: 0 }])
  assert.deepEqual(e.semFicha, [99])
  assert.equal(e.insumos.size, 0)
})

test('explosão marca insumo sem custo', () => {
  const e = explodirEvento(fichas, new Map([[10, 8]]), [{ codigo: 2, porcoes: 1 }])
  assert.equal(e.insumos.get(30)!.semCusto, true)
  assert.equal(e.insumos.get(30)!.custo, 0)
})

test('explosão de ficha em ciclo não trava e avisa', () => {
  const ciclo = new Map<number, FichaArvore>([[1, ficha(1, [[2, 1]])], [2, ficha(2, [[1, 1], [10, 1]])]])
  const e = explodirEvento(ciclo, cmc, [{ codigo: 1, porcoes: 1 }])
  assert.equal(e.ciclo, true)
  perto(e.insumos.get(10)!.quantidade, 1)
})

const info = (c: number) => ({ 10: { descricao: 'Arroz', unidade: 'KG', familia: 'Grãos' }, 30: { descricao: 'Tomate', unidade: 'KG', familia: 'Hortifruti' }, 40: { descricao: 'Azeite', unidade: 'L', familia: null }, 20: { descricao: 'Molho', unidade: 'KG', familia: null } } as Record<number, { descricao: string; unidade: string | null; familia: string | null }>)[c]

test('compras: desconta o saldo, negativo vale zero, sem saldo comparável compra tudo', () => {
  const e = explodirEvento(fichas, cmc, [{ codigo: 1, porcoes: 10 }, { codigo: 2, porcoes: 20 }])
  const saldos: Record<number, number | undefined> = { 10: 5, 30: -2, 40: undefined }
  const l = listaDeCompras(e.insumos, info, (c) => saldos[c])
  const arroz = l.find((x) => x.codigo === 10)!
  assert.equal(arroz.faltaComprar, 0); assert.equal(arroz.custoCompra, 0); assert.equal(arroz.emEstoque, 5)
  const tomate = l.find((x) => x.codigo === 30)!
  perto(tomate.faltaComprar, 4); assert.equal(tomate.emEstoque, 0); perto(tomate.custoCompra, 40)
  const azeite = l.find((x) => x.codigo === 40)!
  assert.equal(azeite.emEstoque, null); perto(azeite.faltaComprar, 0.25); assert.equal(azeite.familia, SEM_FAMILIA)
  assert.deepEqual(l.map((x) => x.descricao), ['Arroz', 'Azeite', 'Tomate'])
})

test('agrupa por família com "Sem família" no fim', () => {
  const g = porFamilia([{ familia: SEM_FAMILIA }, { familia: 'Hortifruti' }, { familia: 'Grãos' }, { familia: 'Grãos' }])
  assert.deepEqual(g.map((x) => [x.familia, x.linhas.length]), [['Grãos', 2], ['Hortifruti', 1], [SEM_FAMILIA, 1]])
})

test('produção lista as preparações com saldo', () => {
  const e = explodirEvento(fichas, cmc, [{ codigo: 1, porcoes: 10 }])
  const p = listaDeProducao(e.preparacoes, info, (c) => (c === 20 ? 0.3 : undefined))
  assert.equal(p.length, 1); perto(p[0].quantidade, 1); assert.equal(p[0].emEstoque, 0.3)
})

test('formatos de data e quantidade', () => {
  assert.equal(formatarData('2026-11-12'), '12/11/2026')
  assert.equal(formatarData(null), 'Sem data')
  assert.equal(diasAte('2026-11-15', new Date(2026, 10, 12)), 3)
  assert.equal(quantidadeTexto(0.25, 'L'), '250 ml')
  assert.equal(quantidadeTexto(0.5, 'KG'), '500 g')
  assert.equal(quantidadeTexto(4, 'KG'), '4 kg')
})

test('texto do WhatsApp traz pratos, produção e compras por família', () => {
  const e = explodirEvento(fichas, cmc, [{ codigo: 1, porcoes: 10 }, { codigo: 2, porcoes: 20 }])
  const compras = listaDeCompras(e.insumos, info, (c) => (c === 10 ? 5 : 0))
  const t = textoWhatsApp({ nome: 'Casamento', data: '2026-12-01', convidados: 30 }, [{ descricao: 'Risoto', porcoes: 10 }],
    listaDeProducao(e.preparacoes, info, () => undefined), compras)
  assert.match(t, /\*Casamento\*/)
  assert.match(t, /01\/12\/2026 · 30 convidados/)
  assert.match(t, /- Risoto: 10 porções/)
  assert.match(t, /\*Produzir\*\n- Molho: 1 kg/)
  assert.match(t, /_Hortifruti_\n- Tomate: 4 kg/)
  assert.doesNotMatch(t, /Arroz/)
  assert.match(t, /Estimativa da compra: R\$\s?50,00/)
})
