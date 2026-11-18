import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarAguardandoOmie, textoAguardandoOmie, ehMovimentoDeVenda } from './aguardando-omie.ts'

const prod = new Map<number, string>([[10, 'PIZZA CALABRESA'], [11, 'CERVEJA 600ML']])

test('F-09: venda do Vendas é reconhecida pela marca na obs ou na obs do item', () => {
  assert.equal(ehMovimentoDeVenda({ obs: 'Venda ntb-vendas #abc', obs_item: null }), true)
  assert.equal(ehMovimentoDeVenda({ obs: 'Cupom 12', obs_item: 'Venda ntb-vendas #abc' }), true)
  assert.equal(ehMovimentoDeVenda({ obs: 'Ajuste de contagem', obs_item: null }), false)
})

test('F-09: monta linhas das saídas e das OPs da fila com o aviso "aguardando o Omie"', () => {
  const r = montarAguardandoOmie({
    movimentos: [
      { id: 1, id_prod: 10, quan: -2, data: '2026-11-18', obs: 'Venda ntb-vendas #aaaa', obs_item: null, status: 'Erro', tentativas: 1, descricao_status: 'Omie bloqueado neste ambiente' },
      { id: 2, id_prod: 11, quan: -1, data: '2026-11-18', obs: 'Cupom 9', obs_item: 'Venda ntb-vendas #bbbb', status: 'Processando', tentativas: 0, descricao_status: null },
    ],
    fila: [
      { id: 7, tipo: 'op', ref: 'aaaa', payload: { codigo: '90001', codigo_produto: 10, quantidade: 2, cCodIntOP: 'X1' }, tentativas: 1, ultimo_erro: 'Omie bloqueado neste ambiente', proximo_em: '2026-11-18T10:00:00Z' },
      { id: 8, tipo: 'nfce', ref: 'chave', payload: {}, tentativas: 1, ultimo_erro: null, proximo_em: '2026-11-18T10:00:00Z' },
    ],
    produtos: prod,
  })
  assert.equal(r.total, 3)
  assert.equal(r.saidas.length, 2)
  assert.equal(r.ops.length, 1, 'só OP entra; nota fiscal fica fora desta lista')
  assert.equal(r.saidas[0].produto, 'PIZZA CALABRESA')
  assert.equal(r.saidas[0].quantidade, 2, 'quantidade sempre positiva na tela')
  assert.equal(r.saidas[0].motivo, 'Omie bloqueado neste ambiente')
  assert.equal(r.saidas[1].motivo, 'Aguardando a primeira tentativa')
  assert.equal(r.ops[0].produto, 'PIZZA CALABRESA')
  assert.equal(r.ops[0].quantidade, 2)
  assert.match(textoAguardandoOmie(r), /aguardando o Omie/i)
})

test('F-09: saída que não é de venda ou já tem ajuste fica de fora; sem nada, total zero e sem texto', () => {
  const r = montarAguardandoOmie({
    movimentos: [{ id: 3, id_prod: 10, quan: -1, data: '2026-11-18', obs: 'Ajuste manual', obs_item: null, status: 'Erro', tentativas: 2, descricao_status: 'x' }],
    fila: [],
    produtos: prod,
  })
  assert.equal(r.total, 0)
  assert.equal(textoAguardandoOmie(r), '')
})

test('F-09: produto desconhecido mostra o código; texto no singular e no plural', () => {
  const um = montarAguardandoOmie({
    movimentos: [{ id: 4, id_prod: 99, quan: 1, data: '2026-11-18', obs: 'Venda ntb-vendas #z', obs_item: null, status: 'Erro', tentativas: 1, descricao_status: null }],
    fila: [], produtos: prod,
  })
  assert.equal(um.saidas[0].produto, 'Produto 99')
  assert.match(textoAguardandoOmie(um), /1 baixa de venda/)
})
