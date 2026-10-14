import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classificarProblemas, sugestaoContagem, custoPelaFicha, type EntradaCentral, type ProdutoC, type OPAbertaC, type Problema } from './central-puro.ts'

const base = (o: Partial<EntradaCentral> = {}): EntradaCentral => ({
  hoje: '2026-10-13', modo: 'omie', produtos: [], nomesLocais: new Map([[1, 'Depósito']]), desde: new Map(), custoHist: new Map(),
  fichas: new Map(), cmcLocal: new Map(), semCusto: [], insumosInativos: new Set(), opsAbertas: [], contagens: [], cuponsSemOP: [],
  notasPendentes: new Map(), naoControla: new Set(), ...o,
})
const prod = (o: Partial<ProdutoC>): ProdutoC => ({ codigo: 10, cod: '90126', nome: 'Batata frita', unidade: 'UN', tipo: '04', saldo: -11, cmc: 5.28, locais: [{ local: 1, saldo: -11 }], ...o })
const op = (o: Partial<OPAbertaC>): OPAbertaC => ({ id: 1, nCodOP: 500, numero: '2026/00395567', produto: 10, qtd: 1, local: 1, origem: 'manual', previsao: '2026-10-10', inclusao: '2026-10-10', cupom: null, insumos: [], ...o })
const por = (ps: Problema[], chave: string) => ps.find((p) => p.chave === chave)

test('prato negativo: grupo, valor, ações e dependência dos cupons sem OP', () => {
  const ps = classificarProblemas(base({
    produtos: [prod({})], desde: new Map([['10:1', '2026-10-07']]),
    cuponsSemOP: [
      { nIdCupom: 1, num: '1', data: '2026-10-12', hora: '12:00:00', itens: [{ produto: 10, nome: 'Batata', quantidade: 1 }] },
      { nIdCupom: 2, num: '2', data: '2026-10-12', hora: '13:00:00', itens: [{ produto: 10, nome: 'Batata', quantidade: 1 }] },
    ],
  }))
  const p = por(ps, 'pa:produto:10')!
  assert.equal(p.grupo, 'pa')
  assert.equal(p.valor, 58.08)
  assert.deepEqual(p.acoes, ['zerar', 'op_prato', 'contagem', 'ramon'])
  assert.match(p.depende[0].texto, /2 cupons/)
  assert.equal(p.causa, 'Saldo −11 un no local Depósito, negativo desde 07/10. 2 cupons deste prato ficaram sem OP: a venda baixou o prato e não os insumos.')
})

test('PI, MP, taxa e não controla', () => {
  const ps = classificarProblemas(base({
    produtos: [
      prod({ codigo: 11, tipo: '03', unidade: 'KG', saldo: -64.89, cmc: 9.86, locais: [{ local: 1, saldo: -64.89 }] }),
      prod({ codigo: 12, tipo: '01', unidade: 'KG', saldo: -2, cmc: 12, locais: [{ local: 1, saldo: -2 }] }),
      prod({ codigo: 13, tipo: '99', nome: 'Taxa de Serviço', saldo: -851, cmc: 0, locais: [{ local: 1, saldo: -851 }] }),
      prod({ codigo: 14 }),
    ],
    naoControla: new Set([14]),
  }))
  assert.equal(por(ps, 'pi:produto:11')!.d.sugerida, 64.89)
  assert.deepEqual(por(ps, 'pi:produto:11')!.acoes, ['op_preparo', 'contagem', 'ramon'])
  assert.equal(por(ps, 'mp:produto:12')!.grupo, 'mp')
  const t = por(ps, 'taxa:produto:13')!
  assert.deepEqual(t.acoes, ['nao_controla', 'ramon']); assert.equal(t.valor, 0)
  assert.equal(ps.filter((p) => p.d.produto === 14).length, 0)
})

