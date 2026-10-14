-- 171 — Central de correções (14/10/2026): estado de cada problema, produtos que não controlam estoque, OPs lançadas
-- pela Central (trava de idempotência) e o log do robô ("faxina", era a migration 156 só local: o número 156 já foi
-- usado no remoto com outro conteúdo). Permissão nova "Correcoes - Executar".
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md). Depende da 156 remota
-- (usuario_lojas) e da 112 (usuario_e_admin).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 171_central_correcoes.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
-- Leitura por loja no padrão initplan (migration 156): (select usuario_e_admin()) or loja_id in (select usuario_lojas()).
-- Escrita só pelo servidor (service role), depois de a server action conferir a permissão.

begin;

-- 1. Permissão ----------------------------------------------------------------------------------------------------
insert into permissoes (nome) values ('Correcoes - Executar') on conflict (nome) do nothing;

-- 2. Log do robô (correções automáticas) ---------------------------------------------------------------------------
create table if not exists public.correcoes_automaticas (
  id            bigint generated always as identity primary key,
  loja_id       bigint not null references public.lojas(id) on delete cascade,
  lote          text not null,
  modulo        text not null check (modulo in ('faxina','lancarPI','corrigirAzeite','relatorios')),
  acao          text not null,
  -- Colunas da chave de idempotência são NOT NULL (vazio = "não se aplica"): NULL nunca é igual a NULL num UNIQUE.
  produto_cod   text not null default '',
  produto_desc  text,
  data_ref      date not null,
  quantidade    numeric,
  de_valor      numeric,
  para_valor    numeric,
  status        text not null check (status in ('ok','falhou','parado','pendente_decisao','desfeito')),
  motivo        text,
  omie_ref      text not null default '',
  origem_ts     timestamptz not null,
  criado_em     timestamptz not null default now(),
  dados         jsonb,
  constraint correcoes_automaticas_idem unique (loja_id, lote, acao, produto_cod, data_ref, omie_ref)
);
create index if not exists correcoes_automaticas_loja_origem_idx on public.correcoes_automaticas (loja_id, origem_ts desc);
create index if not exists correcoes_automaticas_lote_idx on public.correcoes_automaticas (lote);
create index if not exists correcoes_automaticas_decisao_idx on public.correcoes_automaticas (loja_id, origem_ts desc)
  where status in ('parado','pendente_decisao');

-- 3. Estado de cada problema da Central ------------------------------------------------------------------------------
create table if not exists public.central_problema_estado (
  id            bigserial primary key,
  loja_id       bigint not null references public.lojas(id) on delete cascade,
  chave         text not null,                  -- <grupo>:<tipo>:<id>[:<local>] (lib/correcoes/central-puro.ts)
  estado        text not null check (estado in ('aberto','resolvido','ramon','ignorado')),
  motivo        text,                           -- motivo do ignorar / "Já resolvi no Omie"
  mensagem      text,                           -- pedido ao Ramon (guardado; nada é enviado)
  acao          text,                           -- o que foi feito ("Saldo zerado", "OP de preparo lançada"...)
  ate           date,                           -- ignorado até (inclusive): "olhar outro dia"
  assinatura    text,                           -- foto do problema quando o estado foi gravado
  user_id       uuid,
  user_nome     text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint central_problema_estado_chave unique (loja_id, chave)
);
create index if not exists central_problema_estado_loja_atualizado on public.central_problema_estado (loja_id, atualizado_em desc);

-- 4. Produtos que não controlam estoque (só local nesta rodada; nada é escrito no Omie) -------------------------------
create table if not exists public.estoque_nao_controla (
  loja_id        bigint not null references public.lojas(id) on delete cascade,
  codigo_produto bigint not null,
  motivo         text,
  user_id        uuid,
  user_nome      text,
  criado_em      timestamptz not null default now(),
  primary key (loja_id, codigo_produto)
);

-- 5. OPs lançadas pela Central: trava de idempotência por cCodIntOP (CP-<cupom>-<produto> / CT-<hash>) --------------
-- O 2º insert do mesmo código (duplo clique, duas abas, refazer) falha com 23505 e o servidor decide pelo status.
create table if not exists public.central_op_lancada (
  id             bigserial primary key,
  loja_id        bigint not null references public.lojas(id) on delete cascade,
  cod_int_op     text not null,
  origem         text not null check (origem in ('cupom','correcao')),
  codigo_produto bigint not null,
  quantidade     numeric not null check (quantidade > 0),
  data_op        date not null,
  n_id_cupom     bigint,
  n_cod_op       bigint,
  status         text not null check (status in ('incluindo','incluida','concluida','erro')),
  erro           text,
  simulado       boolean not null default false,
  user_id        uuid,
  user_nome      text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint central_op_lancada_cod unique (loja_id, cod_int_op)
);
create index if not exists central_op_lancada_loja_data on public.central_op_lancada (loja_id, data_op desc);

-- 6. RLS (leitura por loja, initplan) e grants -----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['correcoes_automaticas','central_problema_estado','estoque_nao_controla','central_op_lancada'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

commit;
