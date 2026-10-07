import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campoCsv, lerQuantidade, linhaCsv, numeroCsv, podeFechar, progressoContagem, resumirVariancia } from './inventario-regras.ts'

test('lerQuantidade aceita vírgula, ponto e milhar brasileiro, nunca negativo', () => {
  assert.equal(lerQuantidade('1,5'), 1.5)
  assert.equal(lerQuantidade('2.5'), 2.5)
  assert.equal(lerQuantidade('1.234,5'), 1234.5)
  assert.equal(lerQuantidade(' 0 '), 0)
  assert.equal(lerQuantidade(''), null)
  assert.equal(lerQuantidade('abc'), null)
  assert.equal(lerQuantidade('-1'), null)
  assert.equal(lerQuantidade(null), null)
})

test('progresso da contagem', () => {
  assert.deepEqual(progressoContagem([]), { total: 0, contados: 0, pct: 0 })
  assert.deepEqual(progressoContagem([{ contado: 1 }, { contado: null }, { contado: 0 }]), { total: 3, contados: 2, pct: 67 })
})

test('variância: líquido, sobras, faltas e motivo obrigatório', () => {
  const linhas = [
    { delta: -2, valorDelta: -10, exigeMotivo: true, motivo: null },
    { delta: 3, valorDelta: 6, exigeMotivo: false, motivo: null },
    { delta: 0, valorDelta: 0, exigeMotivo: false, motivo: null },
  ]
  const r = resumirVariancia(linhas)
  assert.equal(r.comDiferenca, 2)
  assert.equal(r.faltas, -10)
  assert.equal(r.sobras, 6)
  assert.equal(r.liquido, -4)
  assert.equal(r.semMotivo, 1)
  assert.equal(podeFechar(linhas), false)
  assert.equal(podeFechar([{ ...linhas[0], motivo: 'quebra' }, linhas[1]]), true)
  assert.equal(podeFechar([]), false)
})

test('CSV: ponto e vírgula, aspas escapadas e números em pt-BR', () => {
  assert.equal(campoCsv('a;b'), '"a;b"')
  assert.equal(campoCsv('diz "oi"'), '"diz ""oi"""')
  assert.equal(linhaCsv(['x', 1, null]), 'x;1;')
  assert.equal(numeroCsv(1234.5), '1234,5')
})
