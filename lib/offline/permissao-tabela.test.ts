import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lojasQuePodemLer, filtrarMudancas, tabelaRestrita, type ContextoPermissao } from './permissao-tabela.ts'

const ctx = (o: Partial<ContextoPermissao>): ContextoPermissao => ({ perfil: 'Usuario', superAdmin: false, permissoes: new Map(), ...o })

test('tabela fora da lista de restritas passa por qualquer usuário', () => {
  assert.equal(tabelaRestrita('produtos'), false)
  assert.deepEqual(lojasQuePodemLer('produtos', [4, 15], ctx({})), [4, 15])
})

test('gerente sem permissão não lê compras_proprio, notas_fiscais nem tabelas de gestão', () => {
  const c = ctx({ permissoes: new Map([[4, new Set(['Movimentacoes'])]]) })
  for (const t of ['compras_proprio', 'notas_fiscais', 'faturamento_importado', 'margem_importada', 'metas_faturamento', 'contas_pagar', 'contas_receber', 'contas_correntes'])
    assert.deepEqual(lojasQuePodemLer(t, [4], c), [], t)
})

test('quem tem a permissão continua lendo, só nas lojas em que a tem', () => {
  const c = ctx({ permissoes: new Map([[4, new Set(['Compras'])], [15, new Set(['Movimentacoes'])]]) })
  assert.deepEqual(lojasQuePodemLer('compras_proprio', [4, 15], c), [4])
  assert.deepEqual(lojasQuePodemLer('notas_fiscais', [4, 15], c), [])
})

test('Admin lê tudo (permissão * ) mas financeiro exige desenvolvedor', () => {
  const admin = ctx({ perfil: 'Admin', permissoes: new Map([[4, new Set(['*'])]]) })
  assert.deepEqual(lojasQuePodemLer('compras_proprio', [4], admin), [4])
  assert.deepEqual(lojasQuePodemLer('faturamento_importado', [4], admin), [4])
  assert.deepEqual(lojasQuePodemLer('contas_pagar', [4], admin), [])
  assert.deepEqual(lojasQuePodemLer('contas_pagar', [4], { ...admin, superAdmin: true }), [4])
})

test('AdminLoja só tem gestão nas lojas em que é vinculado', () => {
  const c = ctx({ perfil: 'AdminLoja', permissoes: new Map([[4, new Set(['*'])]]) })
  assert.deepEqual(lojasQuePodemLer('metas_faturamento', [4, 15], c), [4])
})

test('usuário Usuario com permissão de gestão por cargo ainda não lê tabela de gestão', () => {
  const c = ctx({ permissoes: new Map([[4, new Set(['*'])]]) })
  assert.deepEqual(lojasQuePodemLer('metas_faturamento', [4], c), [])
})

test('mudanças: remove linha restrita de loja sem permissão e mantém o resto', () => {
  const c = ctx({ permissoes: new Map([[4, new Set(['Compras'])]]) })
  const m = [
    { versao: 1, tabela: 'produtos', pk: { id: 1 }, apagado: false, dado: { id: 1, loja_id: 15 } },
    { versao: 2, tabela: 'compras_proprio', pk: { id: 2 }, apagado: false, dado: { id: 2, loja_id: 4 } },
    { versao: 3, tabela: 'compras_proprio', pk: { id: 3 }, apagado: false, dado: { id: 3, loja_id: 15 } },
    { versao: 4, tabela: 'notas_fiscais', pk: { id: 4 }, apagado: false, dado: { id: 4, loja_id: 4 } },
    { versao: 5, tabela: 'notas_fiscais', pk: { id: 5 }, apagado: true, dado: null },
    { versao: 6, tabela: 'contas_pagar', pk: { id: 6 }, apagado: false, dado: { id: 6 } },
  ]
  assert.deepEqual(filtrarMudancas(m, [4, 15], c).map((x) => x.versao), [1, 2, 5])
})

test('mudanças: dado sem loja_id só passa se o usuário pode ler em todas as lojas', () => {
  const todas = ctx({ permissoes: new Map([[4, new Set(['Compras'])], [15, new Set(['Compras'])]]) })
  const parcial = ctx({ permissoes: new Map([[4, new Set(['Compras'])]]) })
  const m = [{ versao: 1, tabela: 'compras_proprio', pk: { id: 1 }, apagado: false, dado: { id: 1 } }]
  assert.equal(filtrarMudancas(m, [4, 15], todas).length, 1)
  assert.equal(filtrarMudancas(m, [4, 15], parcial).length, 0)
})
