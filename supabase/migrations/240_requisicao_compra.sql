-- 240 — Fase C2 (paridade com o Omie): compradores [I8] e requisição de compra [I1] do estoque próprio.
-- SÓ loja modo_estoque='proprio'. Nada aqui fala com o Omie; lojas Omie não usam nada disto.
-- Aditiva, com duas mudanças em objetos da 200 (já em produção desde 19/10):
--   * pedidos_compra ganha comprador_id (nullable) e origem aceita também 'requisicao' e 'planilha';
--   * pc_salvar é recriada IGUAL à da 200 + o campo comprador_id (só confere o comprador quando ele muda).
-- Aplicar (manual, com backup e OK do dono), numa transação:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 240_requisicao_compra.sql
-- Depois: NOTIFY pgrst; desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
-- Requisição: aberta → aprovada → pedido (virou pedido) | recusada (com motivo). reabrir: aprovada/recusada → aberta.
-- Editar só aberta. Fornecedor é sugerido por item (pode ficar vazio). rc_gerar_pedidos junta várias requisições
-- aprovadas e cria um pedido RASCUNHO por fornecedor (mesmo produto+unidade+fator somado, preço médio ponderado).

begin;

insert into permissoes (nome) values ('Compras - Requisicoes') on conflict (nome) do nothing;

