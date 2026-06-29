// Sincroniza ajustes de estoque do Omie → tabela movimentos.
// API sort: ASCENDENTE por id_ajuste (página 1 = mais antigos).
// Backfill: varre todas as páginas, filtra por data >= cutoff.
// Incremental: varre das últimas páginas para frente, para quando id <= cursor.
//
// SEGURANÇA DE BANCO: aborta automaticamente ao atingir 480MB.
// Nunca toca na loja 4 (O SERTAO VAI VIRAR MAR - produção).
//
// Uso:
//   node scripts/sync-ajustes-omie.mjs              → todas as lojas, últimos 12 meses
//   node scripts/sync-ajustes-omie.mjs 3             → só loja 3
//   node scripts/sync-ajustes-omie.mjs 3 --full      → sem corte de data (histórico completo)
//   node scripts/sync-ajustes-omie.mjs 3 --incremental → só registros novos (ids > max)
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
const LIMITE_MB = 480  // aborta antes de estourar o free tier do Supabase (500MB)

// Cutoff: se não for --full, só importa registros a partir de 12 meses atrás
const hoje = new Date()
const cutoffDate = FULL_HISTORY
  ? new Date('2020-01-01')
  : new Date(hoje.getFullYear() - 1, hoje.getMonth(), hoje.getDate())
const cutoffISO = cutoffDate.toISOString().slice(0, 10)

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Verifica tamanho do banco. Retorna MB.
async function tamanhoDbMB() {
  const { rows: [r] } = await db.query(
    "SELECT pg_database_size(current_database()) / 1048576.0 AS mb"
  )
  return Number(r.mb)
}

const mbInicial = await tamanhoDbMB()
console.log(`Banco atual: ${mbInicial.toFixed(1)} MB / limite ${LIMITE_MB} MB`)
if (mbInicial >= LIMITE_MB) {
  console.error('BANCO JÁ ESTÁ NO LIMITE — abortar antes de qualquer inserção.')
  await db.end(); process.exit(1)
}
console.log(`Modo: ${FULL_HISTORY ? 'HISTÓRICO COMPLETO' : `últimos 12 meses (>= ${cutoffISO})`}${INCREMENTAL ? ' | incremental' : ''}`)

// Lojas ativas (exceto loja 4 = O SERTAO VAI VIRAR MAR, produção protegida)
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
  if (anoN < 2020 || anoN > 2100) return null  // filtra datas corrompidas
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
}

// Chama o Omie com retry em rate-limits conhecidos
async function omieListar(key, secret, pagina, registros_por_pagina = 50) {
  for (let tentativa = 1; tentativa <= 8; tentativa++) {
    const r = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarAjusteEstoque',
        app_key: key,
        app_secret: secret,
        param: [{ pagina, registros_por_pagina }],
      }),
    })
    const j = await r.json()
    const fault = j?.faultstring ?? ''
    // Concorrência (8020): outra requisição em andamento
    if (j?.faultcode?.includes('8020') || /requisição.*executada/i.test(fault)) {
      const espera = 2000 * tentativa
      console.log(`\n    concorrência Omie (t${tentativa}), aguardando ${espera / 1000}s...`)
      await sleep(espera); continue
    }
    // Redundância (Client-6): "Consumo redundante detectado. Aguarde X segundos"
    if (/REDUNDANT/i.test(fault) || /redundante/i.test(fault)) {
      const m = fault.match(/Aguarde (\d+) segundo/)
      const espera = m ? (Number(m[1]) + 3) * 1000 : 65000
      console.log(`\n    redundância Omie (t${tentativa}), aguardando ${Math.round(espera / 1000)}s...`)
      await sleep(espera); continue
    }
    if (fault) throw new Error(`Omie: ${fault}`)
    return j
  }
  throw new Error('Rate limit persistente após 8 tentativas')
}

