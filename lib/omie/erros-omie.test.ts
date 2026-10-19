import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bloqueioDaResposta, segundosBloqueio, idAjusteExistente, ehCmcPendente, registrarBloqueio, msRestantesBloqueio, decidirErroItemInventario, classificarErroOmie, proximaTentativa, podeRepetirLimite, statusFalhaConclusaoOP, ehRecusaDoDisjuntor } from './erros-omie.ts'

test('segundosBloqueio extrai N de consumo indevido', () => {
  assert.equal(segundosBloqueio('ERROR: API bloqueada por consumo indevido. Tente novamente em 1678 segundos.'), 1678)
  assert.equal(segundosBloqueio('ERROR: Consumo redundante detectado. Aguarde 5 segundos'), null)
  assert.equal(segundosBloqueio('qualquer outra'), null)
})

test('idAjusteExistente extrai o ID do ajuste já lançado', () => {
  const msg = 'ERROR: Já existe um ajuste de estoque para o código de integração [ITEM8962] com o ID [8995630051] para o produto de código [123]'
  assert.equal(idAjusteExistente(msg), 8995630051)
  assert.equal(idAjusteExistente('ERROR: outra coisa'), null)
})

test('ehCmcPendente reconhece cálculo de CMC não concluído', () => {
  assert.equal(ehCmcPendente('ERROR: O cálculo do saldo de estoque e CMC do produto ainda não foi concluído para o local X'), true)
  assert.equal(ehCmcPendente('ERROR: outra'), false)
})

test('disjuntor: bloqueia por app_key até expirar', () => {
  registrarBloqueio('k1', 100, 1_000_000)
  assert.equal(msRestantesBloqueio('k1', 1_000_000), 100_000)
  assert.equal(msRestantesBloqueio('k2', 1_000_000), 0)
  assert.equal(msRestantesBloqueio('k1', 1_000_000 + 100_001), 0)
})

test('decidirErroItemInventario: ajuste já existente NÃO é adotado (ID do Omie pode ser de outro item) e sai do retry', () => {
  const r = decidirErroItemInventario('ERROR: Já existe um ajuste de estoque para o código de integração [ITEM1] com o ID [42] para o produto', undefined, 7, 30)
  assert.equal(r.status, 'Erro')
  assert.equal(r.tentativas, 30)
  assert.equal('id_ajuste' in r, false)
  assert.match(r.descricao_status, /42/)
})

test('decidirErroItemInventario: CMC pendente vira Sem CMC e conta tentativa', () => {
  const r = decidirErroItemInventario('ERROR: O cálculo do saldo de estoque e CMC do produto ainda não foi concluído para o local', undefined, 2, 30)
  assert.equal(r.status, 'Sem CMC')
  assert.equal(r.tentativas, 3)
})

test('decidirErroItemInventario: bloqueio não queima tentativa', () => {
  assert.equal(decidirErroItemInventario('qualquer', 'MISUSE_API_PROCESS', 5, 30).tentativas, 5)
  const r = decidirErroItemInventario('ERROR: API bloqueada por consumo indevido. Tente novamente em 10 segundos.', undefined, 5, 30)
  assert.equal(r.status, 'Erro')
  assert.equal(r.tentativas, 5)
})

test('decidirErroItemInventario: erro genérico vira Erro e conta tentativa', () => {
  const r = decidirErroItemInventario('ERROR: produto inativo', undefined, null, 30)
  assert.deepEqual(r, { status: 'Erro', tentativas: 1, descricao_status: 'ERROR: produto inativo' })
})

test('bloqueioDaResposta: segundos da msg, MISUSE sem segundos usa padrão, resto null', () => {
  assert.equal(bloqueioDaResposta('ERROR: API bloqueada por consumo indevido. Tente novamente em 300 segundos.', undefined), 300)
  assert.equal(bloqueioDaResposta('qualquer texto', 'MISUSE_API_PROCESS'), 900)
  assert.equal(bloqueioDaResposta('ERROR: produto inativo', 'SOAP-ENV:Client-5113'), null)
})

