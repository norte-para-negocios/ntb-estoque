import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fimDoDia, inicioDoDia, ordenarCadeia, reordenarPagina } from './kardex-cadeia-puro.ts'

// Linhas reais do kardex do Omie (loja 5, produto 2453421862, local 2424369390). A ordem do Omie dentro do dia
// é a cadeia de saldo (saldo anterior + quantidade = saldo depois), não o id_mov.
const dia0831 = [
  { id_mov: 3811642145, quantidade: 2995.5, saldo_apos: 5500, cmc_apos: 27.492109 },
  { id_mov: 3814628292, quantidade: 2, saldo_apos: 2504.5, cmc_apos: 27.499334 },
]
const dia0915 = [
  { id_mov: 3817519218, quantidade: -11, saldo_apos: 3, cmc_apos: 27.494063 },
  { id_mov: 3827727948, quantidade: 10, saldo_apos: 14, cmc_apos: 16.062589 },
]

test('fimDoDia: último movimento da cadeia mesmo quando ele tem o menor id_mov', () => {
  assert.equal(fimDoDia(dia0831)?.saldo_apos, 5500)
  assert.equal(fimDoDia(dia0915)?.saldo_apos, 3)
})

test('inicioDoDia: primeiro movimento da cadeia (saldo antes dele = saldo de abertura)', () => {
  const ini = inicioDoDia(dia0915)
  assert.equal(ini?.id_mov, 3827727948)
  assert.equal(Number(ini?.saldo_apos) - Number(ini?.quantidade), 4)
})

test('ordenarCadeia: devolve os movimentos na ordem do Omie', () => {
  assert.deepEqual(ordenarCadeia(dia0831).map((r) => r.id_mov), [3814628292, 3811642145])
  assert.deepEqual(ordenarCadeia(dia0915).map((r) => r.id_mov), [3827727948, 3817519218])
})

test('dia que volta ao mesmo saldo (ciclo): cai para o maior id_mov, como antes', () => {
  const ciclo = [
    { id_mov: 1, quantidade: 5, saldo_apos: 15, cmc_apos: 1 },
    { id_mov: 2, quantidade: -5, saldo_apos: 10, cmc_apos: 1 },
  ]
  // abertura 10 → 15 → 10: fim = 10 (id 2), início = id 1
  assert.equal(fimDoDia(ciclo)?.id_mov, 2)
  assert.equal(inicioDoDia(ciclo)?.id_mov, 1)
})

test('um movimento só e lista vazia', () => {
  assert.equal(fimDoDia([dia0831[1]])?.id_mov, 3814628292)
  assert.equal(fimDoDia([]), null)
  assert.equal(inicioDoDia([]), null)
})

test('reordenarPagina: na tela (mais novo primeiro) cada produto+local+dia fica na ordem do Omie, sem mexer nos outros', () => {
  // página vinda do banco por data_mov desc, id_mov desc; a linha de outro produto (id 50) fica no mesmo lugar
  const linha = (r: { id_mov: number; quantidade: number; saldo_apos: number }, prod: number, data: string) => ({ ...r, n_cod_prod: prod, codigo_local_estoque: 1, data_mov: data })
  const pagina = [
    linha(dia0915[1], 7, '2026-09-15'), // id 3827727948 (+10, 4→14)
    linha({ id_mov: 50, quantidade: 1, saldo_apos: 1 }, 8, '2026-09-15'),
    linha(dia0915[0], 7, '2026-09-15'), // id 3817519218 (−11, 14→3) = último do dia no Omie
  ]
  assert.deepEqual(reordenarPagina(pagina).map((r) => r.id_mov), [3817519218, 50, 3827727948])
})
