import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ETAPAS, montarPlano, formatarPlano } from './tudo-plano.ts'

test('a ordem da suíte é a combinada e cada etapa aponta para um script npm robo:*', () => {
  assert.deepEqual(ETAPAS.map((e) => e.id), ['passeio', 'saldo', 'financeiro', 'permissoes', 'entrada', 'venda', 'inventario', 'compras', 'cozinha', 'cmv'])
  assert.equal(ETAPAS[0].script, 'robo')
  for (const e of ETAPAS.slice(1)) assert.equal(e.script, `robo:${e.id}`)
})

test('os robôs que escrevem na cópia estão marcados (e são os quatro que resetam no fim)', () => {
  assert.deepEqual(ETAPAS.filter((e) => e.escreve).map((e) => e.id), ['entrada', 'venda', 'inventario', 'compras'])
})

test('montarPlano sem filtro: todas as etapas, na ordem', () => {
  const p = montarPlano({})
  assert.equal(p.erro, null)
  assert.equal(p.etapas.length, 10)
})

test('ROBO_TUDO_SO deixa só as etapas pedidas, mas mantém a ordem da suíte', () => {
  const p = montarPlano({ ROBO_TUDO_SO: 'cmv, saldo' })
  assert.deepEqual(p.etapas.map((e) => e.id), ['saldo', 'cmv'])
})

test('ROBO_TUDO_PULAR tira etapas', () => {
  const p = montarPlano({ ROBO_TUDO_PULAR: 'cozinha,inventario' })
  assert.equal(p.etapas.length, 8)
  assert.ok(!p.etapas.some((e) => e.id === 'cozinha'))
})

test('nome de etapa que não existe é erro (não ignora calado)', () => {
  const p = montarPlano({ ROBO_TUDO_SO: 'saldo,banana' })
  assert.match(p.erro ?? '', /banana/)
})

test('filtros que cada robô já tem aparecem como ativos só quando estão definidos no ambiente', () => {
  const p = montarPlano({ ROBO_LOJAS: '15,19', ROBO_CENARIOS: '19-manual', ROBO_SEM_RESET: '1' })
  const ativos = (id: string) => p.etapas.find((e) => e.id === id)!.filtrosAtivos
  assert.deepEqual(ativos('cozinha'), ['ROBO_LOJAS=15,19'])
  assert.deepEqual(ativos('entrada'), ['ROBO_CENARIOS=19-manual', 'ROBO_SEM_RESET=1'])
  assert.deepEqual(ativos('saldo'), [])
})

test('formatarPlano lista ordem e comandos sem executar nada', () => {
  const txt = formatarPlano(montarPlano({ ROBO_LOJAS: '15' }))
  assert.match(txt, /1\. passeio .*npm run robo\b/)
  assert.match(txt, /10\. cmv .*npm run robo:cmv/)
  assert.match(txt, /ROBO_LOJAS=15/)
  assert.match(txt, /escreve na cópia/)
  assert.match(txt, /lista-final/)
})
