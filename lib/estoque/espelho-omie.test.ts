import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarVisaoOmie, type EntradaEspelho } from './espelho-omie.ts'

const base = (): EntradaEspelho => ({
  produtos: [
    { codigo_produto: 1, codigo: '90150', descricao: 'Moqueca', unidade: 'UN', tipo_item: '04', codigo_familia: 10, estoque_minimo: null },
    { codigo_produto: 2, codigo: '80104', descricao: 'Pescada', unidade: 'KG', tipo_item: '01', codigo_familia: null, estoque_minimo: 5 },
    { codigo_produto: 3, codigo: '70119', descricao: 'Camarão PI', unidade: 'KG', tipo_item: '03', codigo_familia: 10, estoque_minimo: null },
  ],
  posicoes: [
    // foto mais recente (13/10): local 100 e 200; sentinela 0 com CMC
    { data_posicao: '2026-10-13', codigo_local_estoque: 0, n_cod_prod: 1, n_saldo: 0, n_cmc: 66.5, estoque_minimo: 2, updated_at: '2026-10-13T13:00:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 100, n_cod_prod: 1, n_saldo: 3, n_cmc: 66.5, estoque_minimo: 0, updated_at: '2026-10-13T13:05:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 200, n_cod_prod: 1, n_saldo: -1, n_cmc: 66.5, estoque_minimo: 0, updated_at: '2026-10-13T13:06:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 0, n_cod_prod: 2, n_saldo: 0, n_cmc: 0, estoque_minimo: 0, updated_at: '2026-10-13T13:00:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 100, n_cod_prod: 2, n_saldo: 10, n_cmc: 0, estoque_minimo: 0, updated_at: '2026-10-13T13:05:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 0, n_cod_prod: 3, n_saldo: 0, n_cmc: 27960529129.45, estoque_minimo: 0, updated_at: '2026-10-13T13:00:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 100, n_cod_prod: 3, n_saldo: -4, n_cmc: 27960529129.45, estoque_minimo: 0, updated_at: '2026-10-13T13:05:00Z' },
    // foto anterior (12/10): CMC do produto 2 e local 300 que não veio hoje
    { data_posicao: '2026-10-12', codigo_local_estoque: 0, n_cod_prod: 2, n_saldo: 0, n_cmc: 30, estoque_minimo: 0, updated_at: '2026-10-12T13:00:00Z' },
    { data_posicao: '2026-10-12', codigo_local_estoque: 300, n_cod_prod: 2, n_saldo: 7, n_cmc: 30, estoque_minimo: 0, updated_at: '2026-10-12T13:00:00Z' },
  ],
  locais: [
    { codigo_local_estoque: 100, descricao: 'PADRAO', inativo: 'N' },
    { codigo_local_estoque: 200, descricao: 'COZINHA', inativo: 'N' },
    { codigo_local_estoque: 300, descricao: 'BAR', inativo: 'N' },
  ],
  familias: [{ codigo_familia: 10, nome: 'Pratos' }],
})

test('soma saldos dos locais da foto mais recente e ignora a sentinela como local', () => {
  const v = montarVisaoOmie(base())
  const p1 = v.linhas.find((l) => l.codigoProduto === 1)!
  assert.equal(p1.saldo, 2)
  assert.deepEqual(p1.locais.map((l) => [l.local, l.saldo]), [['PADRAO', 3], ['COZINHA', -1]])
  assert.equal(p1.cmc, 66.5)
  assert.equal(p1.valor, 133)
  assert.equal(p1.minimo, 2)
  assert.equal(v.dataPosicao, '2026-10-13')
  assert.equal(v.atualizadoEm, '2026-10-13T13:06:00Z')
})

test('CMC zerado na foto de hoje cai para o da foto anterior; saldo nunca mistura fotos', () => {
  const p2 = montarVisaoOmie(base()).linhas.find((l) => l.codigoProduto === 2)!
  assert.equal(p2.cmc, 30)
  assert.equal(p2.saldo, 10) // o 7 do BAR é da foto de ontem: não entra
  assert.equal(p2.minimo, 5) // sem mínimo no Omie: usa o do cadastro
})

test('CMC absurdo vira 0 e marca custo suspeito', () => {
  const v = montarVisaoOmie(base())
  const p3 = v.linhas.find((l) => l.codigoProduto === 3)!
  assert.equal(p3.cmc, 0)
  assert.equal(p3.valor, 0)
  assert.equal(p3.custoSuspeito, true)
  assert.equal(v.custoSuspeito, 1)
  assert.equal(p3.situacao, 'negativo')
})

test('local ativo que veio na foto anterior e não na mais recente é avisado', () => {
  assert.deepEqual(montarVisaoOmie(base()).locaisSemLeitura, ['BAR'])
})

test('sem nenhuma foto: lista produtos com saldo 0 e atualizadoEm null', () => {
  const v = montarVisaoOmie({ ...base(), posicoes: [] })
  assert.equal(v.atualizadoEm, null)
  assert.equal(v.dataPosicao, null)
  assert.ok(v.linhas.every((l) => l.saldo === 0 && l.situacao === 'zerado'))
  assert.deepEqual(v.locaisSemLeitura, [])
})

test('foto de hoje só com sentinela (sync em andamento): saldos vêm da foto anterior', () => {
  const e = base()
  e.posicoes = [
    { data_posicao: '2026-10-14', codigo_local_estoque: 0, n_cod_prod: 1, n_saldo: 0, n_cmc: 70, estoque_minimo: 2, updated_at: '2026-10-14T00:01:00Z' },
    ...e.posicoes.filter((p) => p.data_posicao === '2026-10-13'),
  ]
  const v = montarVisaoOmie(e)
  assert.equal(v.dataPosicao, '2026-10-13')
  const p1 = v.linhas.find((l) => l.codigoProduto === 1)!
  assert.equal(p1.saldo, 2)
  assert.equal(p1.cmc, 70) // CMC mais novo (sentinela de hoje) continua valendo
})

test('local ativo sem nenhuma linha em nenhuma foto vai para locaisSemSaldo', () => {
  const e = base()
  e.locais.push({ codigo_local_estoque: 400, descricao: 'ADEGA', inativo: 'N' })
  const v = montarVisaoOmie(e)
  assert.deepEqual(v.locaisSemSaldo, ['ADEGA'])
  assert.deepEqual(v.locaisSemLeitura, ['BAR'])
})
