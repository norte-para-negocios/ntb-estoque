// Puxa os dados da empresa do Omie (ListarEmpresas) e grava nas lojas.
// Mesma logica do lib/omie/empresa.ts, mas standalone (backfill local). Grava
// pelo pooler Postgres (db.mjs descobre o host) porque o REST do Supabase pode
// estar bloqueado nesta rede. Nunca mexe em nome/nome_fantasia (rotulo do usuario).
// Requer migration 011. Uso: node scripts/sync-empresa.mjs        (todas com chave)
//                            node scripts/sync-empresa.mjs 3 4     (so essas lojas)
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const u = new URL(env.SUPABASE_DB_URL)
const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
let host = 'aws-1-sa-east-1.pooler.supabase.com', port = 5432
try {
  const [h, p] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
  if (h) host = h
  if (p) port = Number(p)
} catch {}

const filtro = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n))
const tel = (d, n) => {
  const dd = (d ?? '').trim(), nn = (n ?? '').trim()
  return !dd && !nn ? null : (dd ? `(${dd}) ${nn}` : nn).trim()
}

const client = new pg.Client({
  host, port, user: `postgres.${ref}`, password: senha,
  database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000,
})
await client.connect()

const { rows: lojas } = await client.query(
  `select id, nome, nome_fantasia, omie_app_key, omie_app_secret
     from lojas where omie_app_key is not null order by id`
)
const alvo = lojas.filter((l) => !filtro.length || filtro.includes(Number(l.id)))

for (const loja of alvo) {
  try {
    const r = await fetch('https://app.omie.com.br/api/v1/geral/empresas/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_key: loja.omie_app_key, app_secret: loja.omie_app_secret, call: 'ListarEmpresas', param: [{ pagina: 1, registros_por_pagina: 50 }] }),
      signal: AbortSignal.timeout(30000),
    })
    const j = await r.json()
    const e = (j.empresas_cadastro || [])[0]
    if (!e) {
      await client.query(`update lojas set empresa_status='Sem dados', empresa_ultima_atualizacao=now() where id=$1`, [loja.id])
      console.log(`loja ${loja.id}: sem dados`)
      continue
    }
    // completa endereco so se vier preenchido (coalesce no SQL)
    await client.query(
      `update lojas set
        razao_social=$2, inscricao_estadual=$3, inscricao_municipal=$4, cnae=$5, cnae_municipal=$6,
        regime_tributario=$7, optante_simples_nacional=$8, csc_producao=$9, csc_id_producao=$10,
        codigo_empresa=$11, complemento=$12, email=$13, website=$14, telefone1=$15, telefone2=$16,
        sped_nome_contador=$17, sped_cpf_contador=$18, sped_email_contador=$19,
        cnpj=coalesce(nullif($20,''), cnpj), cep=coalesce(nullif($21,''), cep), uf=coalesce(nullif($22,''), uf),
        cidade=coalesce(nullif($23,''), cidade), bairro=coalesce(nullif($24,''), bairro),
        logradouro=coalesce(nullif($25,''), logradouro), numero=coalesce(nullif($26,''), numero),
        full_object_empresa=$27, empresa_status='Concluido', empresa_ultima_atualizacao=now()
       where id=$1`,
      [
        loja.id, e.razao_social ?? null, e.inscricao_estadual ?? null, e.inscricao_municipal ?? null,
        e.cnae ?? null, e.cnae_municipal ?? null, e.regime_tributario ?? null, e.optante_simples_nacional ?? null,
        e.csc_producao || null, e.csc_id_producao || null, e.codigo_empresa ? Number(e.codigo_empresa) : null,
        e.complemento ?? null, e.email ?? null, e.website ?? null, tel(e.telefone1_ddd, e.telefone1_numero),
        tel(e.telefone2_ddd, e.telefone2_numero), e.sped_nome_contador ?? null, e.sped_cpf_contador ?? null,
        e.sped_email_contador ?? null, e.cnpj ?? '', e.cep ?? '', e.estado ?? '', e.cidade ?? '',
        e.bairro ?? '', e.endereco ?? '', e.endereco_numero ?? '', JSON.stringify(e),
      ]
    )
    console.log(`loja ${loja.id} (${loja.nome_fantasia}): ${e.razao_social} | IE ${e.inscricao_estadual} | CNAE ${e.cnae} | regime ${e.regime_tributario}`)
  } catch (err) {
    await client.query(`update lojas set empresa_status='Erro', empresa_ultima_atualizacao=now() where id=$1`, [loja.id]).catch(() => {})
    console.log(`loja ${loja.id}: ERRO ${(err.message || '').slice(0, 80)}`)
  }
}
await client.end()
console.log('FIM')
