-- 380 — Financeiro, Fase 4 passo 3: CONTAS A RECEBER GERADAS PELAS VENDAS DO NORTE VENDAS, por forma de pagamento, com taxa
-- e data prevista por adquirente. Plano: docs/superpowers/plans/2026-11-03-norte-erp-plano-mestre.md (Fase 4, item 3).
-- Depende da 142/150 (vendas_proprio*, gravadas pelo POST /api/integracao/venda/fechamento) e da 285/286 (fin_*).
-- SÓ ADITIVA, só loja de estoque próprio. Nenhuma função existente muda; nada fala com o Omie, a SEFAZ ou o banco do Vendas.
--
-- De onde vem o dinheiro
-- * O Vendas já manda cada venda fechada com os pagamentos (metodo CREDIT|DEBIT|PIX|CASH + bandeira; cortesia não vem).
--   Eles estão em vendas_proprio_pagamentos. Forma de recebimento = fin_cr_forma_do_pagamento(metodo, bandeira):
--   cartão com bandeira de vale (alelo, sodexo, ticket, vr) = voucher; CREDIT = crédito; DEBIT = débito; PIX; CASH = dinheiro;
--   nomes de app de entrega / voucher que o Vendas ainda não manda já ficam mapeados; o resto = 'outros' (nunca some).
--   Espelho em TS: lib/financeiro/receber-vendas-puro.ts (quem muda um muda o outro).
--
-- Cadastro por loja (fin_formas_recebimento): forma, adquirente (texto livre), taxa %, taxa fixa POR PAGAMENTO, prazo em dias
-- (corridos ou úteis = seg–sex, sem feriado) e conta corrente de destino. Forma sem cadastro gera o título com taxa 0 e prazo
-- 0, marcado configurar = true.
--
-- Geração (fin_receber_vendas_gerar, chamada pelo cron /api/cron/gerar-receber-vendas e pelo botão da tela, só dev)
-- * UM título por dia × loja × forma (agregado), com bruto, nº de pagamentos, taxa, líquido previsto e data prevista.
--   Vendas canceladas/devolvidas e pagamentos ≤ 0 não entram. A conta é a de fin_receber_vendas_previa (só leitura).
-- * Idempotente: índice único (loja, origem, dia, forma) dos títulos não cancelados + trava por loja. Rodar de novo:
--     - título em aberto: segue a venda e o cadastro ATUAL (cancelamento muda o bruto; cadastrar a taxa reprecifica);
--     - título já recebido: NÃO muda; se a venda mudou, grava UM evento 'vendas_mudaram_apos_baixa' por valor novo;
--     - dia × forma que ficou sem venda (tudo cancelado): título em aberto é cancelado; se a venda voltar, nasce outro.
-- * CHAVE POR LOJA lojas.fin_cr_vendas_ativo (padrão false; esta migration liga só a loja-laboratório 19). Loja 4 nunca.
--
-- Baixa (fin_recebimento_registrar): valor recebido + data + conta; grava a ENTRADA no extrato (fin_lancamentos, origem
-- 'recebimento') e a diferença recebido − líquido previsto (coluna gerada). Estorno (fin_recebimento_estornar): SAÍDA de
-- mesmo valor no extrato (origem 'recebimento', ligada por estorno_lancamento_id; o check de fin_lancamentos.estorno_de não
-- foi alterado de propósito) e o título volta a 'aberto'. Nada se apaga. Conciliação automática = passo 4, fora daqui.
--
-- Aplicar (manual, com backup e OK do dono; numa transação):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 380_contas_receber_vendas.sql
-- Teste: bash scripts/testes-sql/380_rodar.sh (BEGIN … ROLLBACK em produção, loja 19). Depois: desktop/scripts/gerar-schema.sh.

begin;
set lock_timeout = '5s';

insert into permissoes (nome) values
  ('Financeiro - Contas a receber'),
  ('Financeiro - Contas a receber - Receber')
on conflict (nome) do nothing;

-- Mesmo desenho das contas a pagar: o Gerente vê e configura; dar baixa fica com Admin/AdminLoja (que já têm tudo).
insert into public.cargo_permissao (cargo_id, permissao_id)
select c.id, p.id from public.cargos c join public.permissoes p on p.nome = 'Financeiro - Contas a receber'
where c.nome = 'Gerente'
on conflict do nothing;

alter table public.lojas add column if not exists fin_cr_vendas_ativo boolean not null default false;
comment on column public.lojas.fin_cr_vendas_ativo is 'Fase 4: as vendas do Norte Vendas geram contas a receber (migration 380). Desligado até o dono liberar.';
update public.lojas set fin_cr_vendas_ativo = true where id = 19 and is_test and modo_estoque = 'proprio';

