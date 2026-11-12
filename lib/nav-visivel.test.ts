import { test } from 'node:test'
import assert from 'node:assert/strict'
import { navItemVisivel, type CtxVisibilidade } from './nav-visivel.ts'
import type { Acesso, ModuloId } from './plataforma/modulos-puro.ts'

const base: CtxVisibilidade = {
  isAdmin: false,
  isSuperAdmin: false,
  podeGerirUsuarios: false,
  rotasVisiveis: null,
  estoqueProprio: true,
  temEstoque: true,
  pedidosOmie: false,
  desktop: false,
}

const modulos = (cozinha: Acesso): Record<ModuloId, Acesso> =>
  ({ dashboard: 'abre', vendas: 'abre', erp: 'abre', cozinha, pacioli: 'abre' })

test('item de módulo em vitrine some do menu', () => {
  assert.equal(navItemVisivel({ href: '/cozinha' }, { ...base, modulos: modulos('vitrine') }), false)
})

test('item de módulo que abre aparece', () => {
  assert.equal(navItemVisivel({ href: '/cozinha' }, { ...base, modulos: modulos('abre') }), true)
})

test('item de módulo suspenso (consulta) continua no menu', () => {
  assert.equal(navItemVisivel({ href: '/cozinha' }, { ...base, modulos: modulos('consulta') }), true)
})

test('sem ctx.modulos o menu fica como hoje', () => {
  assert.equal(navItemVisivel({ href: '/cozinha' }, base), true)
})

test('rota livre nunca some pelo módulo', () => {
  const tudoVitrine = { dashboard: 'vitrine', vendas: 'vitrine', erp: 'vitrine', cozinha: 'vitrine', pacioli: 'vitrine' } as const
  assert.equal(navItemVisivel({ href: '/usuario' }, { ...base, modulos: tudoVitrine }), true)
  assert.equal(navItemVisivel({ href: '/estoque' }, { ...base, modulos: tudoVitrine }), false)
})
