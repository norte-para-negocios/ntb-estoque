import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bloqueioDeEscrita, deltaDoAjuste, mesDoAjusteFechado, impactoCorrecaoCusto, validarCustoNovo, motivoNaoCorrige,
  codIntCorrecao, proximaEtapaCorrecao, montarTrocas, conferirAntesDaTroca, conferirTroca, intMalhaDaTroca, ehLimiteOmie,
  selecionarLoteOPs, saldoNoLocalDaOP, isoParaBR, type AjusteParaCorrigir,
} from './escrita-omie-puro.ts'

test('bloqueioDeEscrita: loja 4 e loja fora do modo omie são bloqueadas', () => {
  assert.match(bloqueioDeEscrita({ id: 4, modo: 'omie' }) ?? '', /loja 4/i)
  assert.match(bloqueioDeEscrita({ id: 5, modo: 'proprio' }) ?? '', /Omie/)
  assert.equal(bloqueioDeEscrita({ id: 5, modo: 'omie' }), null)
  assert.equal(bloqueioDeEscrita({ id: 10, modo: 'omie' }), null)
})

test('deltaDoAjuste: contagem vira ENT/SAI da diferença; diferença zero é erro', () => {
  assert.deepEqual(deltaDoAjuste({ modo: 'contagem', valor: 10, saldoAtual: 12 }), { tipo: 'SAI', quantidade: 2 })
  assert.deepEqual(deltaDoAjuste({ modo: 'contagem', valor: 5, saldoAtual: -3 }), { tipo: 'ENT', quantidade: 8 })
  assert.deepEqual(deltaDoAjuste({ modo: 'diferenca', valor: -1.5, saldoAtual: 99 }), { tipo: 'SAI', quantidade: 1.5 })
  assert.ok('erro' in deltaDoAjuste({ modo: 'contagem', valor: 7, saldoAtual: 7 }))
  assert.ok('erro' in deltaDoAjuste({ modo: 'diferenca', valor: Number.NaN, saldoAtual: 0 }))
  assert.ok('erro' in deltaDoAjuste({ modo: 'contagem', valor: -1, saldoAtual: 0 }))
  // ruído de ponto flutuante não vira ajuste
  assert.deepEqual(deltaDoAjuste({ modo: 'contagem', valor: 0.3, saldoAtual: 0.1 }), { tipo: 'ENT', quantidade: 0.2 })
})

test('mesDoAjusteFechado: antes do mês passado é fechado; config fecha mais', () => {
  assert.equal(mesDoAjusteFechado('2026-08-31', '2026-10-13'), true)
  assert.equal(mesDoAjusteFechado('2026-09-01', '2026-10-13'), false)
  assert.equal(mesDoAjusteFechado('2026-10-13', '2026-10-13'), false)
  assert.equal(mesDoAjusteFechado('2025-11-30', '2026-01-05'), true)
  assert.equal(mesDoAjusteFechado('2025-12-10', '2026-01-05'), false)
  assert.equal(mesDoAjusteFechado('2026-09-15', '2026-10-13', '2026-09'), true)
  assert.equal(mesDoAjusteFechado('2026-10-01', '2026-10-13', '2026-09'), false)
  assert.equal(mesDoAjusteFechado('2026-09-15', '2026-10-13', 'lixo'), false)
  assert.equal(mesDoAjusteFechado('lixo', '2026-10-13'), true) // data ilegível: trata como fechado (pede a 2ª confirmação)
})

test('impactoCorrecaoCusto: entrada muda o valor do estoque, saída o custo da saída', () => {
  assert.deepEqual(impactoCorrecaoCusto({ tipo: 'ENT', quantidade: 10, custoAtual: 2, custoNovo: 3 }),
    { quantidade: 10, valorAtual: 20, valorNovo: 30, diferenca: 10, efeitoNoEstoque: 10 })
  const s = impactoCorrecaoCusto({ tipo: 'SAI', quantidade: -10, custoAtual: 2, custoNovo: 3 })
  assert.equal(s.quantidade, 10)
  assert.equal(s.diferenca, 10)
  assert.equal(s.efeitoNoEstoque, -10)
  const r = impactoCorrecaoCusto({ tipo: 'ENT', quantidade: 3, custoAtual: 0.1, custoNovo: 0.2 })
  assert.equal(r.diferenca, 0.3)
})

test('validarCustoNovo: positivo, diferente do atual e plausível', () => {
  assert.ok(validarCustoNovo(0, 2))
  assert.ok(validarCustoNovo(-1, 2))
  assert.ok(validarCustoNovo(Number.NaN, 2))
  assert.ok(validarCustoNovo(2, 2))
  assert.ok(validarCustoNovo(1e7, 2))
  assert.equal(validarCustoNovo(2.5, 2), null)
})

