import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bloqueioEtapaPorOmie, codigoIntegracaoItem, codigoIntegracaoPedido, codigoOmieDoFornecedor, dataParaOmie, decidirFalhaPedido,
  ehPedidoJaExiste, ehPedidoNaoEncontrado, gravacaoPedidosOmieLigada, montarIncluirPedCompra, motivoSemGravacaoPedidoOmie,
  pedidoCompraNaLoja, pedidoIncluido, pedidoNtbDoCodigo, TETO_PERMANENTE, TETO_TRANSITORIO,
  inclusaoIncerta, incertoAposFalhaDaInclusao, payloadParaGuardar, payloadsDivergem, msBloqueioPersistido, JANELA_BLOQUEIO_PERSISTIDO_MS,
  type ConfigPedidoOmie, type PedidoParaOmie,
} from './pedido-omie-gravar-puro.ts'

const fx = JSON.parse(readFileSync(new URL('./fixtures/pedido-omie-c1.fixture.json', import.meta.url), 'utf8')) as {
  config: ConfigPedidoOmie; pedido: PedidoParaOmie; esperado: unknown
}
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const montar = (mut?: (p: PedidoParaOmie, c: ConfigPedidoOmie) => void) => {
  const p = copia(fx.pedido); const c = copia(fx.config)
  mut?.(p, c)
  return montarIncluirPedCompra(p, c)
}
const erros = (r: ReturnType<typeof montarIncluirPedCompra>) => ('erros' in r ? r.erros : [])

// ---------------------------------------------------------------- portões: desligado = exatamente como antes do C1
test('flag desligada por padrão: nenhuma loja grava, nem com opt-in', () => {
  for (const env of [{}, { OMIE_GRAVAR_PEDIDOS_COMPRA: '0' }, { OMIE_GRAVAR_PEDIDOS_COMPRA: 'true' }, { OMIE_LER_PEDIDOS_COMPRA: '1' }]) {
    assert.equal(gravacaoPedidosOmieLigada(env), false)
    for (const id of [2, 3, 5, 6]) assert.match(motivoSemGravacaoPedidoOmie(env, { id, modo: 'omie', optIn: true })!, /desligada/)
  }
})

test('flag desligada: pedido de compra só na loja de estoque próprio (regra de antes do C1)', () => {
  for (const modo of ['proprio', 'omie', 'nenhum', null]) {
    for (const optIn of [false, true]) {
      assert.equal(pedidoCompraNaLoja({}, { id: 2, modo, optIn }), modo === 'proprio' ? 'proprio' : null)
    }
  }
})

test('flag ligada fora da produção (NTB_AMBIENTE) não grava: o código NTB-PC-<id> colidiria com o banco de produção', () => {
  for (const amb of [undefined, '', 'dev', 'teste', 'PRODUCAO']) {
    const env = { OMIE_GRAVAR_PEDIDOS_COMPRA: '1', NTB_AMBIENTE: amb }
    assert.match(motivoSemGravacaoPedidoOmie(env, { id: 2, modo: 'omie', optIn: true })!, /NTB_AMBIENTE/)
    assert.equal(pedidoCompraNaLoja(env, { id: 2, modo: 'omie', optIn: true }), null)
  }
})

test('flag ligada: precisa do opt-in da loja, modo Omie, e loja 4 nunca', () => {
  const env = { OMIE_GRAVAR_PEDIDOS_COMPRA: '1', NTB_AMBIENTE: 'producao' }
  assert.equal(motivoSemGravacaoPedidoOmie(env, { id: 2, modo: 'omie', optIn: true }), null)
  assert.match(motivoSemGravacaoPedidoOmie(env, { id: 6, modo: 'omie', optIn: false })!, /liberada/)
  assert.match(motivoSemGravacaoPedidoOmie(env, { id: 4, modo: 'omie', optIn: true })!, /loja 4/)
  assert.match(motivoSemGravacaoPedidoOmie(env, { id: 15, modo: 'proprio', optIn: true })!, /estoque Omie/)
  assert.equal(pedidoCompraNaLoja(env, { id: 2, modo: 'omie', optIn: true }), 'omie')
  assert.equal(pedidoCompraNaLoja(env, { id: 2, modo: 'omie', optIn: false }), null)
  assert.equal(pedidoCompraNaLoja(env, { id: 15, modo: 'proprio', optIn: false }), 'proprio')
})

