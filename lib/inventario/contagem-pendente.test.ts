import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chavePendentes,
  lerPendentes,
  guardarPendente,
  confirmarPendente,
  aplicarPendentes,
  ehVersaoVelha,
  podeRecarregar,
  pendenteRecente,
  type Armazenamento,
} from './contagem-pendente.ts'

function memoria(): Armazenamento & { dados: Map<string, string> } {
  const dados = new Map<string, string>()
  return {
    dados,
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => void dados.set(k, v),
    removeItem: (k) => void dados.delete(k),
  }
}

const quebrado: Armazenamento = {
  getItem: () => {
    throw new Error('bloqueado')
  },
  setItem: () => {
    throw new Error('bloqueado')
  },
  removeItem: () => {
    throw new Error('bloqueado')
  },
}

test('chave separa loja e inventário', () => {
  assert.notEqual(chavePendentes(5, 10), chavePendentes(6, 10))
  assert.notEqual(chavePendentes(5, 10), chavePendentes(5, 11))
})

test('guarda e lê a contagem pendente', () => {
  const st = memoria()
  const k = chavePendentes(6, 610)
  guardarPendente(st, k, 23596, 4.5, 1000)
  guardarPendente(st, k, 23597, null, 1001)
  assert.deepEqual(lerPendentes(st, k), { 23596: { quan: 4.5, em: 1000 }, 23597: { quan: null, em: 1001 } })
})

test('confirmar só apaga se for o mesmo valor guardado (não apaga uma digitação mais nova)', () => {
  const st = memoria()
  const k = chavePendentes(6, 610)
  guardarPendente(st, k, 1, 3, 1000)
  guardarPendente(st, k, 1, 4, 2000) // digitou de novo antes da resposta do 1º envio
  confirmarPendente(st, k, 1, 1000) // resposta do 1º envio chega
  assert.deepEqual(lerPendentes(st, k), { 1: { quan: 4, em: 2000 } })
  confirmarPendente(st, k, 1, 2000)
  assert.deepEqual(lerPendentes(st, k), {})
  assert.equal(st.dados.has(k), false, 'sem pendente nenhum, a chave sai do aparelho')
})

test('lixo ou armazenamento bloqueado nunca quebra a tela', () => {
  const st = memoria()
  const k = chavePendentes(1, 1)
  st.setItem(k, '{não é json')
  assert.deepEqual(lerPendentes(st, k), {})
  st.setItem(k, JSON.stringify({ 5: { quan: 'abc', em: 1 }, x: { quan: 1, em: 1 }, 6: { quan: 2, em: 3 } }))
  assert.deepEqual(lerPendentes(st, k), { 6: { quan: 2, em: 3 } })
  assert.deepEqual(lerPendentes(quebrado, k), {})
  assert.doesNotThrow(() => guardarPendente(quebrado, k, 1, 1, 1))
  assert.doesNotThrow(() => confirmarPendente(quebrado, k, 1, 1))
})

test('aplicar: pendente vira "Não salvo" com o número digitado', () => {
  const itens = [
    { id: 1, quan: null, status: 'Vazio' },
    { id: 2, quan: 5, status: 'Concluido' },
  ]
  const r = aplicarPendentes(itens, { 1: { quan: 7, em: 1 }, 2: { quan: 6, em: 2 } })
  assert.deepEqual(
    r.itens.map((i) => [i.id, i.quan, i.status]),
    [
      [1, 7, 'Não salvo'],
      [2, 6, 'Não salvo'],
    ]
  )
  assert.deepEqual(r.aplicados, [1, 2])
  assert.deepEqual(r.descartar, [])
})

test('aplicar: o servidor já tem o mesmo número concluído (resposta se perdeu) = descarta', () => {
  const r = aplicarPendentes([{ id: 2, quan: 5, status: 'Concluido' }], { 2: { quan: 5, em: 2 } })
  assert.deepEqual(r.itens[0], { id: 2, quan: 5, status: 'Concluido' })
  assert.deepEqual(r.aplicados, [])
  assert.deepEqual(r.descartar, [2])
})

test('aplicar: item que saiu do inventário = descarta', () => {
  const r = aplicarPendentes([{ id: 1, quan: null, status: 'Vazio' }], { 9: { quan: 5, em: 2 } })
  assert.deepEqual(r.descartar, [9])
  assert.equal(r.itens[0].status, 'Vazio')
})

test('detecta a tela com versão velha (ação que não existe mais no servidor)', () => {
  const e = new Error(
    'Server Action "70739f4263273ed4529b58c8bf093a641708" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'
  )
  assert.equal(ehVersaoVelha(e), true)
  const porNome = new Error('x')
  porNome.name = 'UnrecognizedActionError'
  assert.equal(ehVersaoVelha(porNome), true)
  assert.equal(ehVersaoVelha(new TypeError('Failed to fetch')), false)
  assert.equal(ehVersaoVelha(null), false)
  assert.equal(ehVersaoVelha('texto'), false)
})

test('não recarrega em loop: no máximo uma vez por minuto', () => {
  assert.equal(podeRecarregar(null, 100_000), true)
  assert.equal(podeRecarregar(100_000, 130_000), false)
  assert.equal(podeRecarregar(100_000, 160_001), true)
  assert.equal(podeRecarregar(Number.NaN, 1), true)
})

test('pendente recente (até 2 min) não é reenviada na hora ao abrir', () => {
  assert.equal(pendenteRecente({ quan: 1, em: 1_000_000 }, 1_000_000 + 60_000), true)
  assert.equal(pendenteRecente({ quan: 1, em: 1_000_000 }, 1_000_000 + 121_000), false)
})
