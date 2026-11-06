-- 370 — Finanças, Fase 4 passo 2 (plano mestre 2026-11-03): APROVAÇÃO DE PAGAMENTO por valor e cargo, CONTAS RECORRENTES
-- (aluguel, energia…) e LANÇAMENTO AVULSO + TRANSFERÊNCIA entre contas correntes. Depende da 285/286 (fin_*), 340 e 360.
-- SÓ loja de estoque próprio (toda função recusa as outras; o gerador nunca toca a loja 4). Nada fala com Omie, SEFAZ ou banco.
--
-- 1. CONFIGURAÇÃO por loja (fin_config_loja; sem linha = padrão): aprovação DESLIGADA; até R$ 1.000,00 não precisa aprovar;
--    acima disso o gerente aprova (permissão 'Financeiro - Aprovar pagamento'); acima de R$ 5.000,00 só admin/dono
--    ('Financeiro - Aprovar pagamento alto valor'); quem lançou pode aprovar a própria conta; gerador de recorrentes cria os
--    próximos 45 dias. Padrões do dono (05/11/2026), todos mudam pela tela (permissão 'Financeiro - Configurar aprovacao').
-- 2. APROVAÇÃO: colunas novas em fin_titulos_pagar. O gatilho BEFORE INSERT calcula a faixa de TODA conta nova (manual, da nota,
--    recorrente) pelo valor DA CONTA (cada parcela é uma conta). Faixa > 0 = 'pendente' ("aguardando aprovação"). Mudou o valor:
--    pendente recalcula; aprovada só volta a pendente se subir de faixa; reprovada não muda de valor (cancela e lança de novo).
--    Conta pendente ou reprovada NÃO recebe pagamento (gatilho BEFORE INSERT em fin_pagamentos: vale para qualquer caminho).
--    Aprovar/reprovar: fin_titulo_aprovacao_decidir (nível do usuário vem do servidor, que conferiu as permissões); reprovar
--    exige motivo; quem/quando/nível/motivo ficam na conta e em fin_eventos. Ligar a aprovação não mexe nas contas que já existem;
--    desligar não libera as que estão pendentes (alguém decide).
-- 3. RECORRENTES (fin_recorrentes): fornecedor, categoria, valor fixo ou ESTIMADO, mensal (dia 1–31; 29–31 em mês curto = último
--    dia) ou semanal (dia da semana ISO 1–7), início e fim. fin_recorrentes_gerar(loja|null, dias|null, hoje|null) é idempotente:
--    cada vencimento vira UMA ocorrência (fin_recorrentes_ocorrencias, única por recorrente+data) e uma conta a pagar
--    (origem 'recorrente'). Conta cancelada não volta. Valor estimado = conta com valor_a_confirmar (não paga antes de
--    fin_titulo_valor_confirmar). Editar a recorrente não mexe nas contas já geradas. Falha numa recorrente não para as outras
--    (evento 'geracao_falha'). Rota /api/cron/fin-recorrentes (1×/dia, scripts/sync-cron.sh).
-- 4. LANÇAMENTO AVULSO (despesa/receita sem fornecedor nem nota) no extrato, com categoria obrigatória do mesmo sentido, e
--    TRANSFERÊNCIA entre duas contas da mesma loja (fin_transferencias): saída na origem + entrada no destino, sem categoria (fora
--    da DRE), o consolidado da loja não muda. Os dois têm estorno (lançamento contrário ligado por estorno_de, data de hoje, motivo
--    obrigatório). fin_lancamentos continua append-only.
--
-- Aditiva: colunas novas com padrão, CHECKs de origem ampliados (fin_titulos_pagar e fin_lancamentos), tabelas e funções novas.
-- Nenhuma função existente muda de assinatura nem de corpo. Permissões novas aqui; os cargos padrão na 371.
-- Aplicar (manual, com backup e OK do dono), 370 e depois 371, cada uma numa transação:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 370_financeiro_aprovacao_recorrentes_lancamentos.sql
-- Teste: bash scripts/testes-sql/370_rodar.sh (produção, BEGIN … ROLLBACK, loja 19). Depois: desktop/scripts/gerar-schema.sh.

begin;
set lock_timeout = '5s';

insert into permissoes (nome) values
  ('Financeiro - Aprovar pagamento'),
  ('Financeiro - Aprovar pagamento alto valor'),
  ('Financeiro - Configurar aprovacao'),
  ('Financeiro - Contas recorrentes'),
  ('Financeiro - Lancamentos e transferencias')
on conflict (nome) do nothing;

-- ------------------------------------------------------------------------------------------------------- configuração
create table if not exists public.fin_config_loja (
  loja_id                      bigint primary key references public.lojas(id),
  aprovacao_ativa              boolean not null default false,
  aprovacao_ate                numeric(14,2) not null default 1000 check (aprovacao_ate >= 0 and aprovacao_ate <> 'NaN'),
  aprovacao_alto_acima         numeric(14,2) not null default 5000 check (aprovacao_alto_acima >= 0 and aprovacao_alto_acima <> 'NaN'),
  aprovacao_autor_pode_aprovar boolean not null default true,
  recorrentes_dias             int not null default 45 check (recorrentes_dias between 1 and 366),
  atualizado_por               text,
  atualizado_por_nome          text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check (aprovacao_alto_acima >= aprovacao_ate)
);

-- Sem linha = os padrões da tabela (uma fonte só: o default das colunas).
create or replace function public.fin_config(p_loja bigint) returns public.fin_config_loja
language plpgsql stable security definer set search_path = public as $$
declare c fin_config_loja%rowtype;
begin
  select * into c from fin_config_loja where loja_id = p_loja;
  if not found then
    c.loja_id := p_loja; c.aprovacao_ativa := false; c.aprovacao_ate := 1000; c.aprovacao_alto_acima := 5000;
    c.aprovacao_autor_pode_aprovar := true; c.recorrentes_dias := 45;
  end if;
  return c;
end $$;