-- ---------------------------------------------------------------------------------------------------------- tabelas
create table if not exists public.fin_formas_recebimento (
  id               bigint generated always as identity primary key,
  loja_id          bigint not null references public.lojas(id),
  forma            text not null check (forma in ('credito', 'debito', 'pix', 'dinheiro', 'app_entrega', 'voucher', 'outros')),
  adquirente       text check (adquirente is null or length(btrim(adquirente)) between 1 and 60),
  taxa_percentual  numeric(7,4) not null default 0 check (taxa_percentual >= 0 and taxa_percentual < 100 and taxa_percentual <> 'NaN'),
  taxa_fixa        numeric(14,2) not null default 0 check (taxa_fixa >= 0 and taxa_fixa < 1000 and taxa_fixa <> 'NaN'),
  prazo_dias       int not null default 0 check (prazo_dias between 0 and 400),
  dias_uteis       boolean not null default false,
  conta_id         bigint,
  observacao       text,
  criado_por       text,
  criado_por_nome  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (loja_id, forma),
  foreign key (conta_id, loja_id) references public.fin_contas_correntes (id, loja_id)
);

create table if not exists public.fin_titulos_receber (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  origem_tipo          text not null default 'vendas' check (origem_tipo in ('vendas')),
  data_venda           date not null,
  forma                text not null check (forma in ('credito', 'debito', 'pix', 'dinheiro', 'app_entrega', 'voucher', 'outros')),
  adquirente           text,
  quantidade           int not null default 0 check (quantidade >= 0),
  valor_bruto          numeric(14,2) not null check (valor_bruto > 0 and valor_bruto <> 'NaN'),
  taxa_percentual      numeric(7,4) not null default 0,
  taxa_fixa            numeric(14,2) not null default 0,
  valor_taxa           numeric(14,2) not null default 0 check (valor_taxa >= 0 and valor_taxa <= valor_bruto),
  valor_liquido        numeric(14,2) not null,
  prazo_dias           int not null default 0,
  dias_uteis           boolean not null default false,
  data_prevista        date not null,
  conta_id             bigint,
  categoria_id         bigint,
  configurar           boolean not null default false,
  status               text not null default 'aberto' check (status in ('aberto', 'recebido', 'cancelado')),
  valor_recebido       numeric(14,2),
  data_recebimento     date,
  diferenca            numeric(14,2) generated always as (valor_recebido - valor_liquido) stored,
  cancelado_em         timestamptz,
  motivo_cancelamento  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, loja_id),
  foreign key (conta_id, loja_id) references public.fin_contas_correntes (id, loja_id),
  foreign key (categoria_id, loja_id) references public.fin_categorias (id, loja_id),
  check (valor_liquido = valor_bruto - valor_taxa),
  check (data_prevista >= data_venda),
  -- situação sempre coerente (rede de segurança contra bug de função)
  check (
    (status = 'aberto'    and valor_recebido is null and data_recebimento is null and cancelado_em is null) or
    (status = 'recebido'  and valor_recebido is not null and data_recebimento is not null and cancelado_em is null) or
    (status = 'cancelado' and valor_recebido is null and cancelado_em is not null)
  )
);
-- Idempotência da geração: um título ativo por dia × forma.
create unique index if not exists fin_titulos_receber_dia_forma on public.fin_titulos_receber (loja_id, origem_tipo, data_venda, forma)
  where status <> 'cancelado';
create index if not exists fin_titulos_receber_prevista on public.fin_titulos_receber (loja_id, data_prevista, id);
create index if not exists fin_titulos_receber_venda on public.fin_titulos_receber (loja_id, data_venda, id);

create table if not exists public.fin_recebimentos (
  id                    bigint generated by default as identity primary key,
  loja_id               bigint not null references public.lojas(id),
  titulo_id             bigint not null,
  conta_id              bigint not null,
  data_recebimento      date not null,
  valor_recebido        numeric(14,2) not null check (valor_recebido > 0 and valor_recebido <> 'NaN'),
  valor_previsto        numeric(14,2) not null,
  diferenca             numeric(14,2) generated always as (valor_recebido - valor_previsto) stored,
  observacao            text,
  lancamento_id         bigint not null references public.fin_lancamentos(id),
  chave_idempotencia    text not null,
  assinatura            text not null,
  criado_por            text,
  criado_por_nome       text,
  created_at            timestamptz not null default now(),
  estornado_em          timestamptz,
  estornado_por         text,
  estornado_por_nome    text,
  motivo_estorno        text,
  estorno_lancamento_id bigint references public.fin_lancamentos(id),
  unique (loja_id, chave_idempotencia),
  foreign key (titulo_id, loja_id) references public.fin_titulos_receber (id, loja_id),
  foreign key (conta_id, loja_id) references public.fin_contas_correntes (id, loja_id),
  check ((estornado_em is null) = (estorno_lancamento_id is null))
);
-- Um recebimento ativo por título (a baixa é do valor que a adquirente depositou, de uma vez).
create unique index if not exists fin_recebimentos_um_ativo on public.fin_recebimentos (titulo_id) where estornado_em is null;

