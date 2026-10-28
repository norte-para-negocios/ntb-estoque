// Financeiro A0: normalização dos avisos Financas.* e da API (formatos reais da loja 5, 27/10/2026, sem dado pessoal).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  baixaDoMovimento, categoriaDoOmie, codigo, contaDoOmie, dataHoraOmie, dataOmie, dreDoOmie, juntarAvisos, linhasDoAviso, num,
  saldoDoExtrato, situacaoPorResumo, situacaoPorStatus, statusTitulo, tipoDoAviso, tituloDoMovimento, ultimaPorChave, chaveTitulo,
  type AvisoGravado,
} from './normalizar.ts'

const tituloPagar = {
  nsu: '', operacao: '', situacao: 'Pago', id_origem: 'APIP', data_emissao: '2026-10-27T00:00:00-03:00',
  data_previsao: '2026-10-27T00:00:00-03:00', data_registro: '2026-10-27T00:00:00-03:00', numero_parcela: '001/001',
  data_vencimento: '2026-10-27T00:00:00-03:00', valor_documento: 516.63, codigo_categoria: '2.05.78', numero_documento: '',
  id_conta_corrente: 2424369383, codigo_tipo_documento: 'DIN', codigo_lancamento_omie: 3837792306, codigo_projeto: 0,
  codigo_cliente_fornecedor: 2451537488, codigo_lancamento_integracao: '11267Sangria',
}
const aviso = (id: number, topic: string, event: unknown, created_at = '2026-10-28T00:45:11.402Z'): AvisoGravado =>
  ({ id, loja_id: 5, created_at, message: { messageId: `m${id}`, topic, event, appKey: 'x', origin: 'omie-connect-2.0' } })

test('campos básicos: texto, número, código, datas', () => {
  assert.equal(codigo(0), null)
  assert.equal(codigo('3837792306'), 3837792306)
  assert.equal(codigo(-5), null)
  assert.equal(num('1.234,56'), 1234.56)
  assert.equal(num('600'), 600)
  assert.equal(num(516.635), 516.64)
  assert.equal(num('abc'), null)
  assert.equal(num(5e12), null, 'fora de numeric(14,2) não trava o lote')
  assert.equal(dataOmie('27/10/2026'), '2026-10-27')
  assert.equal(dataOmie('2026-10-27T00:00:00-03:00'), '2026-10-27')
  assert.equal(dataOmie('31/02/2026'), null)
  assert.equal(dataOmie(''), null)
  assert.equal(dataHoraOmie('27/10/2026', '14:00:49'), '2026-10-27 14:00:49')
  assert.equal(dataHoraOmie('27/10/2026', ''), '2026-10-27 00:00:00')
  assert.equal(dataHoraOmie('', '10:00:00'), null)
})

test('status e situação', () => {
  assert.equal(statusTitulo('[SG]A vencer'), 'A VENCER')
  assert.equal(statusTitulo('Pago (bloqueado)'), 'PAGO (BLOQUEADO)')
  assert.equal(statusTitulo('Recebido Parcialmente'), 'RECEBIDO PARCIALMENTE')
  assert.equal(statusTitulo(''), null)
  assert.equal(situacaoPorStatus('PAGO (BLOQUEADO)'), 'liquidado')
  assert.equal(situacaoPorStatus('RECEBIDO PARCIALMENTE'), 'parcial')
  assert.equal(situacaoPorStatus('ATRASADO'), 'aberto')
  assert.equal(situacaoPorStatus('VENCE HOJE'), 'aberto')
  assert.equal(situacaoPorStatus('CANCELADO'), 'cancelado')
  assert.equal(situacaoPorStatus('CONCILIADO'), null)
  // Caso real: cStatus RECEBIDO com cLiquidado N e valor em aberto → parcial (o resumo manda).
  assert.equal(situacaoPorResumo('RECEBIDO', { cLiquidado: 'N', nValAberto: 509.34, nValPago: 8.76 }), 'parcial')
  assert.equal(situacaoPorResumo('A VENCER', { cLiquidado: 'N', nValAberto: 3638, nValPago: 0 }), 'aberto')
  assert.equal(situacaoPorResumo('PAGO', { cLiquidado: 'S', nValAberto: 0, nValPago: 2500 }), 'liquidado')
  assert.equal(situacaoPorResumo('CANCELADO', { cLiquidado: 'N', nValAberto: 10 }), 'cancelado')
})

