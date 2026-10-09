// Testa a migration 157 (canal offline) num banco local com o esquema da produção.
// Uso: node scripts/testar-canal.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const banco = require('../electron/banco.js')
const MIG = path.join(import.meta.dirname, '..', '..', 'supabase', 'migrations', '157_canal_offline.sql')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntb-canal-'))
const b = await banco.iniciar({ dataDir: dir, porta: 54495, senhaAdmin: 'adm', senhaAuthenticator: 'aut' })
const c = await b.conectar('estoque')
const q = async (sql, p) => (await c.query(sql, p)).rows
const U1 = '00000000-0000-0000-0000-0000000000a1'
const U2 = '00000000-0000-0000-0000-0000000000a2'
const U3 = '00000000-0000-0000-0000-0000000000a3'

try {
  // o desktop tira o rastreio local; aqui queremos o banco como o servidor
  await q(`do $$ declare t record; begin for t in select tgrelid::regclass r from pg_trigger where tgname='ntb_rastro' loop execute format('drop trigger ntb_rastro on %s', t.r); end loop; end $$`)
  const sql = fs.readFileSync(MIG, 'utf8')
  const [antes, indice] = sql.split(/^create index concurrently/m)
  await c.query(antes)
  await c.query('create index concurrently' + indice.split('\n-- outbox_capture original')[0])
  await c.query(fs.readFileSync(MIG.replace('157_canal_offline.sql', '158_offline_compactar_leve.sql'), 'utf8'))

  // dados
  await q(`insert into lojas (id, cnpj, nome, omie_app_key, omie_app_secret, integracao_api_key) values
    (1, '1', 'Loja A', 'SEGREDO-A', 'SEGREDO-A2', 'CHAVE-A'), (2, '2', 'Loja B', 'SEGREDO-B', 'x', 'y')`)
  await q(`insert into profiles (id, name, email) values ($1, 'Ana', 'ana@x'), ($2, 'Beto', 'beto@x'), ($3, 'Caio', 'caio@x')`, [U1, U2, U3])
  await q(`insert into loja_user (id, loja_id, user_id) values (1, 1, $1), (2, 1, $2), (3, 2, $3)`, [U1, U2, U3])
  await q(`insert into familias (id, loja_id, nome) values (10, 1, 'Bebidas'), (20, 2, 'Outra loja')`)

  const n1 = (await q('select offline_compactar() n'))[0].n
  assert.ok(n1 >= 8, `compactou ${n1}`)

  const puxar = (lojas, user, cursor) => q('select * from offline_puxar($1, $2, $3, 5000)', [lojas, user, cursor])
  let r = await puxar([1], U1, 0)
  const por = (t) => r.filter((x) => x.tabela === t && x.dado)
  assert.deepEqual(por('familias').map((x) => x.dado.nome), ['Bebidas'])
  assert.deepEqual(por('lojas').map((x) => x.dado.id), [1])
  for (const k of ['omie_app_key', 'omie_app_secret', 'integracao_api_key']) assert.ok(!(k in por('lojas')[0].dado), `vazou ${k}`)
  const perfis = Object.fromEntries(por('profiles').map((x) => [x.dado.name, x.dado]))
  assert.deepEqual(Object.keys(perfis).sort(), ['Ana', 'Beto'])
  assert.equal(perfis.Ana.email, 'ana@x')
  assert.ok(!('email' in perfis.Beto), 'e-mail de outro usuário vazou')
  const cursor = Math.max(...r.map((x) => Number(x.versao)))

  // reprocessar não gera versão nova
  assert.equal((await q('select offline_compactar() n'))[0].n, 0)
  assert.equal((await puxar([1], U1, cursor)).length, 0)

  // só updated_at mudou: nada na outbox
  const antesOut = (await q('select count(*)::int n from outbox'))[0].n
  await q(`update familias set updated_at = now() + interval '1 minute' where id = 10`)
  assert.equal((await q('select count(*)::int n from outbox'))[0].n, antesOut, 'update só de updated_at foi para a outbox')

  // commit fora de ordem: linha da outbox com id menor que o último processado aparece depois
  await q(`insert into outbox (id, table_name, operation, row_data) values ((select max(id) + 100 from outbox), 'nao_sincronizada', 'INSERT', '{}')`)
  await q('select offline_compactar()')
  const ultimo = Number((await q(`select (valor #>> '{}')::bigint v from offline_meta where chave='ultimo_outbox'`))[0].v)
  // (para o MESMO registro a ordem é garantida pelo lock da linha; o caso real é outro registro)
  await q(`insert into familias (id, loja_id, nome) values (12, 1, 'Atrasada')`)
  const livre = (await q(`select g from generate_series(greatest($1::bigint - 4000, 1), $1::bigint - 1) g where not exists (select 1 from outbox o where o.id = g) limit 1`, [ultimo]))[0].g
  await q(`update outbox set id = $1 where id = (select max(id) from outbox)`, [livre])
  assert.ok((await q('select offline_compactar() n'))[0].n >= 1, 'mudança atrasada não foi compactada')
  r = await puxar([1], U1, cursor)
  assert.deepEqual(r.filter((x) => x.tabela === 'familias').map((x) => x.dado.nome), ['Atrasada'])

  // snapshot paginado só da loja
  const s1 = await q('select * from offline_snapshot($1, $2, $3, null, 1)', ['familias', [1, 2], U1])
  assert.equal(s1.length, 1)
  const s2 = await q('select * from offline_snapshot($1, $2, $3, $4, 1)', ['familias', [1, 2], U1, s1[0].pk])
  assert.equal(s2.length, 1)
  assert.notDeepEqual(s1[0].pk, s2[0].pk)
  const so1 = await q('select * from offline_snapshot($1, $2, $3, null, 10)', ['familias', [1], U1])
  assert.deepEqual(so1.map((x) => x.dado.loja_id), [1, 1])
  const sl = await q('select * from offline_snapshot($1, $2, $3, null, 10)', ['lojas', [1], U1])
  assert.ok(!('omie_app_key' in sl[0].dado))
  await assert.rejects(q('select * from offline_snapshot($1, $2, $3, null, 10)', ['outbox', [1], U1]))

  // linhas criadas por um intent
  await c.query('begin')
  await q(`select set_config('request.headers', '{"x-ntb-intent":"abc-123","accept":"*/*"}', true)`)
  await q(`insert into familias (id, loja_id, nome) values (11, 1, 'Nova')`)
  await c.query('commit')
  const cr = await q('select * from offline_criados($1)', ['abc-123'])
  assert.deepEqual(cr.map((x) => [x.tabela, x.pk]), [['familias', { id: 11 }]])

  // apagar vira lápide
  await q('delete from familias where id = 10')
  await q('select offline_compactar()')
  r = await puxar([1], U1, cursor)
  const lap = r.find((x) => x.tabela === 'familias' && x.pk.id === 10)
  assert.equal(lap.apagado, true)
  assert.equal(lap.dado, null)

  // outra loja não vê nada da loja 1
  r = await puxar([2], U3, 0)
  assert.ok(!r.some((x) => x.tabela === 'familias' && x.dado?.loja_id === 1))
  assert.ok(!r.some((x) => x.dado?.name === 'Ana'))

  console.log('OK canal offline')
} finally {
  await c.end()
  await b.parar()
  fs.rmSync(dir, { recursive: true, force: true })
}
