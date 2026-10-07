-- 142 — Faturamento e lucro das lojas independentes (modo 'proprio'). Aditiva.
-- O Norte Vendas envia cada venda fechada; aqui ela vira (a) fato de vendas, (b) o pré-agregado `faturamento_importado`
-- que os relatórios atuais já leem, (c) base do lucro realizado (faturamento − CMV do ledger).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 142_faturamento_lucro_proprio.sql

create sequence if not exists public.seq_cupom_proprio start 8000000000001;

create table if not exists public.vendas_proprio (
  id               bigint generated always as identity primary key,
  loja_id          bigint not null references public.lojas(id),
  pedido_ref       text   not null,
  n_id_cupom       bigint not null default nextval('public.seq_cupom_proprio'),
  data             date   not null,
  hora             text,
  tipo             text,
  mesa             text,
  valor            numeric(14,2) not null default 0,
  desconto         numeric(14,2) not null default 0,
  taxa             numeric(14,2) not null default 0,
  cancelado        boolean not null default false,
  devolvido        boolean not null default false,
  operador         text,
  nota_chave       text,
  nota_numero      text,
  nota_serie       text,
  nota_status      text,
  frio_enviado_em  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (loja_id, pedido_ref),
  unique (loja_id, n_id_cupom)
);
create index if not exists vendas_proprio_data on public.vendas_proprio (loja_id, data);
create index if not exists vendas_proprio_frio on public.vendas_proprio (loja_id) where frio_enviado_em is null;

create table if not exists public.vendas_proprio_itens (
  id              bigint generated always as identity primary key,
  venda_id        bigint not null references public.vendas_proprio(id) on delete cascade,
  linha           int    not null,
  codigo          text,
  codigo_produto  bigint,
  nome            text,
  quantidade      numeric(18,6) not null default 0,
  valor_unitario  numeric(14,4) not null default 0,
  desconto        numeric(14,2) not null default 0,
  valor           numeric(14,2) not null default 0,
  ncm             text,
  cfop            text,
  unique (venda_id, linha)
);

create table if not exists public.vendas_proprio_pagamentos (
  id         bigint generated always as identity primary key,
  venda_id   bigint not null references public.vendas_proprio(id) on delete cascade,
  sequencia  int    not null,
  metodo     text,
  tipo_doc   text,
  valor      numeric(14,2) not null default 0,
  bandeira   text,
  unique (venda_id, sequencia)
);