create or replace function public.fin_config_ler(p_loja bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('aprovacao_ativa', c.aprovacao_ativa, 'aprovacao_ate', c.aprovacao_ate, 'aprovacao_alto_acima', c.aprovacao_alto_acima,
    'aprovacao_autor_pode_aprovar', c.aprovacao_autor_pode_aprovar, 'recorrentes_dias', c.recorrentes_dias,
    'atualizado_por_nome', c.atualizado_por_nome, 'updated_at', c.updated_at,
    'salva', exists (select 1 from fin_config_loja x where x.loja_id = p_loja))
  from fin_config(p_loja) c
$$;

create or replace function public.fin_config_salvar(p_loja bigint, p_dados jsonb, p_user text default null, p_user_nome text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a fin_config_loja%rowtype; d fin_config_loja%rowtype;
begin
  perform fin_exigir_loja_propria(p_loja);
  a := fin_config(p_loja);
  d := a;
  d.aprovacao_ativa := coalesce((p_dados->>'aprovacao_ativa')::boolean, a.aprovacao_ativa);
  d.aprovacao_ate := fin_numero(p_dados->>'aprovacao_ate', a.aprovacao_ate);
  d.aprovacao_alto_acima := fin_numero(p_dados->>'aprovacao_alto_acima', a.aprovacao_alto_acima);
  d.aprovacao_autor_pode_aprovar := coalesce((p_dados->>'aprovacao_autor_pode_aprovar')::boolean, a.aprovacao_autor_pode_aprovar);
  d.recorrentes_dias := coalesce(nullif(p_dados->>'recorrentes_dias', '')::int, a.recorrentes_dias);
  if d.aprovacao_ate < 0 or d.aprovacao_alto_acima < 0 then
    raise exception 'Os valores das faixas não podem ser negativos' using errcode = '22023';
  end if;
  if d.aprovacao_alto_acima < d.aprovacao_ate then
    raise exception 'O valor do admin/dono não pode ser menor que o valor sem aprovação' using errcode = '22023';
  end if;
  if d.recorrentes_dias not between 1 and 366 then
    raise exception 'Os dias do gerador de recorrentes vão de 1 a 366' using errcode = '22023';
  end if;
  insert into fin_config_loja (loja_id, aprovacao_ativa, aprovacao_ate, aprovacao_alto_acima, aprovacao_autor_pode_aprovar, recorrentes_dias,
      atualizado_por, atualizado_por_nome)
  values (p_loja, d.aprovacao_ativa, d.aprovacao_ate, d.aprovacao_alto_acima, d.aprovacao_autor_pode_aprovar, d.recorrentes_dias, p_user, p_user_nome)
  on conflict (loja_id) do update set aprovacao_ativa = excluded.aprovacao_ativa, aprovacao_ate = excluded.aprovacao_ate,
      aprovacao_alto_acima = excluded.aprovacao_alto_acima, aprovacao_autor_pode_aprovar = excluded.aprovacao_autor_pode_aprovar,
      recorrentes_dias = excluded.recorrentes_dias, atualizado_por = excluded.atualizado_por, atualizado_por_nome = excluded.atualizado_por_nome,
      updated_at = now();
  perform fin_registrar_evento(p_loja, 'config', p_loja, 'editada', jsonb_build_object(
    'antes', jsonb_build_object('aprovacao_ativa', a.aprovacao_ativa, 'aprovacao_ate', a.aprovacao_ate, 'aprovacao_alto_acima', a.aprovacao_alto_acima,
       'aprovacao_autor_pode_aprovar', a.aprovacao_autor_pode_aprovar, 'recorrentes_dias', a.recorrentes_dias),
    'depois', jsonb_build_object('aprovacao_ativa', d.aprovacao_ativa, 'aprovacao_ate', d.aprovacao_ate, 'aprovacao_alto_acima', d.aprovacao_alto_acima,
       'aprovacao_autor_pode_aprovar', d.aprovacao_autor_pode_aprovar, 'recorrentes_dias', d.recorrentes_dias)), p_user, p_user_nome);
  return fin_config_ler(p_loja);
end $$;

-- Faixa exigida pelo valor: 0 = não precisa; 1 = gerente; 2 = admin/dono. Espelho: nivelExigido (lib/financeiro/aprovacao-puro.ts).
create or replace function public.fin_aprovacao_nivel(p_loja bigint, p_valor numeric) returns int
language sql stable security definer set search_path = public as $$
  select case when not c.aprovacao_ativa or p_valor <= c.aprovacao_ate then 0 when p_valor > c.aprovacao_alto_acima then 2 else 1 end
  from fin_config(p_loja) c
$$;

-- ---------------------------------------------------------------------------------------------- aprovação na conta a pagar
alter table public.fin_titulos_pagar
  add column if not exists aprovacao                text not null default 'nao_exige',
  add column if not exists aprovacao_nivel          smallint not null default 0,
  add column if not exists aprovacao_nivel_aprovado smallint,
  add column if not exists aprovacao_em             timestamptz,
  add column if not exists aprovacao_por            text,
  add column if not exists aprovacao_por_nome       text,
  add column if not exists aprovacao_motivo         text,
  add column if not exists valor_a_confirmar        boolean not null default false;

alter table public.fin_titulos_pagar drop constraint if exists fin_titulos_pagar_aprovacao_check;
alter table public.fin_titulos_pagar add constraint fin_titulos_pagar_aprovacao_check check (
  aprovacao in ('nao_exige', 'pendente', 'aprovado', 'reprovado') and aprovacao_nivel between 0 and 2
  and (aprovacao = 'nao_exige') = (aprovacao_nivel = 0)
  and (aprovacao = 'aprovado') = (aprovacao_nivel_aprovado is not null));
alter table public.fin_titulos_pagar drop constraint if exists fin_titulos_pagar_origem_tipo_check;
alter table public.fin_titulos_pagar add constraint fin_titulos_pagar_origem_tipo_check
  check (origem_tipo in ('manual', 'nota_entrada', 'pedido_compra', 'importacao', 'recorrente'));
create index if not exists fin_titulos_pagar_aprovacao_pendente on public.fin_titulos_pagar (loja_id, data_vencimento)
  where aprovacao = 'pendente' and status <> 'cancelado';

-- Toda conta nova passa pela faixa (ninguém insere conta já aprovada); valor mudou = faixa recalculada.
create or replace function public.trg_fin_titulo_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nivel int;
begin
  if tg_op = 'INSERT' then
    v_nivel := case when new.status = 'cancelado' then 0 else fin_aprovacao_nivel(new.loja_id, new.valor) end;
    new.aprovacao := case when v_nivel = 0 then 'nao_exige' else 'pendente' end;
    new.aprovacao_nivel := v_nivel;
    new.aprovacao_nivel_aprovado := null; new.aprovacao_em := null; new.aprovacao_por := null; new.aprovacao_por_nome := null;
    new.aprovacao_motivo := null;
    return new;
  end if;
  if new.valor is not distinct from old.valor or new.status = 'cancelado' then return new; end if;
  if old.aprovacao = 'reprovado' then
    raise exception 'Conta reprovada: o valor não muda. Cancele e lance de novo.' using errcode = '22023';
  end if;
  v_nivel := fin_aprovacao_nivel(new.loja_id, new.valor);
  if old.aprovacao = 'aprovado' then
    if v_nivel > old.aprovacao_nivel_aprovado then
      new.aprovacao := 'pendente'; new.aprovacao_nivel := v_nivel; new.aprovacao_nivel_aprovado := null;
      new.aprovacao_em := null; new.aprovacao_por := null; new.aprovacao_por_nome := null; new.aprovacao_motivo := null;
    end if;
  elsif v_nivel = 0 then
    new.aprovacao := 'nao_exige'; new.aprovacao_nivel := 0;
  else
    new.aprovacao := 'pendente'; new.aprovacao_nivel := v_nivel;
  end if;
  if new.aprovacao is distinct from old.aprovacao or new.aprovacao_nivel is distinct from old.aprovacao_nivel then
    perform fin_registrar_evento(new.loja_id, 'titulo_pagar', new.id, 'aprovacao_recalculada', jsonb_build_object('valor_antes', old.valor,
      'valor', new.valor, 'antes', old.aprovacao, 'depois', new.aprovacao, 'nivel', new.aprovacao_nivel), null, null);
  end if;
  return new;
end $$;
drop trigger if exists fin_titulo_aprovacao on public.fin_titulos_pagar;
create trigger fin_titulo_aprovacao before insert or update of valor on public.fin_titulos_pagar
  for each row execute function public.trg_fin_titulo_aprovacao();

create or replace function public.trg_fin_titulo_aprovacao_evento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.aprovacao = 'pendente' then
    perform fin_registrar_evento(new.loja_id, 'titulo_pagar', new.id, 'aprovacao_exigida',
      jsonb_build_object('valor', new.valor, 'nivel', new.aprovacao_nivel), new.criado_por, new.criado_por_nome);
  end if;
  return null;
end $$;
drop trigger if exists fin_titulo_aprovacao_evento on public.fin_titulos_pagar;
create trigger fin_titulo_aprovacao_evento after insert on public.fin_titulos_pagar
  for each row execute function public.trg_fin_titulo_aprovacao_evento();

-- Pagamento só de conta liberada: vale para fin_pagamento_registrar e para qualquer outro caminho que grave pagamento.
create or replace function public.trg_fin_pagamento_exige_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_apr text; v_conf boolean;
begin
  select aprovacao, valor_a_confirmar into v_apr, v_conf from fin_titulos_pagar where id = new.titulo_id and loja_id = new.loja_id;
  if v_apr = 'pendente' then
    raise exception 'Conta aguardando aprovação: só pode ser paga depois de aprovada' using errcode = '22023';
  elsif v_apr = 'reprovado' then
    raise exception 'Conta reprovada: não pode ser paga' using errcode = '22023';
  elsif v_conf then
    raise exception 'Confirme o valor da conta (valor estimado) antes de pagar' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists fin_pagamento_exige_aprovacao on public.fin_pagamentos;
create trigger fin_pagamento_exige_aprovacao before insert on public.fin_pagamentos
  for each row execute function public.trg_fin_pagamento_exige_aprovacao();

-- p_nivel_usuario: 1 = gerente ('Financeiro - Aprovar pagamento'), 2 = admin/dono ('… alto valor'). O servidor confere as permissões.
create or replace function public.fin_titulo_aprovacao_decidir(p_loja bigint, p_id bigint, p_acao text, p_nivel_usuario int,
  p_motivo text default null, p_user text default null, p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t fin_titulos_pagar%rowtype; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform fin_exigir_loja_propria(p_loja);
  if p_acao not in ('aprovar', 'reprovar') then raise exception 'Decisão inválida' using errcode = '22023'; end if;
  select * into t from fin_titulos_pagar where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Conta a pagar não encontrada' using errcode = '22023'; end if;
  if (p_acao = 'aprovar' and t.aprovacao = 'aprovado') or (p_acao = 'reprovar' and t.aprovacao = 'reprovado') then
    return jsonb_build_object('ok', true, 'duplicado', true, 'aprovacao', t.aprovacao);
  end if;
  if t.status = 'cancelado' then raise exception 'Conta cancelada não passa por aprovação' using errcode = '22023'; end if;
  if t.aprovacao <> 'pendente' then raise exception 'Esta conta não está aguardando aprovação' using errcode = '22023'; end if;
  if coalesce(p_nivel_usuario, 0) < 1 then raise exception 'Sem permissão para aprovar pagamentos' using errcode = '22023'; end if;
  if p_nivel_usuario < t.aprovacao_nivel then
    raise exception 'Esta conta passa do valor do gerente: só admin/dono aprova' using errcode = '22023';
  end if;
  if not (fin_config(p_loja)).aprovacao_autor_pode_aprovar and t.criado_por is not null and t.criado_por = p_user then
    raise exception 'Quem lançou a conta não pode aprovar nem reprovar a própria conta' using errcode = '22023';
  end if;
  if p_acao = 'reprovar' and length(coalesce(v_motivo, '')) < 3 then
    raise exception 'Informe o motivo da reprovação' using errcode = '22023';
  end if;
  update fin_titulos_pagar set aprovacao = case when p_acao = 'aprovar' then 'aprovado' else 'reprovado' end,
      aprovacao_nivel_aprovado = case when p_acao = 'aprovar' then p_nivel_usuario end,
      aprovacao_em = now(), aprovacao_por = p_user, aprovacao_por_nome = p_user_nome, aprovacao_motivo = v_motivo, updated_at = now()
    where id = t.id returning * into t;
  perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, case when p_acao = 'aprovar' then 'aprovada' else 'reprovada' end,
    jsonb_build_object('nivel_exigido', t.aprovacao_nivel, 'nivel_usuario', p_nivel_usuario, 'valor', t.valor, 'motivo', v_motivo), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'aprovacao', t.aprovacao);
end $$;

-- Contas para a tela de aprovações: p_situacao 'pendente' (padrão), 'aprovado', 'reprovado' ou 'decididas' (aprovado+reprovado, 90 dias).
create or replace function public.fin_titulos_aprovacao_listar(p_loja bigint, p_situacao text default 'pendente', p_limite int default 200)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'numero', x.numero, 'fornecedor_nome', x.fornecedor_nome, 'documento', x.documento,
      'parcela', x.parcela, 'total_parcelas', x.total_parcelas, 'valor', x.valor, 'data_vencimento', x.data_vencimento,
      'categoria_nome', k.nome, 'origem_tipo', x.origem_tipo, 'origem_id', x.origem_id, 'status', x.status,
      'situacao', fin_situacao_titulo(x.status, x.data_vencimento), 'aprovacao', x.aprovacao, 'aprovacao_nivel', x.aprovacao_nivel,
      'aprovacao_em', x.aprovacao_em, 'aprovacao_por_nome', x.aprovacao_por_nome, 'aprovacao_motivo', x.aprovacao_motivo,
      'criado_por', x.criado_por, 'criado_por_nome', x.criado_por_nome, 'valor_a_confirmar', x.valor_a_confirmar, 'observacao', x.observacao)
      order by x.data_vencimento, x.id), '[]'::jsonb)
  from (select * from fin_titulos_pagar t where t.loja_id = p_loja and t.status <> 'cancelado'
          and case coalesce(p_situacao, 'pendente')
                when 'decididas' then t.aprovacao in ('aprovado', 'reprovado') and t.aprovacao_em >= now() - interval '90 days'
                else t.aprovacao = coalesce(p_situacao, 'pendente') end
        order by t.data_vencimento, t.id limit greatest(least(p_limite, 1000), 1)) x
  left join fin_categorias k on k.id = x.categoria_id
