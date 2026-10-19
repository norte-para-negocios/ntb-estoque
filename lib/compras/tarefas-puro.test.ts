import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarTarefas, resumoTarefas, type EntradaTarefas } from './tarefas-puro.ts'

const entrada = (): EntradaTarefas => ({
  hoje: '2026-10-19',
  pode: { aprovar: true, pedidos: true, requisicoes: true, notas: true },
  requisicoes: [
    { id: 1, numero: 1, etapa: 'aberta', criadaEm: '2026-10-18T10:00:00Z', compradorId: 5, itens: 2, valor: 100 },
    { id: 2, numero: 2, etapa: 'aprovada', criadaEm: '2026-10-17T10:00:00Z', compradorId: null, itens: 1, valor: 10 },
    { id: 3, numero: 3, etapa: 'pedido', criadaEm: '2026-10-10T10:00:00Z', compradorId: null, itens: 1, valor: 10 },
  ],
  pedidos: [
    { id: 10, numero: 10, etapa: 'aguardando_aprovacao', fornecedorNome: 'HORTI', fornecedorCnpj: '11222333000181', previsao: null, atualizadoEm: '2026-10-18T10:00:00Z', compradorId: 5, qtdBase: 10, recebido: 0, total: 50 },
    { id: 11, numero: 11, etapa: 'aprovado', fornecedorNome: 'HORTI', fornecedorCnpj: '11222333000181', previsao: '2026-10-15', atualizadoEm: '2026-10-10T10:00:00Z', compradorId: 5, qtdBase: 10, recebido: 4, total: 50 },
    { id: 12, numero: 12, etapa: 'aprovado', fornecedorNome: 'FEIRA', fornecedorCnpj: null, previsao: '2026-10-25', atualizadoEm: '2026-10-10T10:00:00Z', compradorId: null, qtdBase: 3, recebido: 0, total: 9 },
    { id: 13, numero: 13, etapa: 'aprovado', fornecedorNome: 'BEBIDAS', fornecedorCnpj: '99888777000166', previsao: '2026-10-01', atualizadoEm: '2026-10-01T10:00:00Z', compradorId: null, qtdBase: 5, recebido: 5, total: 9 },
    { id: 14, numero: 14, etapa: 'rascunho', fornecedorNome: 'X', fornecedorCnpj: null, previsao: null, atualizadoEm: '2026-10-12T10:00:00Z', compradorId: null, qtdBase: 1, recebido: 0, total: 1 },
    { id: 15, numero: 15, etapa: 'rascunho', fornecedorNome: 'Y', fornecedorCnpj: null, previsao: null, atualizadoEm: '2026-10-18T10:00:00Z', compradorId: null, qtdBase: 1, recebido: 0, total: 1 },
  ],
  notas: [
    { compraId: 100, notaId: 900, numero: '55', fornecedorNome: 'HORTI LTDA', fornecedorCnpj: '11.222.333/0001-81', emissao: '2026-10-18', temVinculo: false },
    { compraId: 101, notaId: 901, numero: '56', fornecedorNome: 'HORTI LTDA', fornecedorCnpj: '11222333000181', emissao: '2026-10-18', temVinculo: true },
    { compraId: 102, notaId: 902, numero: '57', fornecedorNome: 'BEBIDAS', fornecedorCnpj: '99888777000166', emissao: '2026-10-18', temVinculo: false },
  ],
})

test('montarTarefas: o que espera ação, na ordem de urgência', () => {
  const t = montarTarefas(entrada())
  assert.deepEqual(t.map((x) => `${x.tipo}:${x.ref}`), [
    'pedido_atrasado:11', 'aprovar_pedido:10', 'conferir_nota:100', 'aprovar_requisicao:1', 'gerar_pedido:2', 'rascunho_parado:14',
  ])
  const atraso = t[0]
  assert.equal(atraso.atrasoDias, 4)
  assert.equal(atraso.href, '/pedido-compra/11')
  assert.match(t[2].detalhe, /nº 11/)              // a nota sugere o pedido aprovado do mesmo CNPJ que ainda falta receber
  assert.equal(t[2].href, '/nota-fiscal/900')
  assert.equal(t[2].compradorId, 5)                // herda o comprador do pedido
})

test('montarTarefas: sem permissão não aparece; filtro por comprador', () => {
  const e = entrada()
  e.pode = { aprovar: false, pedidos: true, requisicoes: true, notas: false }
  const t = montarTarefas(e)
  assert.ok(!t.some((x) => x.tipo === 'aprovar_pedido' || x.tipo === 'aprovar_requisicao' || x.tipo === 'conferir_nota'))
  const minhas = montarTarefas(entrada(), { compradorId: 5 })
  assert.deepEqual(minhas.map((x) => x.tipo), ['pedido_atrasado', 'aprovar_pedido', 'conferir_nota', 'aprovar_requisicao'])
})

test('resumoTarefas conta por tipo', () => {
  const r = resumoTarefas(montarTarefas(entrada()))
  assert.equal(r.total, 6)
  assert.equal(r.porTipo.pedido_atrasado, 1)
  assert.equal(r.porTipo.aprovar_requisicao, 1)
})