-- Recebimento só muda uma vez, para "estornado"; nunca é apagado nem reescrito.
create or replace function public.trg_fin_recebimentos_guarda() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'fin_recebimentos não se apaga: use o estorno' using errcode = '55000';
  end if;
  if old.estornado_em is not null
     or (new.id, new.loja_id, new.titulo_id, new.conta_id, new.data_recebimento, new.valor_recebido, new.valor_previsto,
         new.lancamento_id, new.chave_idempotencia, new.assinatura)
        is distinct from
        (old.id, old.loja_id, old.titulo_id, old.conta_id, old.data_recebimento, old.valor_recebido, old.valor_previsto,
         old.lancamento_id, old.chave_idempotencia, old.assinatura) then
    raise exception 'fin_recebimentos é imutável (só o estorno altera)' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists fin_recebimentos_guarda on public.fin_recebimentos;
create trigger fin_recebimentos_guarda before update or delete on public.fin_recebimentos
  for each row execute function public.trg_fin_recebimentos_guarda();

do $$ declare t text; begin
  foreach t in array array['fin_formas_recebimento', 'fin_titulos_receber', 'fin_recebimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- --------------------------------------------------------------------------------------------------------- ajudantes
create or replace function public.fin_cr_forma_do_pagamento(p_metodo text, p_bandeira text) returns text
language sql immutable as $$
  select case
    when upper(btrim(coalesce(p_metodo, ''))) in ('CREDIT', 'DEBIT')
         and lower(btrim(coalesce(p_bandeira, ''))) in ('alelo', 'sodexo', 'ticket', 'vr') then 'voucher'
    when upper(btrim(coalesce(p_metodo, ''))) = 'CREDIT' then 'credito'
    when upper(btrim(coalesce(p_metodo, ''))) = 'DEBIT' then 'debito'
    when upper(btrim(coalesce(p_metodo, ''))) = 'PIX' then 'pix'
    when upper(btrim(coalesce(p_metodo, ''))) = 'CASH' then 'dinheiro'
    when upper(btrim(coalesce(p_metodo, ''))) in ('VOUCHER', 'MEAL_VOUCHER', 'FOOD_VOUCHER', 'VALE', 'VR', 'VA') then 'voucher'
    when upper(btrim(coalesce(p_metodo, ''))) in ('APP', 'APP_ENTREGA', 'DELIVERY_APP', 'IFOOD', 'RAPPI', 'AIQFOME', '99FOOD', 'KEETA') then 'app_entrega'
    else 'outros' end
$$;

-- Data + prazo; dias úteis = segunda a sexta (sem feriado). Prazo 0 = o próprio dia.
create or replace function public.fin_cr_somar_dias(p_data date, p_dias int, p_uteis boolean) returns date
language plpgsql immutable as $$
declare d date := p_data; n int := 0;
begin
  if not coalesce(p_uteis, false) then return p_data + coalesce(p_dias, 0); end if;
  while n < coalesce(p_dias, 0) loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return d;
end $$;

create or replace function public.fin_cr_vendas_ligado(p_loja bigint) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select fin_cr_vendas_ativo and modo_estoque = 'proprio' and id <> 4 from lojas where id = p_loja), false)
$$;