$$;

-- Valor estimado (conta recorrente) → valor de verdade. Até confirmar, a conta não recebe pagamento.
create or replace function public.fin_titulo_valor_confirmar(p_loja bigint, p_id bigint, p_valor text, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t fin_titulos_pagar%rowtype; v numeric; v_antes numeric;
begin
  perform fin_exigir_loja_propria(p_loja);
  v := fin_numero(p_valor);
  if v is null or v <= 0 then raise exception 'O valor precisa ser maior que zero' using errcode = '22023'; end if;
  select * into t from fin_titulos_pagar where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Conta a pagar não encontrada' using errcode = '22023'; end if;
  if not t.valor_a_confirmar then return jsonb_build_object('ok', true, 'duplicado', true, 'valor', t.valor, 'aprovacao', t.aprovacao); end if;
  if t.status in ('cancelado', 'pago') then raise exception 'Conta cancelada ou paga: o valor não muda' using errcode = '22023'; end if;
  if v < t.valor_quitado then raise exception 'O valor não pode ficar abaixo do que já foi pago (%)', t.valor_quitado using errcode = '22023'; end if;
  v_antes := t.valor;
  update fin_titulos_pagar set valor = v, status = fin_status_titulo(v, t.valor_quitado), valor_a_confirmar = false,
      data_quitacao = case when fin_status_titulo(v, t.valor_quitado) = 'pago' then fin_hoje() end, updated_at = now()
    where id = t.id returning * into t;
  perform fin_registrar_evento(p_loja, 'titulo_pagar', t.id, 'valor_confirmado', jsonb_build_object('estimado', v_antes, 'valor', v), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'valor', t.valor, 'aprovacao', t.aprovacao);
end $$;

-- ------------------------------------------------------------------------------------------------------------ recorrentes
create table if not exists public.fin_recorrentes (
  id                bigint generated always as identity primary key,
  loja_id           bigint not null references public.lojas(id),
  descricao         text not null check (length(btrim(descricao)) between 2 and 120),
  fornecedor_id     bigint not null references public.fornecedores(id),
  categoria_id      bigint,
  documento         text,
  valor             numeric(14,2) not null check (valor > 0 and valor <> 'NaN'),
  valor_estimado    boolean not null default false,
  periodicidade     text not null default 'mensal' check (periodicidade in ('mensal', 'semanal')),
  dia               smallint not null,
  data_inicio       date not null,
  data_fim          date,
  ativa             boolean not null default true,
  observacao        text,
  criado_por        text,
  criado_por_nome   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, loja_id),
  foreign key (categoria_id, loja_id) references public.fin_categorias (id, loja_id),
  check ((periodicidade = 'mensal' and dia between 1 and 31) or (periodicidade = 'semanal' and dia between 1 and 7)),
  check (data_fim is null or data_fim >= data_inicio)
);
create index if not exists fin_recorrentes_loja on public.fin_recorrentes (loja_id, ativa);

