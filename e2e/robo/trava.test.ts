import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { verificarServidor } from './trava.ts'

const sessao = async () => ({ access_token: 'a', refresh_token: 'r', expires_at: 1, expires_in: 2, token_type: 'bearer' })

function servidor(h: http.RequestListener): Promise<{ origem: string; fechar: () => void }> {
  return new Promise((res) => {
    const s = http.createServer(h).listen(0, '127.0.0.1', () => res({ origem: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, fechar: () => s.close() }))
  })
}

test('servidor que lê o cookie do Supabase local e redireciona: aprovado, e o cookie certo foi enviado', async () => {
  let cookie = ''
  const s = await servidor((req, res) => { cookie = String(req.headers.cookie); res.writeHead(307, { location: '/home' }).end() })
  const v = await verificarServidor({ origemErp: s.origem, urlSupabase: 'http://127.0.0.1:54421', sessao })
  s.fechar()
  assert.equal(v.ok, true)
  assert.match(cookie, /^sb-127-auth-token=base64-/)
})

test('servidor que usa OUTRO Supabase (não aceita a sessão local, fica no /login): recusado', async () => {
  const s = await servidor((_q, res) => res.writeHead(200).end('login'))
  const v = await verificarServidor({ origemErp: s.origem, urlSupabase: 'http://127.0.0.1:54421', sessao })
  s.fechar()
  assert.equal(v.ok, false)
  if (!v.ok) assert.match(v.motivo, /outro Supabase/)
})

test('servidor fora do ar e Supabase local fora do ar: recusado com motivo', async () => {
  const fora = await verificarServidor({ origemErp: 'http://127.0.0.1:1', urlSupabase: 'http://127.0.0.1:54421', sessao })
  assert.equal(fora.ok, false)
  const semSessao = await verificarServidor({ origemErp: 'http://127.0.0.1:1', urlSupabase: 'http://127.0.0.1:54421', sessao: async () => { throw new Error('GoTrue local respondeu 500') } })
  assert.equal(semSessao.ok, false)
  if (!semSessao.ok) assert.match(semSessao.motivo, /sessão/)
})
