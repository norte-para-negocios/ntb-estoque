// Recupera movimentos de transferencias que perderam os itens na recriacao do banco.
// Consulta o Omie (ListarAjustesEstoque) buscando ajustes TRF com cod_int_ajuste
// no padrao "MOV-<id>" e os vincula de volta as transferencias pelo cruzamento
// data + local_origem + local_destino.
//
// Uso (dry-run, so mostra o que encontrou):
//   node scripts/recover-movimentos-omie.mjs [loja_id]
//
// Gravar de verdade (CUIDADO: irreversivel):
//   node scripts/recover-movimentos-omie.mjs [loja_id] --commit
//
// loja_id omitido = processa TODAS as lojas.
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
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()

const ARG_LOJA = process.argv[2] && !process.argv[2].startsWith('-') ? Number(process.argv[2]) : null
const COMMIT = process.argv.includes('--commit')
const sleep = ms => new Promise(r => setTimeout(r, ms))

// DD/MM/YYYY -> YYYY-MM-DD
function omieToISO(d) { const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
// YYYY-MM-DD ou timestamptz -> DD/MM/YYYY (no fuso Bahia)
function isoToOmie(ts) {
  const d = new Date(ts)
  const bahia = new Date(d.getTime() - 3 * 3600 * 1000)
  const dd = String(bahia.getUTCDate()).padStart(2, '0')
  const mm = String(bahia.getUTCMonth() + 1).padStart(2, '0')
  const yy = bahia.getUTCFullYear()
  return `${dd}/${mm}/${yy}`
}

// Chama Omie com retry em rate-limit
async function omie(key, secret, call, param) {
  for (let t = 0; t < 3; t++) {
    const res = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_key: key, app_secret: secret, call, param: [param] }),
    })
    const json = await res.json().catch(() => null)
    const fault = json?.faultstring ?? ''
    if (/n.o existem registros/i.test(fault)) return null
    if (/redundante|aguarde|too many/i.test(fault)) { console.log('  rate limit, aguardando 60s...'); await sleep(62000); continue }
    if (fault) throw new Error(fault)
    return json
  }
  throw new Error('timeout no retry Omie')
}

// Busca TODAS as paginas de ajustes TRF de uma data no Omie
async function listarAjustesDia(key, secret, dataBR, codLocal) {
  const todos = []
  let pag = 1, total = 1
  while (pag <= total) {
    const res = await omie(key, secret, 'ListarAjustesEstoque', {
      nPagina: pag, nRegPorPagina: 50,
      dDataAjusteDe: dataBR, dDataAjusteAte: dataBR,
      // filtra por local de origem para reduzir volume
      ...(codLocal != null ? { nCodLocalEstoque: codLocal } : {}),
    })
    if (!res) break
    total = res.total_de_paginas ?? 1

    // Probe: na primeira pagina, loga a estrutura bruta para diagnostico
    if (pag === 1) {
      const chaves = Object.keys(res)
      console.log('  [PROBE raw]', JSON.stringify(res).slice(0, 300))
      const listKey = chaves.find(k => Array.isArray(res[k]) && k !== 'param')
      if (listKey) console.log(`  [PROBE list key="${listKey}" len=${res[listKey].length}]`, res[listKey][0] ? Object.keys(res[listKey][0]).join(', ') : '(vazio)')
      else console.log('  [PROBE] nenhum array encontrado na resposta')
    }

    // Tenta vários nomes de lista de ajustes que o Omie pode usar
    const lista = res.ajustes ?? res.ajuste ?? res.lista ?? res.registros ?? res.movimentos ?? []
    for (const aj of lista) todos.push(aj)
    pag++
    if (pag <= total) await sleep(500)
  }
  return todos
}

// Lojas a processar
const lojaQuery = ARG_LOJA
  ? 'select id, nome_fantasia n, omie_app_key k, omie_app_secret s from lojas where id=$1 and omie_app_key is not null'
  : 'select id, nome_fantasia n, omie_app_key k, omie_app_secret s from lojas where omie_app_key is not null order by id'
const { rows: lojas } = await db.query(lojaQuery, ARG_LOJA ? [ARG_LOJA] : [])

console.log(`\n=== recover-movimentos-omie${COMMIT ? ' [COMMIT]' : ' [DRY RUN]'} ===`)
console.log(`Lojas: ${lojas.map(l => `${l.id}/${l.n}`).join(', ')}`)

let totalRecuperados = 0