-- Um vencimento de uma recorrente = uma ocorrência, uma vez só (a conta cancelada não volta).
create table if not exists public.fin_recorrentes_ocorrencias (
  id              bigint generated always as identity primary key,
  loja_id         bigint not null references public.lojas(id),
  recorrente_id   bigint not null,
  data_vencimento date not null,
  titulo_id       bigint,
  created_at      timestamptz not null default now(),
  unique (recorrente_id, data_vencimento),
  foreign key (recorrente_id, loja_id) references public.fin_recorrentes (id, loja_id),
  foreign key (titulo_id, loja_id) references public.fin_titulos_pagar (id, loja_id)
);

-- Vencimentos em [p_de, p_ate] ∩ [início, fim]. Espelho: datasRecorrencia (lib/financeiro/recorrentes-puro.ts).
create or replace function public.fin_recorrente_datas(p_periodicidade text, p_dia int, p_inicio date, p_fim date, p_de date, p_ate date)
returns setof date
language sql immutable as $$
  with j as (select greatest(p_de, p_inicio) as ini, case when p_fim is not null and p_fim < p_ate then p_fim else p_ate end as fim)
  select d::date from j, lateral (
    select (m + (least(p_dia, extract(day from (m + interval '1 month - 1 day'))::int) - 1) * interval '1 day')::date as d
    from generate_series(date_trunc('month', j.ini::timestamp), date_trunc('month', j.fim::timestamp), interval '1 month') m
    where p_periodicidade = 'mensal'
    union all
    select g::date from generate_series((j.ini + ((p_dia - extract(isodow from j.ini)::int + 7) % 7))::timestamp, j.fim::timestamp, interval '7 days') g
    where p_periodicidade = 'semanal'
  ) x
  where j.ini <= j.fim and x.d between j.ini and j.fim
  order by 1
$$;

