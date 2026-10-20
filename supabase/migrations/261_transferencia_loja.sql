-- 261 — Fase F [F2/H4]: remessa/transferência ENTRE LOJAS com nota, no estoque próprio.
-- Plano: docs/superpowers/plans/2026-10-20-fase-f-nfe-saida.md. Depende da 230 (_exigir_periodo_aberto) e da 260 (nfe_saida).
--
-- A transferência entre locais da mesma loja (tabela `transferencias`, migration 138) continua igual: não precisa de nota.
-- Esta é a saída de mercadoria para OUTRA loja (outro estabelecimento, com CNPJ próprio): o documento registra os itens,
-- as unidades saem do estoque da loja de origem na hora, AO CUSTO MÉDIO (registrar_movimento 'SAI', origem
-- 'TRANSFERENCIA_LOJA'), e a NF-e (CFOP 5.152/6.152, ou 5.949/6.949 quando a raiz do CNPJ é outra = "remessa") é
-- emitida pela 260. A ENTRADA na loja de destino NÃO é feita aqui: a nota chega lá pela SEFAZ (loja própria: distribuição
-- DF-e → conferência → entrada, como qualquer compra) ou pelo Omie (loja Omie). Assim nada entra duas vezes.
-- Cancelar = estorno de cada saída; recusado com NF-e de produção em andamento/autorizada (cancele a NF-e antes).
--
-- SÓ ADITIVA. Aplicar (manual, com backup e OK do dono), DEPOIS da 260:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 261_transferencia_loja.sql
-- Depois: NOTIFY pgrst (já no fim); desktop/scripts/gerar-schema.sh + versão do desktop.
-- Teste: scripts/testes-sql/261_transferencia_loja.sql (banco local).

begin;
set lock_timeout = '5s';

insert into permissoes (nome) values ('Transferencias - Entre lojas') on conflict (nome) do nothing;

create table if not exists public.transferencias_loja (
  id                  bigint generated always as identity primary key,
  loja_id             bigint not null references public.lojas(id),
  numero              int not null,
  loja_destino_id     bigint not null references public.lojas(id),
  destino_nome        text,
  destino_cnpj        text,
  natureza            text not null check (natureza in ('transferencia', 'remessa')),
  situacao            text not null default 'registrada' check (situacao in ('registrada', 'cancelada')),
  data                date not null default ((now() at time zone 'America/Bahia')::date),
  valor_custo         numeric(18,2) not null default 0,
  obs                 text,
  chave_idempotencia  text,
  criado_por          text,
  criado_por_nome     text,
  cancelado_por       text,
  cancelado_por_nome  text,
  cancelado_em        timestamptz,
  motivo_cancelamento text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (loja_id, numero),
  unique (loja_id, chave_idempotencia),
  check (loja_destino_id <> loja_id)
);
create index if not exists transferencias_loja_loja on public.transferencias_loja (loja_id, numero desc);

create table if not exists public.transferencias_loja_itens (
  id                    bigint generated always as identity primary key,
  transferencia_id      bigint not null references public.transferencias_loja(id),
  loja_id               bigint not null references public.lojas(id),
  linha                 int not null,
  codigo_produto        bigint not null,
  descricao             text,
  unidade               text,
  codigo_local_estoque  bigint not null,
  quantidade            numeric(18,6) not null check (quantidade > 0),
  custo_unitario        numeric(18,6) not null default 0,
  valor                 numeric(18,2) not null default 0,
  movimento_id          bigint,
  estorno_movimento_id  bigint,
  unique (transferencia_id, linha)
);

create table if not exists public.transferencias_loja_eventos (
  id               bigint generated always as identity primary key,
  loja_id          bigint not null references public.lojas(id),
  transferencia_id bigint not null references public.transferencias_loja(id),
  tipo             text not null check (tipo in ('registrada', 'cancelada')),
  detalhe          jsonb not null default '{}'::jsonb,
  user_id          text,
  user_nome        text,
  created_at       timestamptz not null default now()
);
create index if not exists transferencias_loja_eventos_t on public.transferencias_loja_eventos (transferencia_id, id);

