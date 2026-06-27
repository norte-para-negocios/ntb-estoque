// Cria produto FRESCO (código único), manda intMalha vazio p/ revelar o campo
// obrigatório interno, depois exclui. Poucas calls, bem espaçadas.
import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows: lr } = await db.query('select omie_app_key k, omie_app_secret s from lojas where id=3')
const loja = lr[0]
const { rows: mp } = await db.query(`select codigo_produto, codigo from produtos where loja_id=3 and tipo_item='01' order by codigo_produto limit 1`)
await db.end()
const comp = mp[0]
async function omie(endpoint, call, data) {
  const r = await fetch(`https://app.omie.com.br/api/${endpoint}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: loja.k, app_secret: loja.s, param: [data] }) })
  return r.json()
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const codTeste = 'ZZTM' + Math.floor(Math.random() * 90000 + 10000)
const prod = await omie('v1/geral/produtos', 'IncluirProduto', { codigo: codTeste, codigo_produto_integracao: codTeste, descricao: 'ZZ TESTE MALHA CLAUDE (apagar)', unidade: 'UN', ncm: '21069090', valor_unitario: 0, tipoItem: '04' })
const idPai = prod?.codigo_produto
if (!idPai) { console.log('falhou criar/bloqueado:', JSON.stringify(prod).slice(0,160)); process.exit(1) }
console.log('idPai FRESCO:', idPai, '| componente idProduto', comp.codigo_produto, 'cod', comp.codigo)

const variantes = [
  { nome: 'campo zzz (semantica)', body: { idProduto: idPai, itemMalhaIncluir: { intMalha: { zzz: 1 } } } },
  { nome: 'codProdMalha', body: { idProduto: idPai, itemMalhaIncluir: { intMalha: { codProdMalha: comp.codigo, quantProdMalha: 3, percPerdaProdMalha: 0 } } } },
  { nome: 'idMalha+codProduto', body: { idProduto: idPai, itemMalhaIncluir: { intMalha: { idMalha: 0, codProduto: comp.codigo, quantidade: 3 } } } },
]
for (const v of variantes) {
  await sleep(3000)
  const inc = await omie('v1/geral/malha', 'IncluirEstrutura', v.body)
  console.log(`\n[${v.nome}] ->`, inc?.faultstring ? `FAULT: ${inc.faultstring}` : `OK: ${JSON.stringify(inc).slice(0,200)}`)
  if (!inc?.faultstring) {
    await sleep(3000)
    const vv = await omie('v1/geral/malha', 'ConsultarEstrutura', { idProduto: idPai })
    console.log('VERIFICAÇÃO itens:', JSON.stringify(vv?.itens, null, 2))
    break
  }
}

await sleep(3000)
const d = await omie('v1/geral/produtos', 'ExcluirProduto', { codigo_produto: idPai })
console.log('\nExcluirProduto ->', d?.faultstring || 'OK')