create or replace function public.fin_recorrente_salvar(p_loja bigint, p_id bigint, p_dados jsonb, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r fin_recorrentes%rowtype; f fornecedores%rowtype; v_desc text := btrim(coalesce(p_dados->>'descricao', '')); v_valor numeric;
  v_per text := coalesce(nullif(p_dados->>'periodicidade', ''), 'mensal'); v_dia int := nullif(p_dados->>'dia', '')::int;
  v_ini date := nullif(p_dados->>'data_inicio', '')::date; v_fim date := nullif(p_dados->>'data_fim', '')::date;
  v_cat bigint := nullif(p_dados->>'categoria_id', '')::bigint; v_forn bigint := nullif(p_dados->>'fornecedor_id', '')::bigint; v_antes jsonb;
begin
  perform fin_exigir_loja_propria(p_loja);
  if length(v_desc) < 2 then raise exception 'Informe a descrição (ex.: Aluguel)' using errcode = '22023'; end if;
  v_valor := fin_numero(p_dados->>'valor', 0);
  if v_valor <= 0 then raise exception 'O valor precisa ser maior que zero' using errcode = '22023'; end if;
  if v_per not in ('mensal', 'semanal') then raise exception 'Periodicidade inválida' using errcode = '22023'; end if;
  if v_per = 'mensal' and (v_dia is null or v_dia not between 1 and 31) then
    raise exception 'O dia do vencimento vai de 1 a 31' using errcode = '22023';
  end if;
  if v_per = 'semanal' and (v_dia is null or v_dia not between 1 and 7) then
    raise exception 'Escolha o dia da semana do vencimento' using errcode = '22023';
  end if;
  if v_ini is null then raise exception 'Informe o início' using errcode = '22023'; end if;
  if v_fim is not null and v_fim < v_ini then raise exception 'O fim não pode ser antes do início' using errcode = '22023'; end if;
  if v_cat is not null and not exists (select 1 from fin_categorias where id = v_cat and loja_id = p_loja and tipo = 'despesa') then
    raise exception 'Categoria inválida (precisa ser uma categoria de despesa desta loja)' using errcode = '22023';
  end if;
  select * into f from fornecedores where id = v_forn and loja_id = p_loja;
  if not found then raise exception 'Escolha um fornecedor do cadastro' using errcode = '22023'; end if;

  if p_id is null then
    if f.inativo then raise exception 'Fornecedor inativo' using errcode = '22023'; end if;
    insert into fin_recorrentes (loja_id, descricao, fornecedor_id, categoria_id, documento, valor, valor_estimado, periodicidade, dia,
        data_inicio, data_fim, ativa, observacao, criado_por, criado_por_nome)
    values (p_loja, v_desc, f.id, v_cat, nullif(btrim(coalesce(p_dados->>'documento', '')), ''), v_valor,
        coalesce((p_dados->>'valor_estimado')::boolean, false), v_per, v_dia, v_ini, v_fim, coalesce((p_dados->>'ativa')::boolean, true),
        nullif(btrim(coalesce(p_dados->>'observacao', '')), ''), p_user, p_user_nome)
    returning * into r;
    perform fin_registrar_evento(p_loja, 'recorrente', r.id, 'criada', jsonb_build_object('descricao', r.descricao, 'valor', r.valor,
      'estimado', r.valor_estimado, 'periodicidade', r.periodicidade, 'dia', r.dia, 'inicio', r.data_inicio, 'fim', r.data_fim), p_user, p_user_nome);
    return jsonb_build_object('ok', true, 'id', r.id, 'criada', true);
  end if;

  select * into r from fin_recorrentes where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Conta recorrente não encontrada' using errcode = '22023'; end if;
  if f.inativo and f.id <> r.fornecedor_id then raise exception 'Fornecedor inativo' using errcode = '22023'; end if;
  v_antes := jsonb_build_object('descricao', r.descricao, 'fornecedor_id', r.fornecedor_id, 'valor', r.valor, 'estimado', r.valor_estimado,
    'periodicidade', r.periodicidade, 'dia', r.dia, 'inicio', r.data_inicio, 'fim', r.data_fim, 'ativa', r.ativa, 'categoria_id', r.categoria_id);
  update fin_recorrentes set descricao = v_desc, fornecedor_id = f.id, categoria_id = v_cat,
      documento = nullif(btrim(coalesce(p_dados->>'documento', '')), ''), valor = v_valor,
      valor_estimado = coalesce((p_dados->>'valor_estimado')::boolean, r.valor_estimado), periodicidade = v_per, dia = v_dia,
      data_inicio = v_ini, data_fim = v_fim, ativa = coalesce((p_dados->>'ativa')::boolean, r.ativa),
      observacao = nullif(btrim(coalesce(p_dados->>'observacao', '')), ''), updated_at = now()
    where id = r.id returning * into r;
  perform fin_registrar_evento(p_loja, 'recorrente', r.id, 'editada', jsonb_build_object('antes', v_antes, 'depois', jsonb_build_object(
    'descricao', r.descricao, 'fornecedor_id', r.fornecedor_id, 'valor', r.valor, 'estimado', r.valor_estimado, 'periodicidade', r.periodicidade,
    'dia', r.dia, 'inicio', r.data_inicio, 'fim', r.data_fim, 'ativa', r.ativa, 'categoria_id', r.categoria_id)), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'id', r.id, 'criada', false);
end $$;

create or replace function public.fin_recorrentes_listar(p_loja bigint, p_hoje date default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'descricao', r.descricao, 'fornecedor_id', r.fornecedor_id,
      'fornecedor_nome', coalesce(nullif(f.nome_fantasia, ''), f.razao_social), 'categoria_id', r.categoria_id, 'categoria_nome', k.nome,
      'documento', r.documento, 'valor', r.valor, 'valor_estimado', r.valor_estimado, 'periodicidade', r.periodicidade, 'dia', r.dia,
      'data_inicio', r.data_inicio, 'data_fim', r.data_fim, 'ativa', r.ativa, 'observacao', r.observacao,
      'geradas', (select count(*) from fin_recorrentes_ocorrencias o where o.recorrente_id = r.id),
      'ultima_gerada', (select max(o.data_vencimento) from fin_recorrentes_ocorrencias o where o.recorrente_id = r.id),
      'proxima', (select min(o.data_vencimento) from fin_recorrentes_ocorrencias o join fin_titulos_pagar t on t.id = o.titulo_id
                  where o.recorrente_id = r.id and o.data_vencimento >= coalesce(p_hoje, fin_hoje()) and t.status <> 'cancelado'),
      'ultima_falha', (select e.detalhe->>'erro' from fin_eventos e where e.loja_id = r.loja_id and e.entidade = 'recorrente'
                       and e.entidade_id = r.id and e.tipo in ('geracao_falha', 'geracao_ok') order by e.id desc limit 1))
      order by r.ativa desc, r.descricao, r.id), '[]'::jsonb)
  from fin_recorrentes r
  join fornecedores f on f.id = r.fornecedor_id
  left join fin_categorias k on k.id = r.categoria_id
  where r.loja_id = p_loja
$$;

