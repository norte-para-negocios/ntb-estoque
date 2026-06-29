// Sincroniza ajustes de estoque do Omie → tabela movimentos.
// API sort: ASCENDENTE por id_ajuste (página 1 = mais antigos, última = mais recentes).
//
// Estratégia: varrer das últimas páginas para as primeiras.
//   - Backfill (padrão): para quando todos os registros da página são mais antigos que cutoff.
//   - Incremental (--incremental): para quando todos os ids são <= max_id já salvo.
//   - Checkpoint: salva em .ajustes-checkpoint-<loja>.json e retoma de onde parou.
//
// SEGURANÇA: aborta ao atingir 480 MB para não estourar free tier Supabase (500 MB).
// PROTEÇÃO: nunca toca na loja 4 (O SERTAO VAI VIRAR MAR - produção).
//
// Uso:
//   node scripts/sync-ajustes-omie.mjs              → todas as lojas, últimos 12 meses
//   node scripts/sync-ajustes-omie.mjs 3             → só loja 3
//   node scripts/sync-ajustes-omie.mjs 3 --full      → histórico completo (sem cutoff de data)
//   node scripts/sync-ajustes-omie.mjs 3 --incremental → só ids novos (> max salvo)
//   node scripts/sync-ajustes-omie.mjs 3 --reset     → apaga checkpoint e reinicia do fim
//
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
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({
  host: hh, port: Number(pp), user: `postgres.${ref}`,
  password: senha, database: 'postgres', ssl: { rejectUnauthorized: false },
})
await db.connect()

const LOJA_ARG = Number(process.argv[2]) || 0
const FULL_HISTORY = process.argv.includes('--full')
const INCREMENTAL = process.argv.includes('--incremental')
const RESET_CHECKPOINT = process.argv.includes('--reset')
const LIMITE_MB = 480

// Checkpoint: persiste em qual página cada loja parou para retomar sem repetir
function checkpointPath(lojaId) {
  return `${PROJ}/scripts/.ajustes-checkpoint-${lojaId}.json`
}
function lerCheckpoint(lojaId) {
  try {
    const c = JSON.parse(fs.readFileSync(checkpointPath(lojaId), 'utf8'))
    return c.pagina ?? null
  } catch { return null }
}
function salvarCheckpoint(lojaId, pagina) {
  fs.writeFileSync(checkpointPath(lojaId), JSON.stringify({ pagina, updated: new Date().toISOString() }))
}
function apagarCheckpoint(lojaId) {
  try { fs.unlinkSync(checkpointPath(lojaId)) } catch {}
}

const hoje = new Date()
const cutoffDate = FULL_HISTORY
  ? new Date('2020-01-01')
  : new Date(hoje.getFullYear() - 1, hoje.getMonth(), hoje.getDate())
const cutoffISO = cutoffDate.toISOString().slice(0, 10)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function tamanhoDbMB() {
  const { rows: [r] } = await db.query(
    'SELECT pg_database_size(current_database()) / 1048576.0 AS mb'
  )
  return Number(r.mb)
}

const mbInicial = await tamanhoDbMB()
console.log(`Banco atual: ${mbInicial.toFixed(1)} MB / limite ${LIMITE_MB} MB`)
if (mbInicial >= LIMITE_MB) {
  console.error('BANCO JÁ ESTÁ NO LIMITE — abortar.')
  await db.end(); process.exit(1)
}
console.log(`Modo: ${FULL_HISTORY ? 'HISTÓRICO COMPLETO' : `últimos 12 meses (>= ${cutoffISO})`}${INCREMENTAL ? ' | incremental (id > cursor)' : ' | backfill reverso (última pág → primeira)'}`)

const { rows: lojas } = await db.query(
  `SELECT id, nome_fantasia, omie_app_key k, omie_app_secret s
   FROM lojas WHERE ativo = true AND id != 4 ${LOJA_ARG ? `AND id = ${LOJA_ARG}` : ''}
   ORDER BY id`
)
if (!lojas.length) { console.error('Nenhuma loja encontrada'); await db.end(); process.exit(1) }
console.log(`Lojas: ${lojas.map(l => `${l.id}=${l.nome_fantasia}`).join(', ')}\n`)

// Converte DD/MM/YYYY do Omie para ISO YYYY-MM-DD. Retorna null se data inválida.
function omieDataParaISO(d) {
  if (!d || typeof d !== 'string') return null
  const [dia, mes, ano] = d.split('/')
  if (!dia || !mes || !ano) return null
  const anoN = Number(ano)
  if (anoN < 2020 || anoN > 2100) return null
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
}

