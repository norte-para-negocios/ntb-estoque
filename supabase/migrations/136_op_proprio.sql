-- 136 — Ordem de Produção no estoque próprio, com histórico completo (06/10/2026).
-- A OP de uma loja 'proprio' vive na MESMA tabela `ordens_producao` que a tela de OPs já lê (lista, filtros, exportações,
-- relatórios e etiquetas funcionam sem mudança). O motor é o ledger local (`produzir` da migration 133), sem Omie.
-- Como o Estoque substitui o Omie nessas lojas, cada OP guarda sozinha TODO o seu histórico: número, datas (criação, conclusão,
-- reversão), quem fez, produto, quantidade, ficha e versão usadas, insumos consumidos (bruto, perda, custo), locais, custo total e
-- unitário, status, trilha de mudanças (`op_historico`) e vínculo com os movimentos do ledger e com a venda de origem.
-- Aditiva: lojas 'omie' e 'nenhum' não passam por nada daqui.
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d postgres < 136_op_proprio.sql

alter table public.ordens_producao add column if not exists local_destino       bigint;       -- null = mesmo local de consumo
alter table public.ordens_producao add column if not exists producao_ref        text;         -- ref da última conclusão no ledger
alter table public.ordens_producao add column if not exists producao_n          int not null default 0;
alter table public.ordens_producao add column if not exists criada_por          text;
alter table public.ordens_producao add column if not exists concluida_por_nome  text;
alter table public.ordens_producao add column if not exists revertida_em        timestamptz;
alter table public.ordens_producao add column if not exists revertida_por       text;
alter table public.ordens_producao add column if not exists ficha_id            bigint;
alter table public.ordens_producao add column if not exists ficha_versao        int;
alter table public.ordens_producao add column if not exists custo_total         numeric(18,6);
alter table public.ordens_producao add column if not exists custo_unitario      numeric(18,6);
alter table public.ordens_producao add column if not exists venda_ref           text;         -- venda de origem, quando houver

create sequence if not exists public.seq_op_proprio start 8000000000001;

create table if not exists public.op_numeracao (
  loja_id bigint not null references public.lojas(id),
  ano     int    not null,
  ultimo  int    not null default 0,
  primary key (loja_id, ano)
);