test('tópicos', () => {
  assert.equal(tipoDoAviso('Financas.ContaPagar.Incluido'), 'titulo')
  assert.equal(tipoDoAviso('Financas.ContaReceber.BaixaCancelada'), 'baixa')
  assert.equal(tipoDoAviso('Financas.ContaPagar.Rateio.Categoria'), 'rateio')
  assert.equal(tipoDoAviso('Financas.ContaPagar.Rateio.Departamento'), null)
  assert.equal(tipoDoAviso('Financas.ContaCorrente.Transferencia.Excluido'), 'transferencia')
  assert.equal(tipoDoAviso('OrdemProducao.Concluida'), null)
})

test('aviso de título a pagar (Incluido) e excluído', () => {
  const r = linhasDoAviso(aviso(10, 'Financas.ContaPagar.Incluido', tituloPagar))
  assert.equal(r.ignorado, null)
  const t = r.titulos[0]
  assert.equal(t.codigo_lancamento_omie, 3837792306)
  assert.equal(t.natureza, 'P')
  assert.equal(t.data_vencimento, '2026-10-27')
  assert.equal(t.valor_documento, 516.63)
  assert.equal(t.status_titulo, 'PAGO')
  assert.equal(t.situacao, 'liquidado')
  assert.equal(t.excluido, false)
  assert.equal(t.numero_documento, null)
  assert.equal(t.codigo_projeto, null)
  assert.equal(t.origem_dado, 'webhook')
  assert.equal(t.fonte_em, '2026-10-28T00:45:11.402Z')
  assert.equal(t.webhook_id, 10)
  assert.equal(t.valor_pago, undefined, 'o aviso não traz o resumo: não apaga o da API')
  const x = linhasDoAviso(aviso(11, 'Financas.ContaPagar.Excluido', { ...tituloPagar, situacao: '' })).titulos[0]
  assert.equal(x.excluido, true)
  assert.equal(x.situacao, null)
})

test('aviso de baixas (array) a receber e cancelada', () => {
  const ev = [{
    data: '2026-10-26T00:00:00-03:00', juros: 0, multa: 0, valor: 180, tarifa: 1.5, desconto: 0, data_cred: '2026-10-27T00:00:00-03:00',
    codigo_baixa: 3837682019, codigo_conta_corrente: 2424369383, codigo_baixa_integracao: '20766555073', codigo_cliente_fornecedor: 2451537488,
    conta_a_receber: [{ codigo_lancamento_omie: 3837682010, codigo_lancamento_integracao: '207665', valor_documento: 180 }],
  }, { codigo_baixa: 0, conta_a_receber: [] }]
  const r = linhasDoAviso(aviso(20, 'Financas.ContaReceber.BaixaRealizada', ev))
  assert.equal(r.baixas.length, 1)
  const b = r.baixas[0]
  assert.equal(b.natureza, 'R')
  assert.equal(b.codigo_lancamento_omie, 3837682010)
  assert.equal(b.data, '2026-10-26')
  assert.equal(b.data_cred, '2026-10-27')
  assert.equal(b.tarifa, 1.5)
  assert.equal(b.cancelada, false)
  assert.equal(linhasDoAviso(aviso(21, 'Financas.ContaReceber.BaixaCancelada', ev)).baixas[0].cancelada, true)
  assert.match(linhasDoAviso(aviso(22, 'Financas.ContaPagar.BaixaRealizada', {})).ignorado ?? '', /sem codigo_baixa/)
})

test('rateio e lançamento de conta corrente', () => {
  const r = linhasDoAviso(aviso(30, 'Financas.ContaPagar.Rateio.Categoria', {
    nCodTitulo: 3819081419, categorias: [{ valor: 364.5, percentual: 49.3301, codigo_categoria: '2.01.72' }, { valor: 374.4, percentual: 50.6699, codigo_categoria: '2.01.80' }],
  })).titulos[0]
  assert.equal(r.so_rateio, true)
  assert.equal(r.codigo_lancamento_omie, 3819081419)
  assert.deepEqual(r.categorias?.map((c) => c.codigo_categoria), ['2.01.72', '2.01.80'])
  assert.equal(r.categorias?.[0].percentual, 49.33)
  const l = linhasDoAviso(aviso(31, 'Financas.ContaCorrente.Lancamento.Alterado', {
    info: { dAlt: '' }, detalhes: { cObs: 'x', cTipo: 'NFE  ', cNumDoc: '      ', cCodCateg: '2.01.04             ', nCodCliente: 2464817059, nCodProjeto: 0 },
    diversos: { cOrigem: 'BAXP', cNatureza: 'P', dDtConc: '' }, nCodLanc: 3828347998, situacao: '',
    cabecalho: { nCodCC: 2452837876, dDtLanc: '2026-10-06T00:00:00-03:00', nValorLanc: 600 }, cCodIntLanc: '',
  })).lancamentos[0]
  assert.equal(l.tipo, 'lancamento')
  assert.equal(l.c_cod_categ, '2.01.04')
  assert.equal(l.c_tipo, 'NFE')
  assert.equal(l.c_num_doc, null)
  assert.equal(l.d_dt_lanc, '2026-10-06')
  assert.equal(l.n_valor_lanc, 600)
  assert.equal(l.excluido, false)
})

