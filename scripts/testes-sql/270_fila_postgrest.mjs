// C1: filtros da fila de gravação de pedidos de compra no Omie pelo PostgREST de verdade (banco LOCAL + PostgREST local:
// rode por 270_fila_postgrest.sh). Mesmas strings de filtro do código (lib/omie/pedido-compra-gravar.ts).
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { PostgrestClient } from '@supabase/postgrest-js'
import { filtroFilaCron, filtroReivindicarPendente, ENVIANDO_TRAVADO_MS } from '../../lib/compras/pedido-omie-gravar-puro.ts'

const DB = process.env.DB ?? 'c1'
const URL = process.env.PGRST_URL ?? 'http://127.0.0.1:54399'
const psql = (sql) => {
  const r = spawnSync('docker', ['exec', '-i', 'ntb-teste-sql', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'postgres', '-d', DB], { input: sql, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout.trim()
}
const ultimo = (s) => s.split('\n').find((l) => /^-?\d+$/.test(l))

const loja = Number(ultimo(psql(`insert into lojas (nome, cnpj, modo_estoque, omie_gravar_pedidos_compra) values ('TESTE C1 FILA', '00000000000279', 'omie', true) returning id;`)))
try {
  psql(`insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (${loja}, 3155667788, 'AZ', 'AZEITE', 'UN');`)
  // 6 pedidos aprovados + 1 rascunho; cada um num estado da fila
  const ids = []
  for (let i = 0; i < 7; i++) {
    ids.push(Number(ultimo(psql(`select (pc_salvar(${loja}, '{"fornecedor_nome":"F","previsao_entrega":"2026-10-27","itens":[{"codigo_produto":3155667788,"quantidade":1}]}'::jsonb)->>'id')::bigint;`))))
  }
  for (const id of ids.slice(0, 6)) psql(`select pc_acao(${loja}, ${id}, 'aprovar'); select pc_omie_enfileirar(${loja}, ${id});`)
  const [pendAgora, pendFuturo, enviandoVelho, enviandoNovo, enviado, corrigir, rascunho] = ids
  psql(`
    update pedidos_compra_omie set proxima_tentativa_em = now() - interval '1 minute', tentativas = 1, ultima_tentativa_em = now() - interval '11 minutes' where pedido_id = ${pendAgora};
    update pedidos_compra_omie set proxima_tentativa_em = now() + interval '30 minutes', tentativas = 2, ultima_tentativa_em = now() - interval '1 minute' where pedido_id = ${pendFuturo};
    update pedidos_compra_omie set status = 'enviando', ultima_tentativa_em = now() - interval '2 hours' where pedido_id = ${enviandoVelho};
    update pedidos_compra_omie set status = 'enviando', ultima_tentativa_em = now() - interval '5 minutes' where pedido_id = ${enviandoNovo};
    update pedidos_compra_omie set status = 'enviado', n_cod_ped = 1 where pedido_id = ${enviado};
    update pedidos_compra_omie set status = 'precisa_corrigir' where pedido_id = ${corrigir};
    -- rascunho com linha na fila (aprovado antes, reaberto depois): o cron não pega
    insert into pedidos_compra_omie (pedido_id, loja_id, cod_int) values (${rascunho}, ${loja}, 'NTB-PC-${rascunho}');`)

  const db = new PostgrestClient(URL)

  // fila do cron
  const { data: fila, error } = await db.from('pedidos_compra_omie').select('pedido_id, pedidos_compra!inner(etapa)')
    .eq('loja_id', loja).eq('pedidos_compra.etapa', 'aprovado').or(filtroFilaCron(Date.now())).order('pedido_id').limit(5)
  assert.equal(error, null, error?.message)
  assert.deepEqual(fila.map((f) => Number(f.pedido_id)).sort((a, b) => a - b), [pendAgora, enviandoVelho].sort((a, b) => a - b))

  // reivindicar: só o pendente na hora; a 2ª reivindicação do mesmo pedido não pega nada
  const reiv = (id, manual) => db.from('pedidos_compra_omie').update({ status: 'enviando', ultima_tentativa_em: new Date().toISOString() })
    .eq('pedido_id', id).eq('loja_id', loja).eq('status', 'pendente').or(filtroReivindicarPendente(Date.now(), manual)).select('pedido_id, tentativas')
  let r = await reiv(pendAgora, false); assert.equal(r.error, null, r.error?.message); assert.equal(r.data.length, 1); assert.equal(r.data[0].tentativas, 1)
  r = await reiv(pendAgora, false); assert.equal(r.data.length, 0)
  r = await reiv(pendFuturo, false); assert.equal(r.data.length, 0)        // espera a próxima tentativa
  r = await reiv(pendFuturo, true); assert.equal(r.data.length, 0)         // manual: tentou há 1 min (< 2 min)
  r = await reiv(enviado, true); assert.equal(r.data.length, 0)
  r = await reiv(corrigir, true); assert.equal(r.data.length, 0)
  psql(`update pedidos_compra_omie set ultima_tentativa_em = now() - interval '3 minutes' where pedido_id = ${pendFuturo};`)
  r = await reiv(pendFuturo, true); assert.equal(r.data.length, 1)         // manual: passou o intervalo, ignora a espera

  // 'enviando' esquecido: reivindicado pelo .lt (o código faz igual); o recente não
  const lt = (id) => db.from('pedidos_compra_omie').update({ ultima_tentativa_em: new Date().toISOString() })
    .eq('pedido_id', id).eq('status', 'enviando').lt('ultima_tentativa_em', new Date(Date.now() - ENVIANDO_TRAVADO_MS).toISOString()).select('pedido_id')
  assert.equal((await lt(enviandoVelho)).data.length, 1)
  assert.equal((await lt(enviandoNovo)).data.length, 0)
  console.log('270_fila_postgrest: OK')
} finally {
  psql(`set session_replication_role = replica; delete from pedidos_compra_eventos where loja_id = ${loja}; delete from pedidos_compra_omie where loja_id = ${loja}; delete from pedidos_compra where loja_id = ${loja}; delete from produtos where loja_id = ${loja}; delete from lojas where id = ${loja};`)
}
