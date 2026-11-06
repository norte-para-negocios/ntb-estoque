import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datasRecorrencia, validarRecorrente, rotuloPeriodicidade } from './recorrentes-puro.ts'

test('mensal: dia fixo dentro da janela, só a partir do início', () => {
  const r = { periodicidade: 'mensal' as const, dia: 10, inicio: '2026-11-01', fim: null }
  assert.deepEqual(datasRecorrencia(r, '2026-11-05', '2026-12-20'), ['2026-11-10', '2026-12-10'])
  assert.deepEqual(datasRecorrencia(r, '2026-11-11', '2026-12-09'), [])
  assert.deepEqual(datasRecorrencia({ ...r, inicio: '2026-12-01' }, '2026-11-05', '2027-01-31'), ['2026-12-10', '2027-01-10'])
})

test('mensal: dia 31 vira o último dia do mês (fevereiro, mês de 30)', () => {
  const r = { periodicidade: 'mensal' as const, dia: 31, inicio: '2026-01-01', fim: null }
  assert.deepEqual(datasRecorrencia(r, '2027-01-15', '2027-04-30'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  assert.deepEqual(datasRecorrencia({ ...r, dia: 29 }, '2028-02-01', '2028-02-29'), ['2028-02-29'])
})

test('mensal: o fim corta (inclusive)', () => {
  const r = { periodicidade: 'mensal' as const, dia: 5, inicio: '2026-01-01', fim: '2027-01-05' }
  assert.deepEqual(datasRecorrencia(r, '2026-11-01', '2027-03-01'), ['2026-11-05', '2026-12-05', '2027-01-05'])
})

test('semanal: dia da semana ISO (1 = segunda … 7 = domingo)', () => {
  // 2026-11-09 é segunda
  const r = { periodicidade: 'semanal' as const, dia: 1, inicio: '2026-11-01', fim: null }
  assert.deepEqual(datasRecorrencia(r, '2026-11-05', '2026-11-30'), ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
  assert.deepEqual(datasRecorrencia({ ...r, dia: 7 }, '2026-11-05', '2026-11-16'), ['2026-11-08', '2026-11-15'])
})

test('janela invertida ou fim antes do início = nada', () => {
  const r = { periodicidade: 'mensal' as const, dia: 5, inicio: '2026-01-01', fim: null }
  assert.deepEqual(datasRecorrencia(r, '2026-12-01', '2026-11-01'), [])
  assert.deepEqual(datasRecorrencia({ ...r, inicio: '2026-12-01', fim: '2026-11-01' }, '2026-01-01', '2027-01-01'), [])
})

test('validarRecorrente: fornecedor, descrição, valor, dia conforme a periodicidade, fim depois do início', () => {
  const ok = { descricao: 'Aluguel', fornecedorId: 1, valorCent: 3500_00, periodicidade: 'mensal' as const, dia: 5, inicio: '2026-11-01', fim: null }
  assert.equal(validarRecorrente(ok), null)
  assert.match(validarRecorrente({ ...ok, descricao: ' a ' }) ?? '', /descrição/)
  assert.match(validarRecorrente({ ...ok, fornecedorId: 0 }) ?? '', /fornecedor/)
  assert.match(validarRecorrente({ ...ok, valorCent: 0 }) ?? '', /valor/)
  assert.match(validarRecorrente({ ...ok, dia: 32 }) ?? '', /dia/)
  assert.match(validarRecorrente({ ...ok, periodicidade: 'semanal', dia: 8 }) ?? '', /dia da semana/)
  assert.match(validarRecorrente({ ...ok, fim: '2026-10-31' }) ?? '', /fim/)
  assert.match(validarRecorrente({ ...ok, inicio: '' }) ?? '', /início/)
})

test('rotuloPeriodicidade', () => {
  assert.equal(rotuloPeriodicidade('mensal', 5), 'Todo mês, dia 5')
  assert.equal(rotuloPeriodicidade('mensal', 31), 'Todo mês, dia 31 (ou o último dia)')
  assert.equal(rotuloPeriodicidade('semanal', 1), 'Toda semana, segunda-feira')
  assert.equal(rotuloPeriodicidade('semanal', 7), 'Toda semana, domingo')
})
