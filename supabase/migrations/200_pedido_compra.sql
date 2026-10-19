-- 200 — Fase C (paridade com o Omie): pedido de compra do estoque próprio [I2], aprovação [I3] e conferência
-- pedido × nota × recebido (o "3 vias" do Omie). SÓ loja modo_estoque='proprio'; lojas Omie não usam nada disto
-- (no Omie o pedido é gravado no próprio Omie, fora desta fase).
-- SÓ ADITIVA: tabelas novas, uma view, funções novas e duas permissões. Nada existente muda.
-- Aplicar (manual, com backup e OK do dono): docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 200_pedido_compra.sql
-- Depois: NOTIFY pgrst / restart do PostgREST; desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
-- Etapas gravadas: rascunho → aguardando_aprovacao → aprovado → (cancelado). "Recebido parcial/total" é calculado
-- (view pedidos_compra_itens_situacao): recebido = itens das notas vinculadas que já entraram no estoque (lancado).
-- Escrita só pelas funções pc_* (security definer), chamadas pelo servidor depois de conferir a permissão.

begin;

insert into permissoes (nome) values ('Compras - Pedidos'), ('Compras - Aprovar pedidos') on conflict (nome) do nothing;

create table if not exists public.pedidos_compra (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  numero               int not null,
  etapa                text not null default 'rascunho' check (etapa in ('rascunho', 'aguardando_aprovacao', 'aprovado', 'cancelado')),
  fornecedor_id        bigint references public.fornecedores(id),
  fornecedor_nome      text not null check (btrim(fornecedor_nome) <> ''),
  fornecedor_cnpj      text check (fornecedor_cnpj is null or fornecedor_cnpj ~ '^[0-9]{11,14}$'),
  previsao_entrega     date,
  frete                numeric(18,2) not null default 0 check (frete >= 0),
  outras_despesas      numeric(18,2) not null default 0 check (outras_despesas >= 0),
  parcelas             jsonb not null default '[]'::jsonb check (jsonb_typeof(parcelas) = 'array'),  -- [{dias, percentual}]
  numero_fornecedor    text,                 -- nº do pedido no fornecedor
  contato              text,
  obs                  text,                 -- impressa no pedido enviado ao fornecedor
  obs_interna          text,                 -- só aparece aqui
  origem               text not null default 'manual' check (origem in ('manual', 'sugestao')),
  chave_idempotencia   text,
  criado_por           text,
  criado_por_nome      text,
  aprovado_por         text,
  aprovado_por_nome    text,
  aprovado_em          timestamptz,
  cancelado_por        text,
  cancelado_por_nome   text,
  cancelado_em         timestamptz,
  motivo_cancelamento  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (loja_id, numero),
  unique (loja_id, chave_idempotencia)
);
create index if not exists pedidos_compra_loja_etapa on public.pedidos_compra (loja_id, etapa, id desc);

create table if not exists public.pedidos_compra_itens (
  id                   bigint generated always as identity primary key,
  pedido_id            bigint not null references public.pedidos_compra(id) on delete cascade,
  loja_id              bigint not null references public.lojas(id),
  linha                int not null,
  codigo_produto       bigint not null,
  descricao            text not null,
  unidade              text,                 -- unidade do pedido (padrão: a do produto)
  fator                numeric(18,6) not null default 1 check (fator > 0),  -- unidades de estoque por unidade do pedido
  quantidade           numeric(18,6) not null check (quantidade > 0),       -- na unidade do pedido
  preco_unitario       numeric(18,6) not null default 0 check (preco_unitario >= 0),  -- preço combinado por unidade do pedido
  codigo_local_estoque bigint,
  obs                  text,
  unique (pedido_id, linha),
  foreign key (codigo_produto, loja_id) references public.produtos(codigo_produto, loja_id)
);
create index if not exists pedidos_compra_itens_produto on public.pedidos_compra_itens (loja_id, codigo_produto);

-- Item do pedido × item da nota (compras_proprio_itens). Um item da nota atende no máximo um item de pedido.
create table if not exists public.pedidos_compra_vinculos (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  pedido_id            bigint not null references public.pedidos_compra(id) on delete cascade,
  pedido_item_id       bigint not null references public.pedidos_compra_itens(id) on delete cascade,
  compra_id            bigint not null references public.compras_proprio(id) on delete cascade,
  compra_item_id       bigint not null references public.compras_proprio_itens(id) on delete cascade,
  criado_por           text,
  created_at           timestamptz not null default now(),
  unique (compra_item_id)
);
create index if not exists pedidos_compra_vinculos_pedido on public.pedidos_compra_vinculos (pedido_id);
create index if not exists pedidos_compra_vinculos_compra on public.pedidos_compra_vinculos (compra_id);