-- Gerador idempotente. p_loja null = todas as lojas próprias ativas (nunca a 4); p_dias null = o da configuração da loja.
create or replace function public.fin_recorrentes_gerar(p_loja bigint default null, p_dias int default null, p_hoje date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := coalesce(p_hoje, fin_hoje()); l record; r fin_recorrentes%rowtype; d date; v_dias int; v_oc bigint; v_t jsonb;
  v_ger int; v_falhas int; v_erro text; v_erro_rec text; v_out jsonb := '[]'::jsonb;
begin
  if p_loja = 4 then raise exception 'Loja 4 fora do financeiro do Norte' using errcode = '22023'; end if;
  if p_loja is not null then perform fin_exigir_loja_propria(p_loja); end if;
  if p_dias is not null and p_dias not between 1 and 366 then raise exception 'Dias de 1 a 366' using errcode = '22023'; end if;
  for l in select id from lojas where modo_estoque = 'proprio' and ativo and id <> 4 and (p_loja is null or id = p_loja) order by id loop
    v_dias := coalesce(p_dias, (fin_config(l.id)).recorrentes_dias);
    v_ger := 0; v_falhas := 0;
    for r in select * from fin_recorrentes where loja_id = l.id and ativa order by id loop
      v_erro_rec := null;
      for d in select x from fin_recorrente_datas(r.periodicidade, r.dia, r.data_inicio, r.data_fim, v_hoje, v_hoje + v_dias) x loop
        continue when exists (select 1 from fin_recorrentes_ocorrencias where recorrente_id = r.id and data_vencimento = d);
        begin
          v_oc := null;
          insert into fin_recorrentes_ocorrencias (loja_id, recorrente_id, data_vencimento) values (l.id, r.id, d)
            on conflict (recorrente_id, data_vencimento) do nothing returning id into v_oc;
          if v_oc is not null then
            v_t := fin_titulo_pagar_salvar(l.id, null, jsonb_build_object('fornecedor_id', r.fornecedor_id, 'documento', r.documento,
                'valor', r.valor::text, 'data_vencimento', d, 'categoria_id', r.categoria_id,
                'observacao', 'Recorrente: ' || r.descricao || case when r.valor_estimado then ' (valor estimado: confirmar antes de pagar)' else '' end,
                'origem_tipo', 'recorrente', 'origem_id', v_oc), null, 'Contas recorrentes', 'recorrente:' || r.id || ':' || d);
            update fin_recorrentes_ocorrencias set titulo_id = (v_t->>'id')::bigint where id = v_oc;
            if r.valor_estimado then
              update fin_titulos_pagar set valor_a_confirmar = true where id = (v_t->>'id')::bigint;
            end if;
            v_ger := v_ger + 1;
          end if;
        exception when others then
          get stacked diagnostics v_erro = message_text;
          v_falhas := v_falhas + 1;
          v_erro_rec := coalesce(v_erro_rec, left(d::text || ': ' || v_erro, 300));
        end;
      end loop;
      -- um evento por recorrente e rodada (não um por data): o último diz se a geração está falhando
      if v_erro_rec is not null then
        perform fin_registrar_evento(l.id, 'recorrente', r.id, 'geracao_falha', jsonb_build_object('erro', v_erro_rec, 'hoje', v_hoje), null, 'Contas recorrentes');
      elsif exists (select 1 from fin_eventos e where e.loja_id = l.id and e.entidade = 'recorrente' and e.entidade_id = r.id
                    and e.tipo in ('geracao_falha', 'geracao_ok') and e.id = (select max(e2.id) from fin_eventos e2 where e2.loja_id = l.id
                    and e2.entidade = 'recorrente' and e2.entidade_id = r.id and e2.tipo in ('geracao_falha', 'geracao_ok')) and e.tipo = 'geracao_falha') then
        perform fin_registrar_evento(l.id, 'recorrente', r.id, 'geracao_ok', jsonb_build_object('hoje', v_hoje), null, 'Contas recorrentes');
      end if;
    end loop;
    v_out := v_out || jsonb_build_object('loja_id', l.id, 'gerados', v_ger, 'falhas', v_falhas, 'dias', v_dias);
  end loop;
  return jsonb_build_object('ok', true, 'hoje', v_hoje, 'lojas', v_out);
end $$;

-- ------------------------------------------------------------------------------------- lançamento avulso e transferência
alter table public.fin_lancamentos add column if not exists chave_idempotencia text, add column if not exists assinatura text;
create unique index if not exists fin_lancamentos_chave on public.fin_lancamentos (loja_id, chave_idempotencia) where chave_idempotencia is not null;
alter table public.fin_lancamentos drop constraint if exists fin_lancamentos_origem_tipo_check;
alter table public.fin_lancamentos add constraint fin_lancamentos_origem_tipo_check check (origem_tipo in
  ('pagamento', 'estorno_pagamento', 'manual', 'estorno_manual', 'transferencia', 'estorno_transferencia', 'recebimento'));
alter table public.fin_lancamentos drop constraint if exists fin_lancamentos_check;
alter table public.fin_lancamentos add constraint fin_lancamentos_check check (
  (estorno_de is null) = (origem_tipo not in ('estorno_pagamento', 'estorno_manual', 'estorno_transferencia')));

create table if not exists public.fin_transferencias (
  id                  bigint generated by default as identity primary key,
  loja_id             bigint not null references public.lojas(id),
  conta_origem_id     bigint not null,
  conta_destino_id    bigint not null,
  data                date not null,
  valor               numeric(14,2) not null check (valor > 0 and valor <> 'NaN'),
  descricao           text,
  lanc_saida_id       bigint not null references public.fin_lancamentos(id),
  lanc_entrada_id     bigint not null references public.fin_lancamentos(id),
  chave_idempotencia  text not null,
  assinatura          text not null,
  criado_por          text,
  criado_por_nome     text,
  created_at          timestamptz not null default now(),
  estornada_em        timestamptz,
  estornada_por       text,
  estornada_por_nome  text,
  motivo_estorno      text,
  estorno_saida_id    bigint references public.fin_lancamentos(id),
  estorno_entrada_id  bigint references public.fin_lancamentos(id),
  unique (loja_id, chave_idempotencia),
  foreign key (conta_origem_id, loja_id) references public.fin_contas_correntes (id, loja_id),
  foreign key (conta_destino_id, loja_id) references public.fin_contas_correntes (id, loja_id),
  check (conta_origem_id <> conta_destino_id),
  check ((estornada_em is null) = (estorno_saida_id is null) and (estorno_saida_id is null) = (estorno_entrada_id is null))
);
create index if not exists fin_transferencias_loja on public.fin_transferencias (loja_id, data, id);

-- Transferência só muda uma vez, para "estornada"; nunca é apagada nem reescrita.
create or replace function public.trg_fin_transferencias_guarda() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'fin_transferencias não se apaga: use o estorno' using errcode = '55000'; end if;
  if old.estornada_em is not null
     or (new.id, new.loja_id, new.conta_origem_id, new.conta_destino_id, new.data, new.valor, new.descricao, new.lanc_saida_id,
         new.lanc_entrada_id, new.chave_idempotencia, new.assinatura)
        is distinct from
        (old.id, old.loja_id, old.conta_origem_id, old.conta_destino_id, old.data, old.valor, old.descricao, old.lanc_saida_id,
         old.lanc_entrada_id, old.chave_idempotencia, old.assinatura) then
    raise exception 'fin_transferencias é imutável (só o estorno altera)' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists fin_transferencias_guarda on public.fin_transferencias;
create trigger fin_transferencias_guarda before update or delete on public.fin_transferencias
  for each row execute function public.trg_fin_transferencias_guarda();

-- Conta corrente utilizável numa data (ativa, data não futura nem anterior ao saldo inicial). Trava FOR SHARE.
create or replace function public._fin_conta_para_lancar(p_loja bigint, p_conta bigint, p_data date) returns public.fin_contas_correntes
language plpgsql security definer set search_path = public as $$
declare c fin_contas_correntes%rowtype;
begin
  select * into c from fin_contas_correntes where id = p_conta and loja_id = p_loja for share;
  if not found then raise exception 'Escolha a conta corrente' using errcode = '22023'; end if;
  if not c.ativa then raise exception 'A conta corrente % está inativa', c.nome using errcode = '22023'; end if;
  if p_data < c.data_saldo_inicial then
    raise exception 'A data é anterior ao saldo inicial da conta % (%)', c.nome, c.data_saldo_inicial using errcode = '22023';
  end if;
  return c;
end $$;

-- p_dados: conta_id, data (vazio = hoje), tipo (entrada|saida), valor, descricao, categoria_id (obrigatória, do mesmo sentido).
create or replace function public.fin_lancamento_avulso_registrar(p_loja bigint, p_dados jsonb, p_user text default null,
  p_user_nome text default null, p_chave text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_chave text := nullif(btrim(coalesce(p_chave, '')), ''); v_tipo text := p_dados->>'tipo'; v_valor numeric; v_data date;
  v_desc text := btrim(coalesce(p_dados->>'descricao', '')); v_cat bigint := nullif(p_dados->>'categoria_id', '')::bigint;
  v_cat_tipo text; c fin_contas_correntes%rowtype; l fin_lancamentos%rowtype; v_assin text;
begin
  perform fin_exigir_loja_propria(p_loja);
  if v_chave is null then raise exception 'Chave de idempotência obrigatória' using errcode = '22023'; end if;
  v_valor := fin_numero(p_dados->>'valor', 0);
  v_data := coalesce(nullif(p_dados->>'data', '')::date, fin_hoje());
  v_assin := md5(concat_ws('|', coalesce(p_dados->>'conta_id', ''), v_data, coalesce(v_tipo, ''), v_valor, v_desc, coalesce(v_cat::text, '')));
  perform pg_advisory_xact_lock(7370, p_loja::int);
  select * into l from fin_lancamentos where loja_id = p_loja and chave_idempotencia = v_chave;
  if found then
    if l.assinatura is distinct from v_assin then raise exception 'Essa chave já foi usada com outros dados' using errcode = '22023'; end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', l.id);
  end if;
  if v_tipo is null or v_tipo not in ('entrada', 'saida') then raise exception 'Escolha entrada ou saída' using errcode = '22023'; end if;
  if v_valor <= 0 then raise exception 'O valor precisa ser maior que zero' using errcode = '22023'; end if;
  if v_data > fin_hoje() then raise exception 'A data não pode ser futura' using errcode = '22023'; end if;
  if length(v_desc) < 2 then raise exception 'Informe a descrição' using errcode = '22023'; end if;
  select tipo into v_cat_tipo from fin_categorias where id = v_cat and loja_id = p_loja and ativa;
  if v_cat_tipo is null then raise exception 'Escolha a categoria (entra na DRE)' using errcode = '22023'; end if;
  if (v_tipo = 'saida') <> (v_cat_tipo = 'despesa') then
    raise exception '% precisa de uma categoria de %', case when v_tipo = 'saida' then 'Saída' else 'Entrada' end,
      case when v_tipo = 'saida' then 'despesa' else 'receita' end using errcode = '22023';
  end if;
  c := _fin_conta_para_lancar(p_loja, nullif(p_dados->>'conta_id', '')::bigint, v_data);
  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, categoria_id, origem_tipo, origem_id, chave_idempotencia, assinatura,
      criado_por, criado_por_nome)
  values (p_loja, c.id, v_data, v_tipo, v_valor, left(v_desc, 300), v_cat, 'manual', null, v_chave, v_assin, p_user, p_user_nome)
  returning * into l;
  perform fin_registrar_evento(p_loja, 'lancamento', l.id, 'avulso_registrado', jsonb_build_object('conta_id', c.id, 'tipo', v_tipo,
    'valor', v_valor, 'data', v_data, 'categoria_id', v_cat, 'descricao', l.descricao), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', l.id);
end $$;

create or replace function public.fin_lancamento_avulso_estornar(p_loja bigint, p_lancamento bigint, p_motivo text, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l fin_lancamentos%rowtype; v_est bigint;
begin
  perform fin_exigir_loja_propria(p_loja);
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do estorno' using errcode = '22023'; end if;
  select * into l from fin_lancamentos where id = p_lancamento and loja_id = p_loja for update;
  if not found then raise exception 'Lançamento não encontrado' using errcode = '22023'; end if;
  if l.origem_tipo <> 'manual' then
    raise exception 'Só lançamento avulso se estorna aqui (pagamento e transferência têm o próprio estorno)' using errcode = '22023';
  end if;
  select id into v_est from fin_lancamentos where estorno_de = l.id;
  if found then return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_est); end if;
  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, categoria_id, origem_tipo, origem_id, estorno_de, criado_por, criado_por_nome)
  values (p_loja, l.conta_id, fin_hoje(), case l.tipo when 'entrada' then 'saida' else 'entrada' end, l.valor,
      left('Estorno: ' || coalesce(l.descricao, 'lançamento avulso') || ' (' || btrim(p_motivo) || ')', 300), l.categoria_id, 'estorno_manual', l.id, l.id,
      p_user, p_user_nome)
  returning id into v_est;
  perform fin_registrar_evento(p_loja, 'lancamento', l.id, 'avulso_estornado', jsonb_build_object('estorno_id', v_est, 'motivo', btrim(p_motivo),
    'valor', l.valor), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_est);
end $$;

-- p_dados: conta_origem_id, conta_destino_id, data (vazio = hoje), valor, descricao. Mesma loja; as duas contas ativas.
create or replace function public.fin_transferencia_registrar(p_loja bigint, p_dados jsonb, p_user text default null,
  p_user_nome text default null, p_chave text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_chave text := nullif(btrim(coalesce(p_chave, '')), ''); v_orig bigint := nullif(p_dados->>'conta_origem_id', '')::bigint;
  v_dest bigint := nullif(p_dados->>'conta_destino_id', '')::bigint; v_valor numeric; v_data date; v_desc text; v_assin text;
  tr fin_transferencias%rowtype; co fin_contas_correntes%rowtype; cd fin_contas_correntes%rowtype; v_id bigint; v_s bigint; v_e bigint;
begin
  perform fin_exigir_loja_propria(p_loja);
  if v_chave is null then raise exception 'Chave de idempotência obrigatória' using errcode = '22023'; end if;
  v_valor := fin_numero(p_dados->>'valor', 0);
  v_data := coalesce(nullif(p_dados->>'data', '')::date, fin_hoje());
  v_desc := nullif(left(btrim(coalesce(p_dados->>'descricao', '')), 200), '');
  v_assin := md5(concat_ws('|', coalesce(v_orig::text, ''), coalesce(v_dest::text, ''), v_data, v_valor, coalesce(v_desc, '')));
  perform pg_advisory_xact_lock(7370, p_loja::int);
  select * into tr from fin_transferencias where loja_id = p_loja and chave_idempotencia = v_chave;
  if found then
    if tr.assinatura <> v_assin then raise exception 'Essa chave já foi usada com outros dados' using errcode = '22023'; end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', tr.id);
  end if;
  if v_orig is null then raise exception 'Escolha a conta de origem' using errcode = '22023'; end if;
  if v_dest is null then raise exception 'Escolha a conta de destino' using errcode = '22023'; end if;
  if v_orig = v_dest then raise exception 'Origem e destino não podem ser a mesma conta' using errcode = '22023'; end if;
  if v_valor <= 0 then raise exception 'O valor precisa ser maior que zero' using errcode = '22023'; end if;
  if v_data > fin_hoje() then raise exception 'A data não pode ser futura' using errcode = '22023'; end if;
  -- trava as duas contas sempre na mesma ordem (id menor primeiro)
  if v_orig < v_dest then co := _fin_conta_para_lancar(p_loja, v_orig, v_data); cd := _fin_conta_para_lancar(p_loja, v_dest, v_data);
  else cd := _fin_conta_para_lancar(p_loja, v_dest, v_data); co := _fin_conta_para_lancar(p_loja, v_orig, v_data); end if;

  v_id := nextval(pg_get_serial_sequence('fin_transferencias', 'id'));
  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, categoria_id, origem_tipo, origem_id, criado_por, criado_por_nome)
  values (p_loja, co.id, v_data, 'saida', v_valor, left('Transferência para ' || cd.nome || coalesce(' · ' || v_desc, ''), 300), null,
      'transferencia', v_id, p_user, p_user_nome) returning id into v_s;
  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, categoria_id, origem_tipo, origem_id, criado_por, criado_por_nome)
  values (p_loja, cd.id, v_data, 'entrada', v_valor, left('Transferência de ' || co.nome || coalesce(' · ' || v_desc, ''), 300), null,
      'transferencia', v_id, p_user, p_user_nome) returning id into v_e;
  insert into fin_transferencias (id, loja_id, conta_origem_id, conta_destino_id, data, valor, descricao, lanc_saida_id, lanc_entrada_id,
      chave_idempotencia, assinatura, criado_por, criado_por_nome)
  values (v_id, p_loja, co.id, cd.id, v_data, v_valor, v_desc, v_s, v_e, v_chave, v_assin, p_user, p_user_nome);
  perform fin_registrar_evento(p_loja, 'transferencia', v_id, 'registrada', jsonb_build_object('origem', co.id, 'destino', cd.id,
    'valor', v_valor, 'data', v_data), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id);
