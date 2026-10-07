-- 135 — Compras / nota fiscal de entrada do Estoque próprio (Fase 4, 06/10/2026)
-- Aditiva. Só lojas em modo 'proprio' usam. Entrada no ledger via registrar_movimento (migration 132).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 135_compras_proprio.sql

insert into permissoes (nome) values ('Compras'), ('Compras - Criar') on conflict (nome) do nothing;

create table if not exists public.compras_proprio (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  origem               text not null check (origem in ('manual', 'xml')),
  chave_acesso         text check (chave_acesso is null or chave_acesso ~ '^[0-9]{44}$'),
  numero               text,
  serie                text,
  fornecedor_cnpj      text,
  fornecedor_nome      text,
  emissao              date,
  valor_produtos       numeric(18,4) not null default 0,
  valor_frete          numeric(18,4) not null default 0,   -- frete + seguro + outras despesas acessórias
  valor_desconto       numeric(18,4) not null default 0,   -- desconto da nota (além do desconto por item)
  valor_total          numeric(18,4) not null default 0,
  icms_recuperavel     boolean not null default false,     -- Simples: false (custo é o valor cheio)
  codigo_local_estoque bigint,
  status               text not null default 'pendente' check (status in ('pendente', 'parcial', 'lancada', 'cancelada')),
  user_id              text,
  obs                  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  lancada_em           timestamptz,
  unique (loja_id, chave_acesso)                           -- a chave de 44 dígitos é a idempotência da compra
);
create index if not exists compras_proprio_loja on public.compras_proprio (loja_id, created_at desc);

create table if not exists public.compras_proprio_itens (
  id                  bigint generated always as identity primary key,
  compra_id           bigint not null references public.compras_proprio(id) on delete cascade,
  loja_id             bigint not null references public.lojas(id),
  linha               int not null,
  c_prod              text,                                -- código do produto no fornecedor
  ean                 text,
  descricao           text,
  ncm                 text,
  cfop                text,                                -- do XML, só informativo (não decide o tipo)
  unidade_compra      text,
  quantidade          numeric(18,6) not null default 0,
  valor_unitario      numeric(18,6) not null default 0,
  valor_total         numeric(18,4) not null default 0,    -- vProd (antes do desconto do item)
  desconto            numeric(18,4) not null default 0,
  icms_valor          numeric(18,4) not null default 0,
  fator               numeric(18,6) not null default 1,    -- unidades base por unidade de compra
  codigo_produto      bigint,                              -- produto interno (null = pendente de mapear)
  custo_unitario_base numeric(18,6),
  movimento_id        bigint,
  lancado             boolean not null default false,
  unique (compra_id, linha)
);
create index if not exists compras_proprio_itens_compra on public.compras_proprio_itens (compra_id);

create table if not exists public.fornecedor_produto_depara (
  loja_id         bigint not null references public.lojas(id),
  fornecedor_cnpj text not null,
  c_prod          text not null,
  codigo_produto  bigint not null,
  fator           numeric(18,6) not null default 1,
  unidade_compra  text,
  updated_at      timestamptz not null default now(),
  primary key (loja_id, fornecedor_cnpj, c_prod)
);

do $$ declare t text; begin
  foreach t in array array['compras_proprio', 'compras_proprio_itens', 'fornecedor_produto_depara'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin())', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Lança a compra no ledger. Idempotente: a mesma chave não duplica; itens já lançados não entram de novo.
