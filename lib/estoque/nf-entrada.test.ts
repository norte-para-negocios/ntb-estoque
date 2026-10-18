// Revisão final da Fase B: decisões da entrada da nota própria (confirmar, desfazer e entrar de novo, upload do XML).
// Puras + checagem do código das actions (padrão de nf-despacho.test.ts). Valores: TEQUILA PRATA da NF 189215.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decidirConfirmacaoEntrada, decidirLancamentoNaGravacao, refBaseDaEntrada, refsDaEntrada, resultadoLancamento } from './nf-entrada.ts'

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
function corpoDe(src: string, nome: string): string {
  const i = src.indexOf(`export async function ${nome}(`)
  assert.ok(i >= 0, `função ${nome} não encontrada`)
  const prox = src.indexOf('\nexport async function ', i + 10)
  return src.slice(i, prox < 0 ? undefined : prox)
}

const PRATA = [{ linha: 5, alertas: [{ tipo: 'fator_suspeito' as const, texto: 'Fator suspeito: 1 UND8 = 1 ML.' }, { tipo: 'custo_fora' as const, texto: 'custo por ML 750×' }] }]
const SO_INFO = [{ linha: 1, alertas: [{ tipo: 'recebido_menor' as const, texto: 'Recebeu 37,9 de 40,9 KG' }] }]

test('confirmar entrada com aviso de custo/fator exige "Conferi os avisos" ou a nota conferida (TEQUILA PRATA)', () => {
  assert.deepEqual(decidirConfirmacaoEntrada(PRATA, { conferida: false, aceitarAvisos: false }), { error: 'Há avisos de custo ou quantidade: confira e marque "Conferi os avisos".' })
  assert.deepEqual(decidirConfirmacaoEntrada(PRATA, { conferida: false, aceitarAvisos: true }), { ok: true, aceitos: [{ linha: 5, tipo: 'fator_suspeito' }, { linha: 5, tipo: 'custo_fora' }] })
  // conferida depois da última mudança de item (configurar/vincular zeram conferida_em): os avisos já foram aceitos lá
  assert.deepEqual(decidirConfirmacaoEntrada(PRATA, { conferida: true, aceitarAvisos: false }), { ok: true, aceitos: [] })
  assert.deepEqual(decidirConfirmacaoEntrada(SO_INFO, { conferida: false, aceitarAvisos: false }), { ok: true, aceitos: [] })
})

test('upload do XML / SEFAZ: item com aviso de custo/fator não entra sozinho; compra reaberta só pelo "Confirmar entrada"', () => {
  const base = { automatico: false, lancarParcial: true, casados: 2, alertasItens: [] as typeof PRATA, statusCompra: 'pendente', reaberta: false, temLocal: true }
  assert.deepEqual(decidirLancamentoNaGravacao(base), { lancar: true, retida: null })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, alertasItens: PRATA }), { lancar: false, retida: 'avisos' })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, alertasItens: SO_INFO }), { lancar: true, retida: null })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, reaberta: true }), { lancar: false, retida: 'reaberta' })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, lancarParcial: false, automatico: true, reaberta: true }), { lancar: false, retida: 'reaberta' })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, lancarParcial: false }), { lancar: false, retida: null })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, casados: 0 }), { lancar: false, retida: null })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, statusCompra: 'lancada' }), { lancar: false, retida: null })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, temLocal: false }), { lancar: false, retida: null })
  assert.deepEqual(decidirLancamentoNaGravacao({ ...base, lancarParcial: false, automatico: true }), { lancar: true, retida: null })
})

test('resultado do lancar_compra: recusada/cancelada viram erro (sem "0 itens entraram")', () => {
  assert.deepEqual(resultadoLancamento({ ok: false, status: 'recusada', lancados: 0, pendentes: 0, motivo: 'operação recusada na SEFAZ' }),
    { error: 'A operação foi recusada na SEFAZ (desconhecimento ou operação não realizada): a nota não entra no estoque.' })
  assert.deepEqual(resultadoLancamento({ ok: false, status: 'cancelada', lancados: 0, pendentes: 0, motivo: 'nota cancelada na SEFAZ' }),
    { error: 'Nota cancelada na SEFAZ: não entra no estoque.' })
  assert.deepEqual(resultadoLancamento({ ok: false, status: 'pendente', lancados: 0, pendentes: 1, motivo: 'outro' }), { error: 'A entrada não foi feita: outro.' })
  assert.deepEqual(resultadoLancamento({ ok: true, status: 'parcial', lancados: 2, pendentes: 1 }), { ok: true, status: 'parcial', lancados: 2, pendentes: 1 })
})

test('refs da entrada no ledger: uma por ciclo (desfeita e confirmada de novo)', () => {
  assert.deepEqual(refsDaEntrada('CH', 7, 0), ['CH', 'compra:7'])
  assert.deepEqual(refsDaEntrada('CH', 7, 2), ['CH', 'compra:7', 'CH#2', 'compra:7#2', 'CH#3', 'compra:7#3'])
  assert.deepEqual(refsDaEntrada(null, 7, 1), ['compra:7', 'compra:7#2'])
  assert.equal(refBaseDaEntrada('CH#3'), 'CH')
  assert.equal(refBaseDaEntrada('compra:7#2'), 'compra:7')
  assert.equal(refBaseDaEntrada('CH'), 'CH')
})

test('confirmarEntradaNF: refaz os avisos no servidor ANTES do lançamento e trata a recusa antes da auditoria', () => {
  const src = ler('lib/actions/nota-fiscal-proprio.ts')
  const corpo = corpoDe(src, 'confirmarEntradaNF')
  // avisosDosItens = a mesma conta da tela e do marcarConferidaNF (avaliarItemCompra nas linhas gravadas)
  const ajuda = src.slice(src.indexOf('async function avisosDosItens('), src.indexOf('\n}\n', src.indexOf('async function avisosDosItens(')))
  assert.ok(/avaliarItemCompra\(/.test(ajuda), 'avisosDosItens não usa avaliarItemCompra')
  assert.ok(/avisosDosItens\(/.test(corpoDe(src, 'marcarConferidaNF')), 'marcarConferidaNF e confirmar usam contas diferentes')
  const iAval = corpo.indexOf('avisosDosItens('), iDec = corpo.indexOf('decidirConfirmacaoEntrada('), iRpc = corpo.indexOf("rpc('lancar_compra'")
  assert.ok(iAval >= 0 && iDec > iAval && iRpc > iDec, 'avisos não são refeitos no servidor antes do lancar_compra')
  const iRes = corpo.indexOf('resultadoLancamento('), iAud = corpo.indexOf("registrarAuditoria('concluir'")
  assert.ok(iRes > iRpc && iAud > iRes, 'recusa não é tratada antes da auditoria')
  assert.ok(!/status === 'cancelada'\) return \{ error: 'A entrada desta nota foi desfeita/.test(corpo), 'nota desfeita ainda não pode entrar de novo')
})

test('gravarNotaCompleta usa decidirLancamentoNaGravacao (upload e SEFAZ) e excluir fecha a compra', () => {
  const src = ler('lib/estoque/nf-sefaz.ts')
  const i = src.indexOf('decidirLancamentoNaGravacao('), iRpc = src.indexOf("rpc('lancar_compra'")
  assert.ok(i >= 0 && iRpc > i, 'lançamento na gravação sem a decisão')
  const exc = corpoDe(ler('lib/actions/nota-fiscal-proprio.ts'), 'excluirNotaProprio')
  assert.ok(/status: 'cancelada'/.test(exc), 'nota excluída precisa fechar a compra (não reabrir)')
})