test('custo fora do normal pela ficha; custo normal não entra', () => {
  const fichas = new Map([[11, [{ insumo: 20, qtd: 1, perda: 0, local: 1 }]]])
  const ps = classificarProblemas(base({
    produtos: [
      prod({ codigo: 11, tipo: '03', unidade: 'KG', saldo: -42.245, cmc: 1589.01, locais: [{ local: 1, saldo: -42.245 }] }),
      prod({ codigo: 20, tipo: '01', unidade: 'KG', saldo: 5, cmc: 9.2, locais: [{ local: 1, saldo: 5 }] }),
      prod({ codigo: 21, tipo: '01', unidade: 'ML', saldo: 100, cmc: 0.0459, locais: [{ local: 1, saldo: 100 }] }),
    ],
    fichas, custoHist: new Map([[21, { atual: 0.0459, anterior: 0.04 }]]),
  }))
  const c = por(ps, 'custo:produto:11')!
  assert.ok(Math.abs(c.valor - 42.245 * (1589.01 - 9.2)) < 0.01)
  assert.equal(por(ps, 'pi:produto:11')!.valor, Math.round(42.245 * 9.2 * 100) / 100) // negativo usa o custo pela ficha
  assert.equal(por(ps, 'custo:produto:21'), undefined)
  assert.equal(c.causa, 'Custo médio de R$ 1.589,01/kg, 173 vezes o custo pela ficha (R$ 9,20). Costuma ser entrada com custo ou unidade errada.')
})

test('OPs: sobrando, faltando com risco de custo, velha e normal', () => {
  const ps = classificarProblemas(base({
    produtos: [
      prod({ codigo: 10, saldo: 3, locais: [{ local: 1, saldo: 3 }] }),
      prod({ codigo: 30, tipo: '03', unidade: 'KG', saldo: -10, cmc: 5, locais: [{ local: 1, saldo: -10 }] }),
      prod({ codigo: 20, tipo: '01', unidade: 'UN', saldo: 50, cmc: 600, locais: [{ local: 1, saldo: 50 }] }),
      prod({ codigo: 31, saldo: 2, locais: [{ local: 1, saldo: 2 }] }),
      prod({ codigo: 32, saldo: 2, locais: [{ local: 1, saldo: 2 }] }),
    ],
    custoHist: new Map([[20, { atual: 600, anterior: 3 }]]),
    opsAbertas: [
      op({ id: 1, nCodOP: 500, origem: 'cupom', cupom: '206260', produto: 10 }),
      op({ id: 2, nCodOP: 501, produto: 30, qtd: 232, insumos: [{ produto: 20, qtd: 232 }], inclusao: '2026-10-03' }),
      op({ id: 3, nCodOP: 502, produto: 31, inclusao: '2026-10-11', previsao: '2026-10-11' }),
      op({ id: 4, nCodOP: 503, produto: 32, inclusao: '2026-10-04', previsao: '2026-10-04' }),
    ],
  }))
  const s = por(ps, 'op:op:500')!
  assert.equal(s.d.sentido, 'sobrando'); assert.equal(s.acoes[0], 'excluir'); assert.equal(s.alvo.id, 1)
  assert.equal(s.causa, 'OP do caixa (cupom 206260) aberta desde 10/10, e o prato já tem saldo 3 un no local. Concluir agora deixaria sobra; excluir evita entrada em dobro.')
  const f = por(ps, 'op:op:501')!
  assert.equal(f.d.sentido, 'faltando'); assert.equal(f.tag, 'Risco')
  assert.ok(f.depende.some((d) => d.chave === 'custo:produto:20'))
  assert.equal(f.valor, 139200)
  assert.equal(por(ps, 'op:op:502'), undefined)
  assert.equal(por(ps, 'op:op:503')!.d.sentido, 'velha')
})

