import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autorDoAjuste, origemDoAjuste, ajustesForaDaJanela } from './ajuste-autor.ts'

test('autor: carimbo do app, com e sem texto antes/depois', () => {
  assert.equal(autorDoAjuste('NTB Estoque · Edson dos santos dias'), 'Edson dos santos dias')
  assert.equal(autorDoAjuste('NTB Estoque · Edson dos santos dias | custo corrigido 03/10/2026 (era 16605.71)'), 'Edson dos santos dias')
  assert.equal(autorDoAjuste('Garrafa quebrada · Avarias do bar · NTB Estoque · Carlos Marinho'), 'Carlos Marinho')
})

test('autor: "Usuário:Nome" (com ou sem acento/espaço)', () => {
  assert.equal(autorDoAjuste('Usuário:Ramon'), 'Ramon')
  assert.equal(autorDoAjuste('Correção de saldo - Usuario: André Silva'), 'André Silva')
})

test('autor: sem marca = null', () => {
  assert.equal(autorDoAjuste('Cupom 205152'), null)
  assert.equal(autorDoAjuste(''), null)
  assert.equal(autorDoAjuste(null), null)
  assert.equal(autorDoAjuste('NTB Estoque'), null)
})

test('origem: app pelo código de integração ou pelo carimbo', () => {
  assert.equal(origemDoAjuste({ cod_int_ajuste: 'ITEM8045', obs: '' }), 'app')
  assert.equal(origemDoAjuste({ cod_int_ajuste: 'MOV-123', obs: '' }), 'app')
  assert.equal(origemDoAjuste({ cod_int_ajuste: '', obs: 'Vencido · NTB Estoque · Carlos' }), 'app')
})

test('origem: script, pdv, api e tela do Omie', () => {
  assert.equal(origemDoAjuste({ cod_int_ajuste: 'CORTE-80312-ALCAPARRAS', obs: 'NTB Estoque · X' }), 'script')
  assert.equal(origemDoAjuste({ cod_int_ajuste: 'FPI-9', obs: '' }), 'script')
  assert.equal(origemDoAjuste({ cod_int_ajuste: 'SEED-1', obs: '' }), 'script')
  assert.equal(origemDoAjuste({ cod_int_ajuste: '', obs: 'Cupom 1', origem: 'PDV' }), 'pdv')
  assert.equal(origemDoAjuste({ cod_int_ajuste: 'XYZ', obs: '', imp_api: 'S' }), 'api')
  assert.equal(origemDoAjuste({ cod_int_ajuste: '', obs: 'Usuário:Ramon', imp_api: 'N' }), 'omie')
  assert.equal(origemDoAjuste({}), 'omie')
})

test('ajustesForaDaJanela: detecta Omie ignorando o filtro de data (dd/mm/aaaa)', () => {
  const lista = [{ data: '10/10/2026' }, { data: '01/01/2025' }, { data: 'lixo' }]
  assert.equal(ajustesForaDaJanela(lista, '2026-10-01', '2026-10-13'), 1)
  assert.equal(ajustesForaDaJanela([{ data: '13/10/2026' }, { data: '01/10/2026' }], '2026-10-01', '2026-10-13'), 0)
})
