-- 285 — Finanças, etapa 1 (A): contas correntes por loja, categorias financeiras com conta de DRE e extrato (lançamentos).
-- Plano: docs/superpowers/plans/2026-10-21-financeiro-etapa-1.md.
--
-- SÓ ADITIVA e só para loja de ESTOQUE PRÓPRIO (lojas.modo_estoque = 'proprio'): toda função recusa loja Omie.
-- Tabelas NOVAS com prefixo fin_. As antigas contas_pagar / contas_receber / contas_correntes (migrations 052–054,
-- espelho do Omie) NÃO são tocadas: loja Omie pode ter dados nelas e o script sync-financeiro.mjs as alimenta.
-- Dinheiro em numeric(14,2). Nada se apaga: lançamentos e eventos são append-only (trigger); correção = estorno.
-- Escrita só pelas funções abaixo (security definer, só service role). Nenhum acesso direto de authenticated
-- (a tela lê pelo servidor, depois de checar a permissão); a política RLS por loja existe para o dia em que se abrir leitura.
--
-- Aplicar (manual, com backup e OK do dono), ANTES da 286:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 285_financeiro_base.sql
-- Depois: NOTIFY pgrst (já no fim). Reverter: scripts/testes-sql/285_286_reverter.sql (só se nada foi lançado).
-- Teste: scripts/testes-sql/286_financeiro_contas_pagar.sql (cobre 285 e 286) e 286_concorrencia.sh (banco local).

begin;
set lock_timeout = '5s';

insert into permissoes (nome) values
  ('Financeiro - Contas a pagar'),
  ('Financeiro - Contas a pagar - Pagar'),
  ('Financeiro - Contas correntes'),
  ('Financeiro - Categorias')
on conflict (nome) do nothing;

-- ---------------------------------------------------------------------------------------------------------- tabelas
create table if not exists public.fin_contas_correntes (
  id                  bigint generated always as identity primary key,
  loja_id             bigint not null references public.lojas(id),
  nome                text not null check (length(btrim(nome)) between 2 and 80),
  tipo                text not null default 'banco' check (tipo in ('caixa', 'banco', 'outro')),
  banco               text,
  agencia             text,
  numero_conta        text,
  saldo_inicial       numeric(14,2) not null default 0 check (saldo_inicial <> 'NaN'),
  data_saldo_inicial  date not null default ((now() at time zone 'America/Bahia')::date),
  ativa               boolean not null default true,
  observacao          text,
  criado_por          text,
  criado_por_nome     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (loja_id, nome),
  unique (id, loja_id)
);

create table if not exists public.fin_categorias (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  codigo               text,
  -- Identificador estável das categorias padrão: renomear não faz a semente recriar a original.
  padrao               text,
  nome                 text not null check (length(btrim(nome)) between 2 and 80),
  tipo                 text not null default 'despesa' check (tipo in ('despesa', 'receita')),
  -- Linha da DRE onde a categoria entra (relatório da etapa 6).
  grupo_dre            text not null default 'outras' check (grupo_dre in (
                         'receita_bruta', 'deducoes', 'cmv', 'despesa_operacional', 'despesa_pessoal',
                         'despesa_administrativa', 'despesa_financeira', 'receita_financeira', 'imposto_resultado',
                         'investimento', 'outras')),
  -- Ligação opcional com a categoria contábil que já existe (classificação das notas de entrada).
  categoria_contabil_id bigint references public.categorias_contabeis(id) on delete set null,
  ativa                boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (loja_id, nome),
  unique (id, loja_id)
);

create unique index if not exists fin_categorias_padrao on public.fin_categorias (loja_id, padrao) where padrao is not null;

