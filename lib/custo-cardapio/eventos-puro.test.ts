import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FichaArvore } from '../estoque/arvore-custo-puro.ts'
import {
  coberturaCompras, diasAte, explodirEvento, fatorFolga, formatarData, lerConsumoReal, listaDeCompras, listaDeProducao, pedidosDoEvento, porFamilia, porcoesNoEvento,
  proximoPasso, quantidadeTexto, resumoEvento, SEM_FAMILIA, textoConsumo, textoWhatsApp, validarConsumo, type EstadoEvento,
} from './eventos-puro.ts'

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

test('folga: fator limitado a 0–200% e aplicada nas porções dos pedidos', () => {
  assert.equal(fatorFolga(10), 1.1)
  assert.equal(fatorFolga(-5), 1)
  assert.equal(fatorFolga(500), 3)
  assert.equal(fatorFolga(null), 1)
  const p = pedidosDoEvento(100, [{ codigo: 1, porcoesPorConvidado: 0.5 }], 10)
  perto(p[0].porcoes, 55)
  // A explosão com folga cresce na mesma proporção.
  const e = explodirEvento(fichas, cmc, pedidosDoEvento(10, [{ codigo: 1, porcoesPorConvidado: 1 }], 15))
  perto(e.insumos.get(10)!.quantidade, 2 * 1.15)
})

test('resumo com folga: custo, por pessoa, sugerido e lucro sobem; preço não muda', () => {
  const r = resumoEvento(100, [{ porcoesPorConvidado: 1, custoPorPorcao: 10 }], 0.3, 40, 10)
  perto(r.custoSemFolga, 1000)
  perto(r.custoTotal, 1100)
  perto(r.custoPorPessoa, 11)
  assert.equal(r.folgaPct, 10)
  perto(r.receita as number, 4000)
  perto(r.sobra as number, 2900)
  perto(r.cmv as number, 11 / 40)
  perto(r.precoSugeridoPorPessoa, 36.9) // 11 / 0,3 = 36,67 → 36,90
  assert.equal(r.receitaComSugerido, null)
})

test('resumo: prejuízo fica negativo e, sem preço, mostra o lucro com o sugerido', () => {
  const p = resumoEvento(10, [{ porcoesPorConvidado: 1, custoPorPorcao: 50 }], 0.3, 40)
  perto(p.sobra as number, -100)
  assert.ok((p.margem as number) < 0)
  const s = resumoEvento(10, [{ porcoesPorConvidado: 1, custoPorPorcao: 12 }], 0.3, null)
  perto(s.precoSugeridoPorPessoa, 40.9)
  perto(s.receitaComSugerido as number, 409)
  perto(s.sobraComSugerido as number, 289)
  perto(s.margemComSugerido as number, (40.9 - 12) / 40.9)
})

test('compras com reservas de outros eventos: disponível, falta, conflito e concorrentes', () => {
  const e = explodirEvento(fichas, cmc, [{ codigo: 1, porcoes: 10 }, { codigo: 2, porcoes: 20 }])
  // Arroz precisa 2: estoque 5, outro evento reservou 4 → disponível 1, falta 1, conflito.
  // Tomate precisa 4: estoque 10, outro reservou 3 → disponível 7, coberto.
  // Azeite precisa 0,25: estoque 0, outro reservou 1 → comprar (não havia estoque para disputar).
  const saldos: Record<number, number> = { 10: 5, 30: 10, 40: 0 }
  const outro = (q: number) => ({ total: q, eventos: [{ eventoId: 9, nome: 'Formatura', data: '2026-12-01', quantidade: q }] })
  const res: Record<number, ReturnType<typeof outro>> = { 10: outro(4), 30: outro(3), 40: outro(1) }
  const l = listaDeCompras(e.insumos, info, (c) => saldos[c], (c) => res[c])
  const arroz = l.find((x) => x.codigo === 10)!
  assert.equal(arroz.disponivel, 1); perto(arroz.faltaComprar, 1); assert.equal(arroz.situacao, 'conflito')
  assert.deepEqual(arroz.concorrentes.map((c) => c.nome), ['Formatura'])
  perto(arroz.custoCompra, 8)
  const tomate = l.find((x) => x.codigo === 30)!
  assert.equal(tomate.disponivel, 7); assert.equal(tomate.faltaComprar, 0); assert.equal(tomate.situacao, 'coberto')
  const azeite = l.find((x) => x.codigo === 40)!
  assert.equal(azeite.disponivel, -1); perto(azeite.faltaComprar, 0.25); assert.equal(azeite.situacao, 'comprar')
  const c = coberturaCompras(l)
  assert.equal(c.faltam, 2); assert.equal(c.conflitos, 1); assert.equal(c.insumos, 3)
})

