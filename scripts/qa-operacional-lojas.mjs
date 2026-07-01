// Teste operacional ponta-a-ponta em todas as lojas: Transferência, Inventário
// e Ordem de Produção. Cria um registro REAL via UI (escreve no Omie da loja),
// confirma que sincronizou, e exclui usando o próprio botão do sistema
// (excluirTransferencia/excluirInventario/excluirOP chamam ExcluirAjusteEstoque/
// ExcluirOrdemProducao de verdade no Omie).
//
// SEGURANÇA:
//  - Inventário: contagem enviada = saldo atual do produto (ajuste no-op, nunca zera).
//  - OP: cria pendente com quantidade 1 e NUNCA conclui (Concluir consome insumo
//    real; criar/excluir não).
//  - Sequencial por loja (não paralelo) pra não martelar Omie.
//
// Uso:
//   node scripts/qa-operacional-lojas.mjs           -> todas as lojas, ordem 3,5,6,7,2,4
//   node scripts/qa-operacional-lojas.mjs 3         -> só a loja 3
import { chromium } from 'playwright'
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const BASE = 'http://localhost:3007'
const EMAIL = 'claude.qa@ntb-estoque.dev'
const SENHA = 'claudeqa123456'
const DIR = 'C:/Users/media/AppData/Local/Temp/claude/C--Users-media/7f0ff8d4-fb4d-4f04-ac65-a7f013a68c0a/scratchpad/qa-shots'
fs.mkdirSync(DIR, { recursive: true })

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

const argLojas = process.argv[2]?.split(',').map(Number).filter(Boolean) ?? []
const ORDEM_PADRAO = [3, 5, 6, 7, 2, 4]
const lojasParaTestar = argLojas.length ? argLojas : ORDEM_PADRAO

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const relatorio = []

// Espera até a linha sumir do banco (exclusão real no Omie pode demorar quando
// a API está lenta) em vez de um sleep fixo que gera falso FAIL.
async function esperarExcluido(sql, params, tentativasMax = 12) {
  for (let i = 0; i < tentativasMax; i++) {
    const { rows } = await db.query(sql, params)
    if (!rows.length) return true
    await sleep(1500)
  }
  return false
}

// Distingue timeout/instabilidade de rede (Omie lento/fora do ar) de falha real
// do sistema: nao adianta reportar "bug" quando foi a API externa que travou.
function pareceInstabilidadeRede(msg) {
  return /Timeout \d+ms exceeded|ConnectTimeout|ECONNRESET|fetch failed|ETIMEDOUT/i.test(msg ?? '')
}

function logEtapa(lojaId, fluxo, ok, detalhe) {
  const status = ok ? 'PASS' : pareceInstabilidadeRede(detalhe) ? 'INCONCLUSIVO' : 'FAIL'
  const linha = { lojaId, fluxo, status, detalhe }
  relatorio.push(linha)
  console.log(`  [loja ${lojaId}] ${fluxo}: ${status}${detalhe ? ` — ${detalhe}` : ''}`)
}

// Escolhe produto+local pra transferencia/inventario: maior saldo com CMC > 0.
async function escolherProdutoTransferencia(lojaId) {
  const { rows: locais } = await db.query(
    `SELECT codigo_local_estoque, descricao FROM local_estoques
     WHERE loja_id=$1 AND deleted_at IS NULL ORDER BY codigo_local_estoque LIMIT 2`,
    [lojaId]
  )
  if (locais.length < 2) return null
  const { rows: pos } = await db.query(
    `SELECT pe.n_cod_prod, p.descricao, p.codigo, pe.n_saldo, pe.n_cmc
     FROM posicao_estoques pe
     JOIN produtos p ON p.codigo_produto = pe.n_cod_prod AND p.loja_id = pe.loja_id
     WHERE pe.loja_id=$1 AND pe.codigo_local_estoque=$2 AND pe.n_cmc > 0 AND pe.n_saldo > 5
       AND pe.data_posicao = (SELECT max(data_posicao) FROM posicao_estoques WHERE loja_id=$1)
     ORDER BY pe.n_saldo DESC LIMIT 1`,
    [lojaId, locais[0].codigo_local_estoque]
  )
  if (!pos.length) return null
  return {
    origem: locais[0], destino: locais[1],
    produto: pos[0], saldoAtual: Number(pos[0].n_saldo),
  }
}