-- Extrato: um lançamento por movimento de dinheiro. Imutável; o estorno é OUTRO lançamento ligado por estorno_de.
create table if not exists public.fin_lancamentos (
  id                  bigint generated always as identity primary key,
  loja_id             bigint not null references public.lojas(id),
  conta_id            bigint not null,
  data                date not null,
  tipo                text not null check (tipo in ('entrada', 'saida')),
  valor               numeric(14,2) not null check (valor > 0 and valor <> 'NaN'),
  descricao           text,
  categoria_id        bigint,
  origem_tipo         text not null check (origem_tipo in ('pagamento', 'estorno_pagamento', 'manual', 'transferencia', 'recebimento')),
  origem_id           bigint,
  estorno_de          bigint references public.fin_lancamentos(id),
  criado_por          text,
  criado_por_nome     text,
  created_at          timestamptz not null default now(),
  foreign key (conta_id, loja_id) references public.fin_contas_correntes (id, loja_id),
  foreign key (categoria_id, loja_id) references public.fin_categorias (id, loja_id),
  check (estorno_de is null or origem_tipo = 'estorno_pagamento')
);
create index if not exists fin_lancamentos_conta on public.fin_lancamentos (conta_id, data, id);
create index if not exists fin_lancamentos_origem on public.fin_lancamentos (loja_id, origem_tipo, origem_id);
create unique index if not exists fin_lancamentos_um_estorno on public.fin_lancamentos (estorno_de) where estorno_de is not null;

-- Histórico de tudo que importa (quem fez o quê): conta, categoria, título, pagamento. Append-only.
create table if not exists public.fin_eventos (
  id          bigint generated always as identity primary key,
  loja_id     bigint not null references public.lojas(id),
  entidade    text not null,
  entidade_id bigint not null,
  tipo        text not null,
  detalhe     jsonb not null default '{}'::jsonb,
  user_id     text,
  user_nome   text,
  created_at  timestamptz not null default now()
);
create index if not exists fin_eventos_entidade on public.fin_eventos (loja_id, entidade, entidade_id, id);

create or replace function public.trg_fin_imutavel() returns trigger language plpgsql as $$
begin
  raise exception '% é append-only (nada se apaga no financeiro: use o estorno)', tg_table_name using errcode = '55000';
end $$;
drop trigger if exists fin_lancamentos_imutavel on public.fin_lancamentos;
create trigger fin_lancamentos_imutavel before update or delete on public.fin_lancamentos
  for each row execute function public.trg_fin_imutavel();
drop trigger if exists fin_eventos_imutavel on public.fin_eventos;
create trigger fin_eventos_imutavel before update or delete on public.fin_eventos
  for each row execute function public.trg_fin_imutavel();