for (const loja of lojas) {
  console.log(`\n--- LOJA ${loja.id} (${loja.n}) ---`)

  // Transferencias concluidas que nao tem movimentos no banco
  const { rows: transfs } = await db.query(`
    select t.id, t.data, t.codigo_local_origem, t.codigo_local_destino, t.motivo
    from transferencias t
    left join movimentos m on m.transferencia_id = t.id
    where t.loja_id = $1
      and t.status = 'Concluido'
    group by t.id, t.data, t.codigo_local_origem, t.codigo_local_destino, t.motivo
    having count(m.id) = 0
    order by t.data desc
  `, [loja.id])

  if (!transfs.length) { console.log('  nenhuma transferencia concluida sem movimentos'); continue }
  console.log(`  ${transfs.length} transferencia(s) concluidas sem movimentos`)

  // Agrupa por data para minimizar chamadas ao Omie
  const porData = new Map()
  for (const t of transfs) {
    const dataBR = isoToOmie(t.data)
    if (!porData.has(dataBR)) porData.set(dataBR, [])
    porData.get(dataBR).push(t)
  }

  for (const [dataBR, ts] of porData) {
    console.log(`\n  Data ${dataBR}: ${ts.length} transferencia(s)`)

    // Pega os locais de origem unicos para esse dia (reduz volume da query Omie)
    const locaisOrigem = [...new Set(ts.map(t => t.codigo_local_origem))]

    // Busca ajustes Omie para cada local de origem
    const ajustesOmie = []
    for (const localCod of locaisOrigem) {
      try {
        const ajes = await listarAjustesDia(loja.k, loja.s, dataBR, localCod)
        ajustesOmie.push(...ajes)
        if (ajes.length) console.log(`    local ${localCod}: ${ajes.length} ajuste(s) no Omie`)
      } catch (e) {
        console.error(`    ERRO ao buscar ajustes local ${localCod}:`, e.message)
      }
      await sleep(400)
    }

    // Filtra apenas os com cod_int_ajuste "MOV-*" (os criados pelo NTB)
    const doCampo = (aj) => aj.cCodIntAjuste ?? aj.cod_int_ajuste ?? aj.cIntAjuste ?? ''
    const dosNtb = ajustesOmie.filter(aj => /^MOV-\d+$/i.test(doCampo(aj)))
    console.log(`    ${dosNtb.length} ajuste(s) com cod_int_ajuste MOV-*`)
    if (!dosNtb.length) continue

    // Pega o código do produto (vários nomes possíveis no Omie)
    const codProd = (aj) => aj.nCodProd ?? aj.nCodProduto ?? aj.cod_produto ?? null
    const qtde    = (aj) => aj.nQtde ?? aj.nQuantidade ?? aj.quan ?? null
    const valor   = (aj) => aj.nValorUnitario ?? aj.nValor ?? aj.valor ?? null
    const locOri  = (aj) => aj.nCodLocalEstoque ?? aj.codigo_local_estoque ?? null
    const locDes  = (aj) => aj.nCodLocalEstoqueDestino ?? aj.codigo_local_estoque_destino ?? null
    const idAjust = (aj) => aj.nCodAjuste ?? aj.id_ajuste ?? null

    // Cruza cada ajuste com a transferencia certa (mesmo local_origem + local_destino)
    for (const t of ts) {
      const match = dosNtb.filter(aj =>
        locOri(aj) == t.codigo_local_origem &&
        locDes(aj) == t.codigo_local_destino
      )
      if (!match.length) { console.log(`    transferencia #${t.id}: NENHUM ajuste encontrado`); continue }

      console.log(`    transferencia #${t.id} (${t.codigo_local_origem}->${t.codigo_local_destino}): ${match.length} produto(s) recuperado(s)`)
      for (const aj of match) {
        const cp = codProd(aj), q = qtde(aj), v = valor(aj), ia = idAjust(aj)
        console.log(`      produto ${cp} qty=${q} val=${v} id_ajuste=${ia} cod=${doCampo(aj)}`)
        if (!cp) { console.log('      AVISO: cod_produto nulo, pulando'); continue }

        if (COMMIT) {
          const tipo = t.motivo === 'TPQ' ? 'TPQ' : 'TRF'
          await db.query(`
            insert into movimentos (loja_id, transferencia_id, tipo, origem, motivo, data, id_prod,
              codigo_local_estoque, codigo_local_estoque_destino, quan, valor, status, id_ajuste)
            values ($1,$2,$3,'AJU',$4,$5,$6,$7,$8,$9,$10,'Concluido',$11)
            on conflict do nothing
          `, [loja.id, t.id, tipo, tipo, t.data, cp, t.codigo_local_origem, t.codigo_local_destino, q, v, ia])
          totalRecuperados++
        } else {
          totalRecuperados++
        }
      }
    }
  }
}

console.log(`\n=== ${COMMIT ? 'GRAVADOS' : 'ENCONTRADOS (dry-run)'}: ${totalRecuperados} movimento(s) ===`)
if (!COMMIT && totalRecuperados > 0) console.log('Rode com --commit para gravar de verdade.')
await db.end()