const base: AjusteParaCorrigir = {
  tipo: 'ENT', id_ajuste: 123, transferencia_id: null, cod_int_ajuste: null, origem: 'AJU', motivo: 'ENT',
  origem_ajuste: 'omie', quan: 5, valor: 2, codigo_local_estoque: 7,
}
test('motivoNaoCorrige: só ENT/SAI com id, sem transferência, inventário ou PDV', () => {
  assert.equal(motivoNaoCorrige(base), null)
  assert.equal(motivoNaoCorrige({ ...base, tipo: 'SAI', cod_int_ajuste: 'MOV-9' }), null)
  assert.ok(motivoNaoCorrige({ ...base, tipo: 'TRF' }))
  assert.ok(motivoNaoCorrige({ ...base, tipo: 'SLD' }))
  assert.ok(motivoNaoCorrige({ ...base, id_ajuste: null }))
  assert.ok(motivoNaoCorrige({ ...base, id_ajuste: -5 })) // simulado da loja de teste? ainda sim corrige? não: id negativo só existe em teste
  assert.ok(motivoNaoCorrige({ ...base, transferencia_id: 3 }))
  assert.ok(motivoNaoCorrige({ ...base, cod_int_ajuste: 'ITEM123' }))
  assert.ok(motivoNaoCorrige({ ...base, origem: 'PDV' }))
  assert.ok(motivoNaoCorrige({ ...base, motivo: 'PDV' }))
  assert.ok(motivoNaoCorrige({ ...base, origem_ajuste: 'pdv' }))
  assert.ok(motivoNaoCorrige({ ...base, quan: 0 }))
  assert.ok(motivoNaoCorrige({ ...base, codigo_local_estoque: null }))
  assert.ok(motivoNaoCorrige({ ...base, cod_int_ajuste: 'CUSTO-4' }) === null)
})

test('motivoNaoCorrige: loja de teste aceita id negativo quando permitido', () => {
  assert.equal(motivoNaoCorrige({ ...base, id_ajuste: -5 }, { aceitaIdSimulado: true }), null)
})

test('codIntCorrecao e proximaEtapaCorrecao', () => {
  assert.equal(codIntCorrecao(42), 'CUSTO-42')
  const agora = Date.parse('2026-10-13T12:00:00Z')
  assert.equal(proximaEtapaCorrecao('pendente_relancar', '2026-10-13T11:59:00Z', agora), 'relancar')
  assert.equal(proximaEtapaCorrecao('relancando', '2026-10-13T11:55:00Z', agora), null)
  assert.equal(proximaEtapaCorrecao('relancando', '2026-10-13T11:45:00Z', agora), 'relancar')
  assert.equal(proximaEtapaCorrecao('excluindo', '2026-10-13T11:55:00Z', agora), null)
  assert.equal(proximaEtapaCorrecao('excluindo', '2026-10-13T11:40:00Z', agora), 'verificar_exclusao')
  assert.equal(proximaEtapaCorrecao('concluido', '2026-10-13T10:00:00Z', agora), null)
  assert.equal(proximaEtapaCorrecao('falha_exclusao', '2026-10-13T10:00:00Z', agora), null)
  assert.equal(proximaEtapaCorrecao('relancando', 'lixo', agora), 'relancar')
})

test('montarTrocas: qtd do prato ou fixa, marca quem já tem o novo, ignora quem não usa', () => {
  const itens = [
    { produto: 30, insumo: 1, quantidade: 0.35, perda: 0 },
    { produto: 10, insumo: 1, quantidade: 1, perda: 5 },
    { produto: 10, insumo: 9, quantidade: 2, perda: 0 },
    { produto: 20, insumo: 1, quantidade: 2, perda: 0 },
    { produto: 20, insumo: 2, quantidade: 1, perda: 0 },
    { produto: 40, insumo: 2, quantidade: 1, perda: 0 },
  ]
  assert.deepEqual(montarTrocas(itens, 1, 2, null), [
    { produto: 10, quantidadeAtual: 1, quantidadeNova: 1, perda: 5, jaTemNovo: false },
    { produto: 20, quantidadeAtual: 2, quantidadeNova: 2, perda: 0, jaTemNovo: true },
    { produto: 30, quantidadeAtual: 0.35, quantidadeNova: 0.35, perda: 0, jaTemNovo: false },
  ])
  assert.deepEqual(montarTrocas(itens, 1, 2, 0.5).map((t) => t.quantidadeNova), [0.5, 0.5, 0.5])
  assert.deepEqual(montarTrocas(itens, 1, 1, null), [])
  assert.deepEqual(montarTrocas(itens, 77, 2, null), [])
})

