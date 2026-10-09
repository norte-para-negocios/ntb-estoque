// Aplica linhas vindas do servidor no banco local: upsert/delete genéricos pelo catálogo do Postgres.
// Roda como superusuário com session_replication_role = replica (sem triggers de negócio nem
// checagem de FK: o servidor já aplicou tudo) e ntb.aplicando = 1 (o rastreio local ignora).

const cacheTabelas = new Map()

const q = (n) => `"${String(n).replaceAll('"', '""')}"`

async function infoTabela(c, tabela, schema = 'public') {
  const chave = `${schema}.${tabela}`
  if (cacheTabelas.has(chave)) return cacheTabelas.get(chave)
  const cols = (await c.query(
    `select a.attname as nome, a.attgenerated <> '' as gerada
       from pg_attribute a
      where a.attrelid = to_regclass($1) and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [`${q(schema)}.${q(tabela)}`],
  )).rows
  if (!cols.length) {
    cacheTabelas.set(chave, null)
    return null
  }
  const pk = (await c.query(
    `select a.attname as nome
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = to_regclass($1) and i.indisprimary
      order by array_position(i.indkey::int2[], a.attnum)`,
    [`${q(schema)}.${q(tabela)}`],
  )).rows.map((r) => r.nome)
  const info = { schema, tabela, colunas: cols.filter((x) => !x.gerada).map((x) => x.nome), pk }
  cacheTabelas.set(chave, info)
  return info
}

function limparCache() {
  cacheTabelas.clear()
}

async function modoAplicacao(c) {
  await c.query("select set_config('session_replication_role', 'replica', true), set_config('ntb.aplicando', '1', true)")
}

// Colunas de unicidade de uma constraint/índice pelo nome (para resolver conflito com linha velha).
async function colunasDoIndice(c, nome) {
  return (await c.query(
    `select a.attname as nome
       from pg_class ic
       join pg_index i on i.indexrelid = ic.oid
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where ic.relname = $1
      order by array_position(i.indkey::int2[], a.attnum)`,
    [nome],
  )).rows.map((r) => r.nome)
}

/** Upsert de linhas (objetos JSON). Precisa estar dentro de uma transação já em modoAplicacao. */
async function upsert(c, tabela, linhas, { schema = 'public' } = {}) {
  if (!linhas.length) return 0
  const info = await infoTabela(c, tabela, schema)
  if (!info || !info.pk.length) return 0
  const presentes = new Set()
  for (const l of linhas) for (const k of Object.keys(l)) presentes.add(k)
  const cols = info.colunas.filter((x) => presentes.has(x))
  if (!info.pk.every((p) => cols.includes(p))) throw new Error(`linhas de ${tabela} sem a chave primária`)
  const lista = cols.map(q).join(', ')
  const naoPk = cols.filter((x) => !info.pk.includes(x))
  const acao = naoPk.length ? `do update set ${naoPk.map((x) => `${q(x)} = excluded.${q(x)}`).join(', ')}` : 'do nothing'
  const sql = `insert into ${q(schema)}.${q(tabela)} (${lista}) overriding system value
    select ${lista} from jsonb_populate_recordset(null::${q(schema)}.${q(tabela)}, $1::jsonb)
    on conflict (${info.pk.map(q).join(', ')}) ${acao}`
  let n = 0
  for (let i = 0; i < linhas.length; i += 2000) {
    const lote = linhas.slice(i, i + 2000)
    await c.query('savepoint lote')
    try {
      await c.query(sql, [JSON.stringify(lote)])
      await c.query('release savepoint lote')
    } catch (e) {
      await c.query('rollback to savepoint lote')
      if (e.code !== '23505') throw e
      // Conflito com uma linha local velha em outra chave única: vai linha a linha e apaga a velha.
      for (const linha of lote) await upsertUma(c, info, sql, linha)
    }
    n += lote.length
  }
  return n
}

async function upsertUma(c, info, sql, linha) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await c.query('savepoint uma')
    try {
      await c.query(sql, [JSON.stringify([linha])])
      await c.query('release savepoint uma')
      return
    } catch (e) {
      await c.query('rollback to savepoint uma')
      if (e.code !== '23505' || !e.constraint) throw e
      const cols = await colunasDoIndice(c, e.constraint)
      if (!cols.length || cols.some((x) => linha[x] === undefined)) throw e
      const cond = cols.map((x, i) => `${q(x)} is not distinct from (select ${q(x)} from jsonb_populate_record(null::${q(info.schema)}.${q(info.tabela)}, $1::jsonb))`).join(' and ')
      const difPk = info.pk.map((x) => `${q(x)} is distinct from (select ${q(x)} from jsonb_populate_record(null::${q(info.schema)}.${q(info.tabela)}, $1::jsonb))`).join(' or ')
      await c.query(`delete from ${q(info.schema)}.${q(info.tabela)} where ${cond} and (${difPk})`, [JSON.stringify(linha)])
    }
  }
}

/** Apaga linhas pelo pk (lista de objetos {col: valor}). */
async function apagar(c, tabela, pks, { schema = 'public' } = {}) {
  if (!pks.length) return 0
  const info = await infoTabela(c, tabela, schema)
  if (!info || !info.pk.length) return 0
  const cond = info.pk.map((x) => `t.${q(x)} = k.${q(x)}`).join(' and ')
  const r = await c.query(
    `delete from ${q(schema)}.${q(tabela)} t using jsonb_populate_recordset(null::${q(schema)}.${q(tabela)}, $1::jsonb) k where ${cond}`,
    [JSON.stringify(pks)],
  )
  return r.rowCount
}

module.exports = { infoTabela, upsert, apagar, modoAplicacao, limparCache }
