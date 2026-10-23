import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarNumeros, formatarValor, destaquesDoModulo, type Contagens } from './numeros.ts'

const vazio: Contagens = {
  produtosAtivos: null,
  inventariosAbertos: null,
  transferenciasAbertas: null,
  lotesVencendo: null,
  notasEsperando: null,
  opsAbertas: null,
  opsConcluidasHoje: null,
}

test('contagem que falhou não vira zero: a tela fica sem número', () => {
  assert.deepEqual(montarNumeros(vazio), {})
})

test('pendência com valor vira alerta; zero não', () => {
  const n = montarNumeros({ ...vazio, lotesVencendo: 5, notasEsperando: 0 })
  assert.deepEqual(n['/validade'], { valor: 5, rotulo: 'lotes vencem em 7 dias', alerta: true })
  assert.deepEqual(n['/nota-fiscal'], { valor: 0, rotulo: 'notas esperando entrada', alerta: false })
})

test('singular e plural', () => {
  const n = montarNumeros({ ...vazio, produtosAtivos: 1, opsConcluidasHoje: 1, lotesVencendo: 1 })
  assert.equal(n['/estoque'].rotulo, 'produto ativo')
  assert.equal(n['/ordem-producao'].rotulo, 'concluída hoje')
  assert.equal(n['/validade'].rotulo, 'lote vence em 7 dias')
})

test('valor inválido é ignorado', () => {
  assert.deepEqual(montarNumeros({ ...vazio, produtosAtivos: Number.NaN, opsAbertas: -1 }), {})
})

test('milhar no padrão brasileiro', () => {
  assert.equal(formatarValor(1284), '1.284')
  assert.equal(formatarValor(7), '7')
})

test('destaques do módulo: alertas primeiro, no máximo dois', () => {
  const n = montarNumeros({ ...vazio, produtosAtivos: 1284, inventariosAbertos: 2, lotesVencendo: 3 })
  const d = destaquesDoModulo(['/estoque', '/inventario', '/validade', '/kardex'], n)
  assert.deepEqual(d.map((x) => x.href), ['/validade', '/estoque'])
})
