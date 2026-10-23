import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapaUnidades, tirarDesfeitos, unidadeExibicao, type Desfeito } from './movimentacao-qtd-puro.ts'

test('unidadeExibicao: ml vira L e g vira kg; o resto fica', () => {
  assert.deepEqual(unidadeExibicao('ML'), { divisor: 1000, rotulo: 'L' })
  assert.deepEqual(unidadeExibicao(' g '), { divisor: 1000, rotulo: 'kg' })
  assert.deepEqual(unidadeExibicao('KG'), { divisor: 1, rotulo: 'kg' })
  assert.deepEqual(unidadeExibicao('UN'), { divisor: 1, rotulo: 'un' })
  assert.deepEqual(unidadeExibicao(null), { divisor: 1, rotulo: '' })
  // leite de coco de janeiro na loja 5: 1.559.196 ml = 1.559,196 L
  assert.equal(1559196 / unidadeExibicao('ML').divisor, 1559.196)
})

const linguica: Desfeito = {
  cod_prod: 2453421852, descricao: 'LINGUICA CALABRESA (MC)', unidade: 'KG',
  data_entrada: '2026-05-30', data_saida: '2026-05-31', quantidade_entrada: 2719998, quantidade_saida: 2720000,
}

test('tirarDesfeitos: a contagem errada de 2.720.000 kg sai da matriz de saídas e de entradas', () => {
  const saidas = [{ rotulo: 'LINGUICA CALABRESA (MC)', mes: '2026-05', qtde: 2720020, valor: 0 }, { rotulo: 'X', mes: '2026-05', qtde: 3, valor: 0 }]
  const r = tirarDesfeitos(saidas, [linguica], 'saidas', '2026-01-01', '2026-10-23')
  assert.equal(r.matriz.find((l) => l.rotulo === 'LINGUICA CALABRESA (MC)')!.qtde, 20)
  assert.equal(r.tirados.length, 1)
  assert.equal(r.tirados[0].quantidade, 2720000)
  const ent = tirarDesfeitos([{ rotulo: 'LINGUICA CALABRESA (MC)', mes: '2026-05', qtde: 2720004, valor: 0 }], [linguica], 'entradas', '2026-01-01', '2026-10-23')
  assert.equal(ent.matriz[0].qtde, 6)
})

test('tirarDesfeitos: só o lado dentro do período; linha zerada some', () => {
  const r = tirarDesfeitos([{ rotulo: 'LINGUICA CALABRESA (MC)', mes: '2026-05', qtde: '2720000' as unknown as number, valor: 0 }], [linguica], 'saidas', '2026-05-31', '2026-06-30')
  assert.equal(r.matriz.length, 0)
  const fora = tirarDesfeitos([{ rotulo: 'LINGUICA CALABRESA (MC)', mes: '2026-05', qtde: 2719998, valor: 0 }], [linguica], 'entradas', '2026-05-31', '2026-06-30')
  assert.equal(fora.tirados.length, 0)
  assert.equal(fora.matriz[0].qtde, 2719998)
})

test('mapaUnidades: por rótulo da matriz', () => {
  const m = mapaUnidades({ unidades: [{ descricao: 'LEITE DE COCO (MP)', unidade: 'ML' }], desfeitos: [] })
  assert.equal(m.get('LEITE DE COCO (MP)')!.rotulo, 'L')
  assert.equal(mapaUnidades(null).size, 0)
})
