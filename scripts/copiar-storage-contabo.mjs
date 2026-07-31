// scripts/copiar-storage-contabo.mjs
// Copia os arquivos reais (bytes) dos buckets do Supabase Storage real
// pro Storage self-hosted do Contabo -- a replicacao logica so cobre
// metadado (storage.objects), nao os bytes. Uso:
// node scripts/copiar-storage-contabo.mjs
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const origem = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const destino = createClient('http://127.0.0.1:8100', env.FAILOVER_STANDBY_SERVICE_ROLE_KEY)

const BUCKETS = ['arquivo-morto', 'certificados']

// Os buckets tem arquivos dentro de subpastas (ex: arquivo-morto/ordens_producao/2026-01.json.gz),
// nao direto na raiz -- list('') so devolve entradas de 1 nivel, e pastas vem com id:null.
// Precisa recursar pra achar os arquivos de verdade (achado real: list('') sozinho
// sempre dava 0 arquivos, mesmo com 12 arquivos reais existindo dentro das subpastas).
async function listarRecursivo(bucket, prefixo) {
  const { data, error } = await origem.storage.from(bucket).list(prefixo, { limit: 1000 })
  if (error) throw new Error(`listar ${bucket}/${prefixo}: ${error.message}`)

  let caminhos = []
  for (const item of data ?? []) {
    const caminho = prefixo ? `${prefixo}/${item.name}` : item.name
    if (item.id) {
      caminhos.push(caminho) // arquivo de verdade
    } else {
      caminhos = caminhos.concat(await listarRecursivo(bucket, caminho)) // pasta -- recursao
    }
  }
  return caminhos
}

async function copiarBucket(bucket) {
  const caminhos = await listarRecursivo(bucket, '')

  let copiados = 0
  for (const caminho of caminhos) {
    const { data: blob, error: dlErr } = await origem.storage.from(bucket).download(caminho)
    if (dlErr) { console.error(`  ❌ download ${bucket}/${caminho}: ${dlErr.message}`); continue }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const { error: upErr } = await destino.storage.from(bucket).upload(caminho, buffer, {
      upsert: true,
      contentType: blob.type,
    })
    if (upErr) { console.error(`  ❌ upload ${bucket}/${caminho}: ${upErr.message}`); continue }
    copiados++
  }
  console.log(`${bucket}: ${copiados}/${caminhos.length} arquivos copiados`)
}

async function main() {
  for (const bucket of BUCKETS) await copiarBucket(bucket)
}

main().catch((e) => { console.error(e); process.exit(1) })
