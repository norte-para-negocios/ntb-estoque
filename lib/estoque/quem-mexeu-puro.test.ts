import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chavePessoa, resumoPorPessoa, linhaDoTempo, type Evento } from './quem-mexeu-puro.ts'

const ev = (pessoa: string | null, quando: string, tipo: Evento['tipo'], titulo = 't'): Evento => ({ pessoa, quando, tipo, titulo, detalhe: '', href: null })

test('chavePessoa: junta grafias (espaço, caixa, acento); vazio vira (sem nome)', () => {
  assert.equal(chavePessoa(' Carlos  Marinho '), chavePessoa('carlos marinho'))
  assert.equal(chavePessoa('José'), chavePessoa('JOSE'))
  assert.equal(chavePessoa(null), '(sem nome)')
  assert.equal(chavePessoa('   '), '(sem nome)')
})

test('resumoPorPessoa: total, por tipo, grafia mais frequente, último evento; mais ativos primeiro', () => {
  const r = resumoPorPessoa([
    ev('Carlos Marinho', '2026-10-01', 'ajuste'), ev('carlos marinho', '2026-10-03T10:00:00Z', 'op'), ev('Carlos Marinho', '2026-10-02', 'ficha'),
    ev('Ana', '2026-10-05', 'ajuste'), ev(null, '2026-10-04', 'op'),
  ])
  assert.equal(r[0].nome, 'Carlos Marinho')
  assert.equal(r[0].total, 3)
  assert.deepEqual(r[0].porTipo, { ajuste: 1, op: 1, ficha: 1 })
  assert.equal(r[0].ultimo, '2026-10-03T10:00:00Z')
  assert.deepEqual(r.map((x) => x.total), [3, 1, 1])
  assert.ok(r.some((x) => x.nome === '(sem nome)'))
})

test('linhaDoTempo: agrupa por dia (desc), eventos desc no dia, filtra pela pessoa', () => {
  const evs = [ev('Ana', '2026-10-01T09:00:00-03:00', 'ajuste', 'a'), ev('Ana', '2026-10-01T15:00:00-03:00', 'op', 'b'), ev('Beto', '2026-10-02', 'ficha', 'c'), ev('ana', '2026-10-03', 'ficha', 'd')]
  const todos = linhaDoTempo(evs, null)
  assert.deepEqual(todos.map((d) => d.dia), ['2026-10-03', '2026-10-02', '2026-10-01'])
  assert.deepEqual(todos[2].eventos.map((e) => e.titulo), ['b', 'a'])
  const ana = linhaDoTempo(evs, chavePessoa('Ana'))
  assert.deepEqual(ana.flatMap((d) => d.eventos.map((e) => e.titulo)), ['d', 'b', 'a'])
})

test('diaDoMovimento: data do Omie gravada à meia-noite UTC é o próprio dia; hora real vai para o dia da Bahia', async () => {
  const { diaDoMovimento, ehSoData, janelaDeConsulta } = await import('./quem-mexeu-puro.ts')
  assert.equal(diaDoMovimento('2026-10-01T00:00:00+00:00'), '2026-10-01')
  assert.equal(ehSoData('2026-10-01T00:00:00+00:00'), true)
  assert.equal(diaDoMovimento('2026-10-02T01:30:00+00:00'), '2026-10-01')
  assert.equal(ehSoData('2026-10-02T01:30:00+00:00'), false)
  assert.equal(diaDoMovimento('2026-10-01T15:00:00-03:00'), '2026-10-01')
  assert.equal(diaDoMovimento('2026-10-01'), '2026-10-01')
  assert.deepEqual(janelaDeConsulta('2026-10-01', '2026-10-03'), { de: '2026-10-01T00:00:00Z', ate: '2026-10-04T03:00:00Z' })
})

test('linhaDoTempo: ajuste do Omie (meia-noite UTC) fica no próprio dia, não no anterior', () => {
  const d = linhaDoTempo([ev('Ana', '2026-10-01T00:00:00+00:00', 'ajuste', 'omie'), ev('Ana', '2026-10-01T10:00:00-03:00', 'ajuste', 'app')], null)
  assert.deepEqual(d.map((x) => x.dia), ['2026-10-01'])
  assert.equal(d[0].eventos.length, 2)
})
