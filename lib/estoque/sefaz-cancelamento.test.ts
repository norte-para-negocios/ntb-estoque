import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore: import com .ts exigido pelo node --test
import { marcarCanceladaNaSefaz } from './sefaz-cancelamento.ts'

const rpcQue = (resp: { data: unknown; error: { message: string } | null }) => {
  const chamadas: { nome: string; args: Record<string, unknown> }[] = []
  const rpc = async (nome: string, args: Record<string, unknown>) => { chamadas.push({ nome, args }); return resp }
  return { rpc, chamadas }
}

test('erro do banco no cancelamento sobe (o documento não pode ser marcado como processado)', async () => {
  const { rpc } = rpcQue({ data: null, error: { message: 'deadlock detected' } })
  await assert.rejects(() => marcarCanceladaNaSefaz(rpc, 15, '1'.repeat(44)), /cancelamento da nota na SEFAZ: deadlock detected/)
})

test('resposta do banco volta normalizada, inclusive estorno pendente (mês fechado ou devolução ativa)', async () => {
  const { rpc, chamadas } = rpcQue({ data: { ok: true, nota: true, estornada: false, estorno_pendente: true, mes_fechado: false }, error: null })
  const r = await marcarCanceladaNaSefaz(rpc, 15, '2'.repeat(44))
  assert.deepEqual(r, { nota: true, estornada: false, estornoPendente: true, mesFechado: false })
  assert.deepEqual(chamadas, [{ nome: 'sefaz_marcar_cancelada', args: { p_loja: 15, p_chave: '2'.repeat(44) } }])
})

test('resposta antiga (sem os campos novos) não quebra', async () => {
  const { rpc } = rpcQue({ data: { ok: true, nota: false, estornada: true }, error: null })
  assert.deepEqual(await marcarCanceladaNaSefaz(rpc, 15, '3'.repeat(44)), { nota: false, estornada: true, estornoPendente: false, mesFechado: false })
})