// ---------------------------------------------------------------- códigos de integração
test('código de integração: derivado só do id, cabe nos 20 caracteres do Omie e volta para o id', () => {
  assert.equal(codigoIntegracaoPedido(1532), 'NTB-PC-1532')
  assert.equal(codigoIntegracaoPedido(1532), codigoIntegracaoPedido(1532))
  assert.ok(codigoIntegracaoPedido(9_999_999_999_999).length <= 20)
  assert.ok(codigoIntegracaoItem(9_999_999_999_999, 300).length <= 20)
  assert.throws(() => codigoIntegracaoPedido(0))
  assert.equal(pedidoNtbDoCodigo('NTB-PC-1532'), 1532)
  assert.equal(pedidoNtbDoCodigo(' NTB-PC-7 '), 7)
  assert.equal(pedidoNtbDoCodigo('INT001'), null)
  assert.equal(pedidoNtbDoCodigo(''), null)
  assert.equal(pedidoNtbDoCodigo(undefined), null)
})

test('dataParaOmie', () => {
  assert.equal(dataParaOmie('2026-10-27'), '27/10/2026')
  assert.equal(dataParaOmie('2026-10-27T03:00:00Z'), '27/10/2026')
  assert.equal(dataParaOmie(null), null)
  assert.equal(dataParaOmie('27/10/2026'), null)
})

// ---------------------------------------------------------------- payload
test('fixture: IncluirPedCompra exatamente como esperado', () => {
  const r = montar()
  assert.ok('payload' in r, JSON.stringify(r))
  assert.deepEqual(r.payload, fx.esperado)
})

test('unidade de estoque: quantidade × fator e preço ÷ fator preservam o valor do item', () => {
  const r = montar()
  assert.ok('payload' in r)
  const [cx] = r.payload.produtos_incluir
  assert.equal(Math.round(cx.nQtde * cx.nValUnit * 100) / 100, 1078.2)
})

test('parcelas fecham com o total que o Omie calcula das linhas enviadas (nQtde × nValUnit arredondados)', () => {
  // 100.000 un. de 3 por R$ 10: nValUnit 3,333333 → o Omie soma 999.999,90, não 1.000.000,00
  const r = montar((p) => { p.itens = [{ ...p.itens[0], fator: 3, quantidade: 100_000, precoUnitario: 10, codigoLocal: null }]; p.frete = 0 })
  assert.ok('payload' in r)
  const [it] = r.payload.produtos_incluir
  const totalOmie = Math.round(it.nQtde * it.nValUnit * 100) / 100
  assert.equal(totalOmie, 999999.9)
  const soma = r.payload.parcelas_incluir!.reduce((a, x) => a + x.nValor, 0)
  assert.equal(Math.round(soma * 100) / 100, totalOmie)
})

test('sem parcelas, frete, categoria, contato: campos omitidos (Omie usa o padrão)', () => {
  const r = montar((p, c) => { p.parcelas = []; p.frete = 0; p.outrasDespesas = 0; p.contato = null; p.numeroFornecedor = ' '; p.obs = null; p.obsInterna = null; c.categoria = null })
  assert.ok('payload' in r)
  const cab = r.payload.cabecalho_incluir
  for (const k of ['cCodParc', 'nQtdeParc', 'cCodCateg', 'cContato', 'cNumPedido', 'cObs', 'cEmailAprovador', 'cCnpjCpfFor']) assert.equal(k in cab, false, k)
  assert.equal('frete_incluir' in r.payload, false)
  assert.equal('parcelas_incluir' in r.payload, false)
  assert.equal(cab.cObsInt, 'Pedido de compra nº 17 do Norte Estoque (NTB-PC-1532).')
})

test('e-mail do aprovador da loja vai no cabeçalho; outras despesas sozinhas abrem o bloco de frete', () => {
  const r = montar((p, c) => { c.emailAprovador = 'compras@loja.com.br'; p.frete = 0; p.outrasDespesas = 12.3 })
  assert.ok('payload' in r)
  assert.equal(r.payload.cabecalho_incluir.cEmailAprovador, 'compras@loja.com.br')
  assert.deepEqual(r.payload.frete_incluir, { nValFrete: 0, nValOutras: 12.3 })
})

test('itens na ordem da linha (nItemPed da NF-e = posição do item no pedido do Omie)', () => {
  const r = montar((p) => { p.itens.reverse() })
  assert.ok('payload' in r)
  assert.deepEqual(r.payload.produtos_incluir.map((i) => i.cCodIntItem), ['1532-1', '1532-2'])
})

test('fornecedor: código do Omie; faixa própria/planilha usa o CNPJ; sem os dois = erro', () => {
  const f = fx.pedido.fornecedor
  assert.equal(codigoOmieDoFornecedor(f), 3011223344)
  assert.equal(codigoOmieDoFornecedor({ ...f, codigoOmie: 8_000_000_000_001 }), null)
  assert.equal(codigoOmieDoFornecedor({ ...f, origem: 'planilha' }), null)
  assert.equal(codigoOmieDoFornecedor({ ...f, codigoOmie: null }), null)
  const r = montar((p) => { p.fornecedor.codigoOmie = 8_000_000_000_045; p.fornecedor.origem = 'sefaz' })
  assert.ok('payload' in r)
  assert.equal(r.payload.cabecalho_incluir.cCnpjCpfFor, '12345678000190')
  assert.equal('nCodFor' in r.payload.cabecalho_incluir, false)
  assert.match(erros(montar((p) => { p.fornecedor.codigoOmie = null; p.fornecedor.cnpj = null })).join(), /não tem cadastro no Omie/)
})

