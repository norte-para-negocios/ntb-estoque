-- Integracao ntb-vendas -> ntb-estoque (2026-09-28, virada do Sertao pra loja 4 real).
--
-- 1) vendas_integracao_fila: o que a rota de venda nao conseguiu mandar pro Omie
--    na hora por falha TRANSITORIA (consumo redundante, requisicao em andamento,
--    bloqueio da chave, rede/HTTP) fica aqui e o cron /api/cron/retry-integracao-vendas
--    reenvia com espera crescente. Pedido do dono: "se tiver problema de frequencia
--    fica na fila e depois vai". Erro permanente nao entra (nao adianta reenviar).
-- 2) produto_sem_estrutura: produtos em que o Omie recusou OP por nao ter estrutura
--    (revenda: cerveja, refrigerante...). A venda deles so da saida de estoque;
--    guardar evita 1 chamada Omie inutil por venda.
create table if not exists vendas_integracao_fila (
  id bigserial primary key,
  loja_id integer not null references lojas(id),
  tipo text not null check (tipo in ('op', 'nfce')),
  ref text,
  payload jsonb not null,
  status text not null default 'Pendente' check (status in ('Pendente', 'Concluido', 'Erro')),
  tentativas integer not null default 0,
  proximo_em timestamptz not null default now(),
  ultimo_erro text,
  resultado jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendas_integracao_fila_pendentes on vendas_integracao_fila (loja_id, proximo_em) where status = 'Pendente';
alter table vendas_integracao_fila enable row level security;

create table if not exists produto_sem_estrutura (
  loja_id integer not null references lojas(id),
  codigo_produto bigint not null,
  visto_em timestamptz not null default now(),
  primary key (loja_id, codigo_produto)
);
alter table produto_sem_estrutura enable row level security;
-- sem policies: so o service role (rotas de servidor e cron) le/escreve.
revoke all on vendas_integracao_fila from anon, authenticated;
revoke all on produto_sem_estrutura from anon, authenticated;
revoke all on sequence vendas_integracao_fila_id_seq from anon, authenticated;
-- APLICACAO (2026-09-28): so no Postgres self-hosted do Contabo (producao). O
-- Supabase Cloud esta descontinuado (ver 126).