-- Trilha de mudanças da OP (nunca apagada: sobrevive até à exclusão da OP).
create table if not exists public.op_historico (
  id         bigint generated always as identity primary key,
  loja_id    bigint not null references public.lojas(id),
  op_id      bigint,
  n_cod_op   bigint not null,
  num_op     text,
  evento     text not null check (evento in ('criada', 'alterada', 'concluida', 'revertida', 'excluida')),
  user_nome  text,
  user_uuid  uuid,
  quantidade numeric(18,6),
  detalhes   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists op_historico_op on public.op_historico (loja_id, n_cod_op, created_at);

create or replace function public.trg_op_historico_imutavel() returns trigger language plpgsql as $$
begin raise exception 'op_historico é append-only' using errcode = '55000'; end $$;
drop trigger if exists op_historico_imutavel on public.op_historico;
create trigger op_historico_imutavel before update or delete on public.op_historico for each row execute function public.trg_op_historico_imutavel();

do $$ declare t text; begin
  foreach t in array array['op_numeracao', 'op_historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists op_historico_select_por_loja on public.op_historico;
create policy op_historico_select_por_loja on public.op_historico for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
grant select on public.op_historico to authenticated;

-- Ingredientes da OP no mesmo formato que a tela já lê das OPs do Omie (full_object.itensDetalhes): consumo previsto pela ficha ativa.
create or replace function public._op_itens_detalhes(p_loja bigint, p_produto bigint, p_qtde numeric) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('itensDetalhes', coalesce(jsonb_agg(jsonb_build_object(
           'nIdProdutoMalha', e.codigo_insumo, 'nQtde', e.quantidade, 'cUtilizarDoEstoque', 'S') order by e.codigo_insumo), '[]'::jsonb))
    from expandir_receita(p_loja, p_produto, p_qtde) e
$$;

-- Cria a OP (aberta, sem mexer em estoque). Número no formato AAAA/00001 por loja e ano, como o das OPs do Omie.
drop function if exists public.op_proprio_criar(bigint, bigint, date, numeric, bigint, bigint, date, text, text);
create or replace function public.op_proprio_criar(
  p_loja bigint, p_produto bigint, p_data date, p_qtde numeric, p_local bigint default null, p_local_destino bigint default null,
  p_validade date default null, p_obs text default null, p_user text default null, p_venda_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_pr produtos%rowtype; v_local bigint; v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_n int; v_cod bigint; v_num text; v_id bigint; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ficha fichas_tecnicas%rowtype;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_qtde is null or p_qtde <= 0 then raise exception 'Informe a quantidade' using errcode = '22023'; end if;
  select * into v_pr from produtos where loja_id = p_loja and codigo_produto = p_produto;
  if not found then raise exception 'Produto % não existe nesta loja', p_produto using errcode = '22023'; end if;
  v_local := coalesce(p_local, (select codigo_local_estoque from local_estoques where loja_id = p_loja and padrao = 'S' order by id limit 1));
  if v_local is not null and not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = v_local) then
    raise exception 'Local de estoque inexistente' using errcode = '22023';
  end if;
  if p_local_destino is not null and not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_destino) then
    raise exception 'Local de destino inexistente' using errcode = '22023';
  end if;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;

  insert into op_numeracao (loja_id, ano, ultimo) values (p_loja, v_ano, 1)
    on conflict (loja_id, ano) do update set ultimo = op_numeracao.ultimo + 1 returning ultimo into v_n;
  v_num := v_ano || '/' || lpad(v_n::text, 5, '0');
  v_cod := nextval('public.seq_op_proprio');

  insert into ordens_producao (
    loja_id, num_ordem, validade, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op,
    identificacao_n_cod_produto, identificacao_c_cod_int_prod, identificacao_d_dt_previsao, identificacao_n_qtde,
    identificacao_codigo_local_estoque, local_destino, adicionais_d_dt_inicio, produto_codigo, produto_descricao,
    produto_tipo_item, produto_unidade, concluida, dt_inclusao, observacao, full_object, criada_por, ficha_id, ficha_versao, venda_ref
  ) values (
    p_loja, v_num, p_validade, v_cod, 'NTB-' || v_cod, v_num,
    p_produto, v_pr.codigo, coalesce(p_data, v_hoje), p_qtde,
    v_local, p_local_destino, coalesce(p_data, v_hoje), v_pr.codigo, v_pr.descricao,
    v_pr.tipo_item, v_pr.unidade, false, v_hoje, nullif(btrim(concat_ws(' · ', p_obs, p_user)), ''),
    _op_itens_detalhes(p_loja, p_produto, p_qtde), p_user, v_ficha.id, v_ficha.versao, p_venda_ref
  ) returning id into v_id;

  -- Previsto x produzido (relatório de produção): guarda o planejado enquanto a OP está aberta.
  insert into op_qtde_planejada (loja_id, n_cod_op, qtde_planejada, dt_previsao, ultima_vez_em)
  values (p_loja, v_cod, p_qtde, coalesce(p_data, v_hoje), v_hoje)
  on conflict (loja_id, n_cod_op) do update set qtde_planejada = excluded.qtde_planejada, dt_previsao = excluded.dt_previsao, ultima_vez_em = excluded.ultima_vez_em;

  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, v_id, v_cod, v_num, 'criada', p_user, p_qtde,
          jsonb_build_object('produto', p_produto, 'data_prevista', coalesce(p_data, v_hoje), 'local_consumo', v_local, 'local_destino', p_local_destino,
                             'ficha_versao', v_ficha.versao, 'venda_ref', p_venda_ref));

  return jsonb_build_object('ok', true, 'id', v_id, 'n_cod_op', v_cod, 'num_op', v_num);
end $$;

-- Altera data e/ou quantidade planejada de uma OP aberta (refaz os ingredientes previstos).
drop function if exists public.op_proprio_alterar(bigint, bigint, date, numeric);
create or replace function public.op_proprio_alterar(p_loja bigint, p_op bigint, p_data date default null, p_qtde numeric default null, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o ordens_producao%rowtype; v_qtd numeric;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then raise exception 'Não dá para alterar uma OP concluída. Reverta a conclusão primeiro.' using errcode = '22023'; end if;
  if p_qtde is not null and p_qtde <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  v_qtd := coalesce(p_qtde, o.identificacao_n_qtde);
  update ordens_producao set
    identificacao_d_dt_previsao = coalesce(p_data, identificacao_d_dt_previsao),
    adicionais_d_dt_inicio = coalesce(p_data, adicionais_d_dt_inicio),
    identificacao_n_qtde = v_qtd,
    full_object = _op_itens_detalhes(p_loja, o.identificacao_n_cod_produto, v_qtd),
    updated_at = now()
  where id = o.id;
  insert into op_qtde_planejada (loja_id, n_cod_op, qtde_planejada, dt_previsao, ultima_vez_em)
  values (p_loja, o.identificacao_n_cod_op, v_qtd, coalesce(p_data, o.identificacao_d_dt_previsao), (now() at time zone 'America/Sao_Paulo')::date)
  on conflict (loja_id, n_cod_op) do update set qtde_planejada = excluded.qtde_planejada, dt_previsao = excluded.dt_previsao, ultima_vez_em = excluded.ultima_vez_em;
  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'alterada', p_user, v_qtd,
          jsonb_build_object('data_antes', o.identificacao_d_dt_previsao, 'data_depois', coalesce(p_data, o.identificacao_d_dt_previsao),
                             'qtde_antes', o.identificacao_n_qtde, 'qtde_depois', v_qtd));
  return jsonb_build_object('ok', true, 'n_cod_op', o.identificacao_n_cod_op);
