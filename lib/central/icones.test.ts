import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FileText } from 'lucide-react'
import { MODULOS, semQuery } from './modulos.ts'
import { ICONE_POR_ROTA, iconeDoItem } from './icones.ts'

const VERBO = /^(incluir|importar|exibir)/i

test('toda tela, ação Novo e relatório tem ícone próprio (nada cai no genérico)', () => {
  for (const m of MODULOS) {
    const itens = [...m.novos, ...m.telas, ...m.secoes.flatMap((s) => s.itens)]
    for (const i of itens) {
      if (i.href && !VERBO.test(i.label)) {
        assert.ok(ICONE_POR_ROTA[i.href] ?? ICONE_POR_ROTA[semQuery(i.href)], `${m.id}: ${i.label} (${i.href}) sem ícone no mapa`)
      }
      assert.notEqual(iconeDoItem(i.label, undefined, i.href).Icon, FileText, `${m.id}: ${i.label} caiu no ícone genérico`)
    }
  }
})

test('dentro de um módulo, telas diferentes não repetem o ícone', () => {
  for (const m of MODULOS) {
    const vistos = new Map<unknown, string>()
    for (const i of m.telas) {
      const { Icon } = iconeDoItem(i.label, undefined, i.href)
      const antes = vistos.get(Icon)
      assert.equal(antes, undefined, `${m.id}: "${i.label}" repete o ícone de "${antes}"`)
      vistos.set(Icon, i.label)
    }
  }
})

test('regressões da auditoria: Reposição e Etapas do recebimento não pegam o ícone de outra coisa', () => {
  const repos = iconeDoItem('Reposição', undefined, '/reposicao').Icon
  const posicao = iconeDoItem('Posição de estoque', undefined, '/relatorio-posicao-estoque').Icon
  assert.notEqual(repos, posicao)
  const etapas = iconeDoItem('Etapas do recebimento', undefined, '/nota-fiscal/etapas').Icon
  const pagar = iconeDoItem('Contas a pagar', undefined, '/financeiro/contas-pagar').Icon
  assert.notEqual(etapas, pagar)
  // Estoque mínimo e Sugestão de compra moram na mesma página, com ícones diferentes.
  assert.notEqual(iconeDoItem('Estoque mínimo', undefined, '/sugestao-compra?ver=abaixo').Icon, iconeDoItem('Sugestão de compra', undefined, '/sugestao-compra').Icon)
})
