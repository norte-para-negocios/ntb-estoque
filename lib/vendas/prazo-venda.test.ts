import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRAZO_ROTA_VENDA_MS, ESPERA_CMC_APOS_OP_MS, prazoDaRota, passouDoPrazo, cabeNoPrazo, esperasCmcDaSaida } from './prazo-venda.ts'

test('prazo da rota: padrão bem abaixo dos 150 s do Vendas', () => {
  assert.equal(prazoDaRota(1_000, undefined), 1_000 + PRAZO_ROTA_VENDA_MS)
  assert.ok(PRAZO_ROTA_VENDA_MS <= 90_000)
})

test('prazo da rota: env válida vence, inválida/zero cai no padrão', () => {
  assert.equal(prazoDaRota(0, '45000'), 45_000)
  assert.equal(prazoDaRota(0, 'abc'), PRAZO_ROTA_VENDA_MS)
  assert.equal(prazoDaRota(0, '0'), PRAZO_ROTA_VENDA_MS)
  // Nunca acima de 120 s, senão volta a encostar nos 150 s do Vendas.
  assert.equal(prazoDaRota(0, '600000'), 120_000)
})

test('passouDoPrazo: sem prazo nunca passa; com prazo compara com agora', () => {
  assert.equal(passouDoPrazo(undefined, 10), false)
  assert.equal(passouDoPrazo(100, 99), false)
  assert.equal(passouDoPrazo(100, 100), true)
})

test('cabeNoPrazo: espera só se terminar antes do prazo', () => {
  assert.equal(cabeNoPrazo(undefined, 0, 999_999), true)
  assert.equal(cabeNoPrazo(100_000, 30_000, 62_000), true)
  assert.equal(cabeNoPrazo(100_000, 40_000, 62_000), false)
})

test('esperas do Sem CMC: produto sem OP (taxa, revenda) não espera nada', () => {
  assert.deepEqual(esperasCmcDaSaida(false), [])
})

test('esperas do Sem CMC: depois de OP, 1 espera maior que a janela de consumo redundante do Omie (60 s)', () => {
  const e = esperasCmcDaSaida(true)
  assert.equal(e.length, 1)
  assert.equal(e[0], ESPERA_CMC_APOS_OP_MS)
  assert.ok(ESPERA_CMC_APOS_OP_MS > 60_000)
})

import { MSG_ADIADA_PRAZO, ehAdiadaPorPrazo, ehRecusaPorConcorrencia, podeChamarOmie, timeoutDaChamadaMs, decidirFilaJaExiste, linhaOPLocalSemConsulta, PIOR_CASO_ROTA_MS, ESPERA_CONCORRENCIA_MS } from './prazo-venda.ts'
import { classificarErroOmie } from '../omie/erros-omie.ts'

test('chamada ao Omie só começa antes do prazo; sem prazo, sempre', () => {
  assert.equal(podeChamarOmie(undefined, 1e12), true)
  assert.equal(podeChamarOmie(100, 99), true)
  assert.equal(podeChamarOmie(100, 100), false)
})

test('adiada por prazo: reconhecida e transitória (vai para fila/cron, não é erro do item)', () => {
  assert.equal(ehAdiadaPorPrazo(MSG_ADIADA_PRAZO), true)
  assert.equal(ehAdiadaPorPrazo('Consumo redundante'), false)
  assert.equal(classificarErroOmie(MSG_ADIADA_PRAZO), 'transitorio')
})

test('timeout da chamada: com prazo, leitura cai de 60 s para 30 s; escrita fica em 30 s', () => {
  assert.equal(timeoutDaChamadaMs(true, false), 30_000)
  assert.equal(timeoutDaChamadaMs(false, false), 60_000)
  assert.equal(timeoutDaChamadaMs(true, true), 30_000)
  assert.equal(timeoutDaChamadaMs(false, true), 30_000)
})

test('pior caso documentado: prazo + 1 chamada no limite, abaixo de ~120 s', () => {
  assert.equal(PIOR_CASO_ROTA_MS, PRAZO_ROTA_VENDA_MS + 30_000)
  assert.ok(PIOR_CASO_ROTA_MS <= 120_000)
})

test('recusa por concorrência (outra requisição do método em andamento) x redundante', () => {
  assert.equal(ehRecusaPorConcorrencia('ERROR: Já existe uma requisição desse método sendo executada'), true)
  assert.equal(ehRecusaPorConcorrencia('Consumo redundante detectado. Aguarde 60 segundos (REDUNDANT)'), false)
  assert.equal(ehRecusaPorConcorrencia(undefined), false)
  assert.equal(ESPERA_CONCORRENCIA_MS, 5_000)
})

test('fila: "já cadastrada" só vira Concluido se a OP estiver concluída no Omie', () => {
  assert.equal(decidirFilaJaExiste({ nCodOP: 1, concluida: true }), 'concluido')
  assert.equal(decidirFilaJaExiste({ nCodOP: 1, concluida: false }), 'concluir')
  assert.equal(decidirFilaJaExiste(null), 'pendente')
})

test('OP local sem consulta ao Omie: linha mínima para o retry-op-conclusao achar', () => {
  const l = linhaOPLocalSemConsulta(4, 99, { cCodIntOP: 'NTBV-x', codigo_produto: 7, quantidade: 2, dData: '03/11/2026', obs: 'Venda #p', codigoLocalEstoque: 5 }, { concluida: false, erro: 'Omie não respondeu', status: 'Erro', agoraISO: '2026-11-03T10:00:00.000Z' })
  assert.equal(l.loja_id, 4)
  assert.equal(l.identificacao_n_cod_op, 99)
  assert.equal(l.identificacao_c_cod_int_op, 'NTBV-x')
  assert.equal(l.identificacao_n_cod_produto, 7)
  assert.equal(l.identificacao_n_qtde, 2)
  assert.equal(l.identificacao_d_dt_previsao, '2026-11-03')
  assert.equal(l.identificacao_codigo_local_estoque, 5)
  assert.equal(l.concluida, false)
  assert.equal(l.conclusao_status, 'Erro')
  assert.equal(l.observacao, 'Venda #p')
  const ok = linhaOPLocalSemConsulta(4, 99, { cCodIntOP: 'NTBV-x', codigo_produto: 7, quantidade: 2, dData: '03/11/2026', obs: 'o', codigoLocalEstoque: null }, { concluida: true, agoraISO: '2026-11-03T10:00:00.000Z' })
  assert.equal(ok.concluida, true)
  assert.equal(ok.conclusao_status, undefined)
  assert.equal(ok.identificacao_codigo_local_estoque, undefined)
})
