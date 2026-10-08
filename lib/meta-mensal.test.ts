import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diasDoMes, semanasDoMes, resumirMes, resumirSemanas } from './meta-mensal.ts'

test('diasDoMes: meses de 28, 29, 30 e 31 dias', () => {
  assert.equal(diasDoMes('2026-10'), 31)
  assert.equal(diasDoMes('2026-04'), 30)
  assert.equal(diasDoMes('2026-02'), 28)
  assert.equal(diasDoMes('2028-02'), 29)
})

test('semanasDoMes: segunda a domingo, cortadas nas pontas do mês', () => {
  // 01/10/2026 é quinta-feira
  assert.deepEqual(semanasDoMes('2026-10'), [
    { ini: '2026-10-01', fim: '2026-10-04', nDias: 4 },
    { ini: '2026-10-05', fim: '2026-10-11', nDias: 7 },
    { ini: '2026-10-12', fim: '2026-10-18', nDias: 7 },
    { ini: '2026-10-19', fim: '2026-10-25', nDias: 7 },
    { ini: '2026-10-26', fim: '2026-10-31', nDias: 6 },
  ])
})

test('semanasDoMes: mês que começa na segunda e termina no domingo', () => {
  // fev/2027 começa na segunda (01/02/2027) e tem 28 dias
  const s = semanasDoMes('2027-02')
  assert.equal(s.length, 4)
  assert.ok(s.every((w) => w.nDias === 7))
})

const dias = (valores: number[]) => valores.map((valor, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, '0')}`, valor }))

test('resumirMes: meta, falta, ritmo e projeção no meio do mês', () => {
  // dias 1-7 fechados com 12.000, dia 8 (hoje) com 5.000 até agora
  const r = resumirMes({ mes: '2026-10', meta: 310000, dias: dias([12000, 12000, 12000, 12000, 12000, 12000, 12000, 5000]), hoje: '2026-10-08' })
  assert.equal(r.diasNoMes, 31)
  assert.equal(r.metaDiaria, 10000)
  assert.equal(r.realizado, 89000)
  assert.equal(r.falta, 221000)
  assert.equal(r.superou, false)
  assert.equal(r.pct, 28.71)
  assert.equal(r.diasFechados, 7)
  assert.equal(r.diasRestantes, 24) // hoje conta: ainda dá para vender
  assert.equal(r.precisaPorDia, 9208.33)
  assert.equal(r.media, 12000)
  assert.equal(r.projecao, 372000)
  assert.equal(r.esperadoAteOntem, 70000)
  assert.equal(r.diferencaRitmo, 14000) // 84.000 fechados contra 70.000 esperados
  assert.equal(r.pctEsperado, 22.58)
})

test('resumirMes: meta diária arredonda em centavos', () => {
  const r = resumirMes({ mes: '2026-10', meta: 1000000, dias: [], hoje: '2026-10-01' })
  assert.equal(r.metaDiaria, 32258.06)
})

test('resumirMes: primeiro dia do mês, nada fechado ainda', () => {
  const r = resumirMes({ mes: '2026-10', meta: 310000, dias: dias([800]), hoje: '2026-10-01' })
  assert.equal(r.diasFechados, 0)
  assert.equal(r.media, null)
  assert.equal(r.projecao, null)
  assert.equal(r.diasRestantes, 31)
  assert.equal(r.precisaPorDia, 9974.19) // (310000 - 800) / 31
})

test('resumirMes: mês passado fechado — sem dias restantes, projeção = realizado', () => {
  const r = resumirMes({ mes: '2026-10', meta: 300000, dias: dias(Array(31).fill(10000)), hoje: '2026-11-05' })
  assert.equal(r.diasFechados, 31)
  assert.equal(r.diasRestantes, 0)
  assert.equal(r.precisaPorDia, null)
  assert.equal(r.realizado, 310000)
  assert.equal(r.projecao, 310000)
  assert.equal(r.superou, true)
  assert.equal(r.falta, 0)
})

test('resumirMes: dias depois de hoje são ignorados', () => {
  const r = resumirMes({ mes: '2026-10', meta: 310000, dias: dias([1000, 1000, 1000]), hoje: '2026-10-02' })
  assert.equal(r.realizado, 2000)
  assert.equal(r.diasFechados, 1)
})

test('resumirSemanas: realizado, meta proporcional e situação de cada semana', () => {
  const sem = semanasDoMes('2026-10')
  const d = dias(Array(11).fill(1000)) // dias 1..11 com 1.000
  const r = resumirSemanas(sem, d, 10000, '2026-10-08')
  assert.equal(r[0].meta, 40000) // 4 dias × 10.000
  assert.equal(r[0].realizado, 4000)
  assert.equal(r[0].pct, 10)
  assert.equal(r[0].situacao, 'fechada')
  assert.equal(r[1].situacao, 'andamento') // 05 a 11 contém hoje (08)
  assert.equal(r[1].realizado, 4000) // só 05..08 (até hoje)
  assert.equal(r[2].situacao, 'futura')
  assert.equal(r[2].realizado, 0)
})
