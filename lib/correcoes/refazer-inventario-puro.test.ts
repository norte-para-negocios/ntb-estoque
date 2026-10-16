import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  planejarRefazer, passosRefazer, obsRefazer, proximaEscrita, assinaturaPlano, codIntRefazer, type MovKardexDia, type Plano,
} from './refazer-inventario-puro.ts'

// Kardex real da Cerveja Amstel 600 ML, loja 4 (AMJ/Sertão), local 01-BAR, 11/10/2026 (ListarMovimentoEstoque, 15/10).
const m = (idMov: number, idAjuste: number | null, codOrigem: string, qtde: number, saldo: number, cmc = 7.473405): MovKardexDia =>
  ({ idMov, idAjuste, codOrigem, qtde, saldo, cmc, cancelado: false })
const AMSTEL: MovKardexDia[] = [
  m(6961837316, 6961837314, 'PDV', -3, 96), m(6961858169, 6961858167, 'PDV', -2, 94), m(6961858371, 6961858369, 'PDV', -2, 92),
  m(6961858867, 6961858865, 'PDV', -1, 91), m(6961859814, 6961859812, 'PDV', -2, 89), m(6961861396, 6961861394, 'PDV', -3, 86),
  m(6961861856, 6961861854, 'PDV', -1, 85), m(6961863237, 6961863235, 'PDV', -3, 82),
  m(6961871591, 6961871589, 'AJU', -8, 74, 6.069153),
  m(6961883964, 6961883962, 'PDV', -1, 73, 6.069153), m(6961886381, 6961886379, 'PDV', -1, 72, 6.069153),
  m(6962540518, null, 'COM', 72, 99),
]
const INV = 6961871589

test('fim do dia (Amstel 11/10): vendas que entraram depois vão para antes; a compra lançada depois continua valendo', () => {
  const p = planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL, idAjusteInventario: INV }) as Plano
  assert.equal(p.saldoAntes, 82)
  assert.equal(p.contagemLancada, 74)
  assert.equal(p.contagemCerta, 74)
  assert.deepEqual(p.vendasDepois, { n: 2, soma: -2 })
  assert.equal(p.outrosDepois.n, 1)
  assert.equal(p.outrosDepois.soma, 72)
  assert.equal(p.quan, 6)
  assert.equal(p.tipo, 'SAI')
  assert.equal(p.quantidade, 6)
  assert.equal(p.cmc, 6.069153)
  assert.deepEqual(p.excluir, [INV])
  assert.equal(p.fimDoDia, 146)
  assert.ok(p.avisos.some((a) => /compra|depois da contagem/i.test(a)))
})

test('fim do dia sem vendas depois: nada a corrigir', () => {
  const r = planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL.slice(0, 9), idAjusteInventario: INV })
  assert.ok('erro' in r && /último/.test(r.erro))
})

test('contagem errada (vírgula): saldo antes já era a contagem certa → só exclui', () => {
  const movs = [m(10, 1, 'OPS', -0.1, 4.758, 20), m(12, 11, 'AJU', 4653.242, 4658, 20)]
  const p = planejarRefazer({ modo: 'contagem', movs, idAjusteInventario: 11, contagemCerta: 4.658, correcoes: [99] }) as Plano
  assert.equal(p.saldoAntes, 4.758)
  assert.equal(p.quan, 0.1)
  assert.equal(p.tipo, 'SAI')
  assert.deepEqual(p.excluir, [99, 11])
  const q = planejarRefazer({ modo: 'contagem', movs: [m(10, 1, 'OPS', -0.1, 4.658, 20), m(12, 11, 'AJU', 4653.342, 4658, 20)], idAjusteInventario: 11, contagemCerta: 4.658 }) as Plano
  assert.equal(q.quan, 0)
  assert.equal(q.tipo, null)
  assert.equal(q.quantidade, 0)
})

