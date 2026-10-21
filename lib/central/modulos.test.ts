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
import { menuNovoAtivo, navItemVisivel } from '../nav-visivel.ts'

const raiz = join(import.meta.dirname, '..', '..')
const todosItens = MODULOS.flatMap((m) => itensDoModulo(m))

test('todo href de NAV_ITEMS aparece em algum módulo (nada se perde)', () => {
  const hrefs = new Set(todosItens.filter((i) => i.href).map((i) => semQuery(i.href!)))
  const faltando = NAV_ITEMS.filter((n) => !hrefs.has(n.href)).map((n) => n.href)
  assert.deepEqual(faltando, [])
})

test('nenhum href duplicado dentro de um módulo (comparando com a query)', () => {
  for (const m of MODULOS) {
    const hrefs = itensDoModulo(m).filter((i) => i.href).map((i) => i.href!)
    const repetidos = hrefs.filter((h, k) => hrefs.indexOf(h) !== k)
    assert.deepEqual(repetidos, [], `${m.id} repete href`)
    const rotas = hrefs.map(semQuery)
    assert.deepEqual(rotas.filter((h, k) => rotas.indexOf(h) !== k), [], `${m.id} repete a mesma rota com query diferente`)
  }
})

test('entre módulos, repetir a rota só é permitido com ref:true (dono único)', () => {
  const donos = new Map<string, string>()
  for (const m of MODULOS) {
    for (const i of itensDoModulo(m)) {
      if (!i.href || i.ref) continue
      const h = i.href
      assert.equal(donos.has(h), false, `${h} aparece sem ref em ${donos.get(h)} e em ${m.id}`)
      donos.set(h, m.id)
    }
  }
  // todo ref aponta para uma rota que tem dono
  for (const m of MODULOS) {
    for (const i of itensDoModulo(m)) {
      if (i.ref) assert.ok(donos.has(i.href!) || [...donos.keys()].some((d) => semQuery(d) === semQuery(i.href!)), `ref sem dono: ${i.href}`)
    }
  }
})

