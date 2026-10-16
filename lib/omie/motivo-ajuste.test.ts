// Motivo do IncluirAjusteEstoque (15/10/2026): o ajuste manual (Zerar, saldo contado e diferença da Central e de
// /estoque, entrada pela tela, Nova movimentação) mandava motivo = tipo ("SAI"/"ENT") e o Omie recusava
// ("O preenchimento inválido da tag [motivo]! Valores permitidos: 'INV', 'OPS', 'PER', 'PDV'"). Linha real:
// movimentos 1323129 (loja 5, azeitona 80203), presa no retry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MOTIVO_AJUSTE_MANUAL, decidirReenvioAjusteManual, motivoAjusteValido, motivoOmieDoAjuste } from './motivo-ajuste.ts'

const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const semComentarios = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

function corpoDe(src: string, nome: string): string {
  const i = src.indexOf(`export async function ${nome}(`)
  assert.ok(i >= 0, `função ${nome} não encontrada`)
  const prox = src.indexOf('\nexport async function ', i + 10)
  return src.slice(i, prox < 0 ? undefined : prox)
}

test('motivo manual é INV (o mesmo que a faxina usa em produção)', () => {
  assert.equal(MOTIVO_AJUSTE_MANUAL, 'INV')
})

test('motivoAjusteValido segue a lista da API do Omie por tipo', () => {
  for (const m of ['INV', 'PER', 'OPS', 'PDV']) assert.equal(motivoAjusteValido('SAI', m), true, `SAI ${m}`)
  for (const m of ['INV', 'OPE', 'PDV', 'INI']) assert.equal(motivoAjusteValido('ENT', m), true, `ENT ${m}`)
  assert.equal(motivoAjusteValido('SAI', 'SAI'), false)
  assert.equal(motivoAjusteValido('ENT', 'ENT'), false)
  assert.equal(motivoAjusteValido('ENT', 'OPS'), false) // OPS só vale para saída
  assert.equal(motivoAjusteValido('SAI', 'OPE'), false) // OPE só vale para entrada
  assert.equal(motivoAjusteValido('ENT', 'TRF'), false) // TRF só em transferência
  assert.equal(motivoAjusteValido('SAI', null), false)
  assert.equal(motivoAjusteValido('SAI', ''), false)
})

test('motivoOmieDoAjuste nunca devolve o tipo: inválido/vazio vira INV, válido fica', () => {
  assert.equal(motivoOmieDoAjuste('SAI', 'SAI'), 'INV')
  assert.equal(motivoOmieDoAjuste('ENT', 'ENT'), 'INV')
  assert.equal(motivoOmieDoAjuste('SAI', null), 'INV')
  assert.equal(motivoOmieDoAjuste('ENT', undefined), 'INV')
  assert.equal(motivoOmieDoAjuste('ENT', 'TRF'), 'INV')
  assert.equal(motivoOmieDoAjuste('SAI', 'PDV'), 'PDV')
  assert.equal(motivoOmieDoAjuste('SAI', 'PER'), 'PER')
  assert.equal(motivoOmieDoAjuste('ENT', 'INI'), 'INI')
})

test('reenvio: linha com motivo válido vai ao Omie', () => {
  assert.deepEqual(decidirReenvioAjusteManual({ tipo: 'SAI', motivo: 'INV', tentativas: 3 }, 30), { acao: 'enviar' })
  assert.deepEqual(decidirReenvioAjusteManual({ tipo: 'SAI', motivo: 'PDV', tentativas: 0 }, 30), { acao: 'enviar' })
})

test('reenvio: linha antiga com motivo inválido (gravado = tipo) é encerrada sem ir ao Omie', () => {
  const d = decidirReenvioAjusteManual({ tipo: 'SAI', motivo: 'SAI', tentativas: 9 }, 30)
  assert.equal(d.acao, 'encerrar')
  if (d.acao !== 'encerrar') return
  assert.equal(d.status, 'Erro')
  assert.equal(d.tentativas, 30) // teto: as queries do retry usam tentativas < teto
  assert.match(d.descricao_status, /não foi reenviad/i)
  assert.match(d.descricao_status, /SAI/)
  // nunca diminui tentativas já acima do teto
  const acima = decidirReenvioAjusteManual({ tipo: 'ENT', motivo: 'ENT', tentativas: 45 }, 30)
  assert.equal(acima.acao === 'encerrar' && acima.tentativas, 45)
})

test('reenvio-manual: o payload usa motivoOmieDoAjuste e não cai mais no tipo', () => {
  const src = semComentarios(ler('lib/movimentos/reenviar-manual.ts'))
  assert.ok(src.includes('motivoOmieDoAjuste(mov.tipo, mov.motivo)'), 'payload sem motivoOmieDoAjuste')
  assert.ok(!/:\s*mov\.tipo,?\s*\n?\s*}/.test(src) && !/\?\s*mov\.motivo\s*:\s*mov\.tipo/.test(src), 'ainda cai no tipo')
})

test('criarAjusteManual grava e manda o motivo INV, não o tipo', () => {
  const corpo = semComentarios(corpoDe(ler('lib/actions/movimentacoes.ts'), 'criarAjusteManual'))
  assert.ok(!/motivo:\s*input\.tipo/.test(corpo), 'ainda grava motivo = tipo')
  assert.equal((corpo.match(/motivo:\s*MOTIVO_AJUSTE_MANUAL/g) ?? []).length, 2, 'insert e envio na hora devem usar MOTIVO_AJUSTE_MANUAL')
})

test('retry do manual decide (enviar/encerrar) antes de chamar o Omie', () => {
  const corpo = semComentarios(corpoDe(ler('lib/actions/movimentacoes.ts'), 'retryMovimentosManuaisPendentes'))
  const iDecide = corpo.indexOf('decidirReenvioAjusteManual(')
  const iEnvio = corpo.indexOf('reenviarMovimentoManual(')
  assert.ok(iDecide >= 0, 'retry não decide o reenvio')
  assert.ok(iDecide < iEnvio, 'decide depois de enviar')
})

test('correção de custo relança com motivoOmieDoAjuste, não com o tipo', () => {
  const src = semComentarios(ler('lib/actions/estoque-omie.ts'))
  assert.ok(!/\?\s*c\.motivo\s*:\s*c\.tipo/.test(src), 'ainda cai no tipo')
  assert.ok(src.includes('motivoOmieDoAjuste(c.tipo, c.motivo)'))
})