end $$;

-- Conclui a OP: consome os insumos da ficha técnica e entrega o produto (ledger). Conclusão parcial = p_qtde menor que o previsto.
create or replace function public.op_proprio_concluir(
  p_loja bigint, p_op bigint, p_data date default null, p_qtde numeric default null, p_user text default null, p_user_uuid uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o ordens_producao%rowtype; v_qtd numeric; v_n int; v_ref text; v_consumo bigint; v_destino bigint; v_res jsonb; v_ficha fichas_tecnicas%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then raise exception 'Esta OP já está concluída' using errcode = '22023'; end if;
  v_qtd := coalesce(nullif(p_qtde, 0), o.identificacao_n_qtde, 1);
  if v_qtd <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  v_consumo := coalesce(o.identificacao_codigo_local_estoque,
                        (select codigo_local_estoque from local_estoques where loja_id = p_loja and padrao = 'S' order by id limit 1));
  if v_consumo is null then raise exception 'A OP não tem local de estoque e a loja não tem local padrão' using errcode = '22023'; end if;
  v_destino := coalesce(o.local_destino, v_consumo);
  v_n := o.producao_n + 1;
  v_ref := 'OP:' || o.id || ':' || v_n;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = o.identificacao_n_cod_produto and ativa;

  v_res := produzir(p_loja, o.identificacao_n_cod_produto, v_qtd, v_consumo, v_destino, v_ref, p_user,
                    'OP ' || coalesce(o.identificacao_c_num_op, o.id::text));

  update ordens_producao set
    concluida = true, dt_conclusao_real = least(coalesce(p_data, v_hoje), v_hoje), concluida_por = p_user_uuid, concluida_por_nome = p_user,
    identificacao_n_qtde = v_qtd, producao_ref = v_ref, producao_n = v_n,
    ficha_id = v_ficha.id, ficha_versao = v_ficha.versao,
    custo_total = (v_res ->> 'custo_total')::numeric, custo_unitario = (v_res ->> 'custo_unitario')::numeric,
    full_object = _op_itens_detalhes(p_loja, o.identificacao_n_cod_produto, v_qtd),
    conclusao_status = null, conclusao_erro_msg = null, conclusao_tentativas = 0, updated_at = now()
  where id = o.id;

  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, user_uuid, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'concluida', p_user, p_user_uuid, v_qtd,
          jsonb_build_object('ref', v_ref, 'ficha_versao', v_ficha.versao, 'custo_total', v_res -> 'custo_total', 'custo_unitario', v_res -> 'custo_unitario',
                             'local_consumo', v_consumo, 'local_destino', v_destino, 'data', least(coalesce(p_data, v_hoje), v_hoje)));

  return v_res || jsonb_build_object('op_id', o.id, 'ref', v_ref);
end $$;

-- Reverte a conclusão: estorna no ledger cada movimento daquela produção (insumos e produto), volta a OP para aberta.
create or replace function public.op_proprio_reverter(p_loja bigint, p_op bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o ordens_producao%rowtype; m record; v_prods bigint[]; v_cont int := 0;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if not coalesce(o.concluida, false) then raise exception 'Só dá para reverter uma OP concluída' using errcode = '22023'; end if;
  if o.producao_ref is not null then
    select array_agg(distinct codigo_produto order by codigo_produto) into v_prods
      from estoque_movimentos where loja_id = p_loja and origem = 'PRODUCAO' and ref = o.producao_ref;
    if v_prods is not null then perform _travar_custos(p_loja, v_prods); end if;
    for m in select id from estoque_movimentos where loja_id = p_loja and origem = 'PRODUCAO' and ref = o.producao_ref order by id desc loop
      perform estornar_movimento(m.id, p_user, 'Reversão da OP ' || coalesce(o.identificacao_c_num_op, o.id::text));
      v_cont := v_cont + 1;
    end loop;
    update ordens_producao_proprio set status = 'revertida' where loja_id = p_loja and ref = o.producao_ref;
  end if;
  update ordens_producao set concluida = false, dt_conclusao_real = null, concluida_por = null, concluida_por_nome = null,
         revertida_em = now(), revertida_por = p_user, custo_total = null, custo_unitario = null, updated_at = now()
   where id = o.id;
  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'revertida', p_user, o.identificacao_n_qtde,
          jsonb_build_object('ref', o.producao_ref, 'estornados', v_cont));
  return jsonb_build_object('ok', true, 'estornados', v_cont);
