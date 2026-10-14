import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuponsSemOP, codIntOPCupom, codIntOPCorrecao, ehOPdoPDV, coberturaAindaFalta, resumoCuponsPorDia, type ItemCupom } from './cupons-sem-op-puro.ts'

const it = (o: Partial<ItemCupom>): ItemCupom => ({ nIdCupom: 1, num: '100', data: '2026-10-13', hora: '12:00:00', produto: 10, nome: 'Moqueca', quant: 1, ...o })

test('PDV: numérico, Cupom N, origem cupom, CP-', () => {
  assert.ok(ehOPdoPDV({ cCodInt: '1559131' }))
  assert.ok(ehOPdoPDV({ cCodInt: 'X', obs: 'Cupom 206260' }))
  assert.ok(ehOPdoPDV({ cCodInt: 'X', origem: 'cupom' }))
  assert.ok(ehOPdoPDV({ cCodInt: 'CP-abc-def' }))
  assert.ok(!ehOPdoPDV({ cCodInt: 'NTB-1' }))
  assert.ok(!ehOPdoPDV({ cCodInt: null }))
})

test('FIFO por hora: manhã coberta, tarde sem OP; só produtos com OP do PDV', () => {
  const r = cuponsSemOP([
    it({ nIdCupom: 1, hora: '11:00:00' }), it({ nIdCupom: 2, hora: '15:00:00', num: '101' }),
    it({ nIdCupom: 2, hora: '15:00:00', num: '101', produto: 99, nome: 'Água' }),
  ], [{ data: '2026-10-13', produto: 10, qtd: 1 }], new Set([10]), '2026-10-13T23:00:00')
  assert.deepEqual(r, [{ nIdCupom: 2, num: '101', data: '2026-10-13', hora: '15:00:00', itens: [{ produto: 10, nome: 'Moqueca', quantidade: 1 }] }])
})

test('mesmo prato em duas linhas soma; cobertura parcial; corte de 2 h fora', () => {
  const r = cuponsSemOP([it({ quant: 1 }), it({ quant: 2 }), it({ nIdCupom: 3, hora: '22:30:00' })], [{ data: '2026-10-13', produto: 10, qtd: 1 }], new Set([10]), '2026-10-13T21:00:00')
  assert.equal(r.length, 1)
  assert.deepEqual(r[0].itens, [{ produto: 10, nome: 'Moqueca', quantidade: 2 }])
})

test('OP de outro dia não cobre; cupom de dia anterior ao corte entra inteiro', () => {
  assert.equal(cuponsSemOP([it({})], [{ data: '2026-10-12', produto: 10, qtd: 5 }], new Set([10]), '2026-10-14T00:00:00').length, 1)
})

test('ordem: mais recente primeiro', () => {
  const r = cuponsSemOP([it({ nIdCupom: 1, data: '2026-10-08' }), it({ nIdCupom: 2, data: '2026-10-09' })], [], new Set([10]), '2026-10-14T00:00:00')
  assert.deepEqual(r.map((c) => c.nIdCupom), [2, 1])
})

test('códigos determinísticos e curtos', () => {
  assert.equal(codIntOPCupom(2302207100, 2796952545), codIntOPCupom(2302207100, 2796952545))
  assert.ok(codIntOPCupom(2302207100, 2796952545).startsWith('CP-'))
  assert.ok(codIntOPCupom(2302207100, 2796952545).length <= 20)
  assert.notEqual(codIntOPCupom(2302207100, 2796952545), codIntOPCupom(2302207101, 2796952545))
  assert.ok(codIntOPCupom(9e14, 9e14).length <= 20)
  const a = codIntOPCorrecao(5, 10, '2026-10-13', 2)
  assert.ok(a.startsWith('CT-') && a.length <= 20)
  assert.equal(a, codIntOPCorrecao(5, 10, '2026-10-13', 2))
  assert.notEqual(a, codIntOPCorrecao(5, 10, '2026-10-13', 3))
})

test('cobertura ainda falta (PDV reprocessou?)', () => {
  assert.ok(coberturaAindaFalta(3, 1, 2))
  assert.ok(!coberturaAindaFalta(3, 2, 2))
  assert.ok(!coberturaAindaFalta(3, 3, 1))
})

test('resumo por dia', () => {
  assert.deepEqual(resumoCuponsPorDia([{ nIdCupom: 1, num: null, data: '2026-10-08', hora: null, itens: [{ produto: 1, nome: 'a', quantidade: 2 }] }]), [{ data: '2026-10-08', cupons: 1, itens: 2 }])
})

import { pareceOPJaExiste, validarPedidoOP } from './cupons-sem-op-puro.ts'
test('erro do Omie de OP já cadastrada', () => {
  assert.ok(pareceOPJaExiste('Ordem de Produção já cadastrada para o Código de Integração [CP-a-b]'))
  assert.ok(pareceOPJaExiste('Já existe uma OP com o código de integração informado'))
  assert.ok(!pareceOPJaExiste('Já existe uma requisição desse método em andamento'))
  assert.ok(!pareceOPJaExiste('Produto não cadastrado'))
})
test('pedido de OP: quantidade, data e produto', () => {
  assert.equal(validarPedidoOP({ quantidade: 2, dataISO: '2026-10-13', tipo: '04' }, '2026-10-13'), null)
  assert.match(validarPedidoOP({ quantidade: 0, dataISO: '2026-10-13', tipo: '04' }, '2026-10-13') ?? '', /quantidade/)
  assert.match(validarPedidoOP({ quantidade: 1e6, dataISO: '2026-10-13', tipo: '04' }, '2026-10-13') ?? '', /quantidade/)
  assert.match(validarPedidoOP({ quantidade: 1, dataISO: '2026-10-14', tipo: '04' }, '2026-10-13') ?? '', /futuro/)
  assert.match(validarPedidoOP({ quantidade: 1, dataISO: '13/10/2026', tipo: '04' }, '2026-10-13') ?? '', /data/)
  assert.match(validarPedidoOP({ quantidade: 1, dataISO: '2026-10-13', tipo: '01' }, '2026-10-13') ?? '', /prato ou preparo/)
  assert.match(validarPedidoOP({ quantidade: 1, dataISO: '2026-06-01', tipo: '04' }, '2026-10-13') ?? '', /90 dias/)
})
