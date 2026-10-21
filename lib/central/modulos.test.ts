import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODULOS, itensDoModulo, semQuery, moduloDoPath } from './modulos.ts'
import {
  ROTAS_SO_DEV_ESPELHO,
  itemSoDev,
  itemVisivel,
  modulosVisiveis,
  type CtxVisibilidade,
} from './visibilidade.ts'
import { NAV_ITEMS } from '../../components/shell/NavItems.ts'

const raiz = join(import.meta.dirname, '..', '..')
const todosItens = MODULOS.flatMap((m) => itensDoModulo(m))

test('todo href de NAV_ITEMS aparece em algum módulo (nada se perde)', () => {
  const hrefs = new Set(todosItens.filter((i) => i.href).map((i) => semQuery(i.href!)))
  const faltando = NAV_ITEMS.filter((n) => !hrefs.has(n.href)).map((n) => n.href)
  assert.deepEqual(faltando, [])
})

test('nenhum href duplicado dentro de um módulo', () => {
  for (const m of MODULOS) {
    const hrefs = itensDoModulo(m).filter((i) => i.href).map((i) => i.href!)
    const repetidos = hrefs.filter((h, k) => hrefs.indexOf(h) !== k)
    assert.deepEqual(repetidos, [], `${m.id} repete href`)
  }
})

test('todo href existe como rota em app/(app)', () => {
  for (const i of todosItens) {
    if (!i.href) continue
    const caminho = semQuery(i.href).replace(/^\//, '')
    const pagina = join(raiz, 'app', '(app)', caminho, 'page.tsx')
    assert.ok(existsSync(pagina), `rota inexistente: ${i.href} (${pagina})`)
  }
})

test('itens "em breve" não têm href; itens com href não são "em breve"', () => {
  for (const i of todosItens) {
    if (i.emBreve) assert.equal(i.href, undefined, `"${i.label}" é em breve mas tem href`)
    else assert.ok(i.href, `"${i.label}" não tem href e não é em breve`)
  }
})

test('Finanças existe e só tem itens em breve', () => {
  const fin = MODULOS.find((m) => m.id === 'financas')
  assert.ok(fin)
  assert.ok(itensDoModulo(fin).every((i) => i.emBreve))
})

test('ids dos 7 módulos únicos, na ordem do menu', () => {
  assert.deepEqual(
    MODULOS.map((m) => m.id),
    ['inicio', 'estoque', 'compras', 'producao', 'fiscal', 'financas', 'administracao']
  )
})

test('ROTAS_SO_DEV do servidor e o espelho da central não se afastam', () => {
  const fonte = readFileSync(join(raiz, 'lib', 'recursos-dev.ts'), 'utf8')
  const bloco = /ROTAS_SO_DEV = \[([\s\S]*?)\] as const/.exec(fonte)?.[1] ?? ''
  const reais = [...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual([...ROTAS_SO_DEV_ESPELHO].sort(), reais)
})

test('toda rota de ROTAS_SO_DEV que está na central ganha a etiqueta "só dev"', () => {
  for (const i of todosItens) {
    if (!i.href) continue
    const h = semQuery(i.href)
    const emTeste = ROTAS_SO_DEV_ESPELHO.some((r) => h === r || h.startsWith(r + '/'))
    if (emTeste) assert.equal(itemSoDev(i, NAV_ITEMS), true, `${i.href} deveria ser "só dev"`)
  }
})

const dev: CtxVisibilidade = {
  isAdmin: false,
  isSuperAdmin: true,
  podeGerirUsuarios: false,
  rotasVisiveis: null,
  estoqueProprio: false,
  temEstoque: false,
  pedidosOmie: false,
}

test('visibilidade herda as regras do menu atual (loja, admin, superAdmin, permissão)', () => {
  const kardex = todosItens.find((i) => i.href === '/estoque/kardex')!
  assert.equal(itemVisivel(kardex, NAV_ITEMS, dev), false) // /estoque exige comEstoque
  assert.equal(itemVisivel(kardex, NAV_ITEMS, { ...dev, temEstoque: true }), true)

  const pedido = todosItens.find((i) => i.href === '/pedido-compra/novo')!
  assert.equal(itemVisivel(pedido, NAV_ITEMS, dev), false) // soEstoqueProprio
  assert.equal(itemVisivel(pedido, NAV_ITEMS, { ...dev, pedidosOmie: true }), true) // ouPedidosOmie
  assert.equal(itemVisivel(pedido, NAV_ITEMS, { ...dev, estoqueProprio: true }), true)
  assert.equal(itemVisivel(pedido, NAV_ITEMS, { ...dev, isSuperAdmin: false, estoqueProprio: true }), false)

  const log = todosItens.find((i) => i.href === '/log')!
  assert.equal(itemVisivel(log, NAV_ITEMS, dev), false) // admin
  assert.equal(itemVisivel(log, NAV_ITEMS, { ...dev, isAdmin: true }), true)

  const produtos = todosItens.find((i) => i.href === '/produto')!
  assert.equal(itemVisivel(produtos, NAV_ITEMS, { ...dev, rotasVisiveis: ['/home'] }), false) // permissão
  assert.equal(itemVisivel(produtos, NAV_ITEMS, { ...dev, rotasVisiveis: ['/produto'] }), true)
})

test('Finanças aparece sempre no menu; módulos sem nenhum item visível somem', () => {
  const ids = modulosVisiveis(MODULOS, NAV_ITEMS, dev).map((m) => m.id)
  assert.ok(ids.includes('financas'))
  assert.ok(ids.includes('inicio'))
})

test('módulo ativo pelo pathname, inclusive rotas filhas', () => {
  assert.equal(moduloDoPath('/central/compras'), 'compras')
  assert.equal(moduloDoPath('/central/inexistente'), null)
  assert.equal(moduloDoPath('/pedido-compra/123/editar'), 'compras')
  assert.equal(moduloDoPath('/estoque/correcoes'), 'estoque')
  assert.equal(moduloDoPath('/estoque/produto/ABC'), 'estoque')
  assert.equal(moduloDoPath('/ordem-producao/nova'), 'producao')
  assert.equal(moduloDoPath('/home'), 'inicio')
})