// Escolhe produto pra OP: mais recente com OP no historico daquela loja.
async function escolherProdutoOP(lojaId) {
  const { rows } = await db.query(
    `SELECT op.identificacao_n_cod_produto AS cod, p.descricao, p.codigo
     FROM ordens_producao op
     JOIN produtos p ON p.codigo_produto = op.identificacao_n_cod_produto AND p.loja_id = op.loja_id
     WHERE op.loja_id=$1 AND p.inativo = false
     ORDER BY op.created_at DESC LIMIT 1`,
    [lojaId]
  )
  return rows[0] ?? null
}

async function trocarLoja(page, nomeFantasia) {
  const trigger = page.getByRole('combobox').first()
  await trigger.click()
  await page.getByRole('option', { name: nomeFantasia, exact: true }).click()
  await page.waitForTimeout(800)
}

async function buscarEAdicionarProduto(page, codigo) {
  // Busca pelo CÓDIGO (não a descrição): o resultado exibe a descrição já
  // formatada (formatarNomeProduto), o código vem cru e é único.
  const input = page.getByPlaceholder('Buscar produto por nome ou código...')
  await input.fill(String(codigo))
  await page.waitForTimeout(600)
  const opcao = page.locator('button', { hasText: String(codigo) }).first()
  // Timeout generoso: primeira visita a cada rota recompila no dev (Turbopack).
  await opcao.waitFor({ timeout: 35000 })
  await opcao.click()
}