test('aviso estranho é ignorado, nunca lança', () => {
  assert.match(linhasDoAviso(aviso(40, 'Financas.ContaReceber.BoletoGerado', {})).ignorado ?? '', /não usado/)
  assert.match(linhasDoAviso({ id: 41, loja_id: 5, created_at: 'x', message: { topic: 'Financas.ContaPagar.Incluido' } }).ignorado ?? '', /created_at/)
  assert.match(linhasDoAviso({ id: 42, loja_id: 5, created_at: '2026-10-01T00:00:00Z', message: null }).ignorado ?? '', /não usado/)
  assert.match(linhasDoAviso(aviso(43, 'Financas.ContaPagar.Alterado', { situacao: 'Pago' })).ignorado ?? '', /sem codigo/)
})

test('no lote fica só a versão mais nova de cada chave; rateio e título do mesmo código convivem', () => {
  const j = juntarAvisos([
    linhasDoAviso(aviso(50, 'Financas.ContaPagar.Incluido', { ...tituloPagar, situacao: 'A vencer' }, '2026-10-27T10:00:00Z')),
    linhasDoAviso(aviso(52, 'Financas.ContaPagar.Alterado', { ...tituloPagar, situacao: 'Pago' }, '2026-10-27T10:05:00Z')),
    linhasDoAviso(aviso(51, 'Financas.ContaPagar.Rateio.Categoria', { nCodTitulo: tituloPagar.codigo_lancamento_omie, categorias: [] }, '2026-10-27T10:01:00Z')),
    linhasDoAviso(aviso(53, 'Financas.ContaReceber.BoletoGerado', {})),
  ])
  assert.equal(j.titulos.length, 2)
  assert.equal(j.titulos.find((t) => !t.so_rateio)?.status_titulo, 'PAGO')
  assert.equal(j.titulos.find((t) => t.so_rateio)?.categorias, null)
  assert.equal(j.ignorados, 1)
  // empate de hora: vale o webhook de id maior
  const u = ultimaPorChave([{ k: 1, fonte_em: 'T', webhook_id: 2 }, { k: 1, fonte_em: 'T', webhook_id: 1 }].map((x) => ({ ...x, fonte_em: '2026-10-27T10:00:00Z' })), () => 'k')
  assert.equal(u[0].webhook_id, 2)
  assert.equal(chaveTitulo({ codigo_lancamento_omie: 1, natureza: 'P', excluido: false, origem_dado: 'api', fonte_em: null }), '1:t')
})