-- RLS por loja (mesmo desenho das outras tabelas); só o service role acessa de fato (sem grant para authenticated).
do $$ declare t text; begin
  foreach t in array array['fin_contas_correntes', 'fin_categorias', 'fin_lancamentos', 'fin_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- --------------------------------------------------------------------------------------------------------- ajudantes
create or replace function public.fin_hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Bahia')::date
$$;

-- Texto → dinheiro (2 casas). Vazio = padrão. Só aceita decimal simples (regex estrita); recusa lixo, NaN, infinito, notação científica e valores de 1 trilhão para cima.
create or replace function public.fin_numero(p text, p_padrao numeric default null) returns numeric
language plpgsql immutable as $$
declare n numeric;
begin
  if p is null or btrim(p) = '' then return p_padrao; end if;
  -- só número decimal simples, até 2 casas: recusa '1e5', '0x10', '1_000', '.5', '5.', 'NaN', 'Infinity' e 3+ casas (nada de arredondar calado)
  if btrim(p) !~ '^-?[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Valor numérico inválido' using errcode = '22023'; end if;
  n := btrim(p)::numeric;
  if n >= 1e12 or n <= -1e12 then raise exception 'Valor numérico inválido' using errcode = '22023'; end if;
  return n;
end $$;

create or replace function public.fin_exigir_loja_propria(p_loja bigint) returns void
language plpgsql stable set search_path = public as $$
begin
  if not exists (select 1 from lojas where id = p_loja and modo_estoque = 'proprio') then
    raise exception 'O financeiro do Norte só existe na loja de estoque próprio' using errcode = '22023';
  end if;
end $$;

create or replace function public.fin_registrar_evento(p_loja bigint, p_entidade text, p_id bigint, p_tipo text, p_detalhe jsonb,
  p_user text, p_user_nome text) returns void
language sql security definer set search_path = public as $$
  insert into fin_eventos (loja_id, entidade, entidade_id, tipo, detalhe, user_id, user_nome)
  values (p_loja, p_entidade, p_id, p_tipo, coalesce(p_detalhe, '{}'::jsonb), p_user, p_user_nome)
$$;

-- ----------------------------------------------------------------------------------------------------- contas correntes
create or replace function public.fin_conta_salvar(p_loja bigint, p_id bigint, p_dados jsonb, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c fin_contas_correntes%rowtype; v_nome text; v_tipo text; v_saldo numeric; v_data date; v_antes jsonb;
begin
  perform fin_exigir_loja_propria(p_loja);
  v_nome := btrim(coalesce(p_dados->>'nome', ''));
  if length(v_nome) < 2 then raise exception 'Informe o nome da conta' using errcode = '22023'; end if;
  v_tipo := coalesce(nullif(p_dados->>'tipo', ''), 'banco');
  if v_tipo not in ('caixa', 'banco', 'outro') then raise exception 'Tipo de conta inválido' using errcode = '22023'; end if;
  v_saldo := fin_numero(p_dados->>'saldo_inicial', 0);
  v_data := coalesce(nullif(p_dados->>'data_saldo_inicial', '')::date, fin_hoje());
  if v_data > fin_hoje() then raise exception 'A data do saldo inicial não pode ser futura' using errcode = '22023'; end if;
  if exists (select 1 from fin_contas_correntes where loja_id = p_loja and lower(nome) = lower(v_nome) and id is distinct from p_id) then
    raise exception 'Já existe uma conta com esse nome' using errcode = '22023';
  end if;

  if p_id is null then
    insert into fin_contas_correntes (loja_id, nome, tipo, banco, agencia, numero_conta, saldo_inicial, data_saldo_inicial, observacao,
        criado_por, criado_por_nome)
    values (p_loja, v_nome, v_tipo, nullif(btrim(coalesce(p_dados->>'banco', '')), ''), nullif(btrim(coalesce(p_dados->>'agencia', '')), ''),
        nullif(btrim(coalesce(p_dados->>'numero_conta', '')), ''), v_saldo, v_data, nullif(btrim(coalesce(p_dados->>'observacao', '')), ''),
        p_user, p_user_nome)
    returning * into c;
    perform fin_registrar_evento(p_loja, 'conta', c.id, 'criada', jsonb_build_object('nome', c.nome, 'saldo_inicial', c.saldo_inicial), p_user, p_user_nome);
    return jsonb_build_object('ok', true, 'id', c.id, 'criada', true);
  end if;

  select * into c from fin_contas_correntes where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Conta não encontrada' using errcode = '22023'; end if;
  if (v_saldo <> c.saldo_inicial or v_data <> c.data_saldo_inicial) and exists (select 1 from fin_lancamentos where conta_id = c.id) then
    raise exception 'A conta já tem lançamentos: o saldo inicial e a data não mudam mais' using errcode = '22023';
  end if;
  v_antes := jsonb_build_object('nome', c.nome, 'saldo_inicial', c.saldo_inicial, 'data_saldo_inicial', c.data_saldo_inicial, 'ativa', c.ativa);
  update fin_contas_correntes set nome = v_nome, tipo = v_tipo,
      banco = nullif(btrim(coalesce(p_dados->>'banco', '')), ''), agencia = nullif(btrim(coalesce(p_dados->>'agencia', '')), ''),
      numero_conta = nullif(btrim(coalesce(p_dados->>'numero_conta', '')), ''), saldo_inicial = v_saldo, data_saldo_inicial = v_data,
      ativa = coalesce((p_dados->>'ativa')::boolean, c.ativa), observacao = nullif(btrim(coalesce(p_dados->>'observacao', '')), ''),
      updated_at = now()
    where id = c.id returning * into c;
  perform fin_registrar_evento(p_loja, 'conta', c.id, 'editada', jsonb_build_object('antes', v_antes,
      'depois', jsonb_build_object('nome', c.nome, 'saldo_inicial', c.saldo_inicial, 'data_saldo_inicial', c.data_saldo_inicial, 'ativa', c.ativa)),
      p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'id', c.id, 'criada', false);
end $$;

-- Saldo atual = saldo inicial + entradas − saídas (estornos entram como lançamento de sentido contrário).
create or replace function public.fin_contas_saldo(p_loja bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'banco', c.banco, 'agencia', c.agencia, 'numero_conta', c.numero_conta,
    'saldo_inicial', c.saldo_inicial, 'data_saldo_inicial', c.data_saldo_inicial, 'ativa', c.ativa, 'observacao', c.observacao,
    'saldo_atual', c.saldo_inicial + coalesce(l.mov, 0), 'lancamentos', coalesce(l.n, 0)
  ) order by c.ativa desc, c.nome), '[]'::jsonb)
  from fin_contas_correntes c
  left join (select conta_id, sum(case tipo when 'entrada' then valor else -valor end) as mov, count(*) as n
             from fin_lancamentos where loja_id = p_loja group by conta_id) l on l.conta_id = c.id
  where c.loja_id = p_loja