test('contagem com unidade trocada, insumo sem custo e inativo, cupom sem OP', () => {
  const ps = classificarProblemas(base({
    produtos: [prod({ codigo: 30, tipo: '01', unidade: 'KG', saldo: 4658, cmc: 17, locais: [{ local: 1, saldo: 4658 }] }), prod({ codigo: 40, saldo: 1, locais: [{ local: 1, saldo: 1 }] }), prod({ codigo: 10, saldo: 0, locais: [{ local: 1, saldo: 0 }] })],
    contagens: [{ produto: 30, local: 1, data: '2026-08-31', de: 5, para: 4658 }],
    semCusto: [{ insumo: 50, local: 1, pratos: [40, 41] }],
    fichas: new Map([[40, [{ insumo: 51, qtd: 1, perda: 0, local: 1 }]]]),
    insumosInativos: new Set([51]),
    cuponsSemOP: [{ nIdCupom: 77, num: '206453', data: '2026-10-12', hora: '15:20:00', itens: [{ produto: 10, nome: 'Batata', quantidade: 2 }] }],
  }))
  const c = por(ps, 'contagem:produto:30:1')!
  assert.equal(c.d.contagem!.sugerida, 4.658); assert.equal(c.valor, (4658 - 5) * 17)
  assert.deepEqual(por(ps, 'semcusto:produto:50:1')!.d.pratos, [40, 41])
  assert.ok(por(ps, 'semcusto:produto:51:inativo'))
  const cp = por(ps, 'cupom:cupom:77')!
  assert.deepEqual(cp.acoes, ['criar_ops_cupom', 'ramon']); assert.equal(cp.valor, 10.56)
  assert.equal(cp.causa, 'Cupom 206453 de 12/10 às 15:20: Batata ×2 sem OP. A venda baixou os pratos, mas os insumos não saíram.')
})

test('sugestão de contagem e custo pela ficha', () => {
  assert.equal(sugestaoContagem(5, 4658), 4.658)
  assert.equal(sugestaoContagem(5, 12), null)
  assert.equal(custoPelaFicha([{ insumo: 1, qtd: 2, perda: 10, local: null }], () => 3), 6.6)
})

test('duas contagens estranhas do mesmo produto/local viram um problema (a mais recente)', () => {
  const ps = classificarProblemas(base({
    produtos: [prod({ codigo: 30, tipo: '01', unidade: 'G', saldo: 7001, cmc: 0.01, locais: [{ local: 1, saldo: 7001 }] })],
    contagens: [{ produto: 30, local: 1, data: '2026-09-15', de: 16500, para: 6.3 }, { produto: 30, local: 1, data: '2026-10-12', de: 800, para: 7000 }],
  }))
  const c = ps.filter((p) => p.chave === 'contagem:produto:30:1')
  assert.equal(c.length, 1); assert.equal(c[0].d.contagem!.data, '2026-10-12')
  assert.equal(new Set(ps.map((p) => p.chave)).size, ps.length)
})

test('prato negativo com custo fora do normal é valorado pela ficha, não pelo custo errado', () => {
  const ps = classificarProblemas(base({
    produtos: [prod({ codigo: 10, saldo: -185, cmc: 600, locais: [{ local: 1, saldo: -185 }] }), prod({ codigo: 20, tipo: '01', saldo: 10, cmc: 4.6, locais: [{ local: 1, saldo: 10 }] })],
    fichas: new Map([[10, [{ insumo: 20, qtd: 1, perda: 0, local: 1 }]]]),
  }))
  assert.ok(ps.find((p) => p.chave === 'custo:produto:10'))
  assert.equal(ps.find((p) => p.chave === 'pa:produto:10')!.valor, 851)
})

test('C2: contagem já corrigida pela Central (marca no banco) não aparece de novo', () => {
  const ps = classificarProblemas(base({
    produtos: [prod({ codigo: 30, tipo: '01', unidade: 'KG', saldo: 4658, cmc: 17, locais: [{ local: 1, saldo: 4658 }] })],
    contagens: [{ produto: 30, local: 1, data: '2026-08-31', de: 5, para: 4658, movId: 777 }],
    contagensCorrigidas: new Set([777]),
  }))
  assert.equal(ps.filter((p) => p.grupo === 'contagem').length, 0)
  const ps2 = classificarProblemas(base({
    produtos: [prod({ codigo: 30, tipo: '01', unidade: 'KG', saldo: 4658, cmc: 17, locais: [{ local: 1, saldo: 4658 }] })],
    contagens: [{ produto: 30, local: 1, data: '2026-08-31', de: 5, para: 4658, movId: 777 }],
  }))
  assert.equal(ps2.find((p) => p.grupo === 'contagem')!.d.contagem!.movId, 777)
})
