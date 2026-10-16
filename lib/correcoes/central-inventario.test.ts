import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classificarProblemas, opcoesDoProblema, previaAcao, GRUPOS, type EntradaCentral, type ProdutoC, type Problema } from './central-puro.ts'

// Refazer inventário (15/10/2026): contagem errada refeita na data dele e inventário que não ficou no fim do dia.
const base = (o: Partial<EntradaCentral> = {}): EntradaCentral => ({
  hoje: '2026-10-15', modo: 'omie', produtos: [], nomesLocais: new Map([[1, '01-BAR']]), desde: new Map(), custoHist: new Map(),
  fichas: new Map(), cmcLocal: new Map(), semCusto: [], insumosInativos: new Set(), opsAbertas: [], contagens: [], cuponsSemOP: [],
  notasPendentes: new Map(), naoControla: new Set(), ...o,
})
const amstel: ProdutoC = { codigo: 2408957311, cod: '90560', nome: 'Cerveja Amstel 600 ML', unidade: 'UN', tipo: '00', saldo: 44, cmc: 6.07, locais: [{ local: 1, saldo: 44 }] }
const ctx = { nome: (c: number) => `P${c}`, cmc: () => 0, hoje: '2026-10-15' }
type Linhas = { linhas: { rot: string; de: string; para: string }[]; omie: string; aviso?: string }

test('inventário antes das vendas do dia vira problema do grupo "inventario"', () => {
  const ps = classificarProblemas(base({
    produtos: [amstel],
    inventariosForaDoFim: [{ idAjuste: 6961871589, produto: 2408957311, local: 1, dia: '2026-10-11', contagem: 74, n: 2, soma: -2 }],
  }))
  const p = ps.find((x) => x.grupo === 'inventario') as Problema
  assert.equal(p.chave, 'inventario:ajuste:6961871589')
  assert.equal(p.titulo, 'Cerveja Amstel 600 ML')
  assert.deepEqual(p.acoes, ['refazer_inventario', 'ramon'])
  assert.equal(p.valor, 12.14)
  assert.equal(p.causa, 'Inventário de 11/10 em 01-BAR entrou antes de 2 vendas do mesmo dia (−2 un). Ele é feito com a casa fechada: deve ser o último do dia.')
  assert.deepEqual(p.d.inventario, { idAjuste: 6961871589, data: '2026-10-11', contagem: 74, n: 2, soma: -2 })
  assert.equal(p.d.local, 1)
  assert.ok(GRUPOS.inventario.nome)
})

test('inventário já refeito (ou em andamento) não aparece; nem a contagem dele', () => {
  const ps = classificarProblemas(base({
    produtos: [amstel],
    inventariosForaDoFim: [{ idAjuste: 6961871589, produto: 2408957311, local: 1, dia: '2026-10-11', contagem: 74, n: 2, soma: -2 }],
    contagens: [{ produto: 2408957311, local: 1, data: '2026-08-31', de: 5, para: 4658, movId: 7, idAjuste: 3811346389 }],
    inventariosRefeitos: new Set([6961871589, 3811346389]),
  }))
  assert.equal(ps.filter((x) => x.grupo === 'inventario' || x.grupo === 'contagem').length, 0)
})

test('contagem estranha leva o ajuste do inventário e a opção vira "Refazer o inventário de dd/mm"', () => {
  const ps = classificarProblemas(base({
    produtos: [{ ...amstel, codigo: 30, unidade: 'KG', saldo: 4658, cmc: 17, locais: [{ local: 1, saldo: 4658 }] }],
    contagens: [{ produto: 30, local: 1, data: '2026-08-31', de: 5, para: 4658, movId: 7, idAjuste: 3811346389 }],
  }))
  const p = ps.find((x) => x.grupo === 'contagem') as Problema
  assert.equal(p.d.contagem!.idAjuste, 3811346389)
  const o = opcoesDoProblema(p, '2026-10-15')[0]
  assert.equal(o.acao, 'corrigir_contagem')
  assert.equal(o.titulo, 'Refazer o inventário de 31/08')
  assert.equal(o.campos[0].inicial, '4,658')
  const r = previaAcao('corrigir_contagem', p, { para: '4,658' }, ctx) as Linhas
  assert.match(r.omie, /exclui o inventário errado e lança o certo na mesma data/)
  assert.match(r.omie, /passo a passo/)
})

test('opção e prévia de refazer no fim do dia', () => {
  const p = classificarProblemas(base({
    produtos: [amstel],
    inventariosForaDoFim: [{ idAjuste: 6961871589, produto: 2408957311, local: 1, dia: '2026-10-11', contagem: 74, n: 2, soma: -2 }],
  })).find((x) => x.grupo === 'inventario') as Problema
  const o = opcoesDoProblema(p, '2026-10-15')
  assert.equal(o[0].titulo, 'Refazer o inventário de 11/10 no fim do dia')
  assert.equal(o[0].campos.length, 0)
  assert.equal(o[1].titulo, 'Perguntar ao Ramon')
  const r = previaAcao('refazer_inventario', p, {}, ctx) as Linhas
  assert.deepEqual(r.linhas[0], { rot: 'Inventário de 11/10', de: 'antes de 2 vendas', para: 'último do dia' })
  assert.match(r.omie, /passo a passo/)
})