end $$;

-- Exclui a OP (se concluída, reverte antes). A trilha em op_historico fica.
create or replace function public.op_proprio_excluir(p_loja bigint, p_op bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o ordens_producao%rowtype;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then perform op_proprio_reverter(p_loja, p_op, p_user); end if;
  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'excluida', p_user, o.identificacao_n_qtde, '{}'::jsonb);
  delete from op_qtde_planejada where loja_id = p_loja and n_cod_op = o.identificacao_n_cod_op;
  delete from ordens_producao where id = p_op and loja_id = p_loja;
  return jsonb_build_object('ok', true);
end $$;

-- Detalhe completo da OP para a tela: receita usada (ficha e versão), execuções (cada conclusão), insumos consumidos com bruto e custo,
-- movimentos do ledger gerados (e se já foram estornados) e a trilha de mudanças.
create or replace function public.op_proprio_detalhe(p_loja bigint, p_op bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o ordens_producao%rowtype; v_ficha jsonb; v_exec jsonb; v_hist jsonb;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja;
  if not found then return null; end if;

  select jsonb_build_object('id', f.id, 'versao', f.versao, 'rendimento', f.rendimento, 'ativa', f.ativa, 'itens', coalesce((
           select jsonb_agg(jsonb_build_object('codigo_insumo', i.codigo_insumo, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
                    'quantidade_liquida', i.quantidade_liquida, 'fator_correcao', i.fator_correcao, 'perda_pct', i.perda_pct, 'quantidade_bruta', i.quantidade_bruta) order by i.ordem)
             from ficha_tecnica_itens i left join produtos p on p.loja_id = f.loja_id and p.codigo_produto = i.codigo_insumo where i.ficha_id = f.id), '[]'::jsonb))
    into v_ficha from fichas_tecnicas f where f.id = o.ficha_id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.n), '[]'::jsonb) into v_exec from (
    select (regexp_replace(op.ref, '^OP:\d+:', ''))::int as n, op.ref, op.status, op.quantidade, op.custo_total, op.custo_unitario, op.local_consumo, op.local_destino,
           op.user_id, op.created_at,
           (select jsonb_agg(jsonb_build_object('codigo_insumo', it.codigo_insumo, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
                    'quantidade_bruta', it.quantidade, 'custo_unitario', it.custo_unitario, 'custo_total', round(it.quantidade * it.custo_unitario, 6), 'movimento_id', it.movimento_id)
                    order by it.id)
              from ordens_producao_proprio_itens it left join produtos p on p.loja_id = op.loja_id and p.codigo_produto = it.codigo_insumo where it.ordem_id = op.id) as insumos,
           (select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'codigo_produto', m.codigo_produto, 'codigo', p.codigo, 'descricao', p.descricao,
                    'codigo_local_estoque', m.codigo_local_estoque, 'local', l.descricao, 'quantidade', m.quantidade, 'custo_unitario', m.custo_unitario,
                    'saldo_apos', m.saldo_apos, 'created_at', m.created_at,
                    'estornado', exists (select 1 from estoque_movimentos r where r.reverses_id = m.id)) order by m.id)
              from estoque_movimentos m
              left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.codigo_produto
              left join local_estoques l on l.loja_id = m.loja_id and l.codigo_local_estoque = m.codigo_local_estoque
             where m.loja_id = op.loja_id and m.origem = 'PRODUCAO' and m.ref = op.ref) as movimentos
      from ordens_producao_proprio op
     where op.loja_id = p_loja and op.ref like 'OP:' || o.id || ':%'
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'evento', h.evento, 'user_nome', h.user_nome, 'quantidade', h.quantidade, 'detalhes', h.detalhes, 'created_at', h.created_at)
                  order by h.id), '[]'::jsonb)
    into v_hist from op_historico h where h.loja_id = p_loja and h.n_cod_op = o.identificacao_n_cod_op;

  return jsonb_build_object('ficha', v_ficha, 'execucoes', v_exec, 'historico', v_hist);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'op_proprio_criar(bigint,bigint,date,numeric,bigint,bigint,date,text,text,text)',
    'op_proprio_alterar(bigint,bigint,date,numeric,text)',
    'op_proprio_concluir(bigint,bigint,date,numeric,text,uuid)',
    'op_proprio_reverter(bigint,bigint,text)',
    'op_proprio_excluir(bigint,bigint,text)',
    'op_proprio_detalhe(bigint,bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