-- p_compra: {loja_id, id?, origem, chave_acesso?, numero, serie, fornecedor_cnpj, fornecedor_nome, emissao,
--            valor_frete, valor_desconto, icms_recuperavel, obs, itens:[{linha, c_prod, ean, descricao, ncm, cfop,
--            unidade_compra, quantidade, valor_unitario, valor_total, desconto, icms_valor, fator, codigo_produto}]}
create or replace function public.lancar_compra(p_compra jsonb, p_local bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_loja bigint := (p_compra->>'loja_id')::bigint;
  v_modo text; v_chave text := nullif(btrim(coalesce(p_compra->>'chave_acesso', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_compra->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
  v_comp compras_proprio%rowtype; d record; it compras_proprio_itens%rowtype;
  v_total_liq numeric; v_n int; v_share numeric; v_custo_total numeric; v_qtd_base numeric; v_custo_unit numeric;
  v_ref text; r jsonb; v_lanc int := 0; v_pend int := 0; v_ja int := 0; v_saida jsonb := '[]'::jsonb; v_status text;
  v_nitens int; v_tinha_pendente boolean;
begin
  select modo_estoque into v_modo from lojas where id = v_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', v_loja using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = v_loja and codigo_local_estoque = p_local) then
    raise exception 'Local de estoque % inexistente', p_local using errcode = '22023';
  end if;

  -- compra existente (por id ou por chave) ou nova
  if nullif(p_compra->>'id', '') is not null then
    select * into v_comp from compras_proprio where id = (p_compra->>'id')::bigint and loja_id = v_loja for update;
    if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  elsif v_chave is not null then
    select * into v_comp from compras_proprio where loja_id = v_loja and chave_acesso = v_chave for update;
  end if;
  if v_comp.id is null then
    insert into compras_proprio (loja_id, origem, chave_acesso, numero, serie, fornecedor_cnpj, fornecedor_nome, emissao,
        valor_produtos, valor_frete, valor_desconto, valor_total, icms_recuperavel, codigo_local_estoque, user_id, obs)
    values (v_loja, coalesce(p_compra->>'origem', case when v_chave is null then 'manual' else 'xml' end), v_chave,
        p_compra->>'numero', p_compra->>'serie', v_cnpj, p_compra->>'fornecedor_nome', nullif(p_compra->>'emissao', '')::date,
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0),
        coalesce((p_compra->>'valor_frete')::numeric, 0), coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0) - coalesce((x->>'desconto')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0)
          + coalesce((p_compra->>'valor_frete')::numeric, 0) - coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((p_compra->>'icms_recuperavel')::boolean, false), p_local, p_user, p_compra->>'obs')
    returning * into v_comp;
  elsif v_comp.status = 'cancelada' then
    raise exception 'Compra cancelada não pode ser lançada de novo' using errcode = '22023';
  end if;

  -- itens: cria os que faltam; nos já existentes só atualiza o mapeamento (e só se ainda não lançados)
  for d in select value as item, ordinality::int as ord from jsonb_array_elements(coalesce(p_compra->'itens', '[]'::jsonb)) with ordinality loop
    insert into compras_proprio_itens (compra_id, loja_id, linha, c_prod, ean, descricao, ncm, cfop, unidade_compra,
        quantidade, valor_unitario, valor_total, desconto, icms_valor, fator, codigo_produto)
    values (v_comp.id, v_loja, coalesce((d.item->>'linha')::int, d.ord), d.item->>'c_prod', d.item->>'ean', d.item->>'descricao',
        d.item->>'ncm', d.item->>'cfop', d.item->>'unidade_compra', coalesce((d.item->>'quantidade')::numeric, 0),
        coalesce((d.item->>'valor_unitario')::numeric, 0), coalesce((d.item->>'valor_total')::numeric, 0),
        coalesce((d.item->>'desconto')::numeric, 0), coalesce((d.item->>'icms_valor')::numeric, 0),
        coalesce(nullif((d.item->>'fator')::numeric, 0), 1), nullif(d.item->>'codigo_produto', '')::bigint)
    on conflict (compra_id, linha) do update
      set codigo_produto = coalesce(excluded.codigo_produto, compras_proprio_itens.codigo_produto),
          fator = case when excluded.codigo_produto is not null then excluded.fator else compras_proprio_itens.fator end
      where not compras_proprio_itens.lancado;
  end loop;

  -- completa o mapeamento pelo de-para do fornecedor
  if v_cnpj is null then v_cnpj := v_comp.fornecedor_cnpj; end if;
  if v_cnpj is not null then
    update compras_proprio_itens i set codigo_produto = dp.codigo_produto, fator = dp.fator
      from fornecedor_produto_depara dp
     where i.compra_id = v_comp.id and not i.lancado and i.codigo_produto is null and i.c_prod is not null
       and dp.loja_id = v_loja and dp.fornecedor_cnpj = v_cnpj and dp.c_prod = i.c_prod;
  end if;

  -- rateio estável: base = valor líquido de TODOS os itens (não depende da ordem de mapeamento)
  select coalesce(sum(valor_total - desconto), 0), count(*) into v_total_liq, v_n from compras_proprio_itens where compra_id = v_comp.id;
  v_ref := coalesce(v_comp.chave_acesso, 'compra:' || v_comp.id);

  for it in select * from compras_proprio_itens where compra_id = v_comp.id order by linha loop
    if it.lancado then v_ja := v_ja + 1; continue; end if;
    v_qtd_base := it.quantidade * it.fator;
    if it.codigo_produto is null or v_qtd_base <= 0
       or not exists (select 1 from produtos where loja_id = v_loja and codigo_produto = it.codigo_produto) then
      v_pend := v_pend + 1;
      v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', false,
          'motivo', case when it.codigo_produto is null then 'sem_produto' when v_qtd_base <= 0 then 'quantidade_zero' else 'produto_inexistente' end);
      continue;
    end if;
    v_share := case when v_total_liq > 0 then (it.valor_total - it.desconto) / v_total_liq else 1.0 / greatest(v_n, 1) end;
    v_custo_total := (it.valor_total - it.desconto) + v_comp.valor_frete * v_share - v_comp.valor_desconto * v_share
                     - case when v_comp.icms_recuperavel then it.icms_valor else 0 end;
    v_custo_unit := round(v_custo_total / v_qtd_base, 6);
    r := registrar_movimento(v_loja, p_local, it.codigo_produto, 'ENT', 'COMPRA', v_ref, v_qtd_base,
                             case when v_custo_unit > 0 then v_custo_unit else null end, p_user,
                             'Compra ' || coalesce(v_comp.numero, v_comp.id::text), it.linha, null, null, null);
    update compras_proprio_itens set lancado = true, movimento_id = (r->>'id')::bigint, custo_unitario_base = v_custo_unit where id = it.id;
    if v_cnpj is not null and it.c_prod is not null then
      insert into fornecedor_produto_depara (loja_id, fornecedor_cnpj, c_prod, codigo_produto, fator, unidade_compra)
      values (v_loja, v_cnpj, it.c_prod, it.codigo_produto, it.fator, it.unidade_compra)
      on conflict (loja_id, fornecedor_cnpj, c_prod) do update
        set codigo_produto = excluded.codigo_produto, fator = excluded.fator, unidade_compra = excluded.unidade_compra, updated_at = now();
    end if;
    v_lanc := v_lanc + 1;
    v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', true, 'saldo', r->'saldo', 'cmc', r->'cmc',
                                             'custo_unitario_base', v_custo_unit, 'duplicado', r->'duplicado');
  end loop;

  select count(*) into v_nitens from compras_proprio_itens where compra_id = v_comp.id;
  v_status := case when v_nitens = 0 or (v_lanc + v_ja) = 0 then 'pendente' when (v_lanc + v_ja) < v_nitens then 'parcial' else 'lancada' end;
  update compras_proprio set status = v_status, codigo_local_estoque = p_local, updated_at = now(),
         lancada_em = case when v_status = 'lancada' then coalesce(lancada_em, now()) else lancada_em end
   where id = v_comp.id;

  return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'status', v_status, 'lancados', v_lanc, 'ja_lancados', v_ja,
                            'pendentes', v_pend, 'duplicado', (v_lanc = 0 and v_ja > 0 and v_pend = 0), 'itens', v_saida);
end $$;

-- Cancela a compra: estorna cada entrada no ledger (nunca apaga histórico).
create or replace function public.estornar_compra(p_compra_id bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c compras_proprio%rowtype; i record; n int := 0;
begin
  select * into c from compras_proprio where id = p_compra_id for update;
  if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  if c.status = 'cancelada' then return jsonb_build_object('ok', true, 'estornados', 0, 'duplicado', true); end if;
  for i in select * from compras_proprio_itens where compra_id = c.id and lancado and movimento_id is not null order by linha loop
    perform estornar_movimento(i.movimento_id, p_user, 'Estorno da compra ' || coalesce(c.numero, c.id::text));
    update compras_proprio_itens set lancado = false where id = i.id;
    n := n + 1;
  end loop;
  update compras_proprio set status = 'cancelada', updated_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'estornados', n, 'duplicado', false);
end $$;

do $$ declare f text; begin
  foreach f in array array['lancar_compra(jsonb,bigint,text)', 'estornar_compra(bigint,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