test('contagem errada com vendas do dia depois: entram antes do inventário; contagem maior que o saldo = ENT', () => {
  const movs = [m(10, 1, 'PDV', -1, 5, 3), m(12, 11, 'AJU', 1995, 2000, 3), m(14, 13, 'AJU', -1, 1999, 3)]
  const p = planejarRefazer({ modo: 'contagem', movs, idAjusteInventario: 11, contagemCerta: 2, vendasAju: [13] }) as Plano
  // saldo antes 5, venda AJU (sem nota) depois −1 → 4; contagem 2 → saída de 2
  assert.equal(p.quan, 2)
  assert.equal(p.tipo, 'SAI')
  const e = planejarRefazer({ modo: 'contagem', movs, idAjusteInventario: 11, contagemCerta: 10, vendasAju: [13] }) as Plano
  assert.equal(e.quan, -6)
  assert.equal(e.tipo, 'ENT')
  assert.equal(e.quantidade, 6)
})

test('a correção posterior que será excluída não conta como movimento depois', () => {
  const movs = [m(10, 1, 'PDV', -1, 5, 3), m(12, 11, 'AJU', 1995, 2000, 3), m(14, 99, 'AJU', -1998, 2, 3)]
  const p = planejarRefazer({ modo: 'contagem', movs, idAjusteInventario: 11, contagemCerta: 2, correcoes: [99] }) as Plano
  assert.equal(p.outrosDepois.n, 0)
  assert.equal(p.quan, 3)
})

test('mesma contagem e nada depois: recusa', () => {
  const r = planejarRefazer({ modo: 'contagem', movs: AMSTEL.slice(0, 9), idAjusteInventario: INV, contagemCerta: 74 })
  assert.ok('erro' in r && /mesma contagem/.test(r.erro))
})

test('recusas: inventário fora do kardex, não é ajuste, kardex fora de ordem, sem custo, contagem inválida', () => {
  assert.ok('erro' in planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL, idAjusteInventario: 123 }))
  const naoAju = AMSTEL.map((x) => (x.idAjuste === INV ? { ...x, codOrigem: 'PDV' } : x))
  assert.ok('erro' in planejarRefazer({ modo: 'fim_do_dia', movs: naoAju, idAjusteInventario: INV }))
  const foraDeOrdem = AMSTEL.map((x) => (x.idMov === 6961863237 ? { ...x, saldo: 90 } : x))
  const f = planejarRefazer({ modo: 'fim_do_dia', movs: foraDeOrdem, idAjusteInventario: INV })
  assert.ok('erro' in f && /não fecha/.test(f.erro))
  const semCusto = AMSTEL.map((x) => (x.idAjuste === INV ? { ...x, cmc: 0 } : x))
  assert.ok('erro' in planejarRefazer({ modo: 'fim_do_dia', movs: semCusto, idAjusteInventario: INV }))
  assert.ok('erro' in planejarRefazer({ modo: 'contagem', movs: AMSTEL, idAjusteInventario: INV, contagemCerta: -1 }))
  assert.ok('erro' in planejarRefazer({ modo: 'contagem', movs: AMSTEL, idAjusteInventario: INV, contagemCerta: null }))
})

test('movimento cancelado não conta', () => {
  const movs = [...AMSTEL.slice(0, 10), { ...AMSTEL[10], cancelado: true }]
  const p = planejarRefazer({ modo: 'fim_do_dia', movs, idAjusteInventario: INV }) as Plano
  assert.deepEqual(p.vendasDepois, { n: 1, soma: -1 })
  assert.equal(p.quan, 7)
})

test('inventário que não mexeu no saldo (contagem bateu) não aparece no kardex: posição pelo id do ajuste', () => {
  // ajuste 50 entre o movimento 40 e o 60; saldo antes dele = 10 = contagem gravada no banco
  const movs = [m(40, 39, 'PDV', -1, 10, 2), m(60, 59, 'PDV', -2, 8, 2)]
  const p = planejarRefazer({ modo: 'fim_do_dia', movs, idAjusteInventario: 50, contagemDb: 10 }) as Plano
  assert.equal(p.semMovimento, true)
  assert.equal(p.saldoAntes, 10)
  assert.equal(p.quan, -2)
  assert.equal(p.tipo, 'ENT')
  const r = planejarRefazer({ modo: 'fim_do_dia', movs, idAjusteInventario: 50, contagemDb: 11 })
  assert.ok('erro' in r)
})