test('o que falta no NTB vira erro e nada é montado', () => {
  assert.match(erros(montar((p) => { p.previsaoEntrega = null })).join(), /previsão de entrega/)
  assert.match(erros(montar((p) => { p.etapa = 'rascunho' })).join(), /Só pedido aprovado/)
  assert.match(erros(montar((p) => { p.itens[0].produto = { existe: false, inativo: false } })).join(), /não está no cadastro do Omie/)
  assert.match(erros(montar((p) => { p.itens[0].produto = { existe: true, inativo: true } })).join(), /inativo/)
  assert.match(erros(montar((p) => { p.itens[0].codigoLocal = 123 })).join(), /local de estoque 123/)
  assert.match(erros(montar((p) => { p.itens = [] })).join(), /não tem itens/)
  assert.match(erros(montar((_p, c) => { c.categoria = 'Compras' })).join(), /Categoria/)
  assert.equal(erros(montar((p) => { p.previsaoEntrega = null; p.itens[1].codigoLocal = 9 })).length, 2)
})

test('textos cortados no limite do Omie', () => {
  const r = montar((p) => { p.contato = 'x'.repeat(150); p.numeroFornecedor = 'y'.repeat(40) })
  assert.ok('payload' in r)
  assert.equal(r.payload.cabecalho_incluir.cContato!.length, 100)
  assert.equal(r.payload.cabecalho_incluir.cNumPedido!.length, 30)
})

// ---------------------------------------------------------------- respostas e falhas
test('pedidoIncluido', () => {
  assert.deepEqual(pedidoIncluido({ nCodPed: 9988776655, cNumero: '000123', cCodStatus: '0' }), { nCodPed: 9988776655, numero: '000123' })
  assert.deepEqual(pedidoIncluido({ nCodPed: '42' }), { nCodPed: 42, numero: null })
  assert.equal(pedidoIncluido({}), null)
  assert.equal(pedidoIncluido(null), null)
})

test('ja existe / não encontrado', () => {
  assert.equal(ehPedidoJaExiste('Já existe um pedido de compra cadastrado com o Código de Integração [NTB-PC-1532]!'), true)
  assert.equal(ehPedidoJaExiste('Fornecedor não cadastrado'), false)
  assert.equal(ehPedidoNaoEncontrado('Pedido de compra não encontrado!'), true)
  assert.equal(ehPedidoNaoEncontrado('Não existem registros para a página [1]!'), true)
  assert.equal(ehPedidoNaoEncontrado('Too many requests'), false)
})

test('falha: recusa do disjuntor e bloqueio do Omie não contam tentativa e esperam o bloqueio', () => {
  const agora = Date.parse('2026-10-20T12:00:00Z')
  const d1 = decidirFalhaPedido('API do Omie bloqueada para esta loja por consumo indevido (libera em ~12 min). Tente novamente depois.', 'MISUSE_API_PROCESS', 2, agora)
  assert.equal(d1.status, 'pendente'); assert.equal(d1.tentativas, 2); assert.equal(d1.contaTentativa, false)
  assert.ok(Date.parse(d1.proximaTentativaEm!) - agora >= 600_000)
  const d2 = decidirFalhaPedido('A API foi bloqueada por consumo indevido. Aguarde 1800 segundos.', undefined, 0, agora)
  assert.equal(d2.tentativas, 0)
  assert.equal(Date.parse(d2.proximaTentativaEm!) - agora, 1_800_000)
})

test('falha: nunca repete em laço — sempre espaça e tem teto', () => {
  const agora = Date.parse('2026-10-20T12:00:00Z')
  // permanente (validação do Omie): sai da repetição em TETO_PERMANENTE tentativas
  let t = 0
  let d = decidirFalhaPedido('Produto [3155667788] não cadastrado!', 'SOAP-ENV:Client-103', t, agora)
  while (d.status === 'pendente') {
    assert.ok(Date.parse(d.proximaTentativaEm!) - agora >= 600_000)
    t = d.tentativas
    d = decidirFalhaPedido('Produto [3155667788] não cadastrado!', 'SOAP-ENV:Client-103', t, agora)
  }
  assert.equal(d.status, 'precisa_corrigir'); assert.equal(d.tentativas, TETO_PERMANENTE); assert.equal(d.proximaTentativaEm, null)
  // transitório (rede/timeout): mais folga, mesmo assim teto
  t = 0
  d = decidirFalhaPedido('Omie não respondeu em 30s (IncluirPedCompra). Tente novamente.', 'TIMEOUT', t, agora)
  let n = 1
  while (d.status === 'pendente') { t = d.tentativas; d = decidirFalhaPedido('fetch failed', undefined, t, agora); n++ }
  assert.equal(d.tentativas, TETO_TRANSITORIO); assert.equal(n, TETO_TRANSITORIO)
})