create or replace function public.trg_transferencias_loja_eventos_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'transferencias_loja_eventos é append-only' using errcode = '55000';
end $$;
drop trigger if exists transferencias_loja_eventos_imutavel on public.transferencias_loja_eventos;
create trigger transferencias_loja_eventos_imutavel before update or delete on public.transferencias_loja_eventos
  for each row execute function public.trg_transferencias_loja_eventos_imutavel();

do $$ declare t text; begin
  foreach t in array array['transferencias_loja', 'transferencias_loja_itens', 'transferencias_loja_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- p_itens: [{codigo_produto, codigo_local_estoque, quantidade (unidade de estoque)}]
create or replace function public.transferencia_loja_registrar(
  p_loja bigint, p_destino bigint, p_itens jsonb, p_obs text default null, p_user text default null, p_user_nome text default null,
  p_chave text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o lojas%rowtype; d lojas%rowtype; t transferencias_loja%rowtype; x record; pr produtos%rowtype; r jsonb; v_custo numeric;
  v_q numeric; v_numero int; v_linha int := 0; v_total numeric := 0; v_nat text; v_vistos bigint[] := '{}';
begin
  select * into o from lojas where id = p_loja;
  if o.modo_estoque is distinct from 'proprio' then
    raise exception 'Transferência entre lojas com nota só existe na loja de estoque próprio' using errcode = '22023';
  end if;
  select * into d from lojas where id = p_destino;
  if not found or p_destino = p_loja then raise exception 'Escolha a loja de destino' using errcode = '22023'; end if;
  if coalesce(d.is_test, false) <> coalesce(o.is_test, false) then
    raise exception 'Loja de teste só transfere para loja de teste (e real só para real)' using errcode = '22023';
  end if;
  if length(regexp_replace(coalesce(o.cnpj, ''), '\D', '', 'g')) <> 14 or length(regexp_replace(coalesce(d.cnpj, ''), '\D', '', 'g')) <> 14 then
    raise exception 'As duas lojas precisam de CNPJ cadastrado' using errcode = '22023';
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha pelo menos um item' using errcode = '22023';
  end if;
  if jsonb_array_length(p_itens) > 990 then raise exception 'No máximo 990 itens por nota' using errcode = '22023'; end if;

  -- mesma raiz de CNPJ (8 dígitos) = mesmo contribuinte = transferência; senão é remessa para outra empresa
  v_nat := case when left(regexp_replace(o.cnpj, '\D', '', 'g'), 8) = left(regexp_replace(d.cnpj, '\D', '', 'g'), 8)
                then 'transferencia' else 'remessa' end;

  -- duplo clique: a 2ª chamada espera a trava e, com a mesma chave, devolve o registro da 1ª
  perform pg_advisory_xact_lock(7261, p_loja::int);
  if nullif(btrim(coalesce(p_chave, '')), '') is not null then
    select * into t from transferencias_loja where loja_id = p_loja and chave_idempotencia = btrim(p_chave);
    if found then return jsonb_build_object('ok', true, 'duplicado', true, 'id', t.id, 'numero', t.numero); end if;
  end if;
  select coalesce(max(numero), 0) + 1 into v_numero from transferencias_loja where loja_id = p_loja;
  insert into transferencias_loja (loja_id, numero, loja_destino_id, destino_nome, destino_cnpj, natureza, obs, chave_idempotencia,
      criado_por, criado_por_nome)
  values (p_loja, v_numero, p_destino, coalesce(nullif(d.razao_social, ''), d.nome), regexp_replace(d.cnpj, '\D', '', 'g'), v_nat,
      nullif(btrim(coalesce(p_obs, '')), ''), nullif(btrim(coalesce(p_chave, '')), ''), p_user, p_user_nome)
  returning * into t;

  for x in select value as j from jsonb_array_elements(p_itens) loop
    v_q := round(coalesce(nullif(x.j->>'quantidade', '')::numeric, 0), 6);
    if v_q <= 0 then raise exception 'A quantidade precisa ser maior que zero' using errcode = '22023'; end if;
    select * into pr from produtos where loja_id = p_loja and codigo_produto = (x.j->>'codigo_produto')::bigint;
    if not found then raise exception 'Produto % não é desta loja', x.j->>'codigo_produto' using errcode = '22023'; end if;
    if pr.codigo_produto = any(v_vistos) then raise exception 'Produto % repetido na nota', pr.codigo using errcode = '22023'; end if;
    v_vistos := v_vistos || pr.codigo_produto;
    v_linha := v_linha + 1;
    r := registrar_movimento(p_loja, (x.j->>'codigo_local_estoque')::bigint, pr.codigo_produto, 'SAI', 'TRANSFERENCIA_LOJA',
                             'trl:' || t.id, v_q, null, p_user,
                             'Transferência nº ' || v_numero || ' para ' || coalesce(nullif(d.nome_fantasia, ''), d.nome), v_linha, null, null, null);
    select coalesce(custo_unitario, 0) into v_custo from estoque_movimentos where id = (r->>'id')::bigint;
    insert into transferencias_loja_itens (transferencia_id, loja_id, linha, codigo_produto, descricao, unidade, codigo_local_estoque,
        quantidade, custo_unitario, valor, movimento_id)
    values (t.id, p_loja, v_linha, pr.codigo_produto, pr.descricao, pr.unidade, (x.j->>'codigo_local_estoque')::bigint,
        v_q, v_custo, round(v_q * v_custo, 2), (r->>'id')::bigint);
    v_total := v_total + round(v_q * v_custo, 2);
  end loop;

  update transferencias_loja set valor_custo = v_total, updated_at = now() where id = t.id;
  insert into transferencias_loja_eventos (loja_id, transferencia_id, tipo, detalhe, user_id, user_nome)
  values (p_loja, t.id, 'registrada', jsonb_build_object('itens', v_linha, 'valor', v_total, 'natureza', v_nat, 'destino', p_destino), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', t.id, 'numero', v_numero, 'itens', v_linha, 'valor', v_total, 'natureza', v_nat);
end $$;

create or replace function public.transferencia_loja_cancelar(
  p_loja bigint, p_id bigint, p_user text default null, p_user_nome text default null, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t transferencias_loja%rowtype; i record; r jsonb; n int := 0; v_num int; v_st text;
begin
  select * into t from transferencias_loja where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Transferência não encontrada nesta loja' using errcode = '22023'; end if;
  if t.situacao = 'cancelada' then return jsonb_build_object('ok', true, 'duplicado', true); end if;
  select numero, status into v_num, v_st from nfe_saida
   where loja_id = p_loja and origem_tipo = 'transferencia_loja' and origem_id = t.id and tp_amb = 1
     and status in ('enviando', 'incerta', 'autorizada') limit 1;
  if found then
    raise exception 'A transferência tem NF-e nº % (%): cancele a NF-e na SEFAZ antes', v_num, v_st using errcode = '22023';
  end if;
  perform _exigir_periodo_aberto(p_loja, t.data, 'transferência entre lojas');
  for i in select * from transferencias_loja_itens where transferencia_id = t.id and movimento_id is not null and estorno_movimento_id is null order by linha loop
    r := estornar_movimento(i.movimento_id, p_user, 'Cancelamento da transferência nº ' || t.numero);
    update transferencias_loja_itens set estorno_movimento_id = (r->>'id')::bigint where id = i.id;
    n := n + 1;
  end loop;
  update nfe_saida set status = 'descartada', updated_at = now()
   where loja_id = p_loja and origem_tipo = 'transferencia_loja' and origem_id = t.id and status in ('rascunho', 'rejeitada');
  update transferencias_loja set situacao = 'cancelada', cancelado_por = p_user, cancelado_por_nome = p_user_nome, cancelado_em = now(),
         motivo_cancelamento = nullif(btrim(coalesce(p_motivo, '')), ''), updated_at = now()
   where id = t.id;
  insert into transferencias_loja_eventos (loja_id, transferencia_id, tipo, detalhe, user_id, user_nome)
  values (p_loja, t.id, 'cancelada', jsonb_build_object('estornados', n, 'motivo', p_motivo), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'estornados', n);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'transferencia_loja_registrar(bigint,bigint,jsonb,text,text,text,text)',
    'transferencia_loja_cancelar(bigint,bigint,text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.trg_transferencias_loja_eventos_imutavel() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
