import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarTitulosDaCompraManual } from './compra-manual-titulos.ts'

type Chamada = { fn: string; args: Record<string, unknown> }
function clienteFalso(resp: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const chamadas: Chamada[] = []
  return {
    chamadas,
    rpc: async (fn: string, args: Record<string, unknown>) => { chamadas.push({ fn, args }); return { data: resp[fn]?.data ?? null, error: resp[fn]?.error ?? null } },
  }
}

test('F-01: depois de gravar o vínculo da nota, chama a geração da conta a pagar da nota', async () => {
  const c = clienteFalso({ fin_titulos_da_nota_gerar: { data: { ok: true, gerados: 1 } } })
  const r = await gerarTitulosDaCompraManual(c, 19, 77)
  assert.deepEqual(r, { ok: true, gerados: 1 })
  assert.equal(c.chamadas.length, 1)
  assert.equal(c.chamadas[0].fn, 'fin_titulos_da_nota_gerar')
  assert.equal(c.chamadas[0].args.p_loja, 19)
  assert.equal(c.chamadas[0].args.p_nota, 77)
})

test('F-01: loja com a chave desligada devolve 0 gerados e não é erro', async () => {
  const c = clienteFalso({ fin_titulos_da_nota_gerar: { data: { ok: true, gerados: 0, motivo: 'não ligada' } } })
  assert.deepEqual(await gerarTitulosDaCompraManual(c, 15, 9), { ok: true, gerados: 0 })
  assert.equal(c.chamadas.length, 1)
})

test('F-01: falha na geração nunca derruba a entrada, mas deixa o motivo no registro do financeiro', async () => {
  const c = clienteFalso({ fin_titulos_da_nota_gerar: { error: { message: 'Nota sem CNPJ' } } })
  const r = await gerarTitulosDaCompraManual(c, 19, 77)
  assert.deepEqual(r, { ok: false, erro: 'Nota sem CNPJ' })
  const ev = c.chamadas.find((x) => x.fn === 'fin_registrar_evento')
  assert.ok(ev, 'registra o evento titulos_falha')
  assert.equal(ev.args.p_tipo, 'titulos_falha')
  assert.equal(ev.args.p_entidade, 'nota_entrada')
  assert.equal(ev.args.p_id, 77)
})

test('F-01: exceção do cliente também é contida', async () => {
  const c = { rpc: async () => { throw new Error('rede caiu') } }
  assert.deepEqual(await gerarTitulosDaCompraManual(c, 19, 5), { ok: false, erro: 'rede caiu' })
})
