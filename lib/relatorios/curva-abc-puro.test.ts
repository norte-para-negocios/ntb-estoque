import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { curvaAbc, resumoAbc, ROTULO_CLASSE, type ItemAbc } from './curva-abc-puro.ts'

type LinhaOmie = { codigo: string; valor: number; quant: number; classeValor: string; ordemValor: number; pctAcumValor: number; classeQuant: string; ordemQuant: number; pctAcumQuant: number }
const omie: LinhaOmie[] = JSON.parse(readFileSync(new URL('./curva-abc-omie.fixture.json', import.meta.url), 'utf8')).linhas

const item = (o: Partial<ItemAbc>): ItemAbc => ({ chave: o.rotulo ?? 'x', rotulo: 'x', codigo: '', familia: 'F', tipo: 'T', valor: 0, quant: 0, ...o })
const itensOmie = omie.map((l) => item({ chave: l.codigo, rotulo: l.codigo, codigo: l.codigo, valor: l.valor, quant: l.quant }))

test('por valor: classe e % acumulado iguais aos do Omie (loja 5, 385 produtos)', () => {
  const r = curvaAbc(itensOmie, 'valor')
  const porCod = new Map(r.map((l) => [l.codigo, l]))
  const repetidos = new Set(omie.filter((o, i) => omie.some((p, j) => j !== i && p.valor === o.valor)).map((o) => o.codigo))
  let difClasse = 0
  for (const o of omie) {
    const n = porCod.get(o.codigo)!
    if (n.classe !== o.classeValor) difClasse++
    // em valores repetidos a ordem entre eles é livre; nos demais o acumulado fica a menos de 0,5 ponto (o Omie soma
    // % já arredondados e tem 6 inversões de centavos na própria ordem, ex. 569,40 antes de 569,70)
    if (!repetidos.has(o.codigo)) assert.ok(Math.abs(n.pctAcumulado - o.pctAcumValor) < 0.5, `acumulado ${o.codigo}: ${n.pctAcumulado} x ${o.pctAcumValor}`)
  }
  assert.equal(difClasse, 0)
  assert.deepEqual([r.filter((l) => l.classe === 'A').length, r.filter((l) => l.classe === 'B').length, r.filter((l) => l.classe === 'C').length], [2, 86, 297])
})

test('por quantidade: classe igual à do Omie', () => {
  const r = curvaAbc(itensOmie, 'quant')
  const porCod = new Map(r.map((l) => [l.codigo, l]))
  // empate na fronteira: o Omie não tem desempate fixo (ex. 28 un. nas ordens 63 = B e 64 = C); só esses podem trocar
  const dif = omie.filter((o) => porCod.get(o.codigo)!.classe !== o.classeQuant)
  for (const o of dif) {
    const empatados = omie.filter((p) => p.quant === o.quant)
    assert.ok(new Set(empatados.map((p) => p.classeQuant)).size > 1, `classe ${o.codigo} sem empate na fronteira`)
  }
  assert.ok(dif.length <= 2)
  assert.equal(r.filter((l) => l.classe === 'A').length, 2)
  assert.equal(r.filter((l) => l.classe === 'B').length, 61)
})

test('valores iguais: ordem estável pelo rótulo', () => {
  const r = curvaAbc([item({ rotulo: 'B', chave: 'b', valor: 10 }), item({ rotulo: 'A', chave: 'a', valor: 10 }), item({ rotulo: 'C', chave: 'c', valor: 30 })], 'valor')
  assert.deepEqual(r.map((l) => l.rotulo), ['C', 'A', 'B'])
  assert.deepEqual(r.map((l) => l.ordem), [1, 2, 3])
  assert.deepEqual(r.map((l) => l.pctAcumulado), [60, 80, 100])
  assert.deepEqual(r.map((l) => l.classe), ['B', 'B', 'C'])
})

test('item com valor zero ou negativo é sempre C; lista vazia', () => {
  const r = curvaAbc([item({ rotulo: 'a', chave: 'a', valor: 100 }), item({ rotulo: 'z', chave: 'z', valor: 0 }), item({ rotulo: 'n', chave: 'n', valor: -5 })], 'valor')
  assert.equal(r.find((l) => l.chave === 'z')!.classe, 'C')
  assert.equal(r.find((l) => l.chave === 'n')!.classe, 'C')
  assert.equal(r.find((l) => l.chave === 'a')!.classe, 'C') // um item só = 100% acumulado
  assert.deepEqual(curvaAbc([], 'valor'), [])
})

test('cortes personalizados (80/95)', () => {
  const r = curvaAbc([item({ rotulo: 'a', chave: 'a', valor: 80 }), item({ rotulo: 'b', chave: 'b', valor: 15 }), item({ rotulo: 'c', chave: 'c', valor: 5 })], 'valor', { a: 80, b: 95 })
  assert.deepEqual(r.map((l) => l.classe), ['A', 'B', 'C'])
})

test('resumo por classe soma 100% e conta itens', () => {
  const r = curvaAbc(itensOmie, 'valor')
  const s = resumoAbc(r, 'valor')
  assert.equal(s.A.itens + s.B.itens + s.C.itens, 385)
  assert.ok(Math.abs(s.A.pct + s.B.pct + s.C.pct - 100) < 0.05)
  assert.ok(Math.abs(s.A.total + s.B.total + s.C.total - 457062.48) < 0.01)
  assert.equal(ROTULO_CLASSE.B, 'B (60% das vendas)')
  const vazio = resumoAbc([], 'valor')
  assert.deepEqual(vazio.A, { itens: 0, total: 0, pct: 0 })
})
