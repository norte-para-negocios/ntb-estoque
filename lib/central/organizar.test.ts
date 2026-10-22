import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODULOS } from './modulos.ts'
import { moduloVisivel, type CtxVisibilidade } from './visibilidade.ts'
import { organizar, rotuloBotao, varianteBotao } from './organizar.ts'
import { NAV_ITEMS } from '../../components/shell/NavItems.ts'

const dev: CtxVisibilidade = {
  isAdmin: true,
  isSuperAdmin: true,
  podeGerirUsuarios: true,
  rotasVisiveis: null,
  estoqueProprio: true,
  temEstoque: true,
  pedidosOmie: false,
  desktop: false,
} as CtxVisibilidade

const org = (id: string) => organizar(moduloVisivel(MODULOS.find((m) => m.id === id)!, NAV_ITEMS, dev))

test('Finanças: o que não existe vai para a gaveta "em breve", nunca para as listas', () => {
  const o = org('financas')
  assert.ok(o.embreve.length >= 9)
  for (const i of [...o.acoes, ...o.relatorios, ...o.consultas.map((c) => c.item), ...o.cadastros.flatMap((s) => s.itens)]) {
    assert.ok(!i.emBreve && i.href, `${i.label} está desabilitado numa lista`)
  }
  assert.ok(o.acoes.some((a) => a.label === 'Lançar uma conta a pagar'))
})

test('todo módulo tem pelo menos uma ação em verbo e nenhuma seção vazia', () => {
  for (const m of MODULOS) {
    const o = org(m.id)
    assert.ok(o.acoes.length >= 1, `${m.id} sem ação`)
    assert.ok(o.cadastros.every((s) => s.itens.length > 0))
  }
})

test('Estoque: Consultas viram linhas e Produtos vira uma linha com 3+ botões', () => {
  const o = org('estoque')
  assert.ok(o.consultas.some((c) => c.item.label === 'Ajustes de estoque'))
  const produtos = o.cadastros.find((s) => s.nome === 'Produtos')!
  assert.ok(produtos.itens.length >= 3)
  assert.ok(o.relatorios.length >= 4)
})

test('rótulos e variantes dos botões', () => {
  assert.equal(rotuloBotao('Incluir'), '+ Novo')
  assert.equal(rotuloBotao('Exibir todos'), 'Ver todos')
  assert.equal(rotuloBotao('Exibir extrato'), 'Ver extrato')
  assert.equal(rotuloBotao('Importar planilha'), 'Importar planilha')
  assert.equal(varianteBotao('Incluir'), 'novo')
  assert.equal(varianteBotao('Importar XML'), 'importar')
  assert.equal(varianteBotao('Exibir todos'), 'padrao')
})