// Chama Omie com retry em rate-limits (concorrência 8020 + redundância Client-6)
async function omieListar(key, secret, pagina) {
  for (let t = 1; t <= 8; t++) {
    const r = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarAjusteEstoque',
        app_key: key, app_secret: secret,
        param: [{ pagina, registros_por_pagina: 50 }],
      }),
    })
    const j = await r.json()
    const fault = j?.faultstring ?? ''
    if (j?.faultcode?.includes('8020') || /requisição.*executada/i.test(fault)) {
      console.log(`\n    concorrência Omie (t${t}), aguardando ${2 * t}s...`)
      await sleep(2000 * t); continue
    }
    if (/REDUNDANT/i.test(fault) || /redundante/i.test(fault)) {
      const m = fault.match(/Aguarde (\d+) segundo/)
      const espera = m ? (Number(m[1]) + 10) * 1000 : 70000
      console.log(`\n    redundância Omie (t${t}), aguardando ${Math.round(espera / 1000)}s...`)
      await sleep(espera); continue
    }
    if (fault) throw new Error(`Omie: ${fault}`)
    return j
  }
  throw new Error('Rate limit persistente após 8 tentativas')
}

// Batch upsert em chunks de 25 linhas
async function upsertarLote(lojaId, registros) {
  if (!registros.length) return 0
  const linhas = registros.map(r => ({
    loja_id: lojaId,
    id_ajuste: r.id_ajuste,
    id_prod: r.id_prod || null,
    tipo: r.tipo,
    quan: r.quantidade ?? 0,
    valor: r.valor ?? 0,
    local: r.codigo_local_estoque || null,
    destino: r.id_local_ds || null,
    data: omieDataParaISO(r.data),
    motivo: r.motivo || null,
    obs: r.obs || null,
  })).filter(l => l.data !== null)

  if (!linhas.length) return 0

  const CHUNK = 25
  let total = 0
  for (let i = 0; i < linhas.length; i += CHUNK) {
    const chunk = linhas.slice(i, i + CHUNK)
    const cols = 11
    const vals = []
    const params = []
    chunk.forEach((l, idx) => {
      const b = idx * cols
      vals.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},'AJU','Concluido',now(),now())`)
      params.push(l.loja_id, l.id_ajuste, l.id_prod, l.tipo, l.quan, l.valor,
        l.local, l.destino, l.data, l.motivo, l.obs)
    })
    await db.query(
      `INSERT INTO movimentos
         (loja_id,id_ajuste,id_prod,tipo,quan,valor,
          codigo_local_estoque,codigo_local_estoque_destino,
          data,motivo,obs,origem,status,created_at,updated_at)
       VALUES ${vals.join(',')}
       ON CONFLICT (loja_id, id_ajuste) WHERE id_ajuste IS NOT NULL
       DO UPDATE SET
         tipo=EXCLUDED.tipo, quan=EXCLUDED.quan, valor=EXCLUDED.valor,
         codigo_local_estoque=EXCLUDED.codigo_local_estoque,
         codigo_local_estoque_destino=EXCLUDED.codigo_local_estoque_destino,
         data=EXCLUDED.data, motivo=EXCLUDED.motivo, updated_at=now()`,
      params
    )
    total += chunk.length
  }
  return total
}

let totalGeral = 0
let abortado = false

for (const loja of lojas) {
  if (abortado) break
  console.log(`\n━━━ Loja ${loja.id}: ${loja.nome_fantasia} ━━━`)

  const mbAtual = await tamanhoDbMB()
  if (mbAtual >= LIMITE_MB) {
    console.log(`⚠️  ${mbAtual.toFixed(1)} MB — limite atingido, parando.`)
    abortado = true; break
  }
  console.log(`  Banco: ${mbAtual.toFixed(1)} MB`)

  if (RESET_CHECKPOINT) apagarCheckpoint(loja.id)

  let resp1
  try { resp1 = await omieListar(loja.k, loja.s, 1) } catch (e) {
    console.error(`  Erro página 1: ${e.message}`); continue
  }
  const totalPaginas = resp1.total_de_paginas ?? 1
  const totalRegs = resp1.total_de_registros ?? 0
  console.log(`  Total Omie: ${totalRegs.toLocaleString('pt-BR')} registros em ${totalPaginas.toLocaleString('pt-BR')} páginas`)

  // Cursor para modo incremental
  let cursorId = 0
  if (INCREMENTAL) {
    const { rows } = await db.query(
      'SELECT max(id_ajuste) max_id FROM movimentos WHERE loja_id=$1 AND id_ajuste IS NOT NULL',
      [loja.id]
    )
    cursorId = Number(rows[0]?.max_id ?? 0)
    console.log(`  Cursor incremental: id_ajuste > ${cursorId}`)
  }

  let totalLoja = 0
  let paginasProcessadas = 0

  // Checkpoint: retoma da página onde parou (evita repetir e acionar REDUNDANT do Omie)
  const checkpointPagina = INCREMENTAL ? null : lerCheckpoint(loja.id)
  const paginaInicio = checkpointPagina ?? totalPaginas
  if (checkpointPagina) {
    console.log(`  Retomando do checkpoint: página ${checkpointPagina.toLocaleString('pt-BR')}`)
  }

  // Varre da última página para a primeira (sort ASC → última tem registros mais recentes)
  for (let pagina = paginaInicio; pagina >= 1; pagina--) {
    // Verifica banco a cada 500 páginas processadas
    if (paginasProcessadas > 0 && paginasProcessadas % 500 === 0) {
      const mb = await tamanhoDbMB()
      console.log(`\n  [pág ${pagina}] Banco: ${mb.toFixed(1)} MB — ${totalLoja.toLocaleString('pt-BR')} salvos`)
      if (mb >= LIMITE_MB) {
        console.log(`⚠️  Limite ${LIMITE_MB} MB atingido — parando para proteger o banco.`)
        abortado = true; break
      }
    }

    // resp1 foi buscado para pagina=1 — reutiliza só na iteração final do loop
    const resp = pagina === 1 ? resp1 : await omieListar(loja.k, loja.s, pagina)
    const ajustes = resp.ajuste_estoque_lista ?? []

    // Em modo incremental: para quando todos os ids desta página ≤ cursor
    if (INCREMENTAL && ajustes.length > 0 && ajustes.every(a => Number(a.id_ajuste) <= cursorId)) {
      console.log(`\n  Cursor alcançado na página ${pagina}.`)
      break
    }

    // Filtra registros válidos
    const filtrados = ajustes.filter(a => {
      if (INCREMENTAL && Number(a.id_ajuste) <= cursorId) return false
      const iso = omieDataParaISO(a.data)
      if (!iso) return false
      if (!FULL_HISTORY && !INCREMENTAL && iso < cutoffISO) return false
      return true
    })

    const salvos = await upsertarLote(loja.id, filtrados)
    totalLoja += salvos
    paginasProcessadas++

    // Em backfill (sem --incremental): para quando TODOS os registros da página são mais antigos que cutoff
    // Isso indica que chegamos na borda da janela de 12 meses
    if (!INCREMENTAL && !FULL_HISTORY && ajustes.length > 0) {
      const todosAntigos = ajustes.every(a => {
        const iso = omieDataParaISO(a.data)
        return iso && iso < cutoffISO
      })
      if (todosAntigos) {
        console.log(`\n  Cutoff de data alcançado na página ${pagina} — encerrando.`)
        break
      }
    }

    if (paginasProcessadas % 50 === 0) {
      const pct = Math.round(((totalPaginas - pagina + 1) / totalPaginas) * 100)
      process.stdout.write(`\r  Pág ${pagina.toLocaleString('pt-BR')} (${pct}% varrido) — ${totalLoja.toLocaleString('pt-BR')} salvos`)
    }

    // Salva checkpoint a cada 10 páginas (retoma sem repetir se interrompido)
    if (!INCREMENTAL && paginasProcessadas % 10 === 0) {
      salvarCheckpoint(loja.id, pagina)
    }

    await sleep(80)
  }

  // Limpeza do checkpoint ao concluir normalmente
  if (!INCREMENTAL && !abortado) apagarCheckpoint(loja.id)

  console.log(`\n  ✓ Loja ${loja.id}: ${totalLoja.toLocaleString('pt-BR')} registros importados`)
  totalGeral += totalLoja

  if (!abortado && lojas.indexOf(loja) < lojas.length - 1) {
    console.log('  Aguardando 5s antes da próxima loja...')
    await sleep(5000)
  }
}

const mbFinal = await tamanhoDbMB()
console.log(`\n✓ SYNC CONCLUÍDO — ${totalGeral.toLocaleString('pt-BR')} registros no total`)
console.log(`  Banco: ${mbInicial.toFixed(1)} MB → ${mbFinal.toFixed(1)} MB (+${(mbFinal - mbInicial).toFixed(1)} MB)`)
await db.end()
