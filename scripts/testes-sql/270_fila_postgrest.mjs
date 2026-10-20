// C1: fila de gravação de pedidos de compra no Omie pelo PostgREST de verdade (banco LOCAL + PostgREST local:
// rode por 270_fila_postgrest.sh). Mesmas consultas do código (lib/omie/pedido-compra-gravar.ts): candidatos do cron,
// reivindicação pela RPC pc_omie_reivindicar e bloqueio do Omie gravado em integration_attempts. Nenhuma chamada ao Omie.
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { PostgrestClient } from '@supabase/postgrest-js'
import { filtroFilaCron, ENVIANDO_TRAVADO_MS, JANELA_BLOQUEIO_PERSISTIDO_MS, PREFIXO_LOG_BLOQUEIO, msBloqueioPersistido } from '../../lib/compras/pedido-omie-gravar-puro.ts'

const DB = process.env.DB ?? 'c1'
const URL = process.env.PGRST_URL ?? 'http://127.0.0.1:54399'
const psql = (sql) => {
  const r = spawnSync('docker', ['exec', '-i', 'ntb-teste-sql', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'postgres', '-d', DB], { input: sql, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout.trim()
}
const numero = (s) => Number(s.split('\n').find((l) => /^-?\d+$/.test(l)))

const loja = numero(psql(`insert into lojas (nome, cnpj, modo_estoque, omie_gravar_pedidos_compra, omie_app_key) values ('TESTE C1 FILA', '00000000000279', 'omie', true, 'chave-teste-c1') returning id;`))
try {
  psql(`insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (${loja}, 3155667788, 'AZ', 'AZEITE', 'UN');`)
  // 6 pedidos aprovados + 1 rascunho; cada um num estado da fila
  const ids = []
  for (let i = 0; i < 7; i++) {
    ids.push(numero(psql(`select (pc_salvar(${loja}, '{"fornecedor_nome":"F","previsao_entrega":"2026-10-27","itens":[{"codigo_produto":3155667788,"quantidade":1}]}'::jsonb)->>'id')::bigint;`)))
  }
  for (const id of ids.slice(0, 6)) psql(`select pc_acao(${loja}, ${id}, 'aprovar'); select pc_omie_enfileirar(${loja}, ${id});`)
  const [pendAgora, pendFuturo, enviandoVelho, enviandoNovo, enviado, corrigir, rascunho] = ids
  psql(`
    update pedidos_compra_omie set proxima_tentativa_em = now() - interval '1 minute', tentativas = 1, ultima_tentativa_em = now() - interval '11 minutes' where pedido_id = ${pendAgora};
    update pedidos_compra_omie set proxima_tentativa_em = now() + interval '30 minutes', tentativas = 2, ultima_tentativa_em = now() - interval '1 minute' where pedido_id = ${pendFuturo};
    update pedidos_compra_omie set status = 'enviando', ultima_tentativa_em = now() - interval '2 hours' where pedido_id = ${enviandoVelho};
    update pedidos_compra_omie set status = 'enviando', ultima_tentativa_em = now() - interval '5 minutes' where pedido_id = ${enviandoNovo};
    update pedidos_compra_omie set status = 'enviado', n_cod_ped = 1 where pedido_id = ${enviado};
    update pedidos_compra_omie set status = 'precisa_corrigir', incerto = true, ultima_tentativa_em = now() - interval '11 minutes' where pedido_id = ${corrigir};
    -- rascunho com linha na fila (aprovado antes, reaberto depois): o cron não pega
    insert into pedidos_compra_omie (pedido_id, loja_id, cod_int) values (${rascunho}, ${loja}, 'NTB-PC-${rascunho}');`)

  const db = new PostgrestClient(URL)

  // candidatos do cron
  const { data: fila, error } = await db.from('pedidos_compra_omie').select('pedido_id, pedidos_compra!inner(etapa)')
    .eq('loja_id', loja).eq('pedidos_compra.etapa', 'aprovado').or(filtroFilaCron(Date.now())).order('pedido_id').limit(5)
  assert.equal(error, null, error?.message)
  assert.deepEqual(fila.map((f) => Number(f.pedido_id)).sort((a, b) => a - b), [pendAgora, enviandoVelho].sort((a, b) => a - b))

  // reivindicação pela RPC (com os mesmos parâmetros do código)
  const reiv = async (id, modo = 'enviar') => {
    const r = await db.rpc('pc_omie_reivindicar', { p_loja: loja, p_pedido: id, p_modo: modo, p_travado_seg: Math.round(ENVIANDO_TRAVADO_MS / 1000) })
    assert.equal(r.error, null, r.error?.message)
    return r.data
  }
  let r = await reiv(pendAgora); assert.equal(r.ok, true); assert.equal(r.tentativas, 1); assert.equal(r.status_antes, 'pendente')
  assert.equal((await reiv(pendAgora)).ok, false)                 // já está 'enviando'
  r = await reiv(pendFuturo); assert.equal(r.ok, false); assert.ok(r.proxima_tentativa_em)   // espera a próxima tentativa
  r = await reiv(enviandoVelho); assert.equal(r.ok, true); assert.equal(r.status_antes, 'enviando')   // retomada: o código consulta antes
  assert.equal((await reiv(enviandoNovo)).ok, false)
  assert.equal((await reiv(enviado)).ok, false)
  assert.equal((await reiv(corrigir)).ok, false)                  // 'enviar' não pega precisa_corrigir
  r = await reiv(corrigir, 'conferir'); assert.equal(r.ok, true); assert.equal(r.incerto, true)
  assert.equal((await reiv(rascunho)).ok, false)                  // não aprovado

  // bloqueio do Omie gravado (sobrevive a restart): mesma consulta do código
  const bloqueio = async () => {
    const { data: ls } = await db.from('lojas').select('id').eq('omie_app_key', 'chave-teste-c1')
    const q = await db.from('integration_attempts').select('created_at').in('loja_id', ls.map((l) => Number(l.id)))
      .like('model', `${PREFIXO_LOG_BLOQUEIO}%`).gte('created_at', new Date(Date.now() - JANELA_BLOQUEIO_PERSISTIDO_MS).toISOString())
      .order('created_at', { ascending: false }).limit(1)
    assert.equal(q.error, null, q.error?.message)
    return msBloqueioPersistido(q.data?.[0]?.created_at)
  }
  assert.equal(await bloqueio(), 0)
  psql(`insert into integration_attempts (loja_id, model, request, error, error_message, created_at) values
          (${loja}, 'IncluirPedCompra', '', true, 'erro comum', now()),
          (${loja}, '[BLOQUEIO OMIE] ConcluirOrdemProducao', '', true, 'velho', now() - interval '40 minutes');`)
  assert.equal(await bloqueio(), 0)                               // erro comum e bloqueio de 40 min atrás não contam
  psql(`insert into integration_attempts (loja_id, model, request, error, error_message, created_at) values (${loja}, '[BLOQUEIO OMIE] IncluirPedCompra', '', true, 'consumo indevido', now() - interval '5 minutes');`)
  const ms = await bloqueio()
  assert.ok(ms > 29 * 60_000 && ms <= 30 * 60_000 + 5_000, String(ms))  // relógio do container × máquina
  console.log('270_fila_postgrest: OK')
} finally {
  psql(`set session_replication_role = replica; delete from integration_attempts where loja_id = ${loja}; delete from pedidos_compra_eventos where loja_id = ${loja}; delete from pedidos_compra_omie where loja_id = ${loja}; delete from pedidos_compra where loja_id = ${loja}; delete from produtos where loja_id = ${loja}; delete from lojas where id = ${loja};`)
}