// Upserta lote em movimentos usando INSERT ... VALUES (...), (...) para performance
async function upsertarLote(lojaId, registros) {
  if (!registros.length) return 0
  const linhas = registros.map(r => ({
    loja_id: lojaId,
    id_ajuste: r.id_ajuste,
    id_prod: r.id_prod || null,
    tipo: r.tipo,
    quan: r.quantidade ?? 0,
    valor: r.valor ?? 0,
    codigo_local_estoque: r.codigo_local_estoque || null,
    codigo_local_estoque_destino: r.id_local_ds || null,
    data: omieDataParaISO(r.data),
    motivo: r.motivo || null,
    obs: r.obs || null,
  })).filter(l => l.data !== null)

  if (!linhas.length) return 0

  // Batch upsert em chunks de 25 para não explodir o limite de parâmetros do pg
  const CHUNK = 25
  let total = 0
  for (let i = 0; i < linhas.length; i += CHUNK) {
    const chunk = linhas.slice(i, i + CHUNK)
    const cols = 11  // colunas com $-params (origem e status são literais)
    const vals = []
    const params = []
    chunk.forEach((l, idx) => {
      const base = idx * cols
      vals.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},'AJU','Concluido',now(),now())`)
      params.push(l.loja_id, l.id_ajuste, l.id_prod, l.tipo, l.quan, l.valor,
        l.codigo_local_estoque, l.codigo_local_estoque_destino,
        l.data, l.motivo, l.obs)
    })
    await db.query(
      `INSERT INTO movimentos
         (loja_id,id_ajuste,id_prod,tipo,quan,valor,
          codigo_local_estoque,codigo_local_estoque_destino,
          data,motivo,obs,origem,status,created_at,updated_at)
       VALUES ${vals.join(',')}
       ON CONFLICT (loja_id, id_ajuste) WHERE id_ajuste IS NOT NULL
       DO UPDATE SET
         tipo = EXCLUDED.tipo, quan = EXCLUDED.quan, valor = EXCLUDED.valor,
         codigo_local_estoque = EXCLUDED.codigo_local_estoque,
         codigo_local_estoque_destino = EXCLUDED.codigo_local_estoque_destino,
         data = EXCLUDED.data, motivo = EXCLUDED.motivo, updated_at = now()`,
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

  // Verifica tamanho antes de cada loja
  const mbAtual = await tamanhoDbMB()
  if (mbAtual >= LIMITE_MB) {
    console.log(`⚠️  Banco em ${mbAtual.toFixed(1)} MB — limite ${LIMITE_MB} MB atingido, parando.`)
    abortado = true; break
  }
  console.log(`  Banco: ${mbAtual.toFixed(1)} MB`)

  // Busca primeira página para saber o total
  let resp1
  try { resp1 = await omieListar(loja.k, loja.s, 1) } catch (e) {
    console.error(`  Erro ao buscar página 1: ${e.message}`); continue
  }
  const totalPaginas = resp1.total_de_paginas ?? 1
  const totalRegs = resp1.total_de_registros ?? 0
  console.log(`  Total Omie: ${totalRegs.toLocaleString('pt-BR')} registros em ${totalPaginas.toLocaleString('pt-BR')} páginas`)

  let totalLoja = 0

  if (INCREMENTAL) {
    // Cursor: max id_ajuste já salvo para esta loja
    const { rows } = await db.query(
      'SELECT max(id_ajuste) max_id FROM movimentos WHERE loja_id = $1 AND id_ajuste IS NOT NULL',
      [loja.id]
    )
    const cursorId = Number(rows[0]?.max_id ?? 0)
    console.log(`  Cursor: id_ajuste > ${cursorId} | varrendo das últimas páginas para as primeiras`)

    // Sort ASC: últimas páginas têm ids maiores (mais recentes)
    for (let pagina = totalPaginas; pagina >= 1; pagina--) {
      const mbCheck = pagina % 200 === 0 ? await tamanhoDbMB() : 0
      if (mbCheck && mbCheck >= LIMITE_MB) {
        console.log(`\n⚠️  ${mbCheck.toFixed(1)} MB — parando na página ${pagina}`)
        abortado = true; break
      }

      const resp = pagina === 1 ? resp1 : await omieListar(loja.k, loja.s, pagina)
      const ajustes = resp.ajuste_estoque_lista ?? []

      if (ajustes.every(a => Number(a.id_ajuste) <= cursorId)) {
        console.log(`\n  Cursor alcançado na página ${pagina}, encerrando.`)
        break
      }

      const novos = ajustes.filter(a => Number(a.id_ajuste) > cursorId)
      const salvos = await upsertarLote(loja.id, novos)
      totalLoja += salvos

      if ((totalPaginas - pagina) % 20 === 0) {
        process.stdout.write(`\r  Pág ${pagina.toLocaleString('pt-BR')} — ${totalLoja.toLocaleString('pt-BR')} novos`)
      }
      await sleep(80)
    }
  } else {
    // BACKFILL: varre da página 1 ao fim, filtra por data >= cutoff
    const filtP1 = (resp1.ajuste_estoque_lista ?? []).filter(a => {
      const iso = omieDataParaISO(a.data)
      return iso && iso >= cutoffISO
    })
    totalLoja += await upsertarLote(loja.id, filtP1)

    for (let pagina = 2; pagina <= totalPaginas; pagina++) {
      // Verifica tamanho a cada 500 páginas
      if (pagina % 500 === 0) {
        const mb = await tamanhoDbMB()
        console.log(`\n  [${pagina}/${totalPaginas}] Banco: ${mb.toFixed(1)} MB — ${totalLoja.toLocaleString('pt-BR')} salvos`)
        if (mb >= LIMITE_MB) {
          console.log(`⚠️  Limite ${LIMITE_MB} MB atingido — parando para proteger o banco.`)
          abortado = true; break
        }
      }

      let resp
      try { resp = await omieListar(loja.k, loja.s, pagina) } catch (e) {
        console.error(`\n  Página ${pagina}: ERRO — ${e.message}`); break
      }
      const filtrados = (resp.ajuste_estoque_lista ?? []).filter(a => {
        const iso = omieDataParaISO(a.data)
        return iso && iso >= cutoffISO
      })
      totalLoja += await upsertarLote(loja.id, filtrados)

      if (pagina % 100 === 0 || pagina === totalPaginas) {
        const pct = Math.round((pagina / totalPaginas) * 100)
        process.stdout.write(`\r  Pág ${pagina.toLocaleString('pt-BR')}/${totalPaginas.toLocaleString('pt-BR')} (${pct}%) — ${totalLoja.toLocaleString('pt-BR')} salvos`)
      }
      await sleep(80)
    }
  }

  console.log(`\n  ✓ Loja ${loja.id}: ${totalLoja.toLocaleString('pt-BR')} registros importados`)
  totalGeral += totalLoja

  // Pausa entre lojas para respeitar rate limit do Omie
  if (lojas.indexOf(loja) < lojas.length - 1) {
    console.log('  Aguardando 10s antes da próxima loja...')
    await sleep(10000)
  }
}

const mbFinal = await tamanhoDbMB()
console.log(`\n✓ SYNC CONCLUÍDO — ${totalGeral.toLocaleString('pt-BR')} registros no total`)
console.log(`  Banco: ${mbInicial.toFixed(1)} MB → ${mbFinal.toFixed(1)} MB (+${(mbFinal - mbInicial).toFixed(1)} MB)`)
await db.end()