$$;

create or replace function public.fin_extrato(p_loja bigint, p_conta bigint, p_de date default null, p_ate date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c fin_contas_correntes%rowtype; v_ant numeric; v_itens jsonb; v_fim numeric;
begin
  select * into c from fin_contas_correntes where id = p_conta and loja_id = p_loja;
  if not found then raise exception 'Conta não encontrada' using errcode = '22023'; end if;
  select c.saldo_inicial + coalesce(sum(case tipo when 'entrada' then valor else -valor end), 0) into v_ant
    from fin_lancamentos where conta_id = c.id and p_de is not null and data < p_de;
  v_ant := coalesce(v_ant, c.saldo_inicial);
  with corrida as (
    select l.*, c.saldo_inicial + sum(case l.tipo when 'entrada' then l.valor else -l.valor end) over (order by l.data, l.id) as saldo_apos
    from fin_lancamentos l where l.conta_id = c.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data, 'tipo', tipo, 'valor', valor, 'descricao', descricao,
      'origem_tipo', origem_tipo, 'origem_id', origem_id, 'estorno_de', estorno_de, 'saldo_apos', saldo_apos) order by data, id), '[]'::jsonb)
    into v_itens
  from corrida where (p_de is null or data >= p_de) and (p_ate is null or data <= p_ate);
  select c.saldo_inicial + coalesce(sum(case tipo when 'entrada' then valor else -valor end), 0) into v_fim
    from fin_lancamentos where conta_id = c.id and (p_ate is null or data <= p_ate);
  return jsonb_build_object('conta', jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo, 'saldo_inicial', c.saldo_inicial,
      'data_saldo_inicial', c.data_saldo_inicial, 'ativa', c.ativa),
    'saldo_anterior', v_ant, 'saldo_final', v_fim, 'itens', v_itens);
end $$;

