// Motivo do IncluirAjusteEstoque (15/10/2026): o ajuste manual (Zerar, saldo contado e diferença da Central e de
// /estoque, entrada pela tela, Nova movimentação) mandava motivo = tipo ("SAI"/"ENT") e o Omie recusava
// ("O preenchimento inválido da tag [motivo]! Valores permitidos: 'INV', 'OPS', 'PER', 'PDV'"). Linha real:
// movimentos 1323129 (loja 5, azeitona 80203), presa no retry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MOTIVO_AJUSTE_MANUAL, decidirReenvioAjusteManual, encerrarOuEnviarAjusteManual, motivoAjusteValido, motivoOmieDoAjuste } from './motivo-ajuste.ts'

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

test('correção de custo relança com motivoOmieDoAjuste, não com o tipo', () => {
  const src = semComentarios(ler('lib/actions/estoque-omie.ts'))
  assert.ok(!/\?\s*c\.motivo\s*:\s*c\.tipo/.test(src), 'ainda cai no tipo')
  assert.ok(src.includes('motivoOmieDoAjuste(c.tipo, c.motivo)'))
})

// Comportamento do retry (revisão 15/10): a decisão sozinha não basta, o que trava a 1323129 é o retry NÃO chamar o
// envio quando encerra. Fakes no lugar do supabase/Omie; mutações "nunca encerrar" e "encerrar e enviar mesmo assim"
// precisam quebrar estes testes.
function fakesRetry() {
  const gravados: { id: number; patch: Record<string, unknown> }[] = []
  const enviados: { id: number; motivo: string | null | undefined }[] = []
  return {
    gravados,
    enviados,
    deps: {
      gravarEncerramento: async (id: number, patch: Record<string, unknown>) => {
        gravados.push({ id, patch })
        return { error: null }
      },
      enviar: async (mov: { id: number; motivo: string | null | undefined }) => {
        enviados.push({ id: mov.id, motivo: mov.motivo })
        return { status: 'Concluido' }
      },
    },
  }
}

test('retry: linha com motivo SAI (caso 1323129) é encerrada no teto e o Omie NÃO é chamado', async () => {
  const f = fakesRetry()
  const r = await encerrarOuEnviarAjusteManual({ id: 1323129, tipo: 'SAI', motivo: 'SAI', tentativas: 9 }, 30, f.deps)
  assert.equal(r.resultado, 'encerrada')
  assert.equal(f.enviados.length, 0, 'não pode ir ao Omie')
  assert.equal(f.gravados.length, 1)
  assert.equal(f.gravados[0].id, 1323129)
  assert.equal(f.gravados[0].patch.tentativas, 30)
  assert.equal(f.gravados[0].patch.status, 'Erro')
})

test('retry: linha com motivo ENT também é encerrada sem envio', async () => {
  const f = fakesRetry()
  const r = await encerrarOuEnviarAjusteManual({ id: 7, tipo: 'ENT', motivo: 'ENT', tentativas: 0 }, 30, f.deps)
  assert.equal(r.resultado, 'encerrada')
  assert.equal(f.enviados.length, 0)
})

test('retry: linha com motivo INV é enviada e não é encerrada', async () => {
  const f = fakesRetry()
  const r = await encerrarOuEnviarAjusteManual({ id: 8, tipo: 'SAI', motivo: 'INV', tentativas: 2 }, 30, f.deps)
  assert.equal(r.resultado, 'sucesso')
  assert.deepEqual(f.enviados, [{ id: 8, motivo: 'INV' }])
  assert.equal(f.gravados.length, 0)
})

test('retry: envio recusado conta como falha; erro ao gravar encerramento conta como falha e não envia', async () => {
  const f = fakesRetry()
  const r1 = await encerrarOuEnviarAjusteManual({ id: 9, tipo: 'SAI', motivo: 'INV', tentativas: 0 }, 30, {
    ...f.deps,
    enviar: async () => ({ status: 'Erro' }),
  })
  assert.equal(r1.resultado, 'falha')
  const r2 = await encerrarOuEnviarAjusteManual({ id: 10, tipo: 'SAI', motivo: 'SAI', tentativas: 0 }, 30, {
    ...f.deps,
    gravarEncerramento: async () => ({ error: { message: 'boom' } }),
  })
  assert.equal(r2.resultado, 'falha')
  assert.match(r2.erro ?? '', /boom/)
  assert.equal(f.enviados.length, 0)
})

test('retryMovimentosManuaisPendentes passa por encerrarOuEnviarAjusteManual e não chama o envio por fora', () => {
  const corpo = semComentarios(corpoDe(ler('lib/actions/movimentacoes.ts'), 'retryMovimentosManuaisPendentes'))
  assert.ok(corpo.includes('encerrarOuEnviarAjusteManual('), 'retry não usa o helper testado')
  assert.equal((corpo.match(/reenviarMovimentoManual\(/g) ?? []).length, 1, 'envio fora do helper')
  const iHelper = corpo.indexOf('encerrarOuEnviarAjusteManual(')
  const iEnvio = corpo.indexOf('reenviarMovimentoManual(')
  assert.ok(iEnvio > iHelper, 'o envio deve estar dentro do deps.enviar do helper')
})
