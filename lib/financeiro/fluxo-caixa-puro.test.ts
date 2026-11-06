import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chavePeriodo, montarFluxo, origensDoPeriodo, type EntradaFluxo } from './fluxo-caixa-puro.ts'

test('chavePeriodo: dia, semana (segunda-feira) e mês', () => {
  assert.equal(chavePeriodo('2026-11-05', 'dia'), '2026-11-05')
  assert.equal(chavePeriodo('2026-11-05', 'semana'), '2026-11-02') // quinta → segunda
  assert.equal(chavePeriodo('2026-11-08', 'semana'), '2026-11-02') // domingo fica na semana que começou na segunda
  assert.equal(chavePeriodo('2026-11-09', 'semana'), '2026-11-09')
  assert.equal(chavePeriodo('2026-11-05', 'mes'), '2026-11')
})

const base = (over: Partial<EntradaFluxo> = {}): EntradaFluxo => ({
  de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-05', por: 'semana',
  contas: [{ id: 1, nome: 'Caixa', saldo_atual: 1000 }, { id: 2, nome: 'Banco', saldo_atual: 5000 }],
  lancamentos: [], titulosPagar: [], titulosReceber: [], recorrentes: [], ocorrencias: [],
  ...over,
})

test('loja sem nada no financeiro: saldos atuais, sem movimento, sem inventar previsão', () => {
  const f = montarFluxo(base())
  assert.equal(f.saldoInicial, 6000)
  assert.equal(f.saldoFinalProjetado, 6000)
  assert.ok(f.periodos.every((p) => p.realizadoEntradas === 0 && p.previstoSaidas === 0))
  assert.deepEqual(f.contas.map((c) => c.saldoProjetado), [1000, 5000])
})

test('realizado: extrato por período; transferência entre contas não infla entradas/saídas da loja', () => {
  const f = montarFluxo(base({
    contas: [{ id: 1, nome: 'Caixa', saldo_atual: 900 }, { id: 2, nome: 'Banco', saldo_atual: 5300 }],
    lancamentos: [
      { id: 1, conta_id: 1, data: '2026-11-02', tipo: 'saida', valor: 100, descricao: 'Pagamento', origem_tipo: 'pagamento' },
      { id: 2, conta_id: 2, data: '2026-11-03', tipo: 'entrada', valor: 500, descricao: 'Recebimento', origem_tipo: 'recebimento' },
      { id: 3, conta_id: 2, data: '2026-11-04', tipo: 'saida', valor: 200, descricao: 'Transf.', origem_tipo: 'transferencia' },
      { id: 4, conta_id: 1, data: '2026-11-04', tipo: 'entrada', valor: 200, descricao: 'Transf.', origem_tipo: 'transferencia' },
      // saída de antes do período: entra no saldo inicial, não nas colunas
      { id: 5, conta_id: 2, data: '2026-11-01', tipo: 'saida', valor: 0.01, descricao: 'x', origem_tipo: 'manual' },
    ],
  }))
  // saldo antes de 01/11 = atual − movimento de 01/11 em diante = 6200 − (−100 + 500 − 0,01) = 5800,01
  assert.equal(f.saldoInicial, 5800.01)
  const s1 = f.periodos.find((p) => p.chave === '2026-10-26')! // semana de 26/10 tem o dia 01/11 (domingo)
  assert.equal(s1.realizadoSaidas, 0.01)
  const s2 = f.periodos.find((p) => p.chave === '2026-11-02')!
  assert.equal(s2.realizadoEntradas, 500)
  assert.equal(s2.realizadoSaidas, 100)
  assert.equal(s2.transferencias, 200)
  assert.equal(f.saldoFinalProjetado, 6200)
  assert.deepEqual(f.contas.map((c) => c.saldoAtual), [900, 5300])
})

