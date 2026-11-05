import { test } from 'node:test'
import assert from 'node:assert/strict'
import { versaoDoArquivo, classificarSql, montarAplicacao, montarSsh, SQL_CONSULTA_CONTROLE, SQL_CONTROLE_EXISTE } from './runner-puro.ts'

test('versaoDoArquivo aceita só NNN_nome.sql', () => {
  assert.equal(versaoDoArquivo('309_controle_migrations.sql'), 309)
  assert.equal(versaoDoArquivo('001_x.sql'), 1)
  for (const ruim of ['309.sql', '../309_x.sql', '309_x.sql; drop table x', 'abc_x.sql', '309_X.sql']) assert.throws(() => versaoDoArquivo(ruim), /nome de migration inválido/)
})

test('classificarSql: transação própria, concurrently e marca explícita', () => {
  assert.deepEqual(classificarSql('create table a(i int);'), { transacaoPropria: false, semTransacao: false })
  assert.equal(classificarSql('begin;\ncreate table a();\ncommit;').transacaoPropria, true)
  assert.equal(classificarSql('  BEGIN ;').transacaoPropria, true)
  assert.equal(classificarSql('-- begin;\nselect 1;').transacaoPropria, false)
  assert.equal(classificarSql('create index concurrently if not exists i on t(c);').semTransacao, true)
  assert.equal(classificarSql('-- concurrently nao e usado aqui\nselect 1;').semTransacao, false)
  assert.equal(classificarSql('-- sem-transacao\nselect 1;').semTransacao, true)
})

test('modo real: embrulha em transação, registra e avisa o PostgREST', () => {
  const r = montarAplicacao({ arquivo: '310_x.sql', sql: 'create table a(i int);', modo: 'real', controleExiste: true, por: 'joaquim' })
  assert.match(r.sql, /^begin;/)
  assert.match(r.sql, /create table a\(i int\);/)
  assert.match(r.sql, /insert into public\.schema_migrations \(versao, arquivo, por\) values \(310, '310_x\.sql', 'joaquim'\) on conflict \(versao\) do nothing;/)
  assert.match(r.sql, /notify pgrst, 'reload schema';/)
  assert.match(r.sql.trim(), /commit;$/)
  assert.equal(r.embrulhada, true)
})

test('modo seco: mesma coisa, mas termina em ROLLBACK e nunca em commit', () => {
  const r = montarAplicacao({ arquivo: '310_x.sql', sql: 'create table a(i int);', modo: 'seco', controleExiste: true, por: 'joaquim' })
  assert.match(r.sql.trim(), /rollback;$/)
  assert.ok(!/\bcommit\s*;/i.test(r.sql))
})

test('modo seco recusa arquivo que controla a própria transação ou usa concurrently (não dá para garantir o rollback)', () => {
  assert.throws(() => montarAplicacao({ arquivo: '310_x.sql', sql: 'begin;\nselect 1;\ncommit;', modo: 'seco', controleExiste: true, por: 'a' }), /não dá para testar a seco/)
  assert.throws(() => montarAplicacao({ arquivo: '307_x.sql', sql: 'create index concurrently i on t(c);', modo: 'seco', controleExiste: true, por: 'a' }), /não dá para testar a seco/)
})

test('modo real com transação própria/concurrently: não embrulha; registra em comando separado', () => {
  const r = montarAplicacao({ arquivo: '307_x.sql', sql: 'create index concurrently i on t(c);', modo: 'real', controleExiste: true, por: 'a' })
  assert.equal(r.embrulhada, false)
  assert.ok(!/^begin;/i.test(r.sql))
  assert.match(r.sql, /create index concurrently/)
  assert.match(r.sql, /insert into public\.schema_migrations/)
})

test('controle ainda não existe (antes da 309): aplica sem registrar', () => {
  const r = montarAplicacao({ arquivo: '308_x.sql', sql: 'select 1;', modo: 'real', controleExiste: false, por: 'a' })
  assert.ok(!/schema_migrations/.test(r.sql))
  assert.match(r.sql, /notify pgrst/)
})

test('o campo "por" é sanitizado (nada de aspas no SQL)', () => {
  const r = montarAplicacao({ arquivo: '310_x.sql', sql: 'select 1;', modo: 'real', controleExiste: true, por: "x'); drop table lojas; --" })
  assert.ok(!r.sql.includes('drop table lojas'))
})

test('montarSsh exige o alvo por variável de ambiente e nunca embute host ou chave', () => {
  assert.throws(() => montarSsh({}), /NORTE_DB_SSH/)
  const a = montarSsh({ NORTE_DB_SSH: 'root@servidor', NORTE_DB_SSH_KEY: '/k/chave' })
  assert.deepEqual(a.slice(0, 3), ['-i', '/k/chave', 'root@servidor'])
  assert.match(a[a.length - 1], /docker exec -i supabase-db psql -U supabase_admin -d postgres -At -v ON_ERROR_STOP=1/)
  const b = montarSsh({ NORTE_DB_SSH: 'root@servidor' })
  assert.equal(b[0], 'root@servidor')
})

test('consulta de controle só lê', () => {
  assert.match(SQL_CONSULTA_CONTROLE(309), /^set default_transaction_read_only = on;/)
  assert.doesNotMatch(SQL_CONSULTA_CONTROLE(309), /insert|update|delete|create|drop/i)
  assert.match(SQL_CONTROLE_EXISTE, /^set default_transaction_read_only = on;/)
  // a consulta de existência não pode citar a tabela fora do to_regclass (falharia antes da 309)
  assert.doesNotMatch(SQL_CONTROLE_EXISTE.replace(/to_regclass\('public\.schema_migrations'\)/, ''), /schema_migrations/)
})