test('classificarErroOmie: casos reais do log de integracao', () => {
  assert.equal(classificarErroOmie('ERROR: Este produto não possui nenhum item na sua estrutura. Só é possível gerar uma Ordem de Produção de produtos com a estrutura preenchida.'), 'sem_estrutura')
  assert.equal(classificarErroOmie('ERROR: Consumo redundante detectado. Aguarde 49 segundos para tentar novamente (REDUNDANT).'), 'transitorio')
  assert.equal(classificarErroOmie('ERROR: Já existe uma requisição desse método sendo executada e você pode tentar novamente em alguns instantes. (1)'), 'transitorio')
  assert.equal(classificarErroOmie('Omie HTTP 418'), 'transitorio')
  assert.equal(classificarErroOmie('SOAP-ERROR: Internal Error [PBB]'), 'transitorio')
  assert.equal(classificarErroOmie('fetch failed'), 'transitorio')
  assert.equal(classificarErroOmie('ERROR: Já existe uma Ordem de Produção cadastrada com o Código de Integração [NTBV123]!'), 'ja_existe')
  assert.equal(classificarErroOmie('ERROR: Produto não cadastrado!'), 'permanente')
})

test('proximaTentativa: 10, 20, 40, 80, 120 min e para em 120', () => {
  const t0 = Date.UTC(2026, 8, 28, 12, 0, 0)
  const min = (n: number) => (new Date(proximaTentativa(n, t0)).getTime() - t0) / 60000
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(min), [10, 20, 40, 80, 120, 120])
})

test('podeRepetirLimite: até 2 repetições, nunca quando o chamador pede semRepetir (crons do espelho)', () => {
  assert.equal(podeRepetirLimite(0, false), true)
  assert.equal(podeRepetirLimite(1, false), true)
  assert.equal(podeRepetirLimite(2, false), false)
  assert.equal(podeRepetirLimite(0, true), false)
})

// 19/10/2026 (Sertão): o bloqueio do Omie é por IP + app_key + MÉTODO; o disjuntor travava a chave inteira.
test('disjuntor por método: bloquear ConcluirOrdemProducao não trava IncluirAjusteEstoque', () => {
  registrarBloqueio('kM', 1800, 5_000_000, 'ConcluirOrdemProducao')
  assert.equal(msRestantesBloqueio('kM', 5_000_000, 'ConcluirOrdemProducao'), 1_800_000)
  assert.equal(msRestantesBloqueio('kM', 5_000_000, 'IncluirAjusteEstoque'), 0)
  // sem método = algum método da chave bloqueado
  assert.equal(msRestantesBloqueio('kM', 5_000_000), 1_800_000)
  assert.equal(msRestantesBloqueio('kM', 5_000_000 + 1_800_001, 'ConcluirOrdemProducao'), 0)
})

test('erro permanente da conclusão de OP sai da repetição; CMC e transitório seguem', () => {
  assert.equal(statusFalhaConclusaoOP('[OP 1 criada, conclusão falhou] ERROR: Produto [Carnes p/ Baiao 50G (PI)] encontra-se inativo. Não é possível continuar com a operação.'), 'Precisa corrigir no Omie')
  assert.equal(statusFalhaConclusaoOP('ERROR: Este produto não possui nenhum item na sua estrutura.'), 'Precisa corrigir no Omie')
  assert.equal(statusFalhaConclusaoOP('ERROR: O seguinte produto da estrutura possui o CMC unitário zerado em 16/10/2026'), 'Sem CMC')
  assert.equal(statusFalhaConclusaoOP('ERROR: API bloqueada por consumo indevido. Tente novamente em 7 segundos.'), 'Erro')
  assert.equal(statusFalhaConclusaoOP('Omie não respondeu em 30s (ConcluirOrdemProducao). Tente novamente.'), 'Erro')
})

test('recusa do disjuntor local é reconhecida (não chegou no Omie)', () => {
  assert.equal(ehRecusaDoDisjuntor('API do Omie bloqueada para esta loja por consumo indevido (libera em ~30 min). Tente novamente depois.'), true)
  assert.equal(ehRecusaDoDisjuntor('[OP 5 criada, conclusão falhou] API do Omie bloqueada para esta loja por consumo indevido (libera em ~3 min).'), true)
  assert.equal(ehRecusaDoDisjuntor('ERROR: API bloqueada por consumo indevido. Tente novamente em 7 segundos.'), false)
})
