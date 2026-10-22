import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MODULOS, itensDoModulo, semQuery } from './modulos.ts'
import { moduloVisivel, type CtxVisibilidade } from './visibilidade.ts'
import { destinosDoMenu, organizar, rotuloBotao, varianteBotao } from './organizar.ts'
import { NAV_ITEMS } from '../../components/shell/NavItems.ts'

const raiz = join(import.meta.dirname, '..', '..')
const base = {
  isAdmin: true,
  isSuperAdmin: true,
  podeGerirUsuarios: true,
  rotasVisiveis: null,
  pedidosOmie: false,
  desktop: false,
} as const
const proprio: CtxVisibilidade = { ...base, estoqueProprio: true, temEstoque: true }
const omie: CtxVisibilidade = { ...base, estoqueProprio: false, temEstoque: true }

const org = (id: string, ctx = proprio) => organizar(moduloVisivel(MODULOS.find((m) => m.id === id)!, NAV_ITEMS, ctx))

test('uma tela, um nome: nenhum nome de tela ou cadastro se repete entre módulos', () => {
  const nomes = MODULOS.flatMap((m) => [
    ...m.telas.map((i) => i.label),
    ...m.secoes.filter((s) => s.tipo !== 'relatorio').map((s) => s.nome),
  ])
  assert.deepEqual(nomes.filter((n, k) => nomes.indexOf(n) !== k), [])
})

test('uma tela, um lugar: ref só existe em relatório', () => {
  for (const m of MODULOS) {
    for (const i of [...m.novos, ...m.telas]) assert.ok(!i.ref, `${m.id}: ${i.label} é ref`)
    for (const s of m.secoes) if (s.tipo !== 'relatorio') for (const i of s.itens) assert.ok(!i.ref, `${m.id}/${s.nome}: ${i.label} é ref`)
  }
})

test('todo "Novo" e todo "Incluir" abre um formulário de verdade', () => {
  const criacoes = MODULOS.flatMap((m) => [
    ...m.novos,
    ...m.secoes.flatMap((s) => s.itens.filter((i) => /^incluir|^importar/i.test(i.label))),
  ])
  for (const i of criacoes) {
    if (!i.href) continue
    if (i.href.endsWith('?criar=1')) {
      // A tela da lista precisa usar o hook que abre o formulário.
      const pagina = readFileSync(join(raiz, 'app', '(app)', semQuery(i.href).replace(/^\//, ''), 'page.tsx'), 'utf8')
      const comps = [...pagina.matchAll(/from '@\/components\/([^']+)'/g)].map((m) => join(raiz, 'components', m[1] + '.tsx'))
      const usa = comps.some((c) => existsSync(c) && readFileSync(c, 'utf8').includes('useCriarDaCentral('))
      assert.ok(usa, `${i.href}: nenhum componente da tela usa useCriarDaCentral`)
    } else {
      assert.match(semQuery(i.href), /\/(novo|nova|importar)$/, `${i.label} (${i.href}) não é tela de criação`)
    }
  }
})

test('Finanças: o que não existe vai para a gaveta, nunca para as listas', () => {
  const o = org('financas')
  assert.ok(o.embreve.length >= 9)
  for (const i of [...o.novos, ...o.telas, ...o.relatorios, ...o.cadastros.flatMap((s) => s.itens)]) {
    assert.ok(!i.emBreve && i.href, `${i.label} está desabilitado numa lista`)
  }
  assert.equal(o.principal?.label, 'Contas a pagar')
})

test('destaque: só a tela marcada; some quando ela não aparece na loja', () => {
  assert.equal(org('producao').principal?.label, 'Ordens de Produção')
  assert.equal(org('financas', omie).principal, null)
  for (const m of MODULOS) assert.ok(m.telas.filter((i) => i.principal).length <= 1, `${m.id} com 2 destaques`)
})

test('menu lateral: telas + cadastros do módulo, sem criar e sem em breve', () => {
  const d = destinosDoMenu(moduloVisivel(MODULOS.find((m) => m.id === 'estoque')!, NAV_ITEMS, proprio))
  assert.ok(d.some((x) => x.label === 'Produtos' && x.href === '/produto'))
  assert.ok(d.every((x) => !x.href.includes('?criar')))
  const nomes = d.map((x) => x.label)
  assert.equal(new Set(nomes).size, nomes.length)
})

test('loja Omie: todo módulo visível tem ao menos uma tela ou relatório', () => {
  for (const m of MODULOS) {
    const o = org(m.id, omie)
    assert.ok(o.telas.length + (o.principal ? 1 : 0) + o.relatorios.length + o.cadastros.length > 0, m.id)
  }
})

test('rótulos e variantes dos botões', () => {
  assert.equal(rotuloBotao('Incluir'), '+ Novo')
  assert.equal(rotuloBotao('Exibir todos'), 'Ver todos')
  assert.equal(varianteBotao('Incluir'), 'novo')
  assert.equal(varianteBotao('Importar XML'), 'importar')
  assert.equal(varianteBotao('Exibir todos'), 'padrao')
})

test('itensDoModulo cobre novos, telas e seções', () => {
  const m = MODULOS.find((x) => x.id === 'compras')!
  assert.equal(itensDoModulo(m).length, m.novos.length + m.telas.length + m.secoes.reduce((n, s) => n + s.itens.length, 0))
})

test('menu lateral: toda tela do menu antigo visível na loja está a 1 clique, com o nome do menu antigo', async () => {
  const { navItemVisivel } = await import('../nav-visivel.ts')
  const { modulosVisiveis } = await import('./visibilidade.ts')
  for (const ctx of [proprio, omie, { ...omie, pedidosOmie: true }]) {
    const destinos = modulosVisiveis(MODULOS, NAV_ITEMS, ctx).flatMap((m) => [{ href: m.href, label: m.nome }, ...destinosDoMenu(m)])
    for (const n of NAV_ITEMS.filter((x) => navItemVisivel(x, ctx))) {
      const d = destinos.find((x) => x.href === n.href)
      assert.ok(d, `${n.href} (${n.label}) fora do menu lateral`)
      if (n.href !== '/home') assert.equal(d.label, n.label, `${n.href}: nome diferente do menu antigo`)
    }
  }
})