-- RLS: leitura por loja, escrita só pelo servidor.
do $$ declare t text; begin
  foreach t in array array['vendas_proprio', 'vendas_proprio_itens', 'vendas_proprio_pagamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
drop policy if exists vendas_proprio_select_por_loja on public.vendas_proprio;
create policy vendas_proprio_select_por_loja on public.vendas_proprio for select
  using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
drop policy if exists vendas_proprio_itens_select on public.vendas_proprio_itens;
create policy vendas_proprio_itens_select on public.vendas_proprio_itens for select
  using (exists (select 1 from vendas_proprio v where v.id = venda_id and (usuario_tem_acesso_loja(v.loja_id) or usuario_e_admin())));
drop policy if exists vendas_proprio_pagamentos_select on public.vendas_proprio_pagamentos;
create policy vendas_proprio_pagamentos_select on public.vendas_proprio_pagamentos for select
  using (exists (select 1 from vendas_proprio v where v.id = venda_id and (usuario_tem_acesso_loja(v.loja_id) or usuario_e_admin())));

-- Siglas do Omie (cTipoDoc) para a forma de pagamento do Vendas: o fato do Contabo e os relatórios falam essas siglas.
create or replace function public.sigla_forma_pgto(p_metodo text) returns text
language sql immutable as $$
  select case upper(coalesce(p_metodo, ''))
    when 'CREDIT' then 'CRC' when 'DEBIT' then 'CRD' when 'PIX' then 'PIX' when 'CASH' then 'DIN' else '99999' end
$$;

create or replace function public.rotulo_forma_pgto(p_sigla text) returns text
language sql immutable as $$
  select case p_sigla when 'PIX' then 'Pix' when 'CRC' then 'Cartão de Crédito' when 'CRD' then 'Cartão de Débito'
                      when 'DIN' then 'Dinheiro' else 'Outros' end
$$;

create or replace function public.rotulo_tipo_item(p_tipo text) returns text
language sql immutable as $$
  select case p_tipo
    when '00' then 'Mercadoria p/ revenda' when '01' then 'Matéria-prima' when '02' then 'Embalagem'
    when '03' then 'Produto em processo' when '04' then 'Produto acabado' when '05' then 'Subproduto'
    when '06' then 'Produto intermediário' when '07' then 'Uso e consumo' when '08' then 'Ativo imobilizado'
    when '09' then 'Serviços' when '10' then 'Outros insumos' when '99' then 'Outras'
    when null then 'Não classificado' else 'Tipo ' || p_tipo end
$$;

-- Reconstrói o pré-agregado do mês (mesmas 5 dimensões do syncFaturamento do Omie, mais forma_pgto).
create or replace function public.recalcular_faturamento_proprio(p_loja bigint, p_mes text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from faturamento_importado
   where loja_id = p_loja and mes = p_mes
     and dimensao in ('tipo', 'familia', 'produto', 'tipo>familia', 'familia>produto', 'forma_pgto');

  insert into faturamento_importado (loja_id, dimensao, rotulo, mes, valor)
  select p_loja, x.dimensao, x.rotulo, p_mes, round(sum(x.valor), 2)
    from (
      select d.dimensao, d.rotulo, i.valor
        from vendas_proprio v
        join vendas_proprio_itens i on i.venda_id = v.id
        left join produtos p on p.loja_id = v.loja_id and p.codigo_produto = i.codigo_produto
        cross join lateral (
          select rotulo_tipo_item(p.tipo_item) as tipo, coalesce(nullif(p.descricao_familia, ''), 'Sem família') as familia,
                 coalesce(nullif(p.descricao, ''), nullif(i.nome, ''), 'Produto não identificado') as prod
        ) r
        cross join lateral (values
          ('tipo', r.tipo), ('familia', r.familia), ('produto', r.prod),
          ('tipo>familia', r.tipo || '>>' || r.familia), ('familia>produto', r.familia || '>>' || r.prod)
        ) d(dimensao, rotulo)
       where v.loja_id = p_loja and to_char(v.data, 'YYYY-MM') = p_mes and not v.cancelado and not v.devolvido and i.valor <> 0
      union all
      select 'forma_pgto', rotulo_forma_pgto(g.tipo_doc), g.valor
        from vendas_proprio v join vendas_proprio_pagamentos g on g.venda_id = v.id
       where v.loja_id = p_loja and to_char(v.data, 'YYYY-MM') = p_mes and not v.cancelado and not v.devolvido and g.valor <> 0
    ) x
   group by x.dimensao, x.rotulo
  having round(sum(x.valor), 2) <> 0;
  get diagnostics n = row_count;

  insert into faturamento_import_meta (loja_id, importado_em, importado_por, arquivo, linhas)
  values (p_loja, now(), null, 'Norte Vendas (fechamento)', n)
  on conflict (loja_id) do update set importado_em = excluded.importado_em, arquivo = excluded.arquivo, linhas = excluded.linhas;
  return n;
end $$;

-- Registra (ou refaz) uma venda fechada. Idempotente por pedido_ref; reenviar substitui itens e pagamentos.
create or replace function public.registrar_venda_proprio(p_loja bigint, p_venda jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_id bigint; v_cupom bigint; v_existia boolean; v_data date; v_item jsonb; v_pag jsonb; v_linha int := 0; v_seq int := 0;
  v_ref text := p_venda ->> 'pedidoRef';
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if v_ref is null or btrim(v_ref) = '' then raise exception 'pedidoRef é obrigatório' using errcode = '22023'; end if;
  v_data := coalesce((p_venda ->> 'data')::date, (now() at time zone 'America/Sao_Paulo')::date);

  perform pg_advisory_xact_lock(hashtext('venda_proprio:' || p_loja || ':' || v_ref));
  select id, n_id_cupom into v_id, v_cupom from vendas_proprio where loja_id = p_loja and pedido_ref = v_ref;
  v_existia := v_id is not null;

  if v_existia then
    update vendas_proprio set data = v_data, hora = p_venda ->> 'hora', tipo = p_venda ->> 'tipo', mesa = p_venda ->> 'mesa',
           valor = coalesce((p_venda ->> 'valor')::numeric, 0), desconto = coalesce((p_venda ->> 'desconto')::numeric, 0),
           taxa = coalesce((p_venda ->> 'taxa')::numeric, 0), cancelado = coalesce((p_venda ->> 'cancelado')::boolean, false),
           devolvido = coalesce((p_venda ->> 'devolvido')::boolean, false), operador = p_venda ->> 'operador',
           nota_chave = p_venda #>> '{nota,chave}', nota_numero = p_venda #>> '{nota,numero}', nota_serie = p_venda #>> '{nota,serie}',
           nota_status = p_venda #>> '{nota,status}', frio_enviado_em = null, updated_at = now()
     where id = v_id;
    delete from vendas_proprio_itens where venda_id = v_id;
    delete from vendas_proprio_pagamentos where venda_id = v_id;
  else
    insert into vendas_proprio (loja_id, pedido_ref, data, hora, tipo, mesa, valor, desconto, taxa, cancelado, devolvido, operador,
                                nota_chave, nota_numero, nota_serie, nota_status)
    values (p_loja, v_ref, v_data, p_venda ->> 'hora', p_venda ->> 'tipo', p_venda ->> 'mesa',
            coalesce((p_venda ->> 'valor')::numeric, 0), coalesce((p_venda ->> 'desconto')::numeric, 0), coalesce((p_venda ->> 'taxa')::numeric, 0),
            coalesce((p_venda ->> 'cancelado')::boolean, false), coalesce((p_venda ->> 'devolvido')::boolean, false), p_venda ->> 'operador',
            p_venda #>> '{nota,chave}', p_venda #>> '{nota,numero}', p_venda #>> '{nota,serie}', p_venda #>> '{nota,status}')
    returning id, n_id_cupom into v_id, v_cupom;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_venda -> 'itens', '[]'::jsonb)) loop
    v_linha := v_linha + 1;
    insert into vendas_proprio_itens (venda_id, linha, codigo, codigo_produto, nome, quantidade, valor_unitario, desconto, valor, ncm, cfop)
    values (v_id, coalesce((v_item ->> 'linha')::int, v_linha), v_item ->> 'codigo',
            (select pr.codigo_produto from produtos pr where pr.loja_id = p_loja and pr.codigo = v_item ->> 'codigo' limit 1),
            v_item ->> 'nome', coalesce((v_item ->> 'quantidade')::numeric, 0), coalesce((v_item ->> 'valorUnitario')::numeric, 0),
            coalesce((v_item ->> 'desconto')::numeric, 0),
            coalesce((v_item ->> 'valor')::numeric, coalesce((v_item ->> 'valorUnitario')::numeric, 0) * coalesce((v_item ->> 'quantidade')::numeric, 0) - coalesce((v_item ->> 'desconto')::numeric, 0)),
            v_item ->> 'ncm', v_item ->> 'cfop')
    on conflict (venda_id, linha) do update set codigo = excluded.codigo, codigo_produto = excluded.codigo_produto, nome = excluded.nome,
         quantidade = excluded.quantidade, valor_unitario = excluded.valor_unitario, desconto = excluded.desconto, valor = excluded.valor;
  end loop;

  for v_pag in select * from jsonb_array_elements(coalesce(p_venda -> 'pagamentos', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    insert into vendas_proprio_pagamentos (venda_id, sequencia, metodo, tipo_doc, valor, bandeira)
    values (v_id, coalesce((v_pag ->> 'sequencia')::int, v_seq), v_pag ->> 'metodo', sigla_forma_pgto(v_pag ->> 'metodo'),
            coalesce((v_pag ->> 'valor')::numeric, 0), v_pag ->> 'bandeira')
    on conflict (venda_id, sequencia) do update set metodo = excluded.metodo, tipo_doc = excluded.tipo_doc, valor = excluded.valor, bandeira = excluded.bandeira;
  end loop;

  perform recalcular_faturamento_proprio(p_loja, to_char(v_data, 'YYYY-MM'));
  return jsonb_build_object('ok', true, 'venda_id', v_id, 'n_id_cupom', v_cupom, 'duplicado', v_existia);
end $$;

-- Venda cancelada/estornada depois de enviada: sai do faturamento, o histórico fica.
create or replace function public.cancelar_venda_proprio(p_loja bigint, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_data date;
begin
  update vendas_proprio set cancelado = true, frio_enviado_em = null, updated_at = now()
   where loja_id = p_loja and pedido_ref = p_ref returning id, data into v_id, v_data;
  if v_id is null then return jsonb_build_object('ok', true, 'encontrada', false); end if;
  perform recalcular_faturamento_proprio(p_loja, to_char(v_data, 'YYYY-MM'));
  return jsonb_build_object('ok', true, 'encontrada', true, 'venda_id', v_id);
end $$;

-- CMV por venda e produto vendido: baixas do ledger da venda (ref = pedido, ou pedido|produto|linha na venda por receita),
-- já descontados os estornos (movimentos inversos ligados por reverses_id).
create or replace view public.vendas_proprio_cmv with (security_invoker = true) as
  with movs as (
    select v.id as venda_id, v.loja_id,
           case when m.ref = v.pedido_ref then m.codigo_produto else nullif(split_part(m.ref, '|', 2), '')::bigint end as produto_vendido,
           m.id, m.quantidade, m.custo_unitario
      from vendas_proprio v
      join estoque_movimentos m on m.loja_id = v.loja_id and m.origem = 'VENDA' and (m.ref = v.pedido_ref or m.ref like v.pedido_ref || '|%')
  ), est as (
    select reverses_id, sum(quantidade * coalesce(custo_unitario, 0)) as valor from estoque_movimentos where reverses_id is not null group by reverses_id
  )
  select m.venda_id, m.loja_id, m.produto_vendido as codigo_produto,
         round(-(sum(m.quantidade * coalesce(m.custo_unitario, 0)) + coalesce(sum(e.valor), 0)), 4) as cmv,
         count(*) filter (where coalesce(m.custo_unitario, 0) = 0) as movimentos_sem_custo,
         count(*) as movimentos
    from movs m left join est e on e.reverses_id = m.id
   group by m.venda_id, m.loja_id, m.produto_vendido;

-- Lucro realizado = faturamento − CMV, por produto, família, tipo, dia ou mês. Só vendas não canceladas.
create or replace function public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text default 'produto')
returns table (rotulo text, quantidade numeric, faturamento numeric, cmv numeric, lucro numeric, margem numeric, itens_sem_baixa int, itens_sem_custo int)
language sql stable security definer set search_path = public as $$
  with fat as (
    select v.id as venda_id, v.data, i.codigo_produto, max(coalesce(nullif(i.nome, ''), i.codigo)) as nome,
           sum(i.quantidade) as qtde, sum(i.valor) as valor
      from vendas_proprio v join vendas_proprio_itens i on i.venda_id = v.id
     where v.loja_id = p_loja and v.data between p_ini and p_fim and not v.cancelado and not v.devolvido
     group by v.id, v.data, i.codigo_produto
  ), base as (
    select f.*, p.descricao, p.descricao_familia, p.tipo_item, c.cmv, c.movimentos_sem_custo,
           (c.venda_id is null) as sem_baixa
      from fat f
      left join produtos p on p.loja_id = p_loja and p.codigo_produto = f.codigo_produto
      left join vendas_proprio_cmv c on c.venda_id = f.venda_id and c.codigo_produto = f.codigo_produto
  )
  select case p_dim
           when 'familia' then coalesce(nullif(descricao_familia, ''), 'Sem família')
           when 'tipo' then rotulo_tipo_item(tipo_item)
           when 'dia' then to_char(data, 'YYYY-MM-DD')
           when 'mes' then to_char(data, 'YYYY-MM')
           else coalesce(nullif(descricao, ''), nullif(nome, ''), 'Produto não identificado') end as rotulo,
         sum(qtde) as quantidade,
         round(sum(valor), 2) as faturamento,
         round(sum(coalesce(cmv, 0)), 2) as cmv,
         round(sum(valor) - sum(coalesce(cmv, 0)), 2) as lucro,
         case when sum(valor) > 0 then round((sum(valor) - sum(coalesce(cmv, 0))) / sum(valor) * 100, 1) end as margem,
         count(*) filter (where sem_baixa)::int as itens_sem_baixa,
         count(*) filter (where not sem_baixa and coalesce(movimentos_sem_custo, 0) > 0)::int as itens_sem_custo
    from base
   group by 1
   order by 4 desc nulls last
$$;

-- Custo efetivo por produto: o do ledger, ou o da ficha técnica para o vendável que não tem estoque próprio.
create or replace function public.cmc_efetivo_proprio(p_loja bigint)
returns table (codigo_produto bigint, cmc numeric)
language sql stable security definer set search_path = public as $$
  select p.codigo_produto,
         coalesce(nullif(c.cmc, 0), custo_unitario_ficha(p_loja, p.codigo_produto)) as cmc
    from produtos p left join estoque_custos c on c.loja_id = p.loja_id and c.codigo_produto = p.codigo_produto
   where p.loja_id = p_loja
$$;

do $$ declare f text; begin
  foreach f in array array[
    'recalcular_faturamento_proprio(bigint,text)', 'registrar_venda_proprio(bigint,jsonb)', 'cancelar_venda_proprio(bigint,text)',
    'lucro_proprio(bigint,date,date,text)', 'cmc_efetivo_proprio(bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant select on public.vendas_proprio_cmv to authenticated, service_role;

notify pgrst, 'reload schema';
