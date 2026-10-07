import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planejarBaixa } from './plano-baixa.ts'
import { localDaVenda } from '../vendas/local-venda.ts'

const loja = { local_estoque_cozinha_codigo: 20, local_estoque_bar_codigo: 30, local_estoque_por_setor: { Pizzaria: 40 }, local_estoque_por_produto: { '80001': 50 } }
const produtos = new Map([['90001', 1001], ['90002', 1002], ['80001', 1003]])
const locais = new Set([10, 20, 30, 40, 50])
const plano = (itens: object[], padrao: number | null = 10) => planejarBaixa(itens as never[], loja, localDaVenda, produtos, padrao, locais)

test('item sem código ou quantidade inválida é pulado (nada gravado)', () => {
  const p = plano([{ quantidade: 1 }, { codigo: '90001', quantidade: 0 }, { codigo: '90001', quantidade: -2 }])
  assert.ok(p.every((x) => x.pulo?.op === 'pulada' && x.pulo.erro === 'Item inválido'))
})

test('produto inexistente é "pulada" explícito, nunca ok silencioso', () => {
  const [p] = plano([{ codigo: '99999', quantidade: 1 }])
  assert.equal(p.pulo?.op, 'pulada')
  assert.match(p.pulo!.erro, /sem cadastro/)
  assert.equal(p.produto, undefined)
})

test('sem local mapeado nem padrão: sem_estrutura + "sem local de estoque" (retentável no Vendas)', () => {
  const [p] = plano([{ codigo: '90001', quantidade: 1 }], null)
  assert.equal(p.pulo?.op, 'sem_estrutura')
  assert.equal(p.pulo?.baixa, 'sem local de estoque')
})

test('local que não existe na loja é pulado em vez de estourar a FK', () => {
  const [p] = plano([{ codigo: '90001', quantidade: 1, localEstoque: 777 }])
  assert.equal(p.pulo?.op, 'pulada')
  assert.match(p.pulo!.erro, /777/)
})

test('precedência do local: por produto > local do Vendas > setor > cozinha/bar > padrão', () => {
  const p = plano([
    { codigo: '80001', quantidade: 1, localEstoque: 30, setor: 'Pizzaria', destination: 'bar' },
    { codigo: '90001', quantidade: 1, localEstoque: 30, setor: 'Pizzaria', destination: 'kitchen' },
    { codigo: '90001', quantidade: 1, setor: 'pizzaria', destination: 'kitchen' },
    { codigo: '90001', quantidade: 1, destination: 'kitchen' },
    { codigo: '90001', quantidade: 1, destination: 'bar' },
    { codigo: '90001', quantidade: 1 },
  ])
  assert.deepEqual(p.map((x) => x.local), [50, 30, 40, 20, 30, 10])
})

test('mesmo produto no mesmo local duas vezes vira linhas 0 e 1 (idempotência por ocorrência, não por índice)', () => {
  const p = plano([
    { codigo: '90001', quantidade: 1, destination: 'bar' },
    { codigo: '90002', quantidade: 2, destination: 'bar' },
    { codigo: '90001', quantidade: 3, destination: 'bar' },
    { codigo: '90001', quantidade: 1, destination: 'kitchen' },
  ])
  assert.deepEqual(p.map((x) => x.linha), [0, 0, 1, 0])
  assert.deepEqual(p.map((x) => x.indice), [0, 1, 2, 3])
})

test('reenviar só um subconjunto dos itens mantém as mesmas chaves (linha não depende do índice)', () => {
  const inteiro = plano([{ codigo: '90001', quantidade: 1, destination: 'bar' }, { codigo: '90002', quantidade: 1, destination: 'bar' }])
  const soUm = plano([{ codigo: '90002', quantidade: 1, destination: 'bar' }])
  assert.equal(inteiro[1].linha, soUm[0].linha)
  assert.equal(inteiro[1].produto, soUm[0].produto)
  assert.equal(inteiro[1].local, soUm[0].local)
})