test('nenhum href é página que só redireciona', () => {
  for (const i of todosItens) {
    if (!i.href) continue
    const arq = join(raiz, 'app', '(app)', semQuery(i.href).replace(/^\//, ''), 'page.tsx')
    const codigo = readFileSync(arq, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const soRedireciona = /redirect\(/.test(codigo) && !/return\s*(\(|<)/.test(codigo)
    assert.equal(soRedireciona, false, `${i.href} só redireciona`)
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

test('Finanças: itens reais só de estoque próprio e só dev; o resto segue "em breve"', () => {
  const fin = MODULOS.find((m) => m.id === 'financas')
  assert.ok(fin)
  const itens = itensDoModulo(fin)
  const reais = itens.filter((i) => !i.emBreve)
  assert.deepEqual(
    reais.map((i) => i.href).sort(),
    ['/financeiro/categorias', '/financeiro/contas-correntes', '/financeiro/contas-pagar', '/financeiro/contas-pagar/nova', '/financeiro/extrato']
  )
  for (const i of reais) {
    assert.equal(i.soEstoqueProprio, true, `${i.href} precisa da flag de estoque próprio`)
    assert.equal(itemSoDev(i, NAV_ITEMS), true, `${i.href} precisa da etiqueta "só dev"`)
    assert.equal(itemVisivel(i, NAV_ITEMS, { ...dev, estoqueProprio: false }), false) // loja Omie não vê
    assert.equal(itemVisivel(i, NAV_ITEMS, { ...dev, estoqueProprio: true }), true)
    assert.equal(itemVisivel(i, NAV_ITEMS, { ...dev, estoqueProprio: true, isSuperAdmin: false }), false) // cliente não vê
  }
  assert.ok(itens.some((i) => i.emBreve)) // receber, OFX, relatórios etc. ainda não existem
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
  desktop: false,
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
  // sem nenhuma permissão e sem ser dev/admin: só sobra Finanças (itens "em breve" não dependem de permissão)
  const nada: CtxVisibilidade = { ...dev, isSuperAdmin: false, rotasVisiveis: [] }
  assert.deepEqual(modulosVisiveis(MODULOS, NAV_ITEMS, nada).map((m) => m.id), ['financas'])
  // com só /home liberado volta o Início e nada mais
  const soHome: CtxVisibilidade = { ...nada, rotasVisiveis: ['/home'] }
  assert.deepEqual(modulosVisiveis(MODULOS, NAV_ITEMS, soHome).map((m) => m.id), ['inicio', 'financas'])
})

test('Estoque mínimo herda /sugestao-compra e pertence a Compras', () => {
  const minimo = todosItens.find((i) => i.href === '/sugestao-compra?ver=abaixo')!
  assert.equal(minimo.regra, '/sugestao-compra')
  assert.equal(minimo.ref, true)
  assert.equal(moduloDoPath('/sugestao-compra'), 'compras')
  assert.equal(itemVisivel(minimo, NAV_ITEMS, { ...dev, temEstoque: false }), false)
  assert.equal(itemVisivel(minimo, NAV_ITEMS, { ...dev, temEstoque: true }), true)
})

test('relatórios respeitam o modo da loja como a página /relatorios', () => {
  const ops = todosItens.find((i) => i.href === '/relatorio-ops')!
  const lucro = todosItens.find((i) => i.href === '/relatorio-lucro')!
  const gestor = { ...dev, isAdmin: true }
  assert.equal(itemVisivel(ops, NAV_ITEMS, gestor), false) // modo 'nenhum'
  assert.equal(itemVisivel(ops, NAV_ITEMS, { ...gestor, temEstoque: true }), true)
  assert.equal(itemVisivel(lucro, NAV_ITEMS, { ...gestor, temEstoque: true }), false) // só estoque próprio
  assert.equal(itemVisivel(lucro, NAV_ITEMS, { ...gestor, temEstoque: true, estoqueProprio: true }), true)
})

test('itens que a página só aceita em certo modo de loja carregam a flag', () => {
  const gestor = { ...dev, isAdmin: true }
  const achar = (h: string) => todosItens.find((i) => i.href === h)!
  const forn = achar('/relatorio-produtos-fornecedor')
  assert.equal(forn.comEstoque, true)
  assert.equal(itemVisivel(forn, NAV_ITEMS, gestor), false) // modo 'nenhum'
  assert.equal(itemVisivel(forn, NAV_ITEMS, { ...gestor, temEstoque: true }), true)
  for (const h of ['/produto/importar', '/fornecedor/importar', '/nota-fiscal/importar', '/nota-fiscal/nova', '/nota-fiscal/etapas', '/pedido-compra/importar']) {
    assert.equal(achar(h).soEstoqueProprio, true, h)
    assert.equal(itemVisivel(achar(h), NAV_ITEMS, { ...gestor, temEstoque: true, pedidosOmie: true }), false, `${h} em loja Omie`)
  }
  const kardex = achar('/estoque/kardex')
  assert.equal(itemVisivel(kardex, NAV_ITEMS, { ...gestor, temEstoque: true }), true) // Omie
  assert.equal(itemVisivel(kardex, NAV_ITEMS, { ...gestor, temEstoque: true, estoqueProprio: true }), false) // redireciona
})

test('Cargos herdam /usuario; Sincronização só no desktop; Produtos substitutos herdam /produto', () => {
  const cargos = todosItens.find((i) => i.href === '/cargo')!
  assert.equal(cargos.regra, '/usuario')
  assert.equal(itemVisivel(cargos, NAV_ITEMS, dev), false)
  assert.equal(itemVisivel(cargos, NAV_ITEMS, { ...dev, podeGerirUsuarios: true }), true)
  const sinc = todosItens.find((i) => i.href === '/sincronizacao')!
  assert.equal(itemVisivel(sinc, NAV_ITEMS, dev), false)
  assert.equal(itemVisivel(sinc, NAV_ITEMS, { ...dev, desktop: true }), true)
  const subst = todosItens.find((i) => i.href === '/produto-substituicao')!
  assert.equal(itemVisivel(subst, NAV_ITEMS, { ...dev, rotasVisiveis: ['/home'] }), false)
  assert.equal(itemVisivel(subst, NAV_ITEMS, { ...dev, rotasVisiveis: ['/produto'] }), true)
})

test('"Minha loja" mantém o cadeado para quem não é admin global', () => {
  const m = modulosVisiveis(MODULOS, NAV_ITEMS, { ...dev, podeGerirUsuarios: true }).find((x) => x.id === 'administracao')!
  const item = m.secoes.flatMap((s) => s.itens).find((i) => i.href === '/minha-loja')!
  assert.equal(item.cadeado, true)
})

test('navItemVisivel equivale ao filtro original do menu para todo NAV_ITEMS', () => {
  const original = (i: (typeof NAV_ITEMS)[number], c: CtxVisibilidade) => {
    const permitidas = c.rotasVisiveis ? new Set(c.rotasVisiveis) : null
    return (
      (!i.admin || c.isAdmin) &&
      (!i.gestaoUsuarios || c.isAdmin || c.podeGerirUsuarios) &&
      (!i.superAdmin || c.isSuperAdmin) &&
      (!i.soEstoqueProprio || c.estoqueProprio || (i.ouPedidosOmie && c.pedidosOmie)) &&
      (!i.comEstoque || c.temEstoque) &&
      (permitidas === null || permitidas.has(i.href))
    )
  }
  const bool = [false, true]
  for (const isAdmin of bool) for (const isSuperAdmin of bool) for (const podeGerirUsuarios of bool)
    for (const estoqueProprio of bool) for (const temEstoque of bool) for (const pedidosOmie of bool)
      for (const rotasVisiveis of [null, [], NAV_ITEMS.slice(0, 15).map((n) => n.href)]) {
        const c: CtxVisibilidade = { isAdmin, isSuperAdmin, podeGerirUsuarios, estoqueProprio, temEstoque, pedidosOmie, rotasVisiveis, desktop: false }
        for (const i of NAV_ITEMS) assert.equal(navItemVisivel(i, c), !!original(i, c), `${i.href} ${JSON.stringify(c)}`)
      }
})

test('menu novo nunca vale para quem não é desenvolvedor', () => {
  assert.equal(menuNovoAtivo(false, null), false)
  assert.equal(menuNovoAtivo(false, 'novo'), false)
  assert.equal(menuNovoAtivo(true, null), true)
  assert.equal(menuNovoAtivo(true, 'novo'), true)
  assert.equal(menuNovoAtivo(true, 'antigo'), false)
})

test('módulo ativo pelo pathname, inclusive rotas filhas', () => {
  assert.equal(moduloDoPath('/central/compras'), 'compras')
  assert.equal(moduloDoPath('/central/inexistente'), null)
  assert.equal(moduloDoPath('/pedido-compra/123/editar'), 'compras')
  assert.equal(moduloDoPath('/estoque/correcoes'), 'estoque')
  assert.equal(moduloDoPath('/estoque/produto/ABC'), 'estoque')
  assert.equal(moduloDoPath('/ordem-producao/nova'), 'producao')
  assert.equal(moduloDoPath('/home'), 'inicio')
  assert.equal(moduloDoPath('/sugestao-compra'), 'compras')
})
