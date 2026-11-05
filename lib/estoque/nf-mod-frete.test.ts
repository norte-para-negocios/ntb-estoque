import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configInicialItem, flagsDeTexto, flagsParaTexto, freteEntraNoCusto, aplicarModFrete, previaCustoItem } from './nf-item-regras.ts'

// Decisão do dono e do Ramon (05/11/2026): frete e outras despesas só entram no custo quando o frete foi pago por nós,
// pelo modFrete do XML (transp/modFrete).
test('freteEntraNoCusto: 1 (FOB) e 4 (próprio do destinatário) entram; 0, 2, 3 e 9 não; sem modFrete = sem regra', () => {
  assert.equal(freteEntraNoCusto('1'), true)
  assert.equal(freteEntraNoCusto('4'), true)
  for (const m of ['0', '2', '3', '9']) assert.equal(freteEntraNoCusto(m), false, m)
  assert.equal(freteEntraNoCusto(null), null)
  assert.equal(freteEntraNoCusto(''), null)
  assert.equal(freteEntraNoCusto('7'), null)
})

test('aplicarModFrete mexe só nas marcações Frete e Outras; manual é exceção e não muda', () => {
  const base = flagsDeTexto('NNNNNNNN')!
  assert.equal(flagsParaTexto(aplicarModFrete(base, 'regra', '1')), 'NNNNNNSS')
  assert.equal(flagsParaTexto(aplicarModFrete(flagsDeTexto('SSSSSSSS')!, 'produto', '0')), 'SSSSSSNN')
  assert.equal(flagsParaTexto(aplicarModFrete(base, 'manual', '1')), 'NNNNNNNN')
  assert.equal(flagsParaTexto(aplicarModFrete(flagsDeTexto('SSSNSSNN')!, 'padrao', null)), 'SSSNSSNN')
})

test('item CST 60 com FOB: antes ficava NNNNNNNN (frete fora); agora o frete entra sem ninguém marcar', () => {
  const c = configInicialItem({
    item: { cfop: '5405', valorTotalItem: 110, fiscal: { cst: '60', csosn: null } }, crt: '3', finalidade: '1',
    memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'UN', localNota: 10, modFrete: '1',
  })
  assert.equal(flagsParaTexto(c.flags), 'NNNNNNSS')
  assert.equal(c.origemFlags, 'regra')
  // 10 un a R$ 10 + R$ 10 de frete: o custo unitário passa a ser R$ 11
  const p = previaCustoItem({ quantidadeNota: 10, precoUnit: 10, valorTotalItem: 110, desconto: 0, ipi: 0, st: 0, icms: 0, frete: 10, seguro: 0, freteCte: 0, flags: c.flags, aliqCredPis: 0, aliqCredCofins: 0, quantidadeRecebida: 10 })
  assert.equal(p.custoUnitario, 11)
})

test('CIF (0): frete separado não soma, mesmo se a memória do produto dizia frete = S', () => {
  const c = configInicialItem({
    item: { cfop: '5102', valorTotalItem: 110, fiscal: { cst: '00', csosn: null } }, crt: '3', finalidade: '1',
    memoriaProduto: { flags: 'NNNNNNSS', cfopEntrada: null, codigoLocal: null }, memoriaFornecedor: null, unidadeProduto: 'UN', localNota: 10, modFrete: '0',
  })
  assert.equal(flagsParaTexto(c.flags), 'NNNNNNNN')
  const p = previaCustoItem({ quantidadeNota: 10, precoUnit: 10, valorTotalItem: 110, desconto: 0, ipi: 0, st: 0, icms: 0, frete: 10, seguro: 0, freteCte: 0, flags: c.flags, aliqCredPis: 0, aliqCredCofins: 0, quantidadeRecebida: 10 })
  assert.equal(p.custoUnitario, 10)
})

test('sem modFrete (compra manual, XML sem transp) o comportamento é o de antes', () => {
  const c = configInicialItem({
    item: { cfop: '5405', valorTotalItem: 110, fiscal: { cst: '60', csosn: null } }, crt: '3', finalidade: '1',
    memoriaProduto: null, memoriaFornecedor: null, unidadeProduto: 'UN', localNota: 10,
  })
  assert.equal(flagsParaTexto(c.flags), 'NNNNNNNN')
})