test('previsto: a pagar em aberto (restante), a receber (líquido), recorrentes futuras sem título; atrasado cai em hoje', () => {
  const f = montarFluxo(base({
    titulosPagar: [
      { id: 10, numero: 1, fornecedor_nome: 'Atacado', documento: 'NF 1', valor: 300, valor_quitado: 100, data_vencimento: '2026-11-03', aprovacao: 'nao_exige', valor_a_confirmar: false },
      { id: 11, numero: 2, fornecedor_nome: 'Luz', documento: null, valor: 400, valor_quitado: 0, data_vencimento: '2026-11-20', aprovacao: 'nao_exige', valor_a_confirmar: true },
      { id: 12, numero: 3, fornecedor_nome: 'X', documento: null, valor: 999, valor_quitado: 0, data_vencimento: '2026-11-20', aprovacao: 'reprovado', valor_a_confirmar: false },
    ],
    titulosReceber: [
      { id: 20, data_venda: '2026-11-04', forma: 'credito', valor_liquido: 970, data_prevista: '2026-12-04', conta_id: 2 },
      { id: 21, data_venda: '2026-11-04', forma: 'debito', valor_liquido: 98.5, data_prevista: '2026-11-05', conta_id: 2 },
    ],
    recorrentes: [{ id: 30, descricao: 'Aluguel', fornecedor_nome: 'Imobiliária', valor: 4500, valor_estimado: false, periodicidade: 'mensal', dia: 10, data_inicio: '2026-01-01', data_fim: null }],
    // novembro já gerado (é o título 11? não: ocorrência do dia 10 existe → não projeta de novo)
    ocorrencias: [{ recorrente_id: 30, data_vencimento: '2026-11-10' }],
  }))
  const hoje = f.periodos.find((p) => p.chave === '2026-11-02')!
  assert.equal(hoje.previstoSaidas, 200, 'restante da conta atrasada vai para hoje')
  assert.equal(hoje.previstoEntradas, 98.5)
  const s16 = f.periodos.find((p) => p.chave === '2026-11-16')!
  assert.equal(s16.previstoSaidas, 400)
  // recebível de 04/12 está fora do período (até 30/11)
  assert.equal(f.periodos.reduce((s, p) => s + p.previstoEntradas, 0), 98.5)
  assert.equal(f.saldoFinalProjetado, 6000 - 200 + 98.5 - 400)
  // banco recebe o débito; a pagar sem conta definida fica à parte
  assert.equal(f.contas.find((c) => c.id === 2)!.saldoProjetado, 5098.5)
  assert.equal(f.semConta.saidas, 600)
  assert.ok(f.avisos.some((a) => /reprovada/i.test(a)))
  assert.ok(f.avisos.some((a) => /estimad/i.test(a)))
  const orig = origensDoPeriodo(f, '2026-11-02', 'previsto')
  assert.deepEqual(orig.map((o) => o.ref).sort(), ['receber:21', 'titulo:10'])
  assert.ok(orig.find((o) => o.ref === 'titulo:10')!.atrasado)
})

test('recorrente sem ocorrência gerada no período entra como previsão (estimada se o valor é estimado)', () => {
  const f = montarFluxo(base({
    ate: '2026-12-31', por: 'mes',
    recorrentes: [{ id: 30, descricao: 'Aluguel', fornecedor_nome: 'Imobiliária', valor: 4500, valor_estimado: false, periodicidade: 'mensal', dia: 10, data_inicio: '2026-01-01', data_fim: null }],
    ocorrencias: [{ recorrente_id: 30, data_vencimento: '2026-11-10' }],
  }))
  const dez = f.periodos.find((p) => p.chave === '2026-12')!
  assert.equal(dez.previstoSaidas, 4500)
  assert.equal(f.periodos.find((p) => p.chave === '2026-11')!.previstoSaidas, 0)
  assert.equal(origensDoPeriodo(f, '2026-12', 'previsto')[0].ref, 'recorrente:30:2026-12-10')
})

test('origens do realizado: os lançamentos do período, inclusive transferências', () => {
  const f = montarFluxo(base({
    lancamentos: [{ id: 1, conta_id: 1, data: '2026-11-02', tipo: 'saida', valor: 100, descricao: 'Pagamento', origem_tipo: 'pagamento' }],
    contas: [{ id: 1, nome: 'Caixa', saldo_atual: 900 }, { id: 2, nome: 'Banco', saldo_atual: 5000 }],
  }))
  const o = origensDoPeriodo(f, '2026-11-02', 'realizado')
  assert.equal(o.length, 1)
  assert.equal(o[0].valor, -100)
  assert.equal(o[0].conta, 'Caixa')
})
