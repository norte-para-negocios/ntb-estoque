// Leitura do banco da cópia local, SOMENTE LEITURA: sessão read-only no Postgres (default_transaction_read_only=on),
// só SELECT, direto nas tabelas de documentos. Nunca chama função/view/RPC do ERP.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function criarLeitor(raiz: string) {
  const env = fs.readFileSync(path.join(raiz, '.local-data', 'env'), 'utf8')
  const senha = env.match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!senha) throw new Error('POSTGRES_PASSWORD ausente em .local-data/env')
  return function consultar<T = any>(sql: string): T[] {
    if (!/^\s*(select|with)\b/i.test(sql) || /\b(insert|update|delete|drop|alter|truncate|create|grant|call|perform)\b/i.test(sql.replace(/'[^']*'/g, ''))) {
      throw new Error('o leitor só aceita SELECT')
    }
    const r = spawnSync('docker', [
      'exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c client_min_messages=warning', '-e', `PGPASSWORD=${senha}`,
      'ntb-erp-local-db', 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1',
      '-c', `select coalesce(json_agg(t),'[]'::json) from (${sql}) t`,
    ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    if (r.status !== 0) throw new Error(`consulta falhou: ${r.stderr.slice(0, 300)}`)
    return JSON.parse(r.stdout.trim())
  }
}
