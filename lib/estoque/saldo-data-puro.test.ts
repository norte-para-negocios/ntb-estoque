import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarDataSaldo, aplicarSaldoEmData } from './saldo-data-puro.ts'

test('avaliarDataSaldo: formato, futuro, sem histórico, antes da cobertura', () => {
  assert.deepEqual(avaliarDataSaldo('13/10/2026', '2026-08-01', '2026-10-13'), { ok: false, motivo: 'invalida' })
  assert.deepEqual(avaliarDataSaldo('2026-02-30', '2026-08-01', '2026-10-13'), { ok: false, motivo: 'invalida' })
  assert.deepEqual(avaliarDataSaldo('2026-10-14', '2026-08-01', '2026-10-13'), { ok: false, motivo: 'futuro' })
  assert.deepEqual(avaliarDataSaldo('2026-09-01', null, '2026-10-13'), { ok: false, motivo: 'sem_historico' })
  assert.deepEqual(avaliarDataSaldo('2026-07-31', '2026-08-01', '2026-10-13'), { ok: false, motivo: 'antes_cobertura' })
  assert.deepEqual(avaliarDataSaldo('2026-08-01', '2026-08-01', '2026-10-13'), { ok: true })
  assert.deepEqual(avaliarDataSaldo('2026-10-13', '2026-08-01', '2026-10-13'), { ok: true })
})

const linha = (cod: number, locais: { codigoLocal: number; local: string; saldo: number; minimo: number | null }[], minimo: number | null = null) =>
  ({ codigoProduto: cod, descricao: `P${cod}`, locais, minimo, saldo: 999, cmc: 999, valor: 999, situacao: 'ok' as const })

test('aplicarSaldoEmData: soma locais, custo do movimento mais recente, valor por local', () => {
  const linhas = [linha(1, [{ codigoLocal: 10, local: 'Cozinha', saldo: 0, minimo: 2 }]), linha(2, [])]
  const r = aplicarSaldoEmData(linhas, [
    { n_cod_prod: 1, codigo_local_estoque: 10, saldo: 3, cmc: 2, data_mov: '2026-09-01' },
    { n_cod_prod: 1, codigo_local_estoque: 20, saldo: -1, cmc: 4, data_mov: '2026-09-05' },
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].saldo, 2)
  assert.equal(r[0].cmc, 4)
  assert.equal(r[0].valor, 3 * 2 + -1 * 4)
  assert.equal(r[0].ultimoMov, '2026-09-05')
  assert.equal(r[0].situacao, 'ok')
  assert.deepEqual(r[0].locais.map((l) => [l.codigoLocal, l.saldo, l.minimo]), [[10, 3, 2], [20, -1, null]])
})

test('aplicarSaldoEmData: custo absurdo (fora de 0..1e7) vale 0 no valor; situação pelo saldo', () => {
  const r = aplicarSaldoEmData([linha(1, [], 5)], [{ n_cod_prod: 1, codigo_local_estoque: 10, saldo: 2, cmc: 2e7, data_mov: '2026-09-01' }])
  assert.equal(r[0].valor, 0)
  assert.equal(r[0].situacao, 'baixo')
  const z = aplicarSaldoEmData([linha(1, [])], [{ n_cod_prod: 1, codigo_local_estoque: 10, saldo: 0, cmc: null, data_mov: '2026-09-01' }])
  assert.equal(z[0].situacao, 'zerado')
  assert.equal(z[0].cmc, 0)
})
