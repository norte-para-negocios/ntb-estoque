require('dotenv').config();
const express = require('express');
const { Pool, types } = require('pg');

// bigint (OID 20) vem como string por padrao no driver pg -- os ids/codigos deste
// projeto sao pequenos o suficiente pra caber em Number com seguranca, e como
// number aqui o cliente (Next.js) consegue comparar/deduplicar por id sem bug de
// tipo (string "123" !== number 123 num Set/Map).
types.setTypeParser(20, (val) => parseInt(val, 10));
// date (OID 1082) vem como objeto Date por padrao -- ao virar JSON isso serializa
// como timestamp completo ("2025-07-31T22:00:00.000Z" em vez de "2025-07-31"),
// quebrando qualquer formatacao "YYYY-MM-DD".slice/split do lado do cliente.
// Mantem como a string pura que o Postgres realmente guarda (sem hora/fuso).
types.setTypeParser(1082, (val) => val);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const poolVendas = new Pool({ connectionString: process.env.VENDAS_DATABASE_URL });
const app = express();
app.use(express.json({ limit: '2mb' }));

function checkAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function checkAuthVendas(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.VENDAS_API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.post('/webhooks', checkAuth, async (req, res) => {
  const { loja_id, message_id, message } = req.body || {};
  if (!loja_id || !message_id || !message) {
    return res.status(400).json({ error: 'loja_id, message_id e message sao obrigatorios' });
  }
  try {
    await pool.query(
      'insert into webhooks (loja_id, message_id, message) values ($1, $2, $3) on conflict do nothing',
      [loja_id, message_id, JSON.stringify(message)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro ao gravar webhook no Contabo:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/notas_fiscais', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, busca, id, offset, count } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1', 'deleted_at is null'];
  const params = [loja_id];
  if (id) { params.push(id); clauses.push(`id = $${params.length}`); }
  if (data_inicio) { params.push(data_inicio); clauses.push(`d_emissao_nfe >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`d_emissao_nfe <= $${params.length}`); }
  if (busca) {
    params.push(`%${busca}%`);
    clauses.push(`(c_numero_nfe ilike $${params.length} or c_razao_social ilike $${params.length} or c_nome ilike $${params.length})`);
  }
  try {
    // count=true: so a contagem real (sem LIMIT) -- mesmo padrao que ja
    // existia so em /ordens_producao. Achado real (audit Notas Fiscais
    // 2026-07-19): a doc do app (AGENTS.md) afirmava que TODOS os endpoints
    // de historico aceitavam count=true, mas so /ordens_producao de fato
    // implementava -- aqui nunca tinha sido escrito. Adicionado agora pra
    // servir de cinto-de-seguranca no badge de Notas Fiscais, detectando
    // paginacao incompleta (Contabo fora do ar, timeout) e avisando em vez
    // de mostrar um total errado sem dizer nada.
    if (count === 'true') {
      const sql = `select count(*) from notas_fiscais where ${clauses.join(' and ')}`;
      const r = await pool.query(sql, params);
      return res.json({ count: Number(r.rows[0].count) });
    }
    // offset opcional (default 0, retrocompativel) -- achado real (audit
    // Auditoria Fiscal 2026-07-18): sem paginacao, uma consulta de historico
    // longo (ex.: desde 01/07/2025) trunca silenciosamente em 2000 linhas
    // pra lojas com mais NF que isso no periodo. order by d_emissao_nfe desc
    // ja existia; acrescenta id como desempate pra paginacao deterministica.
    const off = Number(offset) || 0;
    const sql = `select * from notas_fiscais where ${clauses.join(' and ')} order by d_emissao_nfe desc, id desc limit 2000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /notas_fiscais:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/nota_fiscal_items', checkAuth, async (req, res) => {
  const { loja_id, nota_fiscal_id, data_inicio, data_final, offset } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (nota_fiscal_id) {
      const ids = String(nota_fiscal_id).split(',').map(Number).filter(Boolean);
      const r = await pool.query(
        `select * from nota_fiscal_items where loja_id = $1 and nota_fiscal_id = any($2)`,
        [loja_id, ids]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['i.loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`nf.d_emissao_nfe >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`nf.d_emissao_nfe <= $${params.length}`); }
    // offset opcional (default 0, retrocompativel) -- achado real (audit
    // Auditoria Fiscal 2026-07-18): sem paginacao, uma consulta de historico
    // longo (ex.: desde 01/07/2025) trunca silenciosamente em 5000 linhas
    // (confirmado via SQL: loja 5 tinha 12225 itens nesse range). Acrescenta
    // "order by i.id" (nao existia nenhum order by) pra paginacao ser
    // deterministica.
    const off = Number(offset) || 0;
    const sql = `
      select i.*, nf.d_emissao_nfe as nf_d_emissao_nfe, nf.c_numero_nfe as nf_c_numero_nfe, nf.c_natureza_operacao as nf_c_natureza_operacao
      from nota_fiscal_items i
      join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
      where ${clauses.join(' and ')} and nf.deleted_at is null
      order by i.id
      limit 5000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /nota_fiscal_items:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/ordens_producao', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, validade_inicio, validade_final, previsao_inicio, previsao_final, busca, id, count, offset } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1'];
  const params = [loja_id];
  if (id) { params.push(id); clauses.push(`id = $${params.length}`); }
  if (data_inicio) { params.push(data_inicio); clauses.push(`dt_conclusao_real >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`dt_conclusao_real <= $${params.length}`); }
  if (validade_inicio) { params.push(validade_inicio); clauses.push(`validade >= $${params.length}`); }
  if (validade_final) { params.push(validade_final); clauses.push(`validade <= $${params.length}`); }
  // previsao_inicio/previsao_final: filtro por identificacao_d_dt_previsao (data
  // planejada), separado de data_inicio/data_final (que filtra dt_conclusao_real,
  // usado por outro consumidor -- lib/resumo-dia.ts no app). Achado real
  // (2026-07-19): a tela de Ordens de Producao filtra o lado quente (Supabase)
  // por identificacao_d_dt_previsao, mas o complemento frio reusava data_inicio/
  // data_final e caia no filtro por dt_conclusao_real -- OPs nao concluidas
  // (sem dt_conclusao_real) nunca apareciam com periodo aplicado, e OPs
  // concluidas apareciam/sumiam no periodo errado (conclusao, nao planejamento).
  if (previsao_inicio) { params.push(previsao_inicio); clauses.push(`identificacao_d_dt_previsao >= $${params.length}`); }
  if (previsao_final) { params.push(previsao_final); clauses.push(`identificacao_d_dt_previsao <= $${params.length}`); }
  if (busca) {
    params.push(`%${busca}%`);
    clauses.push(`(num_ordem ilike $${params.length} or identificacao_c_num_op ilike $${params.length})`);
  }
  try {
    // count=true: so a contagem real (sem LIMIT), pra cards/badges nao ficarem
    // truncados pelo teto de linhas do modo normal.
    if (count === 'true') {
      const sql = `select count(*) from ordens_producao where ${clauses.join(' and ')}`;
      const r = await pool.query(sql, params);
      return res.json({ count: Number(r.rows[0].count) });
    }
    // offset opcional (default 0, retrocompativel) -- achado real (audit
    // 2026-07-19): sem paginacao, uma consulta sem filtro de data (ex:
    // complementarOrdensProducao chamado sem dataInicio) trunca em silencio
    // em 2000 linhas -- lojas tem 40mil a 88mil OPs no Contabo.
    const off = Number(offset) || 0;
    const sql = `select * from ordens_producao where ${clauses.join(' and ')} order by id desc limit 2000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /ordens_producao:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

// Achado real (Task 6, auditoria de filtros/relatorios, 2026-08-05):
// paginacao por LIMIT/OFFSET sem tie-breaker no ORDER BY -- muitas linhas
// tem o MESMO valor de `data` (ajustes lancados no mesmo dia, sem hora),
// entao a ordem entre elas nao e garantida pelo Postgres e podia mudar
// entre chamadas sucessivas, fazendo o cliente (buscarFrioTudo) receber um
// recorte ligeiramente diferente a cada pagina/chamada quando o total
// passa de 5000 linhas (medido ao vivo: ~2-3% de linhas diferentes entre
// 2 chamadas seguidas, pra lojas com >2900 linhas no periodo). Corrigido
// com `id` como desempate -- mesmo padrao ja usado em /notas_fiscais
// (linha abaixo) e /nota_fiscal_items.
app.get('/movimentos', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, id_prod, transferencia_id, offset } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1'];
  const params = [loja_id];
  if (data_inicio) { params.push(data_inicio); clauses.push(`data >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`data <= $${params.length}`); }
  if (id_prod) { params.push(id_prod); clauses.push(`id_prod = $${params.length}`); }
  if (transferencia_id) { params.push(transferencia_id); clauses.push(`transferencia_id = $${params.length}`); }
  try {
    const off = Number(offset) || 0;
    const sql = `select * from movimentos where ${clauses.join(' and ')} order by data desc, id desc limit 5000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /movimentos:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/movimentos_historico', checkAuth, async (req, res) => {
  const { loja_id, cod_prod, data_inicio, data_final, offset } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  const clauses = ['loja_id = $1'];
  const params = [loja_id];
  if (cod_prod) { params.push(cod_prod); clauses.push(`cod_prod = $${params.length}`); }
  if (data_inicio) { params.push(data_inicio); clauses.push(`data >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`data <= $${params.length}`); }
  try {
    // offset opcional (default 0, retrocompativel) -- achado real (audit
    // 2026-07-19): complementarMovimentosHistorico chamava isso sem paginar
    // nenhuma -- lojas tem 66mil a 110mil linhas aqui (loja 5: 109819).
    const off = Number(offset) || 0;
    const sql = `select * from movimentos_historico where ${clauses.join(' and ')} order by data desc, cod_prod desc limit 5000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /movimentos_historico:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.post('/vendas/orders', checkAuthVendas, async (req, res) => {
  const { order, items } = req.body || {};
  if (!order || !Array.isArray(items)) {
    return res.status(400).json({ error: 'order e items sao obrigatorios' });
  }
  const client = await poolVendas.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into orders (id, table_id, store_id, status, order_type, total, customer_name, payment_method, payment_details, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
         status = excluded.status,
         total = excluded.total,
         payment_method = excluded.payment_method,
         payment_details = excluded.payment_details,
         updated_at = excluded.updated_at`,
      [order.id, order.table_id, order.store_id, order.status, order.order_type, order.total,
       order.customer_name, order.payment_method,
       order.payment_details ? JSON.stringify(order.payment_details) : null,
       order.created_at, order.updated_at]
    );
    for (const item of items) {
      await client.query(
        `insert into order_items (id, order_id, product_id, quantity, status, notes, price_at_time, created_at, store_id, selected_options)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do update set status = excluded.status`,
        [item.id, item.order_id, item.product_id, item.quantity, item.status, item.notes,
         item.price_at_time, item.created_at, item.store_id,
         JSON.stringify(item.selected_options ?? [])]
      );
    }
    await client.query('commit');
    res.json({ ok: true });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro ao gravar pedido de vendas no Contabo:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});

app.get('/fat_cupons', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, n_id_cupom, offset } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (n_id_cupom) {
      const r = await pool.query(
        'select * from fat_cupons where loja_id = $1 and n_id_cupom = $2',
        [loja_id, n_id_cupom]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`data >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`data <= $${params.length}`); }
    const off = Number(offset) || 0;
    const sql = `select * from fat_cupons where ${clauses.join(' and ')} order by data desc limit 5000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_cupons:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/fat_cupom_itens', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, n_id_cupom, offset } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (n_id_cupom) {
      const r = await pool.query(
        'select * from fat_cupom_itens where loja_id = $1 and n_id_cupom = $2',
        [loja_id, n_id_cupom]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['i.loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`c.data >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`c.data <= $${params.length}`); }
    const off = Number(offset) || 0;
    const sql = `
      select i.*
      from fat_cupom_itens i
      join fat_cupons c on c.loja_id = i.loja_id and c.n_id_cupom = i.n_id_cupom
      where ${clauses.join(' and ')}
      order by i.n_id_cupom, i.id_item
      limit 20000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_cupom_itens:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/fat_cupom_pagamentos', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, n_id_cupom, offset } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  try {
    if (n_id_cupom) {
      const r = await pool.query(
        'select * from fat_cupom_pagamentos where loja_id = $1 and n_id_cupom = $2',
        [loja_id, n_id_cupom]
      );
      return res.json({ rows: r.rows });
    }
    const clauses = ['p.loja_id = $1'];
    const params = [loja_id];
    if (data_inicio) { params.push(data_inicio); clauses.push(`c.data >= $${params.length}`); }
    if (data_final) { params.push(data_final); clauses.push(`c.data <= $${params.length}`); }
    const off = Number(offset) || 0;
    const sql = `
      select p.*
      from fat_cupom_pagamentos p
      join fat_cupons c on c.loja_id = p.loja_id and c.n_id_cupom = p.n_id_cupom
      where ${clauses.join(' and ')}
      order by p.n_id_cupom, p.sequencia
      limit 20000 offset ${off}`;
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_cupom_pagamentos:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/fat_agregado', checkAuth, async (req, res) => {
  const { loja_id, data_inicio, data_final, group, group2 } = req.query;
  if (!loja_id) return res.status(400).json({ error: 'loja_id obrigatorio' });
  if (!['dia', 'forma', 'produto'].includes(group)) {
    return res.status(400).json({ error: "group deve ser 'dia', 'forma' ou 'produto'" });
  }
  const clauses = ['c.loja_id = $1'];
  const params = [loja_id];
  if (data_inicio) { params.push(data_inicio); clauses.push(`c.data >= $${params.length}`); }
  if (data_final) { params.push(data_final); clauses.push(`c.data <= $${params.length}`); }
  const where = clauses.join(' and ');
  const mesExpr = "to_char(c.data, 'YYYY-MM')";
  try {
    let sql;
    if (group === 'dia') {
      sql = `select c.data::text as rotulo, sum(c.valor) as valor, count(*) as qtde_itens
             from fat_cupons c where ${where} and c.cancelado = false
             group by c.data order by c.data`;
    } else if (group === 'forma') {
      sql = `select p.tipo_doc as rotulo, ${group2 === 'mes' ? `${mesExpr} as mes,` : ''} sum(p.valor) as valor, count(*) as qtde_itens
             from fat_cupom_pagamentos p
             join fat_cupons c on c.loja_id = p.loja_id and c.n_id_cupom = p.n_id_cupom
             where ${where} and c.cancelado = false
             group by p.tipo_doc${group2 === 'mes' ? ', mes' : ''} order by valor desc`;
    } else {
      sql = `select i.id_produto as rotulo, ${group2 === 'mes' ? `${mesExpr} as mes,` : ''} sum(i.v_item) as valor, sum(i.quant) as qtde_itens
             from fat_cupom_itens i
             join fat_cupons c on c.loja_id = i.loja_id and c.n_id_cupom = i.n_id_cupom
             where ${where} and c.cancelado = false
             group by i.id_produto${group2 === 'mes' ? ', mes' : ''} order by valor desc`;
    }
    const r = await pool.query(sql, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /fat_agregado:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.post('/fat_cupons_bulk', checkAuth, async (req, res) => {
  const { loja_id, cupons, itens, pagamentos } = req.body || {};
  if (!loja_id || !Array.isArray(cupons)) {
    return res.status(400).json({ error: 'loja_id e cupons (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const c of cupons) {
      await client.query(
        `insert into fat_cupons (loja_id, n_id_cupom, chave, data, hora, num, serie, seq_caixa, id_cliente, id_vendedor, valor, cancelado, devolvido)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (loja_id, n_id_cupom) do update set
           chave = excluded.chave, data = excluded.data, hora = excluded.hora, num = excluded.num,
           serie = excluded.serie, seq_caixa = excluded.seq_caixa, id_cliente = excluded.id_cliente,
           id_vendedor = excluded.id_vendedor, valor = excluded.valor, cancelado = excluded.cancelado,
           devolvido = excluded.devolvido`,
        [loja_id, c.n_id_cupom, c.chave, c.data, c.hora, c.num, c.serie, c.seq_caixa,
         c.id_cliente, c.id_vendedor, c.valor, c.cancelado, c.devolvido]
      );
    }
    for (const it of itens ?? []) {
      await client.query(
        `insert into fat_cupom_itens (loja_id, id_item, n_id_cupom, id_produto, cfop, ncm, quant, v_unit, v_desc, v_item, x_prod)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (loja_id, id_item) do update set
           n_id_cupom = excluded.n_id_cupom, id_produto = excluded.id_produto, cfop = excluded.cfop,
           ncm = excluded.ncm, quant = excluded.quant, v_unit = excluded.v_unit, v_desc = excluded.v_desc,
           v_item = excluded.v_item, x_prod = excluded.x_prod`,
        [loja_id, it.id_item, it.n_id_cupom, it.id_produto, it.cfop, it.ncm, it.quant, it.v_unit, it.v_desc, it.v_item, it.x_prod]
      );
    }
    for (const p of pagamentos ?? []) {
      await client.query(
        `insert into fat_cupom_pagamentos (loja_id, n_id_cupom, sequencia, tipo_doc, valor, categoria, id_conta_corrente)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (loja_id, n_id_cupom, sequencia) do update set
           tipo_doc = excluded.tipo_doc, valor = excluded.valor, categoria = excluded.categoria,
           id_conta_corrente = excluded.id_conta_corrente`,
        [loja_id, p.n_id_cupom, p.sequencia, p.tipo_doc, p.valor, p.categoria, p.id_conta_corrente]
      );
    }
    await client.query('commit');
    res.json({ ok: true, cupons: cupons.length, itens: (itens ?? []).length, pagamentos: (pagamentos ?? []).length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /fat_cupons_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});
app.post('/fat_cupons_marcar_cancelado', checkAuth, async (req, res) => {
  const { loja_id, n_id_cupom } = req.body || {};
  if (!loja_id || !n_id_cupom) {
    return res.status(400).json({ error: 'loja_id e n_id_cupom sao obrigatorios' });
  }
  try {
    const result = await pool.query(
      `update fat_cupons set cancelado = true where loja_id = $1 and n_id_cupom = $2 and cancelado = false`,
      [loja_id, n_id_cupom]
    );
    res.json({ ok: true, atualizado: result.rowCount > 0 });
  } catch (e) {
    console.error('Erro POST /fat_cupons_marcar_cancelado:', e);
    res.status(500).json({ error: 'internal error' });
  }
});



app.post('/movimentos_bulk', checkAuth, async (req, res) => {
  const { loja_id, movimentos } = req.body || {};
  if (!loja_id || !Array.isArray(movimentos)) {
    return res.status(400).json({ error: 'loja_id e movimentos (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const m of movimentos) {
      await client.query(
        `insert into movimentos (loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque, codigo_local_estoque_destino, data, motivo, obs, origem, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (loja_id, id_ajuste) where id_ajuste is not null do update set
           id_prod = excluded.id_prod, tipo = excluded.tipo, quan = excluded.quan, valor = excluded.valor,
           codigo_local_estoque = excluded.codigo_local_estoque,
           codigo_local_estoque_destino = excluded.codigo_local_estoque_destino,
           data = excluded.data, motivo = excluded.motivo, obs = excluded.obs, origem = excluded.origem,
           status = excluded.status, updated_at = now()`,
        [loja_id, m.id_ajuste, m.id_prod, m.tipo, m.quan, m.valor, m.codigo_local_estoque,
         m.codigo_local_estoque_destino, m.data, m.motivo, m.obs, m.origem, m.status]
      );
    }
    await client.query('commit');
    res.json({ ok: true, movimentos: movimentos.length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /movimentos_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});

app.post('/notas_fiscais_bulk', checkAuth, async (req, res) => {
  const { loja_id, notas } = req.body || {};
  if (!loja_id || !Array.isArray(notas)) {
    return res.status(400).json({ error: 'loja_id e notas (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const nf of notas) {
      const cabecResult = await client.query(
        `insert into notas_fiscais (loja_id, n_id_receb, n_id_fornecedor, c_pessoa_fisica, c_nome, c_razao_social, c_inscricao, c_cnpj_cpf, c_chave_nfe, c_etapa, c_numero_nfe, c_serie_nfe, c_modelo_nfe, d_emissao_nfe, n_valor_nfe, c_ambiente_nfe, c_natureza_operacao, full_object)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (loja_id, n_id_receb) do update set
           n_id_fornecedor = excluded.n_id_fornecedor, c_pessoa_fisica = excluded.c_pessoa_fisica,
           c_nome = excluded.c_nome, c_razao_social = excluded.c_razao_social,
           c_inscricao = excluded.c_inscricao, c_cnpj_cpf = excluded.c_cnpj_cpf,
           c_chave_nfe = excluded.c_chave_nfe, c_etapa = excluded.c_etapa,
           c_numero_nfe = excluded.c_numero_nfe, c_serie_nfe = excluded.c_serie_nfe,
           c_modelo_nfe = excluded.c_modelo_nfe, d_emissao_nfe = excluded.d_emissao_nfe,
           n_valor_nfe = excluded.n_valor_nfe, c_ambiente_nfe = excluded.c_ambiente_nfe,
           c_natureza_operacao = excluded.c_natureza_operacao, full_object = excluded.full_object,
           updated_at = now()
         returning id`,
        [loja_id, nf.n_id_receb, nf.n_id_fornecedor, nf.c_pessoa_fisica, nf.c_nome, nf.c_razao_social,
         nf.c_inscricao, nf.c_cnpj_cpf, nf.c_chave_nfe, nf.c_etapa, nf.c_numero_nfe, nf.c_serie_nfe,
         nf.c_modelo_nfe, nf.d_emissao_nfe, nf.n_valor_nfe, nf.c_ambiente_nfe, nf.c_natureza_operacao,
         nf.full_object ? JSON.stringify(nf.full_object) : null]
      );
      const notaFiscalId = cabecResult.rows[0].id;
      for (const it of (nf.itens || [])) {
        await client.query(
          `insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_receb, n_sequencia, n_id_item, n_id_pedido, n_id_it_pedido, n_id_produto, c_codigo_produto, c_descricao_produto, c_ignorar_item, c_adicionar_novo, c_associar_existente, c_item_devolvido, c_ncm, c_ean, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, full_object)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           on conflict (loja_id, n_id_receb, n_sequencia) do update set
             nota_fiscal_id = excluded.nota_fiscal_id, n_id_item = excluded.n_id_item,
             n_id_pedido = excluded.n_id_pedido, n_id_it_pedido = excluded.n_id_it_pedido,
             n_id_produto = excluded.n_id_produto, c_codigo_produto = excluded.c_codigo_produto,
             c_descricao_produto = excluded.c_descricao_produto, c_ignorar_item = excluded.c_ignorar_item,
             c_adicionar_novo = excluded.c_adicionar_novo, c_associar_existente = excluded.c_associar_existente,
             c_item_devolvido = excluded.c_item_devolvido, c_ncm = excluded.c_ncm, c_ean = excluded.c_ean,
             c_cfop = excluded.c_cfop, n_qtde_nfe = excluded.n_qtde_nfe, c_unidade_nfe = excluded.c_unidade_nfe,
             n_preco_unit = excluded.n_preco_unit, full_object = excluded.full_object, updated_at = now()`,
          [loja_id, notaFiscalId, nf.n_id_receb, it.n_sequencia, it.n_id_item, it.n_id_pedido, it.n_id_it_pedido,
           it.n_id_produto, it.c_codigo_produto, it.c_descricao_produto, it.c_ignorar_item, it.c_adicionar_novo,
           it.c_associar_existente, it.c_item_devolvido, it.c_ncm, it.c_ean, it.c_cfop, it.n_qtde_nfe,
           it.c_unidade_nfe, it.n_preco_unit, it.full_object ? JSON.stringify(it.full_object) : null]
        );
      }
    }
    await client.query('commit');
    res.json({ ok: true, notas: notas.length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /notas_fiscais_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});

app.post('/ordens_producao_bulk', checkAuth, async (req, res) => {
  const { loja_id, ordens } = req.body || {};
  if (!loja_id || !Array.isArray(ordens)) {
    return res.status(400).json({ error: 'loja_id e ordens (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const op of ordens) {
      await client.query(
        `insert into ordens_producao (loja_id, num_ordem, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde, identificacao_codigo_local_estoque, concluida, dt_conclusao_real, dt_inclusao, full_object)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (loja_id, identificacao_n_cod_op) do update set
           num_ordem = excluded.num_ordem, identificacao_c_cod_int_op = excluded.identificacao_c_cod_int_op,
           identificacao_c_num_op = excluded.identificacao_c_num_op,
           identificacao_n_cod_produto = excluded.identificacao_n_cod_produto,
           identificacao_d_dt_previsao = excluded.identificacao_d_dt_previsao,
           identificacao_n_qtde = excluded.identificacao_n_qtde,
           identificacao_codigo_local_estoque = excluded.identificacao_codigo_local_estoque,
           concluida = excluded.concluida, dt_conclusao_real = excluded.dt_conclusao_real,
           dt_inclusao = excluded.dt_inclusao, full_object = excluded.full_object, updated_at = now()`,
        [loja_id, op.num_ordem, op.identificacao_n_cod_op, op.identificacao_c_cod_int_op, op.identificacao_c_num_op,
         op.identificacao_n_cod_produto, op.identificacao_d_dt_previsao, op.identificacao_n_qtde,
         op.identificacao_codigo_local_estoque, op.concluida, op.dt_conclusao_real, op.dt_inclusao,
         op.full_object ? JSON.stringify(op.full_object) : null]
      );
    }
    await client.query('commit');
    res.json({ ok: true, ordens: ordens.length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /ordens_producao_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});

// Exportação paginada do fato de faturamento para o app desktop offline (canal /api/offline/frio
// do NTB Estoque). Keyset pela chave primária; `desde` limita aos cupons com data >= desde.
const EXPORT_TABELAS = {
  fat_cupons: { pk: ['n_id_cupom'], sql: 'select c.* from fat_cupons c where c.loja_id = $1 and ($2::date is null or c.data >= $2::date)' },
  fat_cupom_itens: { pk: ['id_item'], sql: 'select i.* from fat_cupom_itens i join fat_cupons c on c.loja_id = i.loja_id and c.n_id_cupom = i.n_id_cupom where i.loja_id = $1 and ($2::date is null or c.data >= $2::date)' },
  fat_cupom_pagamentos: { pk: ['n_id_cupom', 'sequencia'], sql: 'select p.* from fat_cupom_pagamentos p join fat_cupons c on c.loja_id = p.loja_id and c.n_id_cupom = p.n_id_cupom where p.loja_id = $1 and ($2::date is null or c.data >= $2::date)' },
};
app.get('/export', checkAuth, async (req, res) => {
  const t = EXPORT_TABELAS[req.query.tabela];
  const lojaId = Number(req.query.loja_id);
  if (!t || !Number.isInteger(lojaId)) return res.status(400).json({ error: 'tabela/loja_id invalidos' });
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde || '')) ? req.query.desde : null;
  const limite = Math.min(Math.max(Number(req.query.limite) || 5000, 1), 5000);
  let depois = null;
  try { depois = req.query.depois ? JSON.parse(String(req.query.depois)) : null; } catch { return res.status(400).json({ error: 'depois invalido' }); }
  const alias = req.query.tabela === 'fat_cupons' ? 'c' : req.query.tabela === 'fat_cupom_itens' ? 'i' : 'p';
  const cols = t.pk.map((c) => `${alias}.${c}`).join(', ');
  const params = [lojaId, desde];
  let filtroDepois = '';
  if (depois) {
    const vals = t.pk.map((c) => { params.push(depois[c]); return `$${params.length}::bigint`; });
    filtroDepois = ` and (${cols}) > (${vals.join(', ')})`;
  }
  params.push(limite);
  try {
    const r = await pool.query(`${t.sql}${filtroDepois} order by ${cols} limit $${params.length}`, params);
    res.json({ rows: r.rows });
  } catch (e) {
    console.error('Erro GET /export:', e);
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, '127.0.0.1', () => console.log(`ntb-frio-api rodando na porta ${port}`));
