import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cent, dataISO, parcelasDaNota, titulosPagarEsperados, calcularTitulosPagar, totaisPagar, conferirTitulosDasNotas,
  formaDoPagamento, titulosReceberEsperados, conferirReceber, saldosDasContas, conferirStatusOmie, situacaoPagar, brl, type CompraDoc,
} from './gabarito-puro.ts'

test('centavos e datas', () => {
  assert.equal(cent('55.2000'), 5520)
  assert.equal(cent(0.1 + 0.2), 30)
  assert.equal(cent(null), 0)
  assert.equal(dataISO('05/11/2026'), '2026-11-05')
  assert.equal(dataISO('31/02/2026'), null)
  assert.equal(dataISO('2026-11-05T10:00:00Z'), '2026-11-05')
})

test('parcelas: duas duplicatas, uma sem valor ignorada, vencimento ausente vence na emissão', () => {
  const ps = parcelasDaNota([{ dVencimento: '10/12/2026', vParcela: '30.00' }, { dVencimento: '10/01/2027', vParcela: '0' }, { vParcela: '70.50' }], 100.5, '2026-11-01', '2026-11-20')
  assert.deepEqual(ps.map((p) => [p.parcela, p.totalParcelas, p.vencimento, p.valorCent]), [[1, 2, '2026-12-10', 3000], [2, 2, '2026-11-01', 7050]])
})

test('parcelas: sem duplicata = uma parcela no total, na emissão; sem valor = nada', () => {
  assert.deepEqual(parcelasDaNota([], '16.00', '2026-11-05', 'x').map((p) => [p.valorCent, p.vencimento, p.regra]), [[1600, '2026-11-05', 'sem_duplicata']])
  assert.equal(parcelasDaNota([], 0, '2026-11-05', 'x').length, 0)
  assert.equal(parcelasDaNota([], 10, null, '2026-11-20')[0].vencimento, '2026-11-20')
})

const compra = (o: Partial<CompraDoc>): CompraDoc => ({
  compraId: 1, notaId: 10, status: 'lancada', lancadaEm: '2026-11-05T23:00:00Z', emissaoCompra: '2026-11-04', valorTotalCompra: 50,
  nota: { emissao: '2026-11-04', valorNfe: 60, fullObject: {}, apagada: false }, temItens: true, algumItemGeraConta: true, ...o,
})

test('esperados: usa o total da nota, respeita chave, status, cancelada e itens', () => {
  const r = { ligada: true, ligadaDesde: '2026-11-05T22:49:00Z' }
  const { esperados, semGerar } = titulosPagarEsperados([
    compra({ compraId: 1 }),
    compra({ compraId: 2, notaId: 11, lancadaEm: '2026-11-05T13:00:00Z' }), // antes da chave
    compra({ compraId: 3, notaId: 12, status: 'pendente' }),
    compra({ compraId: 4, notaId: 13, algumItemGeraConta: false }),
    compra({ compraId: 5, notaId: 14, nota: { emissao: '2026-11-04', valorNfe: 9, fullObject: { infoCadastro: { cCancelada: 'S' } }, apagada: false } }),
  ], r, '2026-11-20')
  assert.deepEqual(esperados.map((e) => [e.notaId, e.valorCent]), [[10, 6000]])
  assert.equal(semGerar.length, 4)
  assert.equal(titulosPagarEsperados([compra({})], { ligada: false, ligadaDesde: null }, 'x').esperados.length, 0)
})

test('conferir: faltando, valor diferente e sobrando', () => {
  const esp = [{ parcela: 1, totalParcelas: 1, vencimento: '2026-11-04', valorCent: 6000, regra: 'sem_duplicata' as const, notaId: 10, compraId: 1 }]
  assert.equal(conferirTitulosDasNotas(esp, []).length, 1)
  const t = { id: 7, valorCent: 6000, vencimento: '2026-11-04', cancelado: false, origemTipo: 'nota_entrada', origemId: 10, parcela: 1 }
  assert.equal(conferirTitulosDasNotas(esp, [t]).length, 0)
  assert.equal(conferirTitulosDasNotas(esp, [{ ...t, valorCent: 5900 }]).length, 1)
  assert.equal(conferirTitulosDasNotas(esp, [t, { ...t, id: 8, origemId: 99 }]).length, 1)
  assert.equal(conferirTitulosDasNotas(esp, [{ ...t, cancelado: true }]).length, 1)
})