-- ------------------------------------------------------------------------------------------------------------------
-- Compradores (Omie: Configurações → Compradores; lá é só o nome e a situação). Aqui também o usuário do sistema,
-- para o painel de tarefas mostrar "só as minhas".
create table if not exists public.compradores (
  id          bigint generated always as identity primary key,
  loja_id     bigint not null references public.lojas(id),
  nome        text not null check (btrim(nome) <> '' and length(nome) <= 70),
  user_id     text check (user_id is null or user_id ~ '^[0-9a-f-]{36}$'),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists compradores_loja_nome on public.compradores (loja_id, lower(btrim(nome)));

alter table public.pedidos_compra add column if not exists comprador_id bigint references public.compradores(id);
alter table public.pedidos_compra drop constraint if exists pedidos_compra_origem_check;
alter table public.pedidos_compra add constraint pedidos_compra_origem_check check (origem in ('manual', 'sugestao', 'requisicao', 'planilha'));

-- ------------------------------------------------------------------------------------------------------------------
create table if not exists public.requisicoes_compra (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  numero               int not null,
  etapa                text not null default 'aberta' check (etapa in ('aberta', 'aprovada', 'pedido', 'recusada')),
  sugestao_entrega     date,
  comprador_id         bigint references public.compradores(id),
  obs                  text,                 -- vai para a cotação / o pedido
  obs_interna          text,
  origem               text not null default 'manual' check (origem in ('manual', 'sugestao')),
  chave_idempotencia   text,
  criado_por           text,
  criado_por_nome      text,
  aprovado_por         text,
  aprovado_por_nome    text,
  aprovado_em          timestamptz,
  recusado_por         text,
  recusado_por_nome    text,
  recusado_em          timestamptz,
  motivo_recusa        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (loja_id, numero),
  unique (loja_id, chave_idempotencia)
);
create index if not exists requisicoes_compra_loja_etapa on public.requisicoes_compra (loja_id, etapa, id desc);

create table if not exists public.requisicoes_compra_itens (
  id                   bigint generated always as identity primary key,
  requisicao_id        bigint not null references public.requisicoes_compra(id) on delete cascade,
  loja_id              bigint not null references public.lojas(id),
  linha                int not null,
  codigo_produto       bigint not null,
  descricao            text not null,
  unidade              text,
  fator                numeric(18,6) not null default 1 check (fator > 0),
  quantidade           numeric(18,6) not null check (quantidade > 0),
  preco_sugerido       numeric(18,6) not null default 0 check (preco_sugerido >= 0),
  fornecedor_id        bigint references public.fornecedores(id),
  fornecedor_nome      text,
  fornecedor_cnpj      text check (fornecedor_cnpj is null or fornecedor_cnpj ~ '^[0-9]{11,14}$'),
  obs                  text,
  pedido_id            bigint references public.pedidos_compra(id),
  pedido_item_id       bigint references public.pedidos_compra_itens(id) on delete set null,
  unique (requisicao_id, linha),
  foreign key (codigo_produto, loja_id) references public.produtos(codigo_produto, loja_id)
);
create index if not exists requisicoes_compra_itens_produto on public.requisicoes_compra_itens (loja_id, codigo_produto);
create index if not exists requisicoes_compra_itens_pedido on public.requisicoes_compra_itens (pedido_id) where pedido_id is not null;

create table if not exists public.requisicoes_compra_eventos (
  id             bigint generated always as identity primary key,
  loja_id        bigint not null references public.lojas(id),
  requisicao_id  bigint not null references public.requisicoes_compra(id) on delete cascade,
  tipo           text not null,
  de_etapa       text,
  para_etapa     text,
  detalhe        jsonb not null default '{}'::jsonb,
  user_id        text,
  user_nome      text,
  created_at     timestamptz not null default now()
);
create index if not exists requisicoes_compra_eventos_req on public.requisicoes_compra_eventos (requisicao_id, id);

create or replace function public.trg_requisicoes_compra_eventos_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'requisicoes_compra_eventos é append-only' using errcode = '55000';
end $$;
drop trigger if exists requisicoes_compra_eventos_imutavel on public.requisicoes_compra_eventos;
create trigger requisicoes_compra_eventos_imutavel before update or delete on public.requisicoes_compra_eventos
  for each row execute function public.trg_requisicoes_compra_eventos_imutavel();

-- RLS (padrão initplan da 156) e grants mínimos: leitura pela sessão, escrita só service role / funções.
do $$ declare t text; begin
  foreach t in array array['compradores', 'requisicoes_compra', 'requisicoes_compra_itens', 'requisicoes_compra_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ------------------------------------------------------------------------------------------------------------------
-- Chave de agrupamento por fornecedor (a mesma regra está em lib/compras/requisicao-puro.ts, chaveFornecedor):
-- cadastro > CNPJ > nome sem acento e sem caixa > '' (fornecedor a definir).
create or replace function public._rc_chave_fornecedor(p_id bigint, p_cnpj text, p_nome text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_id is not null then 'id:' || p_id
    when nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '') is not null then 'cnpj:' || regexp_replace(p_cnpj, '\D', '', 'g')
    when nullif(btrim(coalesce(p_nome, '')), '') is not null then 'nome:' || lower(translate(regexp_replace(btrim(p_nome), '\s+', ' ', 'g'),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
    else '' end
$$;

-- Comprador ativo da loja; null = sem comprador. Só confere quando o valor muda (p_atual), para editar um pedido
-- antigo cujo comprador foi desativado sem precisar trocá-lo.
create or replace function public._comprador_valido(p_loja bigint, p_comprador bigint, p_atual bigint default null) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_comprador is null or p_comprador is not distinct from p_atual then return; end if;
  if not exists (select 1 from compradores where id = p_comprador and loja_id = p_loja and ativo) then
    raise exception 'Comprador % não é desta loja ou está inativo', p_comprador using errcode = '22023';
  end if;
end $$;

-- Cria ou edita um comprador. p_dados: {id?, nome, user_id?, ativo?}
create or replace function public.comp_salvar(p_loja bigint, p_dados jsonb, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p_dados->>'id', '')::bigint; v_nome text := regexp_replace(btrim(coalesce(p_dados->>'nome', '')), '\s+', ' ', 'g');
        v_user text := nullif(btrim(coalesce(p_dados->>'user_id', '')), ''); v_ativo boolean := coalesce((p_dados->>'ativo')::boolean, true);
begin
  perform _pc_loja_propria(p_loja);
  if v_nome = '' or length(v_nome) > 70 then raise exception 'Nome do comprador: de 1 a 70 caracteres' using errcode = '22023'; end if;
  if v_user is not null and (v_user !~ '^[0-9a-f-]{36}$' or not exists (select 1 from loja_user where loja_id = p_loja and user_id = v_user::uuid)) then
    raise exception 'O usuário escolhido não é desta loja' using errcode = '22023';
  end if;
  begin
    if v_id is null then
      insert into compradores (loja_id, nome, user_id, ativo) values (p_loja, v_nome, v_user, v_ativo) returning id into v_id;
    else
      update compradores set nome = v_nome, user_id = v_user, ativo = v_ativo, updated_at = now() where id = v_id and loja_id = p_loja;
      if not found then raise exception 'Comprador inexistente' using errcode = '22023'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Já existe um comprador com esse nome' using errcode = '22023';
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ------------------------------------------------------------------------------------------------------------------
-- pc_salvar da 200 + comprador_id. Corpo idêntico ao da 200 fora as linhas marcadas "240".
create or replace function public.pc_salvar(p_loja bigint, p_dados jsonb, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped pedidos_compra%rowtype; v_id bigint := nullif(p_dados->>'id', '')::bigint;
  v_chave text := nullif(btrim(coalesce(p_dados->>'chave_idempotencia', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_dados->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
  v_parc jsonb := coalesce(p_dados->'parcelas', '[]'::jsonb); v_soma numeric; v_n int; x jsonb; v_linha int := 0;
  v_forn bigint := nullif(p_dados->>'fornecedor_id', '')::bigint; v_nome text := btrim(coalesce(p_dados->>'fornecedor_nome', ''));
  v_comp bigint := nullif(p_dados->>'comprador_id', '')::bigint;   -- 240
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

  -- criação: a trava vem ANTES de conferir a chave (dois envios simultâneos com a mesma chave = o 2º vê o 1º e devolve duplicado)
  if v_id is null then perform pg_advisory_xact_lock(hashtext('pedido_compra_numero'), p_loja::int); end if;
  if v_id is null and v_chave is not null then
    select * into v_ped from pedidos_compra where loja_id = p_loja and chave_idempotencia = v_chave;
    if found then return jsonb_build_object('ok', true, 'id', v_ped.id, 'numero', v_ped.numero, 'duplicado', true); end if;
  end if;

  if v_id is not null then
    select * into v_ped from pedidos_compra where id = v_id and loja_id = p_loja for update;
    if not found then raise exception 'Pedido inexistente' using errcode = '22023'; end if;
    if v_ped.etapa <> 'rascunho' then raise exception 'Só pedido em rascunho pode ser editado (etapa atual: %)', v_ped.etapa using errcode = '22023'; end if;
    perform _comprador_valido(p_loja, v_comp, v_ped.comprador_id);   -- 240
    update pedidos_compra set fornecedor_id = v_forn, fornecedor_nome = v_nome, fornecedor_cnpj = v_cnpj,
        previsao_entrega = nullif(p_dados->>'previsao_entrega', '')::date,
        frete = coalesce(nullif(p_dados->>'frete', '')::numeric, 0), outras_despesas = coalesce(nullif(p_dados->>'outras_despesas', '')::numeric, 0),
        parcelas = v_parc, numero_fornecedor = nullif(btrim(coalesce(p_dados->>'numero_fornecedor', '')), ''),
        contato = nullif(btrim(coalesce(p_dados->>'contato', '')), ''), obs = nullif(btrim(coalesce(p_dados->>'obs', '')), ''),
        obs_interna = nullif(btrim(coalesce(p_dados->>'obs_interna', '')), ''), comprador_id = v_comp, updated_at = now()   -- 240: comprador_id
      where id = v_id;
    delete from pedidos_compra_itens where pedido_id = v_id;   -- rascunho nunca tem vínculo (só aprovado vincula; reabrir exige sem vínculo)
  else
    perform _comprador_valido(p_loja, v_comp);   -- 240
    insert into pedidos_compra (loja_id, numero, fornecedor_id, fornecedor_nome, fornecedor_cnpj, previsao_entrega, frete, outras_despesas, parcelas,
        numero_fornecedor, contato, obs, obs_interna, origem, chave_idempotencia, criado_por, criado_por_nome, comprador_id)   -- 240: comprador_id
    values (p_loja, coalesce((select max(numero) from pedidos_compra where loja_id = p_loja), 0) + 1, v_forn, v_nome, v_cnpj,
        nullif(p_dados->>'previsao_entrega', '')::date, coalesce(nullif(p_dados->>'frete', '')::numeric, 0),
        coalesce(nullif(p_dados->>'outras_despesas', '')::numeric, 0), v_parc,
        nullif(btrim(coalesce(p_dados->>'numero_fornecedor', '')), ''), nullif(btrim(coalesce(p_dados->>'contato', '')), ''),
        nullif(btrim(coalesce(p_dados->>'obs', '')), ''), nullif(btrim(coalesce(p_dados->>'obs_interna', '')), ''),
        coalesce(nullif(p_dados->>'origem', ''), 'manual'), v_chave, p_user, p_nome, v_comp)
    returning * into v_ped;
    v_id := v_ped.id;
  end if;

  for x in select * from jsonb_array_elements(p_dados->'itens') loop
    v_linha := v_linha + 1;
    if nullif(x->>'codigo_local_estoque', '') is not null and not exists (
         select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = (x->>'codigo_local_estoque')::bigint and deleted_at is null) then
      raise exception 'Local de estoque % não é desta loja', x->>'codigo_local_estoque' using errcode = '22023';
    end if;
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

-- ------------------------------------------------------------------------------------------------------------------
-- Cria ou edita (só aberta) uma requisição. p_dados: {id?, chave_idempotencia?, origem?, sugestao_entrega?, comprador_id?,
-- obs?, obs_interna?, itens:[{codigo_produto, descricao?, unidade?, fator?, quantidade, preco_sugerido?, fornecedor_id?,
-- fornecedor_nome?, fornecedor_cnpj?, obs?}]}
create or replace function public.rc_salvar(p_loja bigint, p_dados jsonb, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req requisicoes_compra%rowtype; v_id bigint := nullif(p_dados->>'id', '')::bigint;
  v_chave text := nullif(btrim(coalesce(p_dados->>'chave_idempotencia', '')), '');
  v_comp bigint := nullif(p_dados->>'comprador_id', '')::bigint; x jsonb; v_linha int := 0;
  v_forn bigint; v_fnome text; v_fcnpj text;
begin
  perform _pc_loja_propria(p_loja);
  if jsonb_typeof(p_dados->'itens') is distinct from 'array' or jsonb_array_length(p_dados->'itens') = 0 then
    raise exception 'A requisição precisa de pelo menos um item' using errcode = '22023';
  end if;
  if jsonb_array_length(p_dados->'itens') > 300 then raise exception 'No máximo 300 itens por requisição' using errcode = '22023'; end if;

  if v_id is null then perform pg_advisory_xact_lock(hashtext('requisicao_compra_numero'), p_loja::int); end if;
  if v_id is null and v_chave is not null then
    select * into v_req from requisicoes_compra where loja_id = p_loja and chave_idempotencia = v_chave;
    if found then return jsonb_build_object('ok', true, 'id', v_req.id, 'numero', v_req.numero, 'duplicado', true); end if;
  end if;

  if v_id is not null then
    select * into v_req from requisicoes_compra where id = v_id and loja_id = p_loja for update;
    if not found then raise exception 'Requisição inexistente' using errcode = '22023'; end if;
    if v_req.etapa <> 'aberta' then raise exception 'Só requisição aberta pode ser editada (etapa atual: %)', v_req.etapa using errcode = '22023'; end if;
    perform _comprador_valido(p_loja, v_comp, v_req.comprador_id);
    update requisicoes_compra set sugestao_entrega = nullif(p_dados->>'sugestao_entrega', '')::date, comprador_id = v_comp,
        obs = nullif(btrim(coalesce(p_dados->>'obs', '')), ''), obs_interna = nullif(btrim(coalesce(p_dados->>'obs_interna', '')), ''), updated_at = now()
      where id = v_id;
    delete from requisicoes_compra_itens where requisicao_id = v_id;   -- aberta nunca virou pedido
  else
    perform _comprador_valido(p_loja, v_comp);
    insert into requisicoes_compra (loja_id, numero, sugestao_entrega, comprador_id, obs, obs_interna, origem, chave_idempotencia, criado_por, criado_por_nome)
    values (p_loja, coalesce((select max(numero) from requisicoes_compra where loja_id = p_loja), 0) + 1,
        nullif(p_dados->>'sugestao_entrega', '')::date, v_comp, nullif(btrim(coalesce(p_dados->>'obs', '')), ''),
        nullif(btrim(coalesce(p_dados->>'obs_interna', '')), ''), coalesce(nullif(p_dados->>'origem', ''), 'manual'), v_chave, p_user, p_nome)
    returning * into v_req;
    v_id := v_req.id;
  end if;

  for x in select * from jsonb_array_elements(p_dados->'itens') loop
    v_linha := v_linha + 1;
    v_forn := nullif(x->>'fornecedor_id', '')::bigint;
    v_fnome := nullif(btrim(coalesce(x->>'fornecedor_nome', '')), '');
    v_fcnpj := nullif(regexp_replace(coalesce(x->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
    if v_forn is not null then
      select coalesce(nullif(btrim(razao_social), ''), nome_fantasia), coalesce(nullif(regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g'), ''), v_fcnpj)
        into v_fnome, v_fcnpj from fornecedores where id = v_forn and loja_id = p_loja;
      if not found then raise exception 'Fornecedor % não é desta loja', v_forn using errcode = '22023'; end if;
    end if;
    if length(v_fcnpj) not in (11, 14) then v_fcnpj := null; end if;
    if v_forn is null and v_fcnpj is not null then   -- CNPJ de fornecedor cadastrado = o cadastro (agrupa junto na hora de gerar o pedido)
      select id, coalesce(nullif(btrim(razao_social), ''), nome_fantasia) into v_forn, v_fnome from fornecedores
       where loja_id = p_loja and regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g') = v_fcnpj and not coalesce(inativo, false) order by id limit 1;
    end if;
    insert into requisicoes_compra_itens (requisicao_id, loja_id, linha, codigo_produto, descricao, unidade, fator, quantidade, preco_sugerido,
        fornecedor_id, fornecedor_nome, fornecedor_cnpj, obs)
    select v_id, p_loja, v_linha, p.codigo_produto, coalesce(nullif(btrim(coalesce(x->>'descricao', '')), ''), p.descricao),
           coalesce(nullif(btrim(coalesce(x->>'unidade', '')), ''), p.unidade), coalesce(nullif(x->>'fator', '')::numeric, 1),
           (x->>'quantidade')::numeric, coalesce(nullif(x->>'preco_sugerido', '')::numeric, 0),
           v_forn, v_fnome, v_fcnpj, nullif(btrim(coalesce(x->>'obs', '')), '')
      from produtos p where p.loja_id = p_loja and p.codigo_produto = (x->>'codigo_produto')::bigint;
    if not found then raise exception 'Produto % não existe nesta loja', x->>'codigo_produto' using errcode = '22023'; end if;
  end loop;

  insert into requisicoes_compra_eventos (loja_id, requisicao_id, tipo, para_etapa, detalhe, user_id, user_nome)
  values (p_loja, v_id, case when nullif(p_dados->>'id', '') is null then 'criada' else 'editada' end, 'aberta',
          jsonb_build_object('itens', v_linha, 'origem', v_req.origem), p_user, p_nome);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_req.numero, 'duplicado', false);
end $$;

-- p_acao: aprovar (aberta → aprovada), recusar (aberta/aprovada → recusada, com motivo), reabrir (aprovada/recusada → aberta).
-- A permissão de aprovar/recusar é conferida no servidor antes de chamar.
create or replace function public.rc_acao(p_loja bigint, p_id bigint, p_acao text, p_user text default null, p_nome text default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req requisicoes_compra%rowtype; v_nova text; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform _pc_loja_propria(p_loja);
  select * into v_req from requisicoes_compra where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Requisição inexistente' using errcode = '22023'; end if;
  v_nova := case
    when p_acao = 'aprovar' and v_req.etapa = 'aberta' then 'aprovada'
    when p_acao = 'recusar' and v_req.etapa in ('aberta', 'aprovada') then 'recusada'
    when p_acao = 'reabrir' and v_req.etapa in ('aprovada', 'recusada') then 'aberta'
  end;
  if v_nova is null then raise exception 'Ação "%" não vale para requisição na etapa %', p_acao, v_req.etapa using errcode = '22023'; end if;
  if p_acao = 'recusar' and v_motivo is null then raise exception 'Informe o motivo' using errcode = '22023'; end if;
  update requisicoes_compra set etapa = v_nova, updated_at = now(),
      aprovado_por = case when v_nova = 'aprovada' then p_user when v_nova = 'aberta' then null else aprovado_por end,
      aprovado_por_nome = case when v_nova = 'aprovada' then p_nome when v_nova = 'aberta' then null else aprovado_por_nome end,
      aprovado_em = case when v_nova = 'aprovada' then now() when v_nova = 'aberta' then null else aprovado_em end,
      recusado_por = case when v_nova = 'recusada' then p_user when v_nova = 'aberta' then null else recusado_por end,
      recusado_por_nome = case when v_nova = 'recusada' then p_nome when v_nova = 'aberta' then null else recusado_por_nome end,
      recusado_em = case when v_nova = 'recusada' then now() when v_nova = 'aberta' then null else recusado_em end,
      motivo_recusa = case when v_nova = 'recusada' then v_motivo when v_nova = 'aberta' then null else motivo_recusa end
    where id = p_id;
  insert into requisicoes_compra_eventos (loja_id, requisicao_id, tipo, de_etapa, para_etapa, detalhe, user_id, user_nome)
  values (p_loja, p_id, p_acao, v_req.etapa, v_nova, case when v_motivo is null then '{}'::jsonb else jsonb_build_object('motivo', v_motivo) end, p_user, p_nome);
  return jsonb_build_object('ok', true, 'id', p_id, 'de', v_req.etapa, 'para', v_nova);
end $$;

-- Gera os pedidos (rascunho) das requisições aprovadas: um por fornecedor sugerido. Tudo ou nada. Idempotente por
-- p_chave: repetir a chamada devolve os mesmos pedidos (duplicado = true), sem criar nada.
create or replace function public.rc_gerar_pedidos(p_loja bigint, p_ids bigint[], p_chave text, p_user text default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_n int; g record; v_itens jsonb; v_forn record; v_prev date; v_nums text; v_comp bigint; v_ncomp int;
        r jsonb; v_ped bigint; v_peds jsonb := '[]'::jsonb; v_i int := 0;
begin
  perform _pc_loja_propria(p_loja);
  if coalesce(p_chave, '') !~ '^[A-Za-z0-9_-]{8,80}$' then raise exception 'Chave inválida' using errcode = '22023'; end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_ids) x where x is not null;
  if v_ids is null then raise exception 'Escolha pelo menos uma requisição aprovada' using errcode = '22023'; end if;
  if cardinality(v_ids) > 100 then raise exception 'No máximo 100 requisições de uma vez' using errcode = '22023'; end if;

  -- a trava vem antes de conferir a chave (dois cliques = o 2º espera e devolve o que o 1º criou)
  perform pg_advisory_xact_lock(hashtext('requisicao_gerar_pedidos'), p_loja::int);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'fornecedor', fornecedor_nome) order by id), '[]'::jsonb)
    into v_peds from pedidos_compra where loja_id = p_loja and chave_idempotencia like p_chave || ':%';
  if jsonb_array_length(v_peds) > 0 then return jsonb_build_object('ok', true, 'duplicado', true, 'pedidos', v_peds); end if;

  perform 1 from requisicoes_compra where loja_id = p_loja and id = any(v_ids) order by id for update;
  select count(*) into v_n from requisicoes_compra where loja_id = p_loja and id = any(v_ids) and etapa = 'aprovada';
  if v_n <> cardinality(v_ids) then
    raise exception 'Só requisição aprovada desta loja vira pedido (% de % escolhidas estão aprovadas)', v_n, cardinality(v_ids) using errcode = '22023';
  end if;
  -- comprador do pedido: o das requisições, se todas têm o mesmo
  select count(distinct comprador_id), min(comprador_id) into v_ncomp, v_comp from requisicoes_compra where id = any(v_ids) and comprador_id is not null;
  if v_ncomp <> 1 or exists (select 1 from requisicoes_compra where id = any(v_ids) and comprador_id is null)
     or not exists (select 1 from compradores where id = v_comp and ativo) then v_comp := null; end if;

  for g in
    select _rc_chave_fornecedor(i.fornecedor_id, i.fornecedor_cnpj, i.fornecedor_nome) as k, min(i.id) as ordem, array_agg(i.id) as itens
      from requisicoes_compra_itens i where i.requisicao_id = any(v_ids)
     group by 1 order by 2
  loop
    v_i := v_i + 1;
    select i.fornecedor_id, i.fornecedor_nome, i.fornecedor_cnpj into v_forn
      from requisicoes_compra_itens i where i.id = any(g.itens) order by (i.fornecedor_id is null), (i.fornecedor_nome is null), i.id limit 1;
    select min(r.sugestao_entrega), string_agg(distinct r.numero::text, ', ') into v_prev, v_nums
      from requisicoes_compra r where r.id in (select requisicao_id from requisicoes_compra_itens where id = any(g.itens));
    select jsonb_agg(jsonb_build_object('codigo_produto', codigo_produto, 'descricao', descricao, 'unidade', unidade, 'fator', fator,
             'quantidade', q, 'preco_unitario', case when q > 0 then round(v / q, 6) else 0 end) order by ordem)
      into v_itens
      from (select codigo_produto, min(descricao) as descricao, unidade, fator, sum(quantidade) as q, sum(quantidade * preco_sugerido) as v, min(id) as ordem
              from requisicoes_compra_itens where id = any(g.itens) group by codigo_produto, unidade, fator) s;
    r := pc_salvar(p_loja, jsonb_build_object('chave_idempotencia', p_chave || ':' || v_i, 'origem', 'requisicao',
           'fornecedor_id', v_forn.fornecedor_id, 'fornecedor_nome', coalesce(v_forn.fornecedor_nome, 'Fornecedor a definir'),
           'fornecedor_cnpj', v_forn.fornecedor_cnpj, 'previsao_entrega', v_prev, 'comprador_id', v_comp,
           'obs_interna', 'Das requisições nº ' || v_nums, 'itens', v_itens), p_user, p_nome);
    v_ped := (r->>'id')::bigint;
    update requisicoes_compra_itens ri set pedido_id = v_ped, pedido_item_id = pi.id
      from pedidos_compra_itens pi
     where ri.id = any(g.itens) and pi.pedido_id = v_ped and pi.codigo_produto = ri.codigo_produto
       and pi.unidade is not distinct from ri.unidade and pi.fator = ri.fator;
    v_peds := v_peds || jsonb_build_object('id', v_ped, 'numero', (r->>'numero')::int, 'fornecedor', coalesce(v_forn.fornecedor_nome, 'Fornecedor a definir'));
  end loop;

  update requisicoes_compra set etapa = 'pedido', updated_at = now() where id = any(v_ids);
  insert into requisicoes_compra_eventos (loja_id, requisicao_id, tipo, de_etapa, para_etapa, detalhe, user_id, user_nome)
  select p_loja, id, 'pedido_gerado', 'aprovada', 'pedido',
         jsonb_build_object('pedidos', (select jsonb_agg(distinct pedido_id) from requisicoes_compra_itens where requisicao_id = rq.id)), p_user, p_nome
    from requisicoes_compra rq where id = any(v_ids);
  return jsonb_build_object('ok', true, 'duplicado', false, 'pedidos', v_peds);
end $$;

do $$ declare f text; begin
  foreach f in array array['_rc_chave_fornecedor(bigint, text, text)', '_comprador_valido(bigint, bigint, bigint)',
                           'comp_salvar(bigint, jsonb, text, text)', 'pc_salvar(bigint, jsonb, text, text)',
                           'rc_salvar(bigint, jsonb, text, text)', 'rc_acao(bigint, bigint, text, text, text, text)',
                           'rc_gerar_pedidos(bigint, bigint[], text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