-- ------------------------------------------------------------------------------------------------ cadastro das formas
-- p_dados: adquirente, taxa_percentual, taxa_fixa, prazo_dias, dias_uteis, conta_id, observacao (texto/num; vazio = 0/nulo).
create or replace function public.fin_forma_recebimento_salvar(p_loja bigint, p_forma text, p_dados jsonb, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f fin_formas_recebimento%rowtype; v_adq text; v_pct numeric; v_fixa numeric; v_prazo int; v_uteis boolean; v_conta bigint;
  v_obs text; v_antes jsonb; v_depois jsonb;
begin
  perform fin_exigir_loja_propria(p_loja);
  if p_forma is null or p_forma not in ('credito', 'debito', 'pix', 'dinheiro', 'app_entrega', 'voucher', 'outros') then
    raise exception 'Forma de recebimento inválida' using errcode = '22023';
  end if;
  v_adq := nullif(btrim(coalesce(p_dados->>'adquirente', '')), '');
  if v_adq is not null and length(v_adq) > 60 then raise exception 'Nome do adquirente longo demais (até 60 letras)' using errcode = '22023'; end if;
  begin
    v_pct := coalesce(nullif(btrim(coalesce(p_dados->>'taxa_percentual', '')), '')::numeric, 0);
    v_fixa := coalesce(nullif(btrim(coalesce(p_dados->>'taxa_fixa', '')), '')::numeric, 0);
    v_prazo := coalesce(nullif(btrim(coalesce(p_dados->>'prazo_dias', '')), '')::int, 0);
  exception when others then
    raise exception 'Taxa ou prazo com número inválido' using errcode = '22023';
  end;
  if v_pct = 'NaN' or v_pct < 0 or v_pct >= 100 then raise exception 'A taxa (%%) precisa ficar entre 0 e 99,99' using errcode = '22023'; end if;
  if round(v_pct, 4) <> v_pct then raise exception 'A taxa (%%) aceita até 4 casas decimais' using errcode = '22023'; end if;
  if v_fixa = 'NaN' or v_fixa < 0 or v_fixa >= 1000 then raise exception 'A taxa fixa precisa ficar entre 0 e 999,99' using errcode = '22023'; end if;
  if round(v_fixa, 2) <> v_fixa then raise exception 'A taxa fixa aceita até 2 casas decimais' using errcode = '22023'; end if;
  if v_prazo < 0 or v_prazo > 400 then raise exception 'O prazo precisa ficar entre 0 e 400 dias' using errcode = '22023'; end if;
  v_uteis := coalesce((p_dados->>'dias_uteis')::boolean, false);
  v_conta := nullif(btrim(coalesce(p_dados->>'conta_id', '')), '')::bigint;
  if v_conta is not null and not exists (select 1 from fin_contas_correntes where id = v_conta and loja_id = p_loja and ativa) then
    raise exception 'Conta corrente de destino não encontrada ou inativa' using errcode = '22023';
  end if;
  v_obs := nullif(btrim(coalesce(p_dados->>'observacao', '')), '');

  select * into f from fin_formas_recebimento where loja_id = p_loja and forma = p_forma for update;
  v_depois := jsonb_build_object('adquirente', v_adq, 'taxa_percentual', v_pct, 'taxa_fixa', v_fixa, 'prazo_dias', v_prazo,
    'dias_uteis', v_uteis, 'conta_id', v_conta, 'observacao', v_obs);
  if found then
    v_antes := jsonb_build_object('adquirente', f.adquirente, 'taxa_percentual', f.taxa_percentual, 'taxa_fixa', f.taxa_fixa,
      'prazo_dias', f.prazo_dias, 'dias_uteis', f.dias_uteis, 'conta_id', f.conta_id, 'observacao', f.observacao);
    if v_antes = v_depois then return jsonb_build_object('ok', true, 'id', f.id, 'mudou', false); end if;
    update fin_formas_recebimento set adquirente = v_adq, taxa_percentual = v_pct, taxa_fixa = v_fixa, prazo_dias = v_prazo,
        dias_uteis = v_uteis, conta_id = v_conta, observacao = v_obs, updated_at = now() where id = f.id;
  else
    insert into fin_formas_recebimento (loja_id, forma, adquirente, taxa_percentual, taxa_fixa, prazo_dias, dias_uteis, conta_id,
        observacao, criado_por, criado_por_nome)
    values (p_loja, p_forma, v_adq, v_pct, v_fixa, v_prazo, v_uteis, v_conta, v_obs, p_user, p_user_nome)
    returning * into f;
  end if;
  perform fin_registrar_evento(p_loja, 'forma_recebimento', f.id, 'salvar',
    jsonb_build_object('forma', p_forma, 'antes', v_antes, 'depois', v_depois), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'id', f.id, 'mudou', true);
end $$;

-- ------------------------------------------------------------------------------------------------ prévia (só leitura)
-- O que a geração gravaria para o período: um registro por dia × forma, com o cadastro ATUAL. Serve também para conferir uma
-- loja com a chave desligada (ex.: a ODARA) sem gravar nada.
create or replace function public.fin_receber_vendas_previa(p_loja bigint, p_de date, p_ate date)
returns table (data_venda date, forma text, quantidade int, valor_bruto numeric, adquirente text, taxa_percentual numeric,
  taxa_fixa numeric, valor_taxa numeric, valor_liquido numeric, prazo_dias int, dias_uteis boolean, data_prevista date,
  conta_id bigint, configurar boolean)
language sql stable security definer set search_path = public as $$
  with pg as (
    select v.data, fin_cr_forma_do_pagamento(g.metodo, g.bandeira) as forma, g.valor
      from vendas_proprio v join vendas_proprio_pagamentos g on g.venda_id = v.id
     where v.loja_id = p_loja and v.data between p_de and p_ate and not v.cancelado and not v.devolvido and g.valor > 0
  ), agg as (
    select data, forma, count(*)::int as qtd, sum(valor) as bruto from pg group by data, forma
  ), calc as (
    select a.*, f.id as cfg, f.adquirente, coalesce(f.taxa_percentual, 0) as pct, coalesce(f.taxa_fixa, 0) as fixa,
           coalesce(f.prazo_dias, 0) as prazo, coalesce(f.dias_uteis, false) as uteis, f.conta_id,
           least(round(a.bruto * coalesce(f.taxa_percentual, 0) / 100 + coalesce(f.taxa_fixa, 0) * a.qtd, 2), a.bruto) as taxa
      from agg a left join fin_formas_recebimento f on f.loja_id = p_loja and f.forma = a.forma
  )
  select data, forma, qtd, bruto, adquirente, pct, fixa, taxa, bruto - taxa, prazo, uteis, fin_cr_somar_dias(data, prazo, uteis),
         conta_id, cfg is null
    from calc order by data, forma
$$;

-- ------------------------------------------------------------------------------------------------------------- geração
create or replace function public.fin_receber_vendas_gerar(p_loja bigint, p_de date, p_ate date, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; t fin_titulos_receber%rowtype; v_cat bigint; v_vistos text[] := '{}';
  n_criados int := 0; n_atualizados int := 0; n_iguais int := 0; n_cancelados int := 0; n_divergentes int := 0;
begin
  if p_loja = 4 then raise exception 'A loja 4 não entra no financeiro do Norte' using errcode = '22023'; end if;
  perform fin_exigir_loja_propria(p_loja);
  if not fin_cr_vendas_ligado(p_loja) then
    raise exception 'A geração de contas a receber das vendas está desligada nesta loja' using errcode = '22023';
  end if;
  if p_de is null or p_ate is null or p_de > p_ate or p_ate - p_de > 92 then
    raise exception 'Período inválido (de até a data final, no máximo 93 dias)' using errcode = '22023';
  end if;
  -- uma geração por loja de cada vez (cron e botão juntos se enfileiram)
  perform pg_advisory_xact_lock(hashtext('fin_cr_vendas:' || p_loja));
  select id into v_cat from fin_categorias where loja_id = p_loja and padrao = 'rec_vendas' and tipo = 'receita' and ativa;

  for r in select * from fin_receber_vendas_previa(p_loja, p_de, p_ate) loop
    v_vistos := v_vistos || (r.data_venda::text || '|' || r.forma);
    select * into t from fin_titulos_receber
     where loja_id = p_loja and origem_tipo = 'vendas' and data_venda = r.data_venda and forma = r.forma and status <> 'cancelado'
     for update;
    if not found then
      insert into fin_titulos_receber (loja_id, data_venda, forma, adquirente, quantidade, valor_bruto, taxa_percentual, taxa_fixa,
          valor_taxa, valor_liquido, prazo_dias, dias_uteis, data_prevista, conta_id, categoria_id, configurar)
      values (p_loja, r.data_venda, r.forma, r.adquirente, r.quantidade, r.valor_bruto, r.taxa_percentual, r.taxa_fixa,
          r.valor_taxa, r.valor_liquido, r.prazo_dias, r.dias_uteis, r.data_prevista, r.conta_id, v_cat, r.configurar)
      returning * into t;
      perform fin_registrar_evento(p_loja, 'titulo_receber', t.id, 'gerado', jsonb_build_object('data_venda', r.data_venda,
        'forma', r.forma, 'bruto', r.valor_bruto, 'liquido', r.valor_liquido, 'configurar', r.configurar), p_user, p_user_nome);
      n_criados := n_criados + 1;
    elsif t.status = 'aberto' then
      if (t.quantidade, t.valor_bruto, t.adquirente, t.taxa_percentual, t.taxa_fixa, t.valor_taxa, t.prazo_dias, t.dias_uteis,
          t.data_prevista, t.conta_id, t.categoria_id, t.configurar)
         is distinct from
         (r.quantidade, r.valor_bruto, r.adquirente, r.taxa_percentual, r.taxa_fixa, r.valor_taxa, r.prazo_dias, r.dias_uteis,
          r.data_prevista, r.conta_id, coalesce(t.categoria_id, v_cat), r.configurar) then
        update fin_titulos_receber set quantidade = r.quantidade, valor_bruto = r.valor_bruto, adquirente = r.adquirente,
            taxa_percentual = r.taxa_percentual, taxa_fixa = r.taxa_fixa, valor_taxa = r.valor_taxa, valor_liquido = r.valor_liquido,
            prazo_dias = r.prazo_dias, dias_uteis = r.dias_uteis, data_prevista = r.data_prevista, conta_id = r.conta_id,
            categoria_id = coalesce(t.categoria_id, v_cat), configurar = r.configurar, updated_at = now()
         where id = t.id;
        perform fin_registrar_evento(p_loja, 'titulo_receber', t.id, 'atualizado', jsonb_build_object(
          'antes', jsonb_build_object('bruto', t.valor_bruto, 'liquido', t.valor_liquido, 'data_prevista', t.data_prevista),
          'depois', jsonb_build_object('bruto', r.valor_bruto, 'liquido', r.valor_liquido, 'data_prevista', r.data_prevista)),
          p_user, p_user_nome);
        n_atualizados := n_atualizados + 1;
      else
        n_iguais := n_iguais + 1;
      end if;
    else -- recebido: a baixa manda; a venda que mudou depois vira aviso (um evento por valor novo, não um por rodada)
      if t.valor_bruto <> r.valor_bruto then
        n_divergentes := n_divergentes + 1;
        if not exists (select 1 from fin_eventos where loja_id = p_loja and entidade = 'titulo_receber' and entidade_id = t.id
                         and tipo = 'vendas_mudaram_apos_baixa' and (detalhe->>'bruto_vendas')::numeric = r.valor_bruto) then
          perform fin_registrar_evento(p_loja, 'titulo_receber', t.id, 'vendas_mudaram_apos_baixa',
            jsonb_build_object('bruto_titulo', t.valor_bruto, 'bruto_vendas', r.valor_bruto), p_user, p_user_nome);
        end if;
      else
        n_iguais := n_iguais + 1;
      end if;
    end if;
  end loop;

  -- dia × forma do período que ficou sem venda (tudo cancelado/devolvido)
  for t in select * from fin_titulos_receber
            where loja_id = p_loja and origem_tipo = 'vendas' and data_venda between p_de and p_ate and status <> 'cancelado'
              and not ((data_venda::text || '|' || forma) = any (v_vistos))
            order by id for update loop
    if t.status = 'aberto' then
      update fin_titulos_receber set status = 'cancelado', cancelado_em = now(),
          motivo_cancelamento = 'As vendas deste dia nesta forma foram canceladas', updated_at = now() where id = t.id;
      perform fin_registrar_evento(p_loja, 'titulo_receber', t.id, 'cancelado',
        jsonb_build_object('motivo', 'vendas canceladas', 'bruto', t.valor_bruto), p_user, p_user_nome);
      n_cancelados := n_cancelados + 1;
    else
      n_divergentes := n_divergentes + 1;
      if not exists (select 1 from fin_eventos where loja_id = p_loja and entidade = 'titulo_receber' and entidade_id = t.id
                       and tipo = 'vendas_mudaram_apos_baixa' and (detalhe->>'bruto_vendas')::numeric = 0) then
        perform fin_registrar_evento(p_loja, 'titulo_receber', t.id, 'vendas_mudaram_apos_baixa',
          jsonb_build_object('bruto_titulo', t.valor_bruto, 'bruto_vendas', 0), p_user, p_user_nome);
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'de', p_de, 'ate', p_ate, 'criados', n_criados, 'atualizados', n_atualizados,
    'iguais', n_iguais, 'cancelados', n_cancelados, 'divergentes', n_divergentes);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- baixa
-- p_dados: conta_id (vazio = a conta do título), data_recebimento (vazio = hoje), valor_recebido (vazio = líquido previsto),
-- observacao. p_chave é OBRIGATÓRIA (idempotência). Entrada no extrato = valor recebido.
create or replace function public.fin_recebimento_registrar(p_loja bigint, p_titulo bigint, p_dados jsonb, p_user text default null,
  p_user_nome text default null, p_chave text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t fin_titulos_receber%rowtype; c fin_contas_correntes%rowtype; rc fin_recebimentos%rowtype;
  v_chave text := nullif(btrim(coalesce(p_chave, '')), ''); v_assin text; v_valor numeric; v_data date; v_conta bigint;
  v_rid bigint; v_lanc bigint;
  v_rot constant jsonb := '{"credito":"cartão de crédito","debito":"cartão de débito","pix":"PIX","dinheiro":"dinheiro","app_entrega":"app de entrega","voucher":"vale-refeição","outros":"outras formas"}';
begin
  perform fin_exigir_loja_propria(p_loja);
  if v_chave is null then raise exception 'Chave de idempotência obrigatória' using errcode = '22023'; end if;
  select * into t from fin_titulos_receber where id = p_titulo and loja_id = p_loja for update;
  if not found then raise exception 'Conta a receber não encontrada' using errcode = '22023'; end if;

  v_assin := md5(concat_ws('|', t.id, coalesce(nullif(p_dados->>'conta_id', ''), ''), coalesce(nullif(p_dados->>'data_recebimento', ''), ''),
      coalesce(fin_numero(p_dados->>'valor_recebido')::text, ''), coalesce(nullif(btrim(coalesce(p_dados->>'observacao', '')), ''), '')));
  select * into rc from fin_recebimentos where loja_id = p_loja and chave_idempotencia = v_chave;
  if found then
    if rc.titulo_id <> t.id or rc.assinatura <> v_assin then raise exception 'Essa chave já foi usada com outros dados' using errcode = '22023'; end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', rc.id, 'lancamento_id', rc.lancamento_id, 'diferenca', rc.diferenca);
  end if;

  if t.status = 'cancelado' then raise exception 'Conta a receber cancelada não recebe baixa' using errcode = '22023'; end if;
  if t.status = 'recebido' then raise exception 'Esta conta já foi recebida (estorne a baixa para refazer)' using errcode = '22023'; end if;

  v_valor := fin_numero(p_dados->>'valor_recebido', t.valor_liquido);
  if v_valor is null or v_valor <= 0 then raise exception 'O valor recebido precisa ser maior que zero' using errcode = '22023'; end if;
  v_data := coalesce(nullif(p_dados->>'data_recebimento', '')::date, fin_hoje());
  if v_data > fin_hoje() then raise exception 'A data do recebimento não pode ser futura' using errcode = '22023'; end if;
  if v_data < t.data_venda then raise exception 'A data do recebimento não pode ser anterior à venda' using errcode = '22023'; end if;

  v_conta := coalesce(nullif(p_dados->>'conta_id', '')::bigint, t.conta_id);
  select * into c from fin_contas_correntes where id = v_conta and loja_id = p_loja for share;
  if not found then raise exception 'Escolha a conta corrente que recebeu' using errcode = '22023'; end if;
  if not c.ativa then raise exception 'A conta corrente está inativa' using errcode = '22023'; end if;
  if v_data < c.data_saldo_inicial then
    raise exception 'A data do recebimento é anterior ao saldo inicial da conta (%)', c.data_saldo_inicial using errcode = '22023';
  end if;

  v_rid := nextval(pg_get_serial_sequence('fin_recebimentos', 'id'));
  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, categoria_id, origem_tipo, origem_id, criado_por, criado_por_nome)
  values (p_loja, c.id, v_data, 'entrada', v_valor,
      'Recebimento das vendas de ' || to_char(t.data_venda, 'DD/MM/YYYY') || ' · ' || coalesce(v_rot->>t.forma, t.forma)
        || coalesce(' · ' || t.adquirente, ''),
      t.categoria_id, 'recebimento', v_rid, p_user, p_user_nome)
  returning id into v_lanc;
  insert into fin_recebimentos (id, loja_id, titulo_id, conta_id, data_recebimento, valor_recebido, valor_previsto, observacao,
      lancamento_id, chave_idempotencia, assinatura, criado_por, criado_por_nome)
  values (v_rid, p_loja, t.id, c.id, v_data, v_valor, t.valor_liquido, nullif(btrim(coalesce(p_dados->>'observacao', '')), ''),
      v_lanc, v_chave, v_assin, p_user, p_user_nome)
  returning * into rc;
  update fin_titulos_receber set status = 'recebido', valor_recebido = v_valor, data_recebimento = v_data, updated_at = now()
   where id = t.id;
  perform fin_registrar_evento(p_loja, 'titulo_receber', t.id, 'recebimento', jsonb_build_object('recebimento_id', v_rid,
    'valor_recebido', v_valor, 'previsto', t.valor_liquido, 'diferenca', rc.diferenca, 'conta_id', c.id, 'data', v_data),
    p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_rid, 'lancamento_id', v_lanc, 'diferenca', rc.diferenca);
end $$;

create or replace function public.fin_recebimento_estornar(p_loja bigint, p_recebimento bigint, p_motivo text, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rc fin_recebimentos%rowtype; t fin_titulos_receber%rowtype; v_titulo bigint; v_lanc bigint;
begin
  perform fin_exigir_loja_propria(p_loja);
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno' using errcode = '22023'; end if;
  select titulo_id into v_titulo from fin_recebimentos where id = p_recebimento and loja_id = p_loja;
  if not found then raise exception 'Recebimento não encontrado' using errcode = '22023'; end if;
  -- mesma ordem de trava da baixa: primeiro o título
  select * into t from fin_titulos_receber where id = v_titulo and loja_id = p_loja for update;
  select * into rc from fin_recebimentos where id = p_recebimento and loja_id = p_loja for update;
  if rc.estornado_em is not null then
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', rc.id, 'status', t.status);
  end if;

  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, categoria_id, origem_tipo, origem_id, criado_por, criado_por_nome)
  values (p_loja, rc.conta_id, fin_hoje(), 'saida', rc.valor_recebido,
      'Estorno do recebimento das vendas de ' || to_char(t.data_venda, 'DD/MM/YYYY'), t.categoria_id, 'recebimento', rc.id,
      p_user, p_user_nome)
  returning id into v_lanc;
  update fin_recebimentos set estornado_em = now(), estornado_por = p_user, estornado_por_nome = p_user_nome,
      motivo_estorno = btrim(p_motivo), estorno_lancamento_id = v_lanc where id = rc.id;
  update fin_titulos_receber set status = 'aberto', valor_recebido = null, data_recebimento = null, updated_at = now() where id = t.id;
  perform fin_registrar_evento(p_loja, 'titulo_receber', t.id, 'estorno_recebimento', jsonb_build_object('recebimento_id', rc.id,
    'valor_recebido', rc.valor_recebido, 'motivo', btrim(p_motivo)), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', rc.id, 'status', 'aberto');
end $$;

-- ------------------------------------------------------------------------------------------------------- listar com totais
-- p_filtros: venda_de, venda_ate, prevista_de, prevista_ate, forma, situacao (aberto|atrasado|em_aberto|recebido|cancelado|configurar).
-- Sem situação = todos menos cancelados. Totais valem para TODOS os títulos do filtro (não só a página).
create or replace function public.fin_titulos_receber_listar(p_loja bigint, p_filtros jsonb default '{}'::jsonb, p_limite int default 50,
  p_offset int default 0, p_hoje date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_hoje date := coalesce(p_hoje, fin_hoje()); v_sit text := nullif(p_filtros->>'situacao', ''); v jsonb;
begin
  with base as (
    select t.*, case when t.status = 'aberto' and t.data_prevista < v_hoje then 'atrasado' else t.status end as situacao,
           c.nome as conta_nome, r.id as recebimento_id, r.conta_id as recebimento_conta_id
      from fin_titulos_receber t
      left join fin_contas_correntes c on c.id = t.conta_id
      left join fin_recebimentos r on r.titulo_id = t.id and r.estornado_em is null
     where t.loja_id = p_loja
       and (nullif(p_filtros->>'venda_de', '') is null or t.data_venda >= (p_filtros->>'venda_de')::date)
       and (nullif(p_filtros->>'venda_ate', '') is null or t.data_venda <= (p_filtros->>'venda_ate')::date)
       and (nullif(p_filtros->>'prevista_de', '') is null or t.data_prevista >= (p_filtros->>'prevista_de')::date)
       and (nullif(p_filtros->>'prevista_ate', '') is null or t.data_prevista <= (p_filtros->>'prevista_ate')::date)
       and (nullif(p_filtros->>'forma', '') is null or t.forma = p_filtros->>'forma')
  ), filtrada as (
    select * from base where case
      when v_sit is null then status <> 'cancelado'
      when v_sit = 'em_aberto' then status = 'aberto'
      when v_sit = 'configurar' then configurar and status <> 'cancelado'
      else situacao = v_sit end
  )
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(to_jsonb(p) - 'created_at' - 'updated_at' order by p.data_venda desc, p.forma)
                         from (select * from filtrada order by data_venda desc, forma limit greatest(1, least(coalesce(p_limite, 50), 500))
                               offset greatest(0, coalesce(p_offset, 0))) p), '[]'::jsonb),
    'totais', (select jsonb_build_object('quantidade', count(*), 'bruto', coalesce(sum(valor_bruto), 0),
        'taxa', coalesce(sum(valor_taxa), 0), 'liquido', coalesce(sum(valor_liquido), 0),
        'a_receber', coalesce(sum(valor_liquido) filter (where status = 'aberto'), 0),
        'atrasado', coalesce(sum(valor_liquido) filter (where situacao = 'atrasado'), 0),
        'recebido', coalesce(sum(valor_recebido), 0), 'diferenca', coalesce(sum(diferenca), 0),
        'configurar', count(*) filter (where configurar and status <> 'cancelado')) from filtrada))
  into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- grants
do $$ declare f text; begin
  foreach f in array array[
    'fin_cr_forma_do_pagamento(text,text)', 'fin_cr_somar_dias(date,integer,boolean)', 'fin_cr_vendas_ligado(bigint)',
    'fin_forma_recebimento_salvar(bigint,text,jsonb,text,text)', 'fin_receber_vendas_previa(bigint,date,date)',
    'fin_receber_vendas_gerar(bigint,date,date,text,text)', 'fin_recebimento_registrar(bigint,bigint,jsonb,text,text,text)',
    'fin_recebimento_estornar(bigint,bigint,text,text,text)', 'fin_titulos_receber_listar(bigint,jsonb,integer,integer,date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