end $$;

create or replace function public.fin_transferencia_estornar(p_loja bigint, p_id bigint, p_motivo text, p_user text default null,
  p_user_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tr fin_transferencias%rowtype; v_s bigint; v_e bigint; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform fin_exigir_loja_propria(p_loja);
  if length(v_motivo) < 3 then raise exception 'Informe o motivo do estorno' using errcode = '22023'; end if;
  select * into tr from fin_transferencias where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Transferência não encontrada' using errcode = '22023'; end if;
  if tr.estornada_em is not null then return jsonb_build_object('ok', true, 'duplicado', true, 'id', tr.id); end if;
  -- devolve na origem a saída e tira do destino a entrada (cada estorno aponta para o lançamento que anula)
  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, origem_tipo, origem_id, estorno_de, criado_por, criado_por_nome)
  values (p_loja, tr.conta_origem_id, fin_hoje(), 'entrada', tr.valor, left('Estorno da transferência nº ' || tr.id || ' (' || v_motivo || ')', 300),
      'estorno_transferencia', tr.id, tr.lanc_saida_id, p_user, p_user_nome) returning id into v_s;
  insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, descricao, origem_tipo, origem_id, estorno_de, criado_por, criado_por_nome)
  values (p_loja, tr.conta_destino_id, fin_hoje(), 'saida', tr.valor, left('Estorno da transferência nº ' || tr.id || ' (' || v_motivo || ')', 300),
      'estorno_transferencia', tr.id, tr.lanc_entrada_id, p_user, p_user_nome) returning id into v_e;
  update fin_transferencias set estornada_em = now(), estornada_por = p_user, estornada_por_nome = p_user_nome, motivo_estorno = v_motivo,
      estorno_saida_id = v_s, estorno_entrada_id = v_e where id = tr.id;
  perform fin_registrar_evento(p_loja, 'transferencia', tr.id, 'estornada', jsonb_build_object('motivo', v_motivo, 'valor', tr.valor), p_user, p_user_nome);
  return jsonb_build_object('ok', true, 'duplicado', false, 'id', tr.id);
