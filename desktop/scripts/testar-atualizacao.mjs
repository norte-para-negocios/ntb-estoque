// Cenário "app atualizado com a estrutura nova adiada" (banco.js + sync.js com servidor simulado).
// Uso: bash scripts/compilar-compartilhado.sh && node scripts/testar-atualizacao.mjs
// (sem desktop/vendor: NTB_PG_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/testar-atualizacao.mjs)
//  1. banco de app antigo (sem hash do canal, sem a visão efetiva) + abertura com adiarRecriacao: segue o banco antigo,
//     hash do canal = null (não manda header, como a 1.0.4), status.estruturaPendente
//  2. sem internet: não recria
//  3. com internet e item com erro na fila: não recria (recriar apagaria o que ele fez no banco local)
//  4. fila vazia e servidor respondendo: recria na mesma abertura, refaz a carga, hash do canal = o do instalador
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const banco = require('../electron/banco.js')
const { criarSync } = require('../electron/sync.js')
const { criarFila } = require('../electron/fila.js')
const { ErroRede } = require('../electron/remoto.js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntb-atual-'))
const base = { dataDir: dir, porta: 54496, senhaAdmin: 'adm', senhaAuthenticator: 'aut', binDir: process.env.NTB_PG_BIN, log: () => {} }
const canalInstalador = banco.hashCanalInstalador()
const visao = async (c) => (await c.query("select to_regclass('public.estoque_movimentos_efetivo') is not null as v")).rows[0].v

// 1) banco "do app antigo": estrutura de outra versão, sem hash do canal
let b = await banco.iniciar(base)
let c = await b.conectar('estoque')
await c.query("update ntb_local.meta set valor = '{\"hash\": \"velho\"}' where chave = 'esquema'")
await c.query('drop view estoque_movimentos_efetivo cascade')
await c.end()
b.parar()

b = await banco.iniciar({ ...base, adiarRecriacao: true })
try {
  c = await b.conectar('estoque')
  assert.equal(b.desatualizado(), true, 'estrutura nova adiada')
  assert.equal(b.hashCanal(), null, 'banco de app antigo: sem header de esquema (o servidor deixa passar, como a 1.0.4)')
  assert.equal(await visao(c), false, 'banco antigo continua (sem a visão)')
  await c.end()

  let online = false
  const chamadas = []
  const remoto = {
    temSessao: () => true,
    async get(caminho) {
      chamadas.push(caminho)
      if (!online) throw new ErroRede('sem conexão')
      if (caminho.startsWith('/api/offline/tabelas')) return { status: 200, json: { ok: true, tabelas: [], cursor: 0, piso: 0, lojas: [] } }
      throw new Error(`GET inesperado ${caminho}`)
    },
    async post(caminho) {
      chamadas.push(caminho)
      if (!online) throw new ErroRede('sem conexão')
      if (caminho === '/api/offline/mudancas') return { status: 200, json: { ok: true, mudancas: [], cursor: 0, mais: false } }
      throw new Error(`POST inesperado ${caminho}`)
    },
  }
  const cofre = { ler: (k) => (k === 'usuario' ? { id: 'u' } : k === 'lojasSync' ? [] : undefined), gravar: () => {} }
  const fila = criarFila(null)
  const sync = criarSync({ banco: b, remoto, cofre, fila })
  assert.equal(sync.status().estruturaPendente, true, 'status avisa a tela')

  // 2) sem internet: nada muda
  await sync.agora()
  assert.equal(b.desatualizado(), true, 'sem internet não recria')

  // 3) com internet, item com erro na fila: segura
  online = true
  fila.incluir({ intentId: '00000000-0000-0000-0000-000000000001', acao: 'x#y', args: [], modo: 'fila', estado: 'erro', erro: 'recusada' })
  await sync.agora()
  assert.equal(b.desatualizado(), true, 'item na fila segura a recriação')
  assert.equal(sync.status().naFila, 1)

  // 4) fila vazia: recria na mesma abertura
  fila.remover('00000000-0000-0000-0000-000000000001')
  await sync.agora()
  assert.equal(b.desatualizado(), false, 'recriou')
  assert.equal(sync.status().estruturaPendente, false)
  assert.equal(sync.status().carga.pronta, true, 'carga refeita')
  assert.equal(b.hashCanal(), canalInstalador, 'header de esquema = o do instalador')
  c = await b.conectar('estoque')
  assert.equal(await visao(c), true, 'estrutura nova (visão efetiva) no banco local')
  const meta = (await c.query("select valor from ntb_local.meta where chave = 'esquema'")).rows[0].valor
  assert.equal(meta.canal, canalInstalador, 'banco novo guarda o hash do canal')
  await c.end()
  sync.parar()
  console.log('OK atualização adiada', { chamadas: chamadas.length })
} finally {
  b.parar()
  fs.rmSync(dir, { recursive: true, force: true })
}