test('passo a passo e obs', () => {
  const p = planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL, idAjusteInventario: INV }) as Plano
  const passos = passosRefazer(p, { dataBR: '11/10/2026', un: 'UN', correcoes: [], mesFechado: false })
  assert.equal(passos.length, 4)
  assert.match(passos[0], /Excluir o inventário de 11\/10\/2026.*6961871589.*74/)
  assert.match(passos[1], /2 vendas/)
  assert.match(passos[2], /saída de 6/)
  assert.match(passos[3], /146/)
  assert.equal(obsRefazer(p, '11/10/2026'), 'Inventário de 11/10/2026 refeito no fim do dia: contagem 74 (2 vendas do dia tinham entrado depois dele) · Central de correções')

  const c = planejarRefazer({ modo: 'contagem', movs: [m(10, 1, 'OPS', -0.1, 4.758, 20), m(12, 11, 'AJU', 4653.242, 4658, 20)], idAjusteInventario: 11, contagemCerta: 4.658, correcoes: [99] }) as Plano
  const pc = passosRefazer(c, { dataBR: '31/08/2026', un: 'KG', correcoes: [{ idAjuste: 99, data: '14/10/2026', tipo: 'SAI', quantidade: 4653.342 }], mesFechado: true })
  assert.match(pc[0], /Excluir o ajuste de correção 99 lançado em 14\/10\/2026 \(saída de 4653,342 KG\)/)
  assert.ok(pc.some((x) => /contabilidade/.test(x)))
  assert.equal(obsRefazer(c, '31/08/2026'), 'Inventário de 31/08/2026 refeito: contagem 4,658 (tinha sido lançada como 4658) · Central de correções')
  const nada = planejarRefazer({ modo: 'contagem', movs: [m(10, 1, 'OPS', -0.1, 4.658, 20), m(12, 11, 'AJU', 4653.342, 4658, 20)], idAjusteInventario: 11, contagemCerta: 4.658 }) as Plano
  assert.ok(passosRefazer(nada, { dataBR: '31/08/2026', un: 'KG', correcoes: [], mesFechado: false }).some((x) => /Não lançar nada/.test(x)))
})

test('próxima escrita: exclui na ordem, confere inclusão sem resposta, inclui, fim', () => {
  const base = { excluir: [99, 11], excluidos: [] as number[], tipo: 'SAI' as const, idNovo: null as number | null, pendente: null }
  assert.deepEqual(proximaEscrita(base), { acao: 'excluir', id: 99 })
  assert.deepEqual(proximaEscrita({ ...base, excluidos: [99] }), { acao: 'excluir', id: 11 })
  assert.deepEqual(proximaEscrita({ ...base, excluidos: [99], pendente: { acao: 'excluir', id: 11 } }), { acao: 'excluir', id: 11 })
  assert.deepEqual(proximaEscrita({ ...base, excluidos: [99, 11] }), { acao: 'incluir' })
  assert.deepEqual(proximaEscrita({ ...base, excluidos: [99, 11], pendente: { acao: 'incluir' } }), { acao: 'conferir_inclusao' })
  assert.deepEqual(proximaEscrita({ ...base, excluidos: [99, 11], idNovo: 5 }), { acao: 'fim' })
  assert.deepEqual(proximaEscrita({ ...base, tipo: null, excluidos: [99, 11] }), { acao: 'fim' })
})

test('assinatura muda quando o plano muda; código interno do ajuste novo', () => {
  const p = planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL, idAjusteInventario: INV }) as Plano
  const q = planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL.slice(0, 11), idAjusteInventario: INV }) as Plano
  assert.equal(assinaturaPlano(p), assinaturaPlano(q)) // a compra não muda o que é lançado
  const r = planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL.slice(0, 10), idAjusteInventario: INV }) as Plano
  assert.notEqual(assinaturaPlano(p), assinaturaPlano(r))
  assert.equal(codIntRefazer(7), 'INVR-7')
})

test('outro inventário do mesmo produto/local depois deste no mesmo dia: recusa (refaça o último)', () => {
  const movs = [...AMSTEL.slice(0, 10), m(6961890000, 6961889998, 'AJU', 1, 74, 6.069153), AMSTEL[10]]
  const r = planejarRefazer({ modo: 'fim_do_dia', movs, idAjusteInventario: INV, inventariosDoDia: [INV, 6961889998] })
  assert.ok('erro' in r && /outro inventário/.test(r.erro))
  const ok = planejarRefazer({ modo: 'fim_do_dia', movs: AMSTEL, idAjusteInventario: INV, inventariosDoDia: [INV] })
  assert.ok(!('erro' in ok))
})
