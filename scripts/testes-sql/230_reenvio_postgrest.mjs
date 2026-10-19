// Revisão I1 da Fase F: com o mês fechado, as consultas dos reenvios ao Omie (mesmos filtros dos crons, pelo PostgREST
// de verdade) deixam de fora as pendências do mês fechado DENTRO da consulta, então elas não ocupam o limite e o
// pendente de um mês aberto continua saindo. Banco LOCAL + PostgREST local: rode por 230_reenvio_postgrest.sh.
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { PostgrestClient } from '@supabase/postgrest-js'
import { filtrosForaDosFechados, filtrosConclusaoOPForaDosFechados } from '../../lib/estoque/periodo-fechado-puro.ts'

const DB = process.env.DB ?? 'f1'
const URL = process.env.PGRST_URL ?? 'http://127.0.0.1:54399'
const psql = (sql) => {
  const r = spawnSync('docker', ['exec', '-i', 'ntb-teste-sql', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'postgres', '-d', DB], { input: sql, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout.trim()
}
const semMesFechado = (q, filtros, tabela) => { for (const f of filtros) q = tabela ? q.or(f, { referencedTable: tabela }) : q.or(f); return q }

const loja = Number(psql(`
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE I1', '00000000000299', 'omie') returning id;`).split('\n')[0])
try {
  psql(`
    -- 35 ajustes de setembro esperando reenvio (os mais antigos) + 1 de outubro
    insert into movimentos (loja_id, codigo_local_estoque, id_prod, data, tipo, status, tentativas, quan, ultima_tentativa_em)
      select ${loja}, 1, 501, '2026-09-10 12:00-03', 'SAI', 'Erro', 1, 1, '2026-09-11 00:00-03' from generate_series(1, 35);
    insert into movimentos (loja_id, codigo_local_estoque, id_prod, data, tipo, status, tentativas, quan, ultima_tentativa_em)
      values (${loja}, 1, 501, '2026-10-02 12:00-03', 'SAI', 'Erro', 1, 1, '2026-10-03 00:00-03');
    -- mesmo cenário no inventário (data no cabeçalho) e nas OPs
    insert into inventarios (loja_id, codigo_local_estoque, data, status) values (${loja}, 1, '2026-09-30 23:30-03', 'Finalizado'), (${loja}, 1, '2026-10-01 00:30-03', 'Finalizado');
    insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, status, tentativas, ultima_tentativa_em)
      select ${loja}, (select min(id) from inventarios where loja_id = ${loja}), 501, 1, 'Erro', 1, '2026-09-11 00:00-03' from generate_series(1, 35);
    insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, status, tentativas, ultima_tentativa_em)
      values (${loja}, (select max(id) from inventarios where loja_id = ${loja}), 501, 1, 'Erro', 1, '2026-10-03 00:00-03');
    insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_d_dt_previsao, conclusao_data_desejada, concluida, conclusao_status, conclusao_ultima_tentativa_em)
      select ${loja}, 501, '2026-09-20', null, false, 'Erro', '2026-09-21 00:00-03' from generate_series(1, 35);
    insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_d_dt_previsao, conclusao_data_desejada, concluida, conclusao_status, conclusao_ultima_tentativa_em)
      values (${loja}, 501, '2026-09-25', '2026-10-01', false, 'Erro', '2026-10-02 00:00-03'), (${loja}, 501, null, null, false, 'Erro', '2026-10-02 00:00-03');
    insert into estoque_periodo_fechado (loja_id, mes, fechado_por_nome) values (${loja}, '2026-09-01', 'Ana');`)

  const db = new PostgrestClient(URL)
  const fechados = ['2026-09']
  const limite = 30

  // sem filtro (o comportamento que a revisão achou): as 30 vagas ficam com setembro
  const antes = await db.from('movimentos').select('id, data').eq('loja_id', loja).is('transferencia_id', null).eq('status', 'Erro').lt('tentativas', 30)
    .order('ultima_tentativa_em', { ascending: true, nullsFirst: true }).limit(limite)
  assert.ifError(antes.error)
  assert.ok(antes.data.every((m) => m.data.startsWith('2026-09')), 'premissa: sem filtro só vem setembro')

  const mov = await semMesFechado(db.from('movimentos').select('id, data').eq('loja_id', loja).is('transferencia_id', null).in('tipo', ['ENT', 'SAI'])
    .eq('status', 'Erro').lt('tentativas', 30).order('ultima_tentativa_em', { ascending: true, nullsFirst: true }).limit(limite), filtrosForaDosFechados('data', fechados, 'timestamp'))
  assert.ifError(mov.error)
  assert.equal(mov.data.length, 1, 'movimentos: só o de outubro')
  assert.ok(mov.data[0].data.startsWith('2026-10'))

  const filtrosInv = filtrosForaDosFechados('data', fechados, 'timestamp')
  const inv = await semMesFechado(db.from('inventario_items').select('id, inventario_id, quan, inventarios!inner(data)').eq('loja_id', loja).eq('status', 'Erro').lt('tentativas', 30)
    .order('ultima_tentativa_em', { ascending: true, nullsFirst: true }).limit(limite), filtrosInv, 'inventarios')
  assert.ifError(inv.error)
  assert.equal(inv.data.length, 1, `inventário: só o item do inventário de 01/10 (veio ${inv.data.length})`)

  const ops = await semMesFechado(db.from('ordens_producao').select('id, identificacao_d_dt_previsao, conclusao_data_desejada').eq('loja_id', loja).eq('concluida', false).eq('conclusao_status', 'Erro')
    .order('conclusao_ultima_tentativa_em', { ascending: true, nullsFirst: true }).limit(limite), filtrosConclusaoOPForaDosFechados(fechados))
  assert.ifError(ops.error)
  assert.equal(ops.data.length, 2, `OPs: a de data desejada em outubro e a sem data (veio ${ops.data.length})`)

  console.log('230 reenvio (PostgREST): todos os testes passaram')
} finally {
  psql(`
    delete from estoque_periodo_fechado where loja_id = ${loja};
    delete from inventario_items where loja_id = ${loja}; delete from inventarios where loja_id = ${loja};
    delete from movimentos where loja_id = ${loja}; delete from ordens_producao where loja_id = ${loja}; delete from lojas where id = ${loja};`)
}