const lido = (idMalha: number, idProdMalha: number, quantProdMalha: number) => ({ idMalha, idProdMalha, quantProdMalha })
test('conferirAntesDaTroca: precisa do antigo 1x e do novo ausente', () => {
  const r = conferirAntesDaTroca([lido(100, 1, 1), lido(101, 9, 2)], 1, 2)
  assert.ok(r.ok && r.antigo.idMalha === 100)
  assert.equal(conferirAntesDaTroca([lido(101, 9, 2)], 1, 2).ok, false)
  assert.equal(conferirAntesDaTroca([lido(100, 1, 1), lido(102, 1, 3)], 1, 2).ok, false)
  assert.equal(conferirAntesDaTroca([lido(100, 1, 1), lido(103, 2, 1)], 1, 2).ok, false)
})

test('conferirTroca: incluído exige novo 1x com a qtd e antigo ainda lá; excluído exige antigo fora', () => {
  assert.equal(conferirTroca('incluido', [lido(100, 1, 1), lido(200, 2, 0.5)], 1, 2, 0.5).ok, true)
  assert.equal(conferirTroca('incluido', [lido(100, 1, 1)], 1, 2, 0.5).ok, false)
  assert.equal(conferirTroca('incluido', [lido(100, 1, 1), lido(200, 2, 0.4)], 1, 2, 0.5).ok, false)
  assert.equal(conferirTroca('incluido', [lido(100, 1, 1), lido(200, 2, 0.5), lido(201, 2, 0.5)], 1, 2, 0.5).ok, false)
  assert.equal(conferirTroca('incluido', [lido(200, 2, 0.5)], 1, 2, 0.5).ok, false)
  assert.equal(conferirTroca('excluido', [lido(200, 2, 0.5), lido(101, 9, 2)], 1, 2, 0.5).ok, true)
  assert.equal(conferirTroca('excluido', [lido(100, 1, 1), lido(200, 2, 0.5)], 1, 2, 0.5).ok, false)
  assert.equal(conferirTroca('excluido', [], 1, 2, 0.5).ok, false)
  assert.equal(conferirTroca('incluido', [lido(100, 1, 1), lido(200, 2, 0.30000000000000004)], 1, 2, 0.3).ok, true)
})

test('intMalhaDaTroca: curto, começa com TRC e muda a cada chamada', () => {
  const a = intMalhaDaTroca(1_760_000_000_000, 0.123)
  const b = intMalhaDaTroca(1_760_000_000_001, 0.123)
  assert.ok(a.startsWith('TRC') && a.length <= 20)
  assert.notEqual(a, b)
})

test('ehLimiteOmie', () => {
  assert.equal(ehLimiteOmie('MISUSE_API_PROCESS: bloqueado'), true)
  assert.equal(ehLimiteOmie('API do Omie bloqueada para esta loja por consumo indevido'), true)
  assert.equal(ehLimiteOmie('Consumo redundante detectado'), true)
  assert.equal(ehLimiteOmie('Já existe uma requisição desse método'), true)
  assert.equal(ehLimiteOmie('Produto não cadastrado'), false)
})

test('selecionarLoteOPs: só abertas com código, sem repetir, até o máximo', () => {
  const ops = [
    { id: 1, nCodOP: 11, aberta: true }, { id: 2, nCodOP: null, aberta: true }, { id: 3, nCodOP: 33, aberta: false },
    { id: 4, nCodOP: 44, aberta: true }, { id: 5, nCodOP: 55, aberta: true },
  ]
  const r = selecionarLoteOPs(ops, [1, 2, 3, 4, 4, 9, 5], 2)
  assert.deepEqual(r.validas, [1, 4])
  assert.deepEqual(r.ignoradas.map((i) => i.id), [2, 3, 4, 9, 5])
  assert.match(r.ignoradas.find((i) => i.id === 3)!.motivo, /não está mais aberta/)
  assert.match(r.ignoradas.find((i) => i.id === 9)!.motivo, /não encontrada/)
  assert.match(r.ignoradas.find((i) => i.id === 5)!.motivo, /limite/)
})

test('saldoNoLocalDaOP: saldo do local; sem local = total; local sem saldo = 0', () => {
  const locais = [{ codigoLocal: 1, saldo: -2 }, { codigoLocal: 2, saldo: 7 }]
  assert.equal(saldoNoLocalDaOP(locais, 1, 5), -2)
  assert.equal(saldoNoLocalDaOP(locais, null, 5), 5)
  assert.equal(saldoNoLocalDaOP(locais, 0, 5), 5)
  assert.equal(saldoNoLocalDaOP(locais, 3, 5), 0)
})

test('isoParaBR', () => {
  assert.equal(isoParaBR('2026-09-05'), '05/09/2026')
  assert.equal(isoParaBR('2026-09-05T00:00:00Z'), '05/09/2026')
})