test('ListarMovimentos: título (CPCR) com resumo e baixa (BX)', () => {
  const lido = '2026-10-28T01:00:00.000Z'
  const t = tituloDoMovimento({
    detalhes: {
      cCodCateg: '2.08.99', cGrupo: 'CONTA_A_PAGAR', cHrAlt: '14:00:49', cHrInc: '09:59:19', cNatureza: 'P', cNumParcela: '008/011', cOrigem: 'RPTP',
      cStatus: 'PAGO', cTipo: 'NFE', cUsAlt: 'P001038409', cUsInc: 'P000224618', dDtAlt: '27/10/2026', dDtEmissao: '20/10/2026', dDtInc: '20/03/2026',
      dDtPagamento: '13/10/2026', dDtPrevisao: '10/10/2026', dDtRegistro: '20/10/2026', dDtVenc: '10/10/2026', nCodCC: 2452837876,
      nCodCliente: 2459268156, nCodTitRepet: 3757831126, nCodTitulo: 3757831513, nValorTitulo: 2500,
    },
    resumo: { cLiquidado: 'S', nDesconto: 0, nJuros: 0, nMulta: 0, nValAberto: 0, nValLiquido: 2500, nValPago: 2500 },
  }, lido, { vistoAberto: true })
  assert.ok(t)
  assert.equal(t.natureza, 'P')
  assert.equal(t.data_pagamento, '2026-10-13')
  assert.equal(t.valor_pago, 2500)
  assert.equal(t.valor_aberto, 0)
  assert.equal(t.liquidado, true)
  assert.equal(t.situacao, 'liquidado')
  assert.equal(t.resumo_em, lido)
  assert.equal(t.fonte_em, lido)
  assert.equal(t.visto_aberto_em, lido)
  assert.equal(t.incluido_omie_em, '2026-03-20 09:59:19')
  assert.equal(t.codigo_titulo_repeticao, 3757831126)
  assert.equal(t.categorias_definidas, undefined, 'sem rateio na resposta não apaga o rateio do aviso')
  const comRateio = tituloDoMovimento({ detalhes: { nCodTitulo: 1, cNatureza: 'R', cStatus: 'A VENCER' }, resumo: {}, categorias: [{ cCodCateg: '1.01.03', nDistrPercentual: 100, nDistrValor: 10 }] }, lido)
  assert.equal(comRateio?.categorias_definidas, true)
  assert.equal(comRateio?.categorias?.[0].valor, 10)
  assert.equal(comRateio?.valor_aberto, null, 'resposta sem resumo não grava resumo')
  assert.equal(comRateio?.situacao, 'aberto')
  assert.equal(tituloDoMovimento({ detalhes: { nCodTitulo: 1, cNatureza: 'X' } }, lido), null)

  const b = baixaDoMovimento({
    detalhes: {
      cCodCateg: '2.01.04', cNatureza: 'P', cStatus: 'PAGO', dDtConcilia: '27/10/2026', dDtCredito: '08/10/2026', dDtPagamento: '08/10/2026',
      nCodBaixa: 3828348005, nCodCC: 2452837876, nCodCliente: 2464817059, nCodMovCC: 3828347998, nCodTitulo: 3828347232, nValorMovCC: 600, nJuros: 1.2,
    },
    resumo: { nValPago: 600 },
  }, lido)
  assert.ok(b)
  assert.equal(b.codigo_baixa, 3828348005)
  assert.equal(b.codigo_lancamento_omie, 3828347232)
  assert.equal(b.data, '2026-10-08')
  assert.equal(b.valor, 600)
  assert.equal(b.juros, 1.2)
  assert.equal(b.desconto, 0)
  assert.equal(b.tarifa, undefined, 'a API não traz tarifa: fica a do aviso')
  assert.equal(b.codigo_mov_cc, 3828347998)
  assert.equal(baixaDoMovimento({ detalhes: { nCodTitulo: 1, cNatureza: 'P' } }, lido), null)
})

test('cadastros: categoria com DRE, DRE, conta corrente, saldo do extrato', () => {
  const lido = '2026-10-28T01:00:00.000Z'
  const c = categoriaDoOmie({
    categoria_superior: '1.01', codigo: '1.01.03', codigo_dre: '1.01.01', conta_despesa: 'N', conta_inativa: 'N', conta_receita: 'S',
    dadosDRE: { codigoDRE: '1.01.01', descricaoDRE: 'Receita Bruta de Vendas', naoExibirDRE: 'N', nivelDRE: 3, sinalDRE: '+', totalizaDRE: 'N' },
    descricao: 'Clientes - Revenda de Mercadoria', id_conta_contabil: '1.1.2.02.100.0', totalizadora: 'N', transferencia: 'N', nao_exibir: 'N',
  }, lido)
  assert.equal(c?.codigo_dre, '1.01.01')
  assert.equal(c?.nivel_dre, 3)
  assert.equal(c?.sinal_dre, '+')
  assert.equal(c?.conta_receita, true)
  assert.equal(c?.totaliza_dre, false)
  const semDre = categoriaDoOmie({ codigo: '0.01', dadosDRE: {}, codigo_dre: '' }, lido)
  assert.equal(semDre?.codigo_dre, null)
  assert.equal(categoriaDoOmie({ codigo: '' }, lido), null)
  assert.deepEqual(dreDoOmie({ codigoDRE: '1', descricaoDRE: 'Lucro Bruto', naoExibirDRE: 'N', nivelDRE: 1, sinalDRE: '', totalizaDRE: 'S' }, lido),
    { codigo_dre: '1', descricao_dre: 'Lucro Bruto', nivel_dre: 1, sinal_dre: null, totaliza_dre: true, nao_exibir_dre: false, lido_em: lido })
  const cc = contaDoOmie({ nCodCC: 2424369383, descricao: 'Caixinha', tipo_conta_corrente: 'CX', codigo_banco: '999', inativo: 'N', saldo_inicial: 29394.3, saldo_data: '31/12/2020' }, lido)
  assert.equal(cc?.id_conta_corrente, 2424369383)
  assert.equal(cc?.saldo_data, '2020-12-31')
  assert.equal(cc?.inativo, false)
  const s = saldoDoExtrato({ nCodCC: 2452837876, nSaldoAtual: -3605202.86, nSaldoConciliado: -3482783.38, nSaldoAtualPrevisto: -5837121.93 }, lido)
  assert.equal(s?.saldo_atual, -3605202.86)
  assert.equal(saldoDoExtrato({ nCodCC: 1 }, lido), null)
})