test('títulos a pagar: baixa parcial, estorno não conta, atraso e totais', () => {
  const ts = [
    { id: 1, valorCent: 10000, vencimento: '2026-11-30', cancelado: false, origemTipo: 'manual', origemId: null, parcela: 1 },
    { id: 2, valorCent: 5000, vencimento: '2026-11-01', cancelado: false, origemTipo: 'manual', origemId: null, parcela: 1 },
    { id: 3, valorCent: 2000, vencimento: '2026-11-30', cancelado: false, origemTipo: 'manual', origemId: null, parcela: 1 },
    { id: 4, valorCent: 900, vencimento: '2026-11-01', cancelado: true, origemTipo: 'manual', origemId: null, parcela: 1 },
  ]
  const c = calcularTitulosPagar(ts, [
    { tituloId: 1, principalCent: 4000, estornado: false },
    { tituloId: 2, principalCent: 1000, estornado: false },
    { tituloId: 3, principalCent: 2000, estornado: false },
    { tituloId: 3, principalCent: 500, estornado: true },
  ], '2026-11-18')
  assert.deepEqual(c.map((x) => x.situacao), ['parcial', 'atrasado', 'pago', 'cancelado'])
  assert.deepEqual(totaisPagar(c), { quantidade: 4, faltaPagarCent: 6000 + 4000, atrasadoCent: 4000, quantidadeAtrasada: 1, jaPagoCent: 7000 })
  assert.equal(situacaoPagar(100, 0, false, '2026-11-18', '2026-11-18'), 'aberto')
})

test('formas de pagamento', () => {
  assert.equal(formaDoPagamento('CREDIT', 'Alelo'), 'voucher')
  assert.equal(formaDoPagamento('credit', 'visa'), 'credito')
  assert.equal(formaDoPagamento('CASH', null), 'dinheiro')
  assert.equal(formaDoPagamento('IFOOD', null), 'app_entrega')
  assert.equal(formaDoPagamento('XYZ', null), 'outros')
})

test('a receber: agrupa por dia e forma, ignora cancelada/devolvida/zero, chave desligada = nada', () => {
  const p = (o: object) => ({ vendaId: 1, data: '2026-11-01', metodo: 'PIX', bandeira: null, valorCent: 1000, cancelada: false, devolvida: false, ...o })
  const pg = [p({}), p({ valorCent: 550 }), p({ cancelada: true }), p({ devolvida: true }), p({ valorCent: 0 }), p({ metodo: 'CASH' })]
  const e = titulosReceberEsperados(pg, true)
  assert.deepEqual(e.map((x) => [x.forma, x.quantidade, x.brutoCent]), [['dinheiro', 1, 1000], ['pix', 2, 1550]])
  assert.equal(titulosReceberEsperados(pg, false).length, 0)
  assert.equal(conferirReceber(e, []).length, 2)
  assert.equal(conferirReceber(e, [{ dataVenda: '2026-11-01', forma: 'pix', quantidade: 2, brutoCent: 1550, cancelado: false }]).length, 1)
})

test('saldo: inicial, pagamento, recebimento, avulso, transferência e estornos', () => {
  const s = saldosDasContas([{ id: 1, nome: 'Caixa', saldoInicialCent: 10000, ativa: true }, { id: 2, nome: 'Banco', saldoInicialCent: 0, ativa: true }], [
    { tipo: 'pagamento', contaId: 1, valorCent: 3000, estornado: false },
    { tipo: 'pagamento', contaId: 1, valorCent: 999, estornado: true },
    { tipo: 'recebimento', contaId: 1, valorCent: 500, estornado: false },
    { tipo: 'avulso', contaId: 2, sentido: 'entrada', valorCent: 200, estornado: false },
    { tipo: 'transferencia', origemId: 1, destinoId: 2, valorCent: 1000, estornada: false },
    { tipo: 'transferencia', origemId: 1, destinoId: 2, valorCent: 7777, estornada: true },
  ])
  assert.equal(s.get(1), 10000 - 3000 + 500 - 1000)
  assert.equal(s.get(2), 1200)
})

test('espelho Omie: status coerente com a data da cópia', () => {
  const t = (status: string, venc: string, codigo = 1) => ({ id: codigo, codigo, status, vencimento: venc, valorCent: 1, syncDia: '2026-06-26' })
  assert.equal(conferirStatusOmie([t('ATRASADO', '2026-06-01'), t('AVENCER', '2026-07-01', 2), t('VENCEHOJE', '2026-06-26', 3), t('PAGTO_PARCIAL', '2020-01-01', 4)], 'x').length, 0)
  assert.equal(conferirStatusOmie([t('AVENCER', '2026-06-01')], 'x').length, 1)
  assert.equal(conferirStatusOmie([t('ATRASADO', '2026-06-01'), t('ATRASADO', '2026-06-01')], 'x').length, 1)
  assert.equal(brl(-123456), '-R$ 1.234,56')
})
