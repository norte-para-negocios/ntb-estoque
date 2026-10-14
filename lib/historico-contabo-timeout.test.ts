// I4 (revisão final da Central): com o Contabo travado, a Central e a busca rápida desistem rápido (sem 3 × 20 s).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { buscarFrioTudo } from './historico-contabo.ts'

test('buscarFrioTudo com timeout curto e 1 tentativa desiste em menos de 1 s e avisa', { timeout: 8000 }, async () => {
  const srv = createServer((_req, res) => { setTimeout(() => { res.end('{"rows":[]}') }, 4000) })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const porta = (srv.address() as { port: number }).port
  process.env.NTB_FRIO_API_URL = `http://127.0.0.1:${porta}`
  process.env.NTB_FRIO_API_KEY = 'x'
  let truncado = false
  const t0 = Date.now()
  const r = await buscarFrioTudo('/fat_cupons', { loja_id: 5 }, 5000, () => { truncado = true }, { timeoutMs: 300, tentativas: 1 })
  const ms = Date.now() - t0
  srv.closeAllConnections(); srv.close()
  assert.deepEqual(r, [])
  assert.ok(truncado)
  assert.ok(ms < 1000, `demorou ${ms} ms`)
})
