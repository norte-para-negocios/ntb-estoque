// Backfill do buraco 07-13->hoje em notas_fiscais/nota_fiscal_items/
// ordens_producao no Contabo. Diferente do backfill original de 07-12 (que
// teve que reconstruir direto do Omie), esse periodo o Supabase ainda tem
// intacto -- so precisa ler de la e empurrar pros endpoints novos
// (/notas_fiscais_bulk, /ordens_producao_bulk). Idempotente (upsert nos 2
// lados). Uso: node scripts/backfill-nf-op-contabo.mjs [loja_id]
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const CORTE = '2026-07-13'
const LOJAS_PADRAO = [2, 3, 4, 5, 6, 7]
// Achado real (rodando o backfill de verdade): diferente de fat_cupons_bulk
// (linha leve, lote fixo de 200 basta), notas_fiscais_bulk carrega
// full_object aninhado por NF E por item -- um lote de 200 NFs de loja com
// itens grandes estoura o limite de 2mb do body-parser do Express (413,
// mesmo incidente ja documentado pro fat_cupons_bulk). Troca pra lote por
// tamanho estimado em bytes em vez de contagem fixa de linhas.
const MAX_BYTES_LOTE = 1_500_000 // 1.5mb, margem de seguranca abaixo do limite de 2mb

function emLotesPorTamanho(itens, maxBytes = MAX_BYTES_LOTE) {
  const lotes = []
  let atual = []
  let atualBytes = 2 // "[]"
  for (const item of itens) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item)) + 1
    if (atual.length && atualBytes + itemBytes > maxBytes) {
      lotes.push(atual)
      atual = []
      atualBytes = 2
    }
    atual.push(item)
    atualBytes += itemBytes
  }
  if (atual.length) lotes.push(atual)
  return lotes
}

const dbUrl = new URL(env.SUPABASE_DB_URL)
const senha = decodeURIComponent(dbUrl.password)
const ref = dbUrl.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')

let host = 'aws-1-sa-east-1.pooler.supabase.com'
let port = 5432
try {
  const saved = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim()
  const [h, p] = saved.split(':')
  if (h) host = h
  if (p) port = Number(p)
} catch {}

const client = new pg.Client({
  host, port, user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false },
})
await client.connect()

const FRIO_URL = env.NTB_FRIO_API_URL
const FRIO_KEY = env.NTB_FRIO_API_KEY

async function postLote(caminho, body) {
  const resp = await fetch(`${FRIO_URL}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': FRIO_KEY },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`${caminho} respondeu ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function backfillNotasFiscais(lojaId) {
  const { rows: notas } = await client.query(
    `select id, n_id_receb, n_id_fornecedor, c_pessoa_fisica, c_nome, c_razao_social, c_inscricao,
            c_cnpj_cpf, c_chave_nfe, c_etapa, c_numero_nfe, c_serie_nfe, c_modelo_nfe,
            d_emissao_nfe, n_valor_nfe, c_ambiente_nfe, c_natureza_operacao, full_object
     from notas_fiscais where loja_id = $1 and d_emissao_nfe >= $2`,
    [lojaId, CORTE]
  )
  if (!notas.length) return 0
  const ids = notas.map((n) => n.id)
  const { rows: itensRows } = await client.query(
    `select nota_fiscal_id, n_sequencia, n_id_item, n_id_pedido, n_id_it_pedido, n_id_produto,
            c_codigo_produto, c_descricao_produto, c_ignorar_item, c_adicionar_novo,
            c_associar_existente, c_item_devolvido, c_ncm, c_ean, c_cfop, n_qtde_nfe,
            c_unidade_nfe, n_preco_unit, full_object
     from nota_fiscal_items where nota_fiscal_id = any($1::bigint[])`,
    [ids]
  )
  const itensPorNota = new Map()
  for (const it of itensRows) {
    const arr = itensPorNota.get(it.nota_fiscal_id) ?? []
    arr.push(it)
    itensPorNota.set(it.nota_fiscal_id, arr)
  }
  const payload = notas.map((n) => ({
    n_id_receb: n.n_id_receb,
    n_id_fornecedor: n.n_id_fornecedor,
    c_pessoa_fisica: n.c_pessoa_fisica,
    c_nome: n.c_nome,
    c_razao_social: n.c_razao_social,
    c_inscricao: n.c_inscricao,
    c_cnpj_cpf: n.c_cnpj_cpf,
    c_chave_nfe: n.c_chave_nfe,
    c_etapa: n.c_etapa,
    c_numero_nfe: n.c_numero_nfe,
    c_serie_nfe: n.c_serie_nfe,
    c_modelo_nfe: n.c_modelo_nfe,
    d_emissao_nfe: n.d_emissao_nfe,
    n_valor_nfe: n.n_valor_nfe,
    c_ambiente_nfe: n.c_ambiente_nfe,
    c_natureza_operacao: n.c_natureza_operacao,
    full_object: n.full_object,
    itens: (itensPorNota.get(n.id) ?? []).map((it) => ({
      n_sequencia: it.n_sequencia,
      n_id_item: it.n_id_item,
      n_id_pedido: it.n_id_pedido,
      n_id_it_pedido: it.n_id_it_pedido,
      n_id_produto: it.n_id_produto,
      c_codigo_produto: it.c_codigo_produto,
      c_descricao_produto: it.c_descricao_produto,
      c_ignorar_item: it.c_ignorar_item,
      c_adicionar_novo: it.c_adicionar_novo,
      c_associar_existente: it.c_associar_existente,
      c_item_devolvido: it.c_item_devolvido,
      c_ncm: it.c_ncm,
      c_ean: it.c_ean,
      c_cfop: it.c_cfop,
      n_qtde_nfe: it.n_qtde_nfe,
      c_unidade_nfe: it.c_unidade_nfe,
      n_preco_unit: it.n_preco_unit,
      full_object: it.full_object,
    })),
  }))
  for (const lote of emLotesPorTamanho(payload)) {
    await postLote('/notas_fiscais_bulk', { loja_id: lojaId, notas: lote })
  }
  return payload.length
}

async function backfillOrdensProducao(lojaId) {
  const { rows: ordens } = await client.query(
    `select num_ordem, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op,
            identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde,
            identificacao_codigo_local_estoque, concluida, dt_conclusao_real, dt_inclusao, full_object
     from ordens_producao
     where loja_id = $1 and (identificacao_d_dt_previsao >= $2 or updated_at >= $2::date)`,
    [lojaId, CORTE]
  )
  for (const lote of emLotesPorTamanho(ordens)) {
    await postLote('/ordens_producao_bulk', { loja_id: lojaId, ordens: lote })
  }
  return ordens.length
}

const alvo = process.argv[2] ? [Number(process.argv[2])] : LOJAS_PADRAO
for (const lojaId of alvo) {
  const nfCount = await backfillNotasFiscais(lojaId)
  const opCount = await backfillOrdensProducao(lojaId)
  console.log(`loja ${lojaId}: ${nfCount} notas fiscais, ${opCount} ordens de producao`)
}
await client.end()