test('compras sem saldo comparável ficam "conferir"', () => {
  const e = explodirEvento(fichas, cmc, [{ codigo: 2, porcoes: 1 }])
  const l = listaDeCompras(e.insumos, info, () => undefined)
  assert.ok(l.every((x) => x.situacao === 'conferir' && x.disponivel === null))
  assert.equal(coberturaCompras(l).conferir, 2)
})

const estado = (o: Partial<EstadoEvento>): EstadoEvento => ({
  status: 'orcamento', finalizado: false, baixaFeita: false, pratos: 2, temPreco: true, dias: 10, faltam: 0, conflitos: 0, modo: 'proprio', ...o,
})

test('próximo passo segue a ordem do evento', () => {
  assert.equal(proximoPasso(estado({ pratos: 0 })).acao, 'pratos')
  assert.equal(proximoPasso(estado({ temPreco: false })).acao, 'preco')
  const conf = proximoPasso(estado({}))
  assert.equal(conf.acao, 'confirmar'); assert.equal(conf.etapa, 0)
  const disputa = proximoPasso(estado({ status: 'confirmado', faltam: 3, conflitos: 1 }))
  assert.equal(disputa.acao, 'conflito'); assert.equal(disputa.etapa, 2)
  const comprar = proximoPasso(estado({ status: 'confirmado', faltam: 3 }))
  assert.equal(comprar.acao, 'comprar'); assert.match(comprar.titulo, /3 itens/)
  assert.match(proximoPasso(estado({ status: 'confirmado', faltam: 1 })).titulo, /1 item\)/)
  assert.equal(proximoPasso(estado({ status: 'confirmado' })).acao, 'produzir')
  assert.equal(proximoPasso(estado({ status: 'confirmado', dias: 0 })).acao, 'finalizar')
  assert.equal(proximoPasso(estado({ status: 'confirmado', dias: -2, faltam: 5 })).acao, 'finalizar')
  assert.equal(proximoPasso(estado({ status: 'realizado' })).acao, 'finalizar')
})

test('próximo passo depois de finalizar: baixa no próprio, ERP no Omie, pronto com baixa', () => {
  assert.equal(proximoPasso(estado({ status: 'realizado', finalizado: true })).acao, 'baixa')
  assert.equal(proximoPasso(estado({ status: 'realizado', finalizado: true, modo: 'omie' })).acao, 'lancar_erp')
  const p = proximoPasso(estado({ status: 'realizado', finalizado: true, baixaFeita: true }))
  assert.equal(p.acao, 'pronto'); assert.equal(p.concluido, true); assert.equal(p.etapa, 3)
  const c = proximoPasso(estado({ status: 'cancelado' }))
  assert.equal(c.acao, 'cancelado'); assert.equal(c.etapa, -1)
})

test('consumo real: valida todos os insumos, só eles, e lê o gravado', () => {
  const esperados = new Set([10, 30])
  const ok = validarConsumo([{ codigo: 10, quantidade: 1.5 }, { codigo: 30, quantidade: 0 }], esperados)
  assert.deepEqual(ok, { consumo: { 10: 1.5, 30: 0 } })
  assert.ok('error' in validarConsumo([{ codigo: 10, quantidade: 1 }], esperados))
  assert.ok('error' in validarConsumo([{ codigo: 10, quantidade: 1 }, { codigo: 99, quantidade: 1 }], esperados))
  assert.ok('error' in validarConsumo([{ codigo: 10, quantidade: -1 }, { codigo: 30, quantidade: 1 }], esperados))
  assert.ok('error' in validarConsumo([{ codigo: 10, quantidade: 1 }, { codigo: 10, quantidade: 1 }], esperados))
  assert.ok('error' in validarConsumo('x', esperados))
  const m = lerConsumoReal({ 10: 1.5, 30: '2', x: 3, 40: -1 })!
  assert.deepEqual([...m.entries()], [[10, 1.5], [30, 2]])
  assert.equal(lerConsumoReal(null), null)
  assert.equal(lerConsumoReal([1]), null)
})

test('texto do consumo para lançar no ERP pula o que não foi usado', () => {
  const t = textoConsumo({ nome: 'Casamento', data: '2026-12-01' }, [
    { codigo: 10, codigoTexto: '80001', descricao: 'Arroz', unidade: 'KG', previsto: 2, usado: 2.2 },
    { codigo: 30, codigoTexto: '80002', descricao: 'Tomate', unidade: 'KG', previsto: 1, usado: 0 },
  ])
  assert.match(t, /Consumo do evento Casamento \(01\/12\/2026\)/)
  assert.match(t, /80001\tArroz\t2,2\tkg/)
  assert.doesNotMatch(t, /Tomate/)
})