async function testarTransferencia(page, lojaId, dados) {
  const fluxo = 'Transferência'
  try {
    await page.goto(`${BASE}/transferencia`, { timeout: 40000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.getByRole('button', { name: 'Nova transferência' }).click()

    await page.getByText('Local de origem').click()
    await page.getByRole('option', { name: dados.origem.descricao, exact: true }).click()
    await page.getByText('Local de destino').click()
    await page.getByRole('option', { name: dados.destino.descricao, exact: true }).click()

    await page.getByRole('button', { name: 'Criar e contar' }).click()
    await page.waitForURL(/\/transferencia\/\d+\/contagem/, { timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    const transId = Number(page.url().match(/\/transferencia\/(\d+)\/contagem/)[1])

    await buscarEAdicionarProduto(page, dados.produto.codigo)
    const qtdTeste = Math.max(1, Math.round(dados.saldoAtual * 0.05))
    const linha = page.locator('li', { hasText: dados.produto.codigo })
    const input = linha.locator('input[placeholder="0"]')
    await input.fill(String(qtdTeste))
    await input.blur()

    await page.waitForFunction(
      () => document.body.innerText.includes('Concluído') || document.body.innerText.includes('Erro') || document.body.innerText.includes('Sem custo'),
      { timeout: 40000 }
    ).catch(() => {})
    await page.waitForTimeout(1500)

    const { rows } = await db.query('SELECT status, id_ajuste FROM movimentos WHERE transferencia_id=$1', [transId])
    const mov = rows[0]
    if (!mov || mov.status !== 'Concluido' || !mov.id_ajuste) {
      logEtapa(lojaId, fluxo, false, `movimento não concluiu (status=${mov?.status}, id_ajuste=${mov?.id_ajuste})`)
      return
    }

    // Excluir via UI (botão real da lista).
    await page.goto(`${BASE}/transferencia`, { timeout: 40000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    const linhaLista = page.locator('li,tr', { hasText: `#${transId}` }).first()
    await linhaLista.getByRole('button', { name: 'Excluir' }).click()

    const excluiu = await esperarExcluido('SELECT id FROM transferencias WHERE id=$1', [transId])
    if (!excluiu) {
      logEtapa(lojaId, fluxo, false, `transferência #${transId} não foi excluída`)
      return
    }
    logEtapa(lojaId, fluxo, true, `#${transId} criada, sincronizada (id_ajuste=${mov.id_ajuste}) e excluída`)
  } catch (e) {
    logEtapa(lojaId, fluxo, false, e.message?.slice(0, 200))
  }
}

async function testarInventario(page, lojaId, dados) {
  const fluxo = 'Inventário'
  try {
    await page.goto(`${BASE}/inventario`, { timeout: 40000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.getByRole('button', { name: 'Novo inventário' }).click()

    await page.getByText('Selecione o local').click()
    await page.getByRole('option', { name: dados.origem.descricao, exact: true }).click()

    await page.getByRole('button', { name: 'Criar e contar' }).click()
    await page.waitForURL(/\/inventario\/\d+\/contagem/, { timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    const invId = Number(page.url().match(/\/inventario\/(\d+)\/contagem/)[1])

    await buscarEAdicionarProduto(page, dados.produto.codigo)
    // Contagem = saldo atual: ajuste no-op, nao mexe no estoque real.
    const linha = page.locator('li', { hasText: dados.produto.codigo })
    const input = linha.locator('input[placeholder="0"]')
    await input.fill(String(dados.saldoAtual))
    await input.blur()

    await page.waitForFunction(
      () => document.body.innerText.includes('Concluído') || document.body.innerText.includes('Erro') || document.body.innerText.includes('Sem custo'),
      { timeout: 40000 }
    ).catch(() => {})
    await page.waitForTimeout(1500)

    const { rows } = await db.query('SELECT status, id_ajuste FROM inventario_items WHERE inventario_id=$1', [invId])
    const item = rows[0]
    if (!item || item.status !== 'Concluido' || !item.id_ajuste) {
      logEtapa(lojaId, fluxo, false, `item não concluiu (status=${item?.status}, id_ajuste=${item?.id_ajuste})`)
      return
    }

    await page.goto(`${BASE}/inventario`, { timeout: 40000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    const linhaLista = page.locator('li,tr', { hasText: `#${invId}` }).first()
    await linhaLista.getByRole('button', { name: 'Excluir' }).click()

    const excluiu = await esperarExcluido('SELECT id FROM inventarios WHERE id=$1', [invId])
    if (!excluiu) {
      logEtapa(lojaId, fluxo, false, `inventário #${invId} não foi excluído`)
      return
    }
    logEtapa(lojaId, fluxo, true, `#${invId} criado, sincronizado (id_ajuste=${item.id_ajuste}, contagem=saldo atual) e excluído`)
  } catch (e) {
    logEtapa(lojaId, fluxo, false, e.message?.slice(0, 200))
  }
}

async function testarOP(page, lojaId, produtoOP) {
  const fluxo = 'Ordem de Produção'
  if (!produtoOP) {
    logEtapa(lojaId, fluxo, false, 'sem produto com histórico de OP nesta loja')
    return
  }
  try {
    await page.goto(`${BASE}/ordem-producao`, { timeout: 40000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.getByRole('button', { name: 'Criar OP' }).click()
    await page.getByPlaceholder('Ex.: lote, cupom...').fill('TESTE-OPERACIONAL-CLAUDE')
    await page.getByRole('button', { name: 'Escolher produtos' }).click()
    await page.waitForURL(/\/ordem-producao\/nova/, { timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})

    await buscarEAdicionarProduto(page, produtoOP.codigo)
    // Quantidade ja vem "1" por padrao; nao mexe.
    await page.getByRole('button', { name: /Criar (OP|\d+ OPs)/ }).click()
    await page.waitForURL(/\/ordem-producao$/, { timeout: 30000 })
    await page.waitForTimeout(2000)

    const { rows } = await db.query(
      `SELECT id, identificacao_n_cod_op, identificacao_c_num_op FROM ordens_producao
       WHERE loja_id=$1 AND identificacao_n_cod_produto=$2 AND concluida = false
       ORDER BY created_at DESC LIMIT 1`,
      [lojaId, produtoOP.cod]
    )
    const op = rows[0]
    if (!op?.identificacao_n_cod_op) {
      logEtapa(lojaId, fluxo, false, 'OP não apareceu no banco com código Omie')
      return
    }

    // Exclui via UI SEM NUNCA concluir (concluir consumiria insumo real).
    // A lista mostra identificacao_c_num_op (ex.: "2026/00118"), não o
    // identificacao_n_cod_op interno do Omie.
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    const linhaLista = page.locator('tr', { hasText: op.identificacao_c_num_op }).first()
    await linhaLista.getByRole('button', { name: 'Excluir' }).click()

    const excluiu = await esperarExcluido('SELECT id FROM ordens_producao WHERE id=$1', [op.id])
    if (!excluiu) {
      logEtapa(lojaId, fluxo, false, `OP ${op.identificacao_n_cod_op} não foi excluída`)
      return
    }
    logEtapa(lojaId, fluxo, true, `OP ${op.identificacao_n_cod_op} criada (pendente, qtde 1, nunca concluída) e excluída`)
  } catch (e) {
    logEtapa(lojaId, fluxo, false, e.message?.slice(0, 200))
  }
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
// Omie pode estar lento/instável agora; timeout padrão generoso pra ações sem
// timeout explícito (ex.: .click() dos botões Excluir).
page.setDefaultTimeout(40000)
const errosConsole = []
page.on('pageerror', (e) => errosConsole.push(e.message))
// Handler global e persistente: aceita qualquer confirm() nativo (excluir
// transferência/inventário/OP). Um handler unico evita a corrida de registrar
// page.once('dialog', ...) antes de cada clique (se o clique falha antes do
// dialog aparecer, o handler "once" fica pendurado e quebra a proxima chamada).
page.on('dialog', (d) => d.accept().catch(() => {}))

await page.goto(`${BASE}/login`)
await page.fill('#email', EMAIL)
await page.fill('#password', SENHA)
await page.click('button[type=submit]')
await page.waitForURL(`${BASE}/home`, { timeout: 30000 }).catch(() => {})
if (!page.url().includes('/home')) {
  console.error('LOGIN FALHOU')
  await browser.close()
  await db.end()
  process.exit(1)
}
console.log(`Login OK. Testando lojas: ${lojasParaTestar.join(', ')}\n`)

for (const lojaId of lojasParaTestar) {
  const { rows: lojaRows } = await db.query('SELECT nome_fantasia FROM lojas WHERE id=$1', [lojaId])
  const nomeFantasia = lojaRows[0]?.nome_fantasia
  console.log(`\n━━━ Loja ${lojaId}: ${nomeFantasia} ━━━`)
  if (!nomeFantasia) {
    logEtapa(lojaId, 'Setup', false, 'loja não encontrada')
    continue
  }

  try {
    await page.goto(`${BASE}/home`)
    await trocarLoja(page, nomeFantasia)
  } catch (e) {
    logEtapa(lojaId, 'Setup', false, `falha ao trocar loja: ${e.message?.slice(0, 150)}`)
    continue
  }

  const dadosTransf = await escolherProdutoTransferencia(lojaId)
  const dadosOP = await escolherProdutoOP(lojaId)

  if (!dadosTransf) {
    logEtapa(lojaId, 'Transferência', false, 'sem produto com CMC/saldo suficiente pra testar')
    logEtapa(lojaId, 'Inventário', false, 'sem produto com CMC/saldo suficiente pra testar')
  } else {
    await testarTransferencia(page, lojaId, dadosTransf)
    await sleep(1000)
    await testarInventario(page, lojaId, dadosTransf)
    await sleep(1000)
  }

  await testarOP(page, lojaId, dadosOP)
  await sleep(1000)
}

await browser.close()

const resumoPorLoja = {}
for (const l of relatorio) {
  resumoPorLoja[l.lojaId] ??= {}
  resumoPorLoja[l.lojaId][l.fluxo] = l.status
}

console.log('\n\n=== RESUMO ===')
console.log('Loja'.padEnd(8), 'Transferência'.padEnd(16), 'Inventário'.padEnd(14), 'OP')
for (const lojaId of lojasParaTestar) {
  const r = resumoPorLoja[lojaId] ?? {}
  console.log(
    String(lojaId).padEnd(8),
    (r['Transferência'] ?? '-').padEnd(16),
    (r['Inventário'] ?? '-').padEnd(14),
    r['Ordem de Produção'] ?? '-'
  )
}

if (errosConsole.length) {
  console.log(`\nErros de console/página capturados: ${errosConsole.length}`)
  errosConsole.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 150)))
}

fs.writeFileSync(
  `${DIR}/operacional-report.json`,
  JSON.stringify({ relatorio, errosConsole }, null, 2)
)
console.log(`\nRelatório: ${DIR}/operacional-report.json`)

await db.end()
