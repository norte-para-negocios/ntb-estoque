// Limpa um pg_dump --schema-only da produção para carregar no Postgres local do desktop.
// Uso: node limpar-schema.mjs <entrada.sql> <saida.sql>
// - tira CREATE SCHEMA public (já existe), SET de sessão do dump e search_path vazio
// - tira os triggers da outbox (a outbox é só do servidor)
// - tira a FK de profiles -> auth.users (o desktop não tem as contas do GoTrue)
import fs from 'node:fs'

const [, , entrada, saida] = process.argv
let sql = fs.readFileSync(entrada, 'utf8')

const remover = [
  /^CREATE SCHEMA public;\n/m,
  /^COMMENT ON SCHEMA public IS .*\n/m,
  /^SELECT pg_catalog\.set_config\('search_path', '', false\);\n/m,
  /^SET transaction_timeout = 0;\n/m,
]
for (const r of remover) sql = sql.replace(r, '')
// Meta-comandos do psql (\\restrict/\\unrestrict do pg_dump 17.6+) não rodam via driver.
sql = sql.replace(/^\\(un)?restrict .*\n/gm, '')

// Blocos "CREATE TRIGGER outbox_trigger ... ;" (uma linha cada no dump)
sql = sql.replace(/^CREATE TRIGGER outbox_trigger .*\n/gm, '')
// FK para auth.users (ALTER TABLE ONLY ... ADD CONSTRAINT ... REFERENCES auth.users(...))
sql = sql.replace(/^ALTER TABLE ONLY public\.\w+\n\s+ADD CONSTRAINT \w+ FOREIGN KEY \(\w+\) REFERENCES auth\.users\(id\)[^;]*;\n/gm, '')

if (/REFERENCES auth\./.test(sql)) throw new Error('sobrou referência a auth.* em FK')
fs.writeFileSync(saida, sql)
console.log(`${saida}: ${sql.split('\n').length} linhas`)
