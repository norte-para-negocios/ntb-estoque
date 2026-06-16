// Puxa os dados da empresa do Omie (ListarEmpresas) e grava nas lojas via REST.
// Mesma logica do lib/omie/empresa.ts, mas standalone (uso local/teste/backfill),
// ja que o Postgres direto pode estar bloqueado na rede. Requer migration 011.
// Uso: node scripts/sync-empresa.mjs        (todas as lojas com chave)
//      node scripts/sync-empresa.mjs 2       (so a loja informada)
import fs from 'node:fs'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL
const SRV = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }
const filtro = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n))

async function f(url, opts = {}, tent = 5) {
  for (let i = 0; i < tent; i++) {
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) })
    } catch (e) {
      if (i === tent - 1) throw e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
const tel = (d, n) => {
  const dd = (d ?? '').trim(), nn = (n ?? '').trim()
  return !dd && !nn ? null : (dd ? `(${dd}) ${nn}` : nn).trim()
}

// 1) checa se a migration 011 foi aplicada
const chk = await f(`${SUPA}/rest/v1/lojas?select=id,razao_social&limit=1`)
if (!chk.ok) {
  const txt = await chk.text()
  console.log('MIGRATION 011 NAO APLICADA (a coluna razao_social ainda nao existe). Aplique o SQL no Supabase.')
  console.log('  detalhe:', txt.slice(0, 200))
  process.exit(1)
}
console.log('Migration 011 OK (coluna existe).')

// 2) lojas com chave
const lj = await (await f(`${SUPA}/rest/v1/lojas?select=id,nome,nome_fantasia,omie_app_key,omie_app_secret&omie_app_key=not.is.null&order=id`)).json()
const lojas = lj.filter((l) => !filtro.length || filtro.includes(Number(l.id)))

for (const loja of lojas) {
  try {
    const r = await f('https://app.omie.com.br/api/v1/geral/empresas/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_key: loja.omie_app_key, app_secret: loja.omie_app_secret, call: 'ListarEmpresas', param: [{ pagina: 1, registros_por_pagina: 50 }] }),
    })
    const j = await r.json()
    const e = (j.empresas_cadastro || [])[0]
    if (!e) { console.log(`loja ${loja.id}: sem dados`); continue }
    const patch = {
      razao_social: e.razao_social ?? null,
      inscricao_estadual: e.inscricao_estadual ?? null,
      inscricao_municipal: e.inscricao_municipal ?? null,
      cnae: e.cnae ?? null,
      cnae_municipal: e.cnae_municipal ?? null,
      regime_tributario: e.regime_tributario ?? null,
      optante_simples_nacional: e.optante_simples_nacional ?? null,
      csc_producao: e.csc_producao || null,
      csc_id_producao: e.csc_id_producao || null,
      codigo_empresa: e.codigo_empresa ? Number(e.codigo_empresa) : null,
      complemento: e.complemento ?? null,
      email: e.email ?? null,
      website: e.website ?? null,
      telefone1: tel(e.telefone1_ddd, e.telefone1_numero),
      telefone2: tel(e.telefone2_ddd, e.telefone2_numero),
      sped_nome_contador: e.sped_nome_contador ?? null,
      sped_cpf_contador: e.sped_cpf_contador ?? null,
      sped_email_contador: e.sped_email_contador ?? null,
      full_object_empresa: e,
      empresa_status: 'Concluido',
      empresa_ultima_atualizacao: new Date().toISOString(),
    }
    const up = await f(`${SUPA}/rest/v1/lojas?id=eq.${loja.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
    console.log(`loja ${loja.id} (${loja.nome_fantasia || loja.nome}): ${up.status} -> ${e.razao_social} | IE ${e.inscricao_estadual} | CNAE ${e.cnae} | regime ${e.regime_tributario}`)
  } catch (err) {
    console.log(`loja ${loja.id}: ERRO ${err.message?.slice(0, 80)}`)
  }
}
console.log('FIM')