end $$;

-- Avulsos e transferências do período (p_de/p_ate nulos = últimos 90 dias), mais novos primeiro.
create or replace function public.fin_avulsos_transferencias_listar(p_loja bigint, p_de date default null, p_ate date default null,
  p_limite int default 300) returns jsonb
language sql stable security definer set search_path = public as $$
  with j as (select coalesce(p_de, fin_hoje() - 90) as de, coalesce(p_ate, fin_hoje()) as ate, greatest(least(p_limite, 1000), 1) as lim)
  select jsonb_build_object(
    'avulsos', coalesce((select jsonb_agg(x order by (x->>'data') desc, (x->>'id')::bigint desc) from (
        select jsonb_build_object('id', l.id, 'data', l.data, 'tipo', l.tipo, 'valor', l.valor, 'descricao', l.descricao,
          'conta_id', l.conta_id, 'conta_nome', c.nome, 'categoria_id', l.categoria_id, 'categoria_nome', k.nome, 'criado_por_nome', l.criado_por_nome,
          'estorno_id', e.id, 'estorno_data', e.data, 'estorno_descricao', e.descricao) as x
        from fin_lancamentos l join j on true
        join fin_contas_correntes c on c.id = l.conta_id
        left join fin_categorias k on k.id = l.categoria_id
        left join fin_lancamentos e on e.estorno_de = l.id
        where l.loja_id = p_loja and l.origem_tipo = 'manual' and l.data between j.de and j.ate
        order by l.data desc, l.id desc limit (select lim from j)) s), '[]'::jsonb),
    'transferencias', coalesce((select jsonb_agg(x order by (x->>'data') desc, (x->>'id')::bigint desc) from (
        select jsonb_build_object('id', t.id, 'data', t.data, 'valor', t.valor, 'descricao', t.descricao,
          'conta_origem_id', t.conta_origem_id, 'conta_origem_nome', o.nome, 'conta_destino_id', t.conta_destino_id, 'conta_destino_nome', d.nome,
          'criado_por_nome', t.criado_por_nome, 'estornada_em', t.estornada_em, 'estornada_por_nome', t.estornada_por_nome,
          'motivo_estorno', t.motivo_estorno) as x
        from fin_transferencias t join j on true
        join fin_contas_correntes o on o.id = t.conta_origem_id
        join fin_contas_correntes d on d.id = t.conta_destino_id
        where t.loja_id = p_loja and t.data between j.de and j.ate
        order by t.data desc, t.id desc limit (select lim from j)) s), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------------------------------- RLS e grants
do $$ declare t text; begin
  foreach t in array array['fin_config_loja', 'fin_recorrentes', 'fin_recorrentes_ocorrencias', 'fin_transferencias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'fin_config(bigint)', 'fin_config_ler(bigint)', 'fin_config_salvar(bigint,jsonb,text,text)', 'fin_aprovacao_nivel(bigint,numeric)',
    'trg_fin_titulo_aprovacao()', 'trg_fin_titulo_aprovacao_evento()', 'trg_fin_pagamento_exige_aprovacao()',
    'fin_titulo_aprovacao_decidir(bigint,bigint,text,int,text,text,text)', 'fin_titulos_aprovacao_listar(bigint,text,int)',
    'fin_titulo_valor_confirmar(bigint,bigint,text,text,text)',
    'fin_recorrente_datas(text,int,date,date,date,date)', 'fin_recorrente_salvar(bigint,bigint,jsonb,text,text)',
    'fin_recorrentes_listar(bigint,date)', 'fin_recorrentes_gerar(bigint,int,date)',
    '_fin_conta_para_lancar(bigint,bigint,date)', 'fin_lancamento_avulso_registrar(bigint,jsonb,text,text,text)',
    'fin_lancamento_avulso_estornar(bigint,bigint,text,text,text)', 'fin_transferencia_registrar(bigint,jsonb,text,text,text)',
    'fin_transferencia_estornar(bigint,bigint,text,text,text)', 'fin_avulsos_transferencias_listar(bigint,date,date,int)',
    'trg_fin_transferencias_guarda()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