test('inclusão incerta: só falta de negócio do Omie garante que nada foi criado', () => {
  assert.equal(inclusaoIncerta('Omie não respondeu em 30s (IncluirPedCompra). Tente novamente.', 'TIMEOUT', true), true)
  assert.equal(inclusaoIncerta('fetch failed', undefined, false), true)
  assert.equal(inclusaoIncerta('Resposta do Omie sem nCodPed: {}', undefined, false), true)
  assert.equal(inclusaoIncerta('SOAP-ERROR: Internal Error', 'SOAP-ENV:Server', true), true)
  assert.equal(inclusaoIncerta('Produto [3155667788] não cadastrado!', 'SOAP-ENV:Client-103', true), false)
  assert.equal(inclusaoIncerta('Já existe um pedido de compra com o Código de Integração [NTB-PC-1]', 'SOAP-ENV:Client-102', true), false)
  assert.equal(inclusaoIncerta('A API foi bloqueada por consumo indevido. Aguarde 1800 segundos.', 'MISUSE_API_PROCESS', true), false)
  assert.equal(inclusaoIncerta('API do Omie bloqueada para esta loja por consumo indevido (libera em ~3 min).', 'MISUSE_API_PROCESS', true), false)
})

test('"já existe" sem a consulta achar o pedido continua incerto (cancelar/reabrir seguem travados)', () => {
  assert.equal(incertoAposFalhaDaInclusao('Já existe um pedido de compra cadastrado com o Código de Integração [NTB-PC-1]!', 'SOAP-ENV:Client-102', true), true)
  assert.equal(incertoAposFalhaDaInclusao('Produto [1] não cadastrado!', 'SOAP-ENV:Client-103', true), false)
  assert.equal(incertoAposFalhaDaInclusao('fetch failed', undefined, false), true)
})

test('payload guardado sem o e-mail do aprovador; divergência na adoção', () => {
  const r = montar((_p, c) => { c.emailAprovador = 'aprovador@loja.com.br' })
  assert.ok('payload' in r)
  const g = payloadParaGuardar(r.payload)
  assert.equal(JSON.stringify(g).includes('aprovador@loja.com.br'), false)
  assert.equal(r.payload.cabecalho_incluir.cEmailAprovador, 'aprovador@loja.com.br')  // o original não muda
  assert.equal(payloadsDivergem(g, r.payload), false)
  const r2 = montar((p, c) => { c.emailAprovador = 'aprovador@loja.com.br'; p.itens[1].quantidade = 41 })
  assert.ok('payload' in r2)
  assert.equal(payloadsDivergem(g, r2.payload), true)
  assert.equal(payloadsDivergem(null, r.payload), true)
})

test('bloqueio do Omie gravado no banco vale por 35 min a partir do registro', () => {
  const agora = Date.parse('2026-10-20T12:00:00Z')
  assert.equal(msBloqueioPersistido('2026-10-20T11:30:00Z', agora), 5 * 60_000)
  assert.equal(msBloqueioPersistido(new Date(agora - JANELA_BLOQUEIO_PERSISTIDO_MS - 1).toISOString(), agora), 0)
  assert.equal(msBloqueioPersistido(null, agora), 0)
  assert.equal(msBloqueioPersistido('lixo', agora), 0)
})

test('etapa: pedido já no Omie não reabre nem cancela no NTB', () => {
  assert.match(bloqueioEtapaPorOmie('cancelar', 'pendente', null, true)!, /Conferir no Omie/)
  assert.match(bloqueioEtapaPorOmie('reabrir', 'precisa_corrigir', null, true)!, /Conferir no Omie/)
  assert.equal(bloqueioEtapaPorOmie('reabrir', 'precisa_corrigir', null, false), null)
  assert.match(bloqueioEtapaPorOmie('cancelar', 'enviado', '000123')!, /nº 000123/)
  assert.match(bloqueioEtapaPorOmie('reabrir', 'enviando')!, /agora/)
  assert.equal(bloqueioEtapaPorOmie('reabrir', 'pendente'), null)
  assert.equal(bloqueioEtapaPorOmie('cancelar', 'precisa_corrigir'), null)
  assert.equal(bloqueioEtapaPorOmie('aprovar', 'enviado'), null)
  assert.equal(bloqueioEtapaPorOmie('cancelar', null), null)
})