create table if not exists public.pedidos_compra_eventos (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  pedido_id            bigint not null references public.pedidos_compra(id) on delete cascade,
  tipo                 text not null,
  de_etapa             text,
  para_etapa           text,
  detalhe              jsonb not null default '{}'::jsonb,
  user_id              text,
  user_nome            text,
  created_at           timestamptz not null default now()
);
create index if not exists pedidos_compra_eventos_pedido on public.pedidos_compra_eventos (pedido_id, id);

create or replace function public.trg_pedidos_compra_eventos_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'pedidos_compra_eventos é append-only' using errcode = '55000';
end $$;
drop trigger if exists pedidos_compra_eventos_imutavel on public.pedidos_compra_eventos;
create trigger pedidos_compra_eventos_imutavel before update on public.pedidos_compra_eventos
  for each row execute function public.trg_pedidos_compra_eventos_imutavel();

-- RLS (padrão initplan da 156) e grants mínimos: leitura pela sessão, escrita só service role / funções.
do $$ declare t text; begin
  foreach t in array array['pedidos_compra', 'pedidos_compra_itens', 'pedidos_compra_vinculos', 'pedidos_compra_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Situação de cada item: quantidade em unidade de estoque, quanto já está em nota vinculada e quanto já entrou no estoque.
-- security_invoker: o RLS das tabelas de baixo vale para quem consulta.
create or replace view public.pedidos_compra_itens_situacao with (security_invoker = true) as
select i.id, i.pedido_id, i.loja_id, i.linha, i.codigo_produto, i.descricao, i.unidade, i.fator, i.quantidade, i.preco_unitario,
       i.codigo_local_estoque, i.obs,
       round(i.quantidade * i.fator, 6) as quantidade_base,
       round(i.preco_unitario / i.fator, 6) as preco_base,
       coalesce(sum(coalesce(ci.quantidade_recebida, ci.quantidade * ci.fator)) filter (where c.status <> 'cancelada'), 0) as vinculado,
       coalesce(sum(coalesce(ci.quantidade_recebida, ci.quantidade * ci.fator)) filter (where c.status <> 'cancelada' and ci.lancado), 0) as recebido
  from public.pedidos_compra_itens i
  left join public.pedidos_compra_vinculos v on v.pedido_item_id = i.id
  left join public.compras_proprio_itens ci on ci.id = v.compra_item_id
  left join public.compras_proprio c on c.id = ci.compra_id
 group by i.id;
revoke all on public.pedidos_compra_itens_situacao from anon, authenticated;
grant select on public.pedidos_compra_itens_situacao to authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------
create or replace function public._pc_loja_propria(p_loja bigint) returns void
language plpgsql stable set search_path = public as $$
begin
  if (select modo_estoque from lojas where id = p_loja) is distinct from 'proprio' then
    raise exception 'A loja % não usa estoque próprio: pedido de compra local só existe no estoque próprio', p_loja using errcode = '22023';
  end if;
end $$;

-- Cria ou edita (só rascunho) um pedido. p_dados: {id?, chave_idempotencia?, origem?, fornecedor_id?, fornecedor_nome,
-- fornecedor_cnpj?, previsao_entrega?, frete?, outras_despesas?, parcelas?, numero_fornecedor?, contato?, obs?, obs_interna?,
-- itens:[{codigo_produto, descricao?, unidade?, fator?, quantidade, preco_unitario?, codigo_local_estoque?, obs?}]}
create or replace function public.pc_salvar(p_loja bigint, p_dados jsonb, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped pedidos_compra%rowtype; v_id bigint := nullif(p_dados->>'id', '')::bigint;
  v_chave text := nullif(btrim(coalesce(p_dados->>'chave_idempotencia', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_dados->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
  v_parc jsonb := coalesce(p_dados->'parcelas', '[]'::jsonb); v_soma numeric; v_n int; x jsonb; v_linha int := 0;
  v_forn bigint := nullif(p_dados->>'fornecedor_id', '')::bigint; v_nome text := btrim(coalesce(p_dados->>'fornecedor_nome', ''));
begin
  perform _pc_loja_propria(p_loja);
  if jsonb_typeof(p_dados->'itens') is distinct from 'array' or jsonb_array_length(p_dados->'itens') = 0 then
    raise exception 'O pedido precisa de pelo menos um item' using errcode = '22023';
  end if;
  if jsonb_typeof(v_parc) is distinct from 'array' then raise exception 'Parcelas inválidas' using errcode = '22023'; end if;
  if jsonb_array_length(v_parc) > 0 then
    select sum((e->>'percentual')::numeric), count(*) filter (where coalesce((e->>'dias')::int, -1) < 0 or coalesce((e->>'percentual')::numeric, 0) <= 0)
      into v_soma, v_n from jsonb_array_elements(v_parc) e;
    if v_n > 0 or abs(v_soma - 100) > 0.01 then
      raise exception 'Parcelas: dias >= 0, percentual > 0 e a soma dos percentuais = 100%%' using errcode = '22023';
    end if;
  end if;
  if v_forn is not null then
    select coalesce(nullif(btrim(razao_social), ''), nome_fantasia), coalesce(v_cnpj, nullif(regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g'), ''))
      into v_nome, v_cnpj from fornecedores where id = v_forn and loja_id = p_loja;
    if not found then raise exception 'Fornecedor % não é desta loja', v_forn using errcode = '22023'; end if;
  end if;
  if coalesce(v_nome, '') = '' then raise exception 'Informe o fornecedor' using errcode = '22023'; end if;
  if length(v_cnpj) not in (11, 14) then v_cnpj := null; end if;   -- documento torto no cadastro não trava o pedido

  if v_id is null and v_chave is not null then
    select * into v_ped from pedidos_compra where loja_id = p_loja and chave_idempotencia = v_chave;
    if found then return jsonb_build_object('ok', true, 'id', v_ped.id, 'numero', v_ped.numero, 'duplicado', true); end if;
  end if;

  if v_id is not null then
    select * into v_ped from pedidos_compra where id = v_id and loja_id = p_loja for update;
    if not found then raise exception 'Pedido inexistente' using errcode = '22023'; end if;
    if v_ped.etapa <> 'rascunho' then raise exception 'Só pedido em rascunho pode ser editado (etapa atual: %)', v_ped.etapa using errcode = '22023'; end if;
    update pedidos_compra set fornecedor_id = v_forn, fornecedor_nome = v_nome, fornecedor_cnpj = v_cnpj,
        previsao_entrega = nullif(p_dados->>'previsao_entrega', '')::date,
        frete = coalesce(nullif(p_dados->>'frete', '')::numeric, 0), outras_despesas = coalesce(nullif(p_dados->>'outras_despesas', '')::numeric, 0),
        parcelas = v_parc, numero_fornecedor = nullif(btrim(coalesce(p_dados->>'numero_fornecedor', '')), ''),
        contato = nullif(btrim(coalesce(p_dados->>'contato', '')), ''), obs = nullif(btrim(coalesce(p_dados->>'obs', '')), ''),
        obs_interna = nullif(btrim(coalesce(p_dados->>'obs_interna', '')), ''), updated_at = now()
      where id = v_id;
    delete from pedidos_compra_itens where pedido_id = v_id;   -- rascunho nunca tem vínculo (só aprovado vincula; reabrir exige sem vínculo)
  else
    perform pg_advisory_xact_lock(hashtext('pedido_compra_numero'), p_loja::int);
    insert into pedidos_compra (loja_id, numero, fornecedor_id, fornecedor_nome, fornecedor_cnpj, previsao_entrega, frete, outras_despesas, parcelas,
        numero_fornecedor, contato, obs, obs_interna, origem, chave_idempotencia, criado_por, criado_por_nome)
    values (p_loja, coalesce((select max(numero) from pedidos_compra where loja_id = p_loja), 0) + 1, v_forn, v_nome, v_cnpj,
        nullif(p_dados->>'previsao_entrega', '')::date, coalesce(nullif(p_dados->>'frete', '')::numeric, 0),
        coalesce(nullif(p_dados->>'outras_despesas', '')::numeric, 0), v_parc,
        nullif(btrim(coalesce(p_dados->>'numero_fornecedor', '')), ''), nullif(btrim(coalesce(p_dados->>'contato', '')), ''),
        nullif(btrim(coalesce(p_dados->>'obs', '')), ''), nullif(btrim(coalesce(p_dados->>'obs_interna', '')), ''),
        coalesce(nullif(p_dados->>'origem', ''), 'manual'), v_chave, p_user, p_nome)
    returning * into v_ped;
    v_id := v_ped.id;
  end if;

  for x in select * from jsonb_array_elements(p_dados->'itens') loop
    v_linha := v_linha + 1;
    insert into pedidos_compra_itens (pedido_id, loja_id, linha, codigo_produto, descricao, unidade, fator, quantidade, preco_unitario, codigo_local_estoque, obs)
    select v_id, p_loja, v_linha, p.codigo_produto, coalesce(nullif(btrim(coalesce(x->>'descricao', '')), ''), p.descricao),
           coalesce(nullif(btrim(coalesce(x->>'unidade', '')), ''), p.unidade), coalesce(nullif(x->>'fator', '')::numeric, 1),
           (x->>'quantidade')::numeric, coalesce(nullif(x->>'preco_unitario', '')::numeric, 0),
           nullif(x->>'codigo_local_estoque', '')::bigint, nullif(btrim(coalesce(x->>'obs', '')), '')
      from produtos p where p.loja_id = p_loja and p.codigo_produto = (x->>'codigo_produto')::bigint;
    if not found then raise exception 'Produto % não existe nesta loja', x->>'codigo_produto' using errcode = '22023'; end if;
  end loop;

  insert into pedidos_compra_eventos (loja_id, pedido_id, tipo, para_etapa, detalhe, user_id, user_nome)
  values (p_loja, v_id, case when nullif(p_dados->>'id', '') is null then 'criado' else 'editado' end, 'rascunho',
          jsonb_build_object('itens', v_linha, 'origem', v_ped.origem), p_user, p_nome);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_ped.numero, 'duplicado', false);
end $$;

-- Muda a etapa. p_acao: enviar (rascunho → aguardando), aprovar (rascunho/aguardando → aprovado), reprovar (aguardando →
-- rascunho), reabrir (aprovado sem nota vinculada → rascunho), cancelar (qualquer aberta → cancelado; com nota vinculada
-- = encerra o saldo que não veio). A permissão de aprovar é conferida no servidor antes de chamar.
create or replace function public.pc_acao(p_loja bigint, p_id bigint, p_acao text, p_user text default null, p_nome text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ped pedidos_compra%rowtype; v_nova text; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform _pc_loja_propria(p_loja);
  select * into v_ped from pedidos_compra where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Pedido inexistente' using errcode = '22023'; end if;
  v_nova := case
    when p_acao = 'enviar'   and v_ped.etapa = 'rascunho' then 'aguardando_aprovacao'
    when p_acao = 'aprovar'  and v_ped.etapa in ('rascunho', 'aguardando_aprovacao') then 'aprovado'
    when p_acao = 'reprovar' and v_ped.etapa = 'aguardando_aprovacao' then 'rascunho'
    when p_acao = 'reabrir'  and v_ped.etapa = 'aprovado' then 'rascunho'
    when p_acao = 'cancelar' and v_ped.etapa <> 'cancelado' then 'cancelado'
  end;
  if v_nova is null then
    raise exception 'Ação "%" não vale para pedido na etapa %', p_acao, v_ped.etapa using errcode = '22023';
  end if;
  if p_acao = 'reabrir' and exists (select 1 from pedidos_compra_vinculos where pedido_id = p_id) then
    raise exception 'O pedido já tem nota vinculada: desvincule a nota antes de reabrir' using errcode = '22023';
  end if;
  if p_acao in ('cancelar', 'reprovar') and v_motivo is null then
    raise exception 'Informe o motivo' using errcode = '22023';
  end if;
  update pedidos_compra set etapa = v_nova, updated_at = now(),
      aprovado_por = case when v_nova = 'aprovado' then p_user when v_nova = 'rascunho' then null else aprovado_por end,
      aprovado_por_nome = case when v_nova = 'aprovado' then p_nome when v_nova = 'rascunho' then null else aprovado_por_nome end,
      aprovado_em = case when v_nova = 'aprovado' then now() when v_nova = 'rascunho' then null else aprovado_em end,
      cancelado_por = case when v_nova = 'cancelado' then p_user else cancelado_por end,
      cancelado_por_nome = case when v_nova = 'cancelado' then p_nome else cancelado_por_nome end,
      cancelado_em = case when v_nova = 'cancelado' then now() else cancelado_em end,
      motivo_cancelamento = case when v_nova = 'cancelado' then v_motivo else motivo_cancelamento end
    where id = p_id;
  insert into pedidos_compra_eventos (loja_id, pedido_id, tipo, de_etapa, para_etapa, detalhe, user_id, user_nome)
  values (p_loja, p_id, p_acao, v_ped.etapa, v_nova, case when v_motivo is null then '{}'::jsonb else jsonb_build_object('motivo', v_motivo) end, p_user, p_nome);
  return jsonb_build_object('ok', true, 'id', p_id, 'de', v_ped.etapa, 'para', v_nova);
end $$;

-- Liga a nota (compra do estoque próprio) ao pedido aprovado: cada item da nota com produto vai para o item do pedido
-- do mesmo produto (primeiro o que ainda tem saldo). Refaz do zero os vínculos desta nota com este pedido (idempotente).
create or replace function public.pc_vincular_nota(p_loja bigint, p_pedido bigint, p_compra bigint, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ped pedidos_compra%rowtype; v_comp compras_proprio%rowtype; ci record; v_item bigint; v_ok int := 0; v_sem int := 0; v_outro int := 0;
begin
  perform _pc_loja_propria(p_loja);
  select * into v_ped from pedidos_compra where id = p_pedido and loja_id = p_loja for update;
  if not found then raise exception 'Pedido inexistente' using errcode = '22023'; end if;
  if v_ped.etapa <> 'aprovado' then raise exception 'Só pedido aprovado recebe nota (etapa atual: %)', v_ped.etapa using errcode = '22023'; end if;
  select * into v_comp from compras_proprio where id = p_compra and loja_id = p_loja;
  if not found then raise exception 'Nota inexistente' using errcode = '22023'; end if;
  if v_comp.status = 'cancelada' then raise exception 'Nota cancelada não entra no pedido' using errcode = '22023'; end if;
  if v_ped.fornecedor_cnpj is not null and v_comp.fornecedor_cnpj is not null
     and v_ped.fornecedor_cnpj <> regexp_replace(v_comp.fornecedor_cnpj, '\D', '', 'g') then
    raise exception 'A nota é de outro fornecedor' using errcode = '22023';
  end if;

  delete from pedidos_compra_vinculos where pedido_id = p_pedido and compra_id = p_compra;
  for ci in select i.* from compras_proprio_itens i where i.compra_id = p_compra order by i.linha loop
    if ci.codigo_produto is null then v_sem := v_sem + 1; continue; end if;
    if exists (select 1 from pedidos_compra_vinculos where compra_item_id = ci.id) then v_outro := v_outro + 1; continue; end if;
    select s.id into v_item from pedidos_compra_itens_situacao s
     where s.pedido_id = p_pedido and s.codigo_produto = ci.codigo_produto
     order by (s.quantidade_base - s.vinculado > 0) desc, s.linha limit 1;
    if v_item is null then v_sem := v_sem + 1; continue; end if;
    insert into pedidos_compra_vinculos (loja_id, pedido_id, pedido_item_id, compra_id, compra_item_id, criado_por)
    values (p_loja, p_pedido, v_item, p_compra, ci.id, p_user);
    v_ok := v_ok + 1;
  end loop;
  insert into pedidos_compra_eventos (loja_id, pedido_id, tipo, de_etapa, para_etapa, detalhe, user_id, user_nome)
  values (p_loja, p_pedido, 'nota_vinculada', v_ped.etapa, v_ped.etapa,
          jsonb_build_object('compra_id', p_compra, 'numero', v_comp.numero, 'itens', v_ok, 'fora_do_pedido', v_sem, 'em_outro_pedido', v_outro), p_user, p_nome);
  return jsonb_build_object('ok', true, 'vinculados', v_ok, 'fora_do_pedido', v_sem, 'em_outro_pedido', v_outro);
end $$;

create or replace function public.pc_desvincular_nota(p_loja bigint, p_pedido bigint, p_compra bigint, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ped pedidos_compra%rowtype; v_n int;
begin
  perform _pc_loja_propria(p_loja);
  select * into v_ped from pedidos_compra where id = p_pedido and loja_id = p_loja for update;
  if not found then raise exception 'Pedido inexistente' using errcode = '22023'; end if;
  delete from pedidos_compra_vinculos where pedido_id = p_pedido and compra_id = p_compra;
  get diagnostics v_n = row_count;
  insert into pedidos_compra_eventos (loja_id, pedido_id, tipo, de_etapa, para_etapa, detalhe, user_id, user_nome)
  values (p_loja, p_pedido, 'nota_desvinculada', v_ped.etapa, v_ped.etapa, jsonb_build_object('compra_id', p_compra, 'itens', v_n), p_user, p_nome);
  return jsonb_build_object('ok', true, 'desvinculados', v_n);
end $$;

do $$ declare f text; begin
  foreach f in array array['_pc_loja_propria(bigint)', 'pc_salvar(bigint, jsonb, text, text)', 'pc_acao(bigint, bigint, text, text, text, text)',
                           'pc_vincular_nota(bigint, bigint, bigint, text, text)', 'pc_desvincular_nota(bigint, bigint, bigint, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
