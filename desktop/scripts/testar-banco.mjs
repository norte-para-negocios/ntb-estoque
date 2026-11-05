// Sobe o banco local num diretório temporário e confere o essencial. Uso: node scripts/testar-banco.mjs
// (sem desktop/vendor: NTB_PG_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/testar-banco.mjs)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const banco = require('../electron/banco.js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntb-banco-'))
const b = await banco.iniciar({ dataDir: dir, porta: 54494, senhaAdmin: 'adm-teste', senhaAuthenticator: 'aut-teste', binDir: process.env.NTB_PG_BIN, log: console.log })
try {
  const c = await b.conectar('estoque')
  const ext = (await c.query("select extname from pg_extension order by 1")).rows.map((r) => r.extname)
  for (const e of ['pg_trgm', 'pgcrypto', 'uuid-ossp']) assert.ok(ext.includes(e), `extensão ${e}`)
  const fn = (await c.query("select count(*)::int n from pg_proc where proname = 'relatorio_movimentacao_matriz'")).rows[0].n
  assert.ok(fn >= 1, 'RPC relatorio_movimentacao_matriz')
  await c.query('begin')
  await c.query('set local role authenticated')
  await c.query(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true)`)
  const uid = (await c.query('select auth.uid() as u')).rows[0].u
  assert.equal(uid, '00000000-0000-0000-0000-000000000001')
  const visiveis = (await c.query('select count(*)::int n from lojas')).rows[0].n
  assert.equal(visiveis, 0, 'RLS ativa para authenticated')
  await c.query('rollback')
  // Revisões de custo (migration 318): só o servidor grava; aqui _revisar_movimento e reprocessar_custo são no-op.
  const rev = (await c.query(`select _revisar_movimento(1, gen_random_uuid(), current_date, 1, 1, 1, 1, false, 'teste') as r`)).rows[0].r
  assert.equal(rev, null, '_revisar_movimento local é no-op')
  const rep = (await c.query(`select reprocessar_custo(1, array[1]::bigint[], current_date, 'teste') as r`)).rows[0].r
  assert.equal(rep.local, true, 'reprocessar_custo local é no-op')
  assert.equal((await c.query('select count(*)::int n from estoque_mov_revisao')).rows[0].n, 0, 'nenhuma revisão local')
  const faixas = (await c.query("select valor from ntb_local.meta where chave = 'faixas'")).rows[0].valor
  assert.ok(Object.keys(faixas).length > 20, 'faixas de ids provisórios')
  const gat = (await c.query("select count(*)::int n from pg_trigger where tgname = 'ntb_rastro'")).rows[0].n
  assert.ok(gat > 50, 'rastreio instalado')
  await c.end()
  const f = await b.conectar('frio')
  const tf = (await f.query("select count(*)::int n from information_schema.tables where table_name = 'fat_cupons'")).rows[0].n
  assert.equal(tf, 1, 'frio.fat_cupons')
  await f.end()
  console.log('OK banco local', { recriado: b.recriado, tabelasComFaixa: Object.keys(faixas).length, rastreio: gat })
} finally {
  await b.parar()
  fs.rmSync(dir, { recursive: true, force: true })
}