-- ---------------------------------------------------------------------------------------------------------- categorias
create or replace function public.fin_categoria_salvar(p_loja bigint, p_id bigint, p_dados jsonb, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k fin_categorias%rowtype; v_nome text; v_tipo text; v_grupo text; v_cc bigint;
begin
  perform fin_exigir_loja_propria(p_loja);
  v_nome := btrim(coalesce(p_dados->>'nome', ''));
  if length(v_nome) < 2 then raise exception 'Informe o nome da categoria' using errcode = '22023'; end if;
  v_tipo := coalesce(nullif(p_dados->>'tipo', ''), 'despesa');
  if v_tipo not in ('despesa', 'receita') then raise exception 'Tipo de categoria inválido' using errcode = '22023'; end if;
  v_grupo := coalesce(nullif(p_dados->>'grupo_dre', ''), 'outras');
  if v_grupo not in ('receita_bruta', 'deducoes', 'cmv', 'despesa_operacional', 'despesa_pessoal', 'despesa_administrativa',
      'despesa_financeira', 'receita_financeira', 'imposto_resultado', 'investimento', 'outras') then
    raise exception 'Linha da DRE inválida' using errcode = '22023';
  end if;
  v_cc := nullif(p_dados->>'categoria_contabil_id', '')::bigint;
  if v_cc is not null and not exists (select 1 from categorias_contabeis where id = v_cc and loja_id = p_loja) then
    raise exception 'Categoria contábil não é desta loja' using errcode = '22023';
  end if;
  if exists (select 1 from fin_categorias where loja_id = p_loja and lower(nome) = lower(v_nome) and id is distinct from p_id) then
    raise exception 'Já existe uma categoria com esse nome' using errcode = '22023';
  end if;
  if p_id is null then
    insert into fin_categorias (loja_id, codigo, nome, tipo, grupo_dre, categoria_contabil_id)
    values (p_loja, nullif(btrim(coalesce(p_dados->>'codigo', '')), ''), v_nome, v_tipo, v_grupo, v_cc) returning * into k;
    perform fin_registrar_evento(p_loja, 'categoria', k.id, 'criada', jsonb_build_object('nome', k.nome, 'grupo_dre', k.grupo_dre), p_user, p_user_nome);
    return jsonb_build_object('ok', true, 'id', k.id, 'criada', true);
  end if;
  select * into k from fin_categorias where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Categoria não encontrada' using errcode = '22023'; end if;
  if v_tipo <> k.tipo and (exists (select 1 from fin_lancamentos where categoria_id = k.id)
      or (to_regclass('public.fin_titulos_pagar') is not null and exists (select 1 from fin_titulos_pagar where categoria_id = k.id))) then
    raise exception 'A categoria já é usada em títulos ou lançamentos: o tipo (despesa/receita) não muda' using errcode = '22023';
  end if;
  update fin_categorias set codigo = nullif(btrim(coalesce(p_dados->>'codigo', '')), ''), nome = v_nome, tipo = v_tipo, grupo_dre = v_grupo,
      categoria_contabil_id = v_cc, ativa = coalesce((p_dados->>'ativa')::boolean, k.ativa), updated_at = now()
    where id = k.id returning * into k;
  perform fin_registrar_evento(p_loja, 'categoria', k.id, 'editada', jsonb_build_object('nome', k.nome, 'grupo_dre', k.grupo_dre, 'ativa', k.ativa), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'id', k.id, 'criada', false);
end $$;

-- Categorias padrão (idempotente). Roda aqui para as lojas de estoque próprio que já existem; a tela oferece o botão
-- "Criar categorias padrão" para lojas que passarem a ser próprias depois.
create or replace function public.fin_categorias_semear(p_loja bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform fin_exigir_loja_propria(p_loja);
  -- Chave estável (padrao): reaplicar nunca recria uma categoria padrão que o usuário renomeou ou inativou.
  with ins as (
    insert into fin_categorias (loja_id, padrao, nome, tipo, grupo_dre)
    select p_loja, v.padrao, v.nome, v.tipo, v.grupo from (values
      ('cmv_revenda', 'Compra de mercadoria para revenda', 'despesa', 'cmv'),
      ('cmv_insumos', 'Matéria-prima e insumos', 'despesa', 'cmv'),
      ('cmv_embalagens', 'Embalagens', 'despesa', 'cmv'),
      ('pessoal_folha', 'Folha de pagamento e encargos', 'despesa', 'despesa_pessoal'),
      ('oper_aluguel', 'Aluguel e condomínio', 'despesa', 'despesa_operacional'),
      ('oper_energia', 'Energia, água e gás', 'despesa', 'despesa_operacional'),
      ('oper_manutencao', 'Manutenção e reparos', 'despesa', 'despesa_operacional'),
      ('oper_marketing', 'Marketing e publicidade', 'despesa', 'despesa_operacional'),
      ('adm_telefone', 'Telefone e internet', 'despesa', 'despesa_administrativa'),
      ('adm_servicos', 'Serviços contábeis e jurídicos', 'despesa', 'despesa_administrativa'),
      ('adm_material', 'Material de limpeza e escritório', 'despesa', 'despesa_administrativa'),
      ('fin_taxas', 'Taxas de cartão e bancárias', 'despesa', 'despesa_financeira'),
      ('fin_juros', 'Juros e multas pagos', 'despesa', 'despesa_financeira'),
      ('ded_impostos', 'Impostos sobre vendas', 'despesa', 'deducoes'),
      ('outras_despesas', 'Outras despesas', 'despesa', 'outras'),
      ('rec_vendas', 'Venda de mercadorias e pratos', 'receita', 'receita_bruta'),
      ('rec_outras', 'Outras receitas', 'receita', 'outras')
    ) as v(padrao, nome, tipo, grupo)
    on conflict do nothing returning 1
  ) select count(*) into n from ins;
  return n;
end $$;

do $$ declare l record; begin
  for l in select id from lojas where modo_estoque = 'proprio' loop
    perform fin_categorias_semear(l.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- grants
do $$ declare f text; begin
  foreach f in array array[
    'fin_registrar_evento(bigint,text,bigint,text,jsonb,text,text)', 'fin_numero(text,numeric)',
    'fin_conta_salvar(bigint,bigint,jsonb,text,text)', 'fin_contas_saldo(bigint)', 'fin_extrato(bigint,bigint,date,date)',
    'fin_categoria_salvar(bigint,bigint,jsonb,text,text)', 'fin_categorias_semear(bigint)',
    'fin_exigir_loja_propria(bigint)', 'fin_hoje()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
