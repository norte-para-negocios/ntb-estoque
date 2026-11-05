// Limpa um pg_dump --schema-only da produção para carregar no Postgres local do desktop.
// Uso: node limpar-schema.mjs <entrada.sql> <saida.sql>
// Regras em lib/offline/limpar-esquema-puro.ts (testadas por npm test): tira CREATE SCHEMA/SETs do dump, os triggers
// da outbox e a FK de profiles -> auth.users; revisões de custo (311–317) viram no-op no banco local (migration 318).
import fs from 'node:fs'
import { limparEsquema } from '../../lib/offline/limpar-esquema-puro.ts'

const [, , entrada, saida] = process.argv
const sql = limparEsquema(fs.readFileSync(entrada, 'utf8'))
fs.writeFileSync(saida, sql)
console.log(`${saida}: ${sql.split('\n').length} linhas`)
