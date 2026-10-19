-- 232 — Fase F: pacote do contador (XMLs das notas de entrada, livro de entradas, inventário tipo Bloco H numa data).
-- Plano: docs/superpowers/plans/2026-10-19-fase-f-contador.md (R6–R8, R10). Só leitura: nada aqui escreve.
--
-- posicao_proprio_em_data: posição do estoque próprio numa data, pelo ledger (append-only): saldo = Σ quantidade com
-- data_ref ≤ data por produto × local; custo = cmc_apos do último movimento (por id) do produto até a data. Com o mês
-- fechado (230) nada mais entra com data nele, então a posição do último dia de um mês fechado não muda depois.
-- security invoker: o RLS de estoque_movimentos vale para quem chama (usuário logado só vê a própria loja).
--
-- Aplicar (manual, com backup e OK do dono), depois da 230/231:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 232_contador.sql
-- Depois: NOTIFY pgrst. Teste: scripts/testes-sql/232_contador.sql (banco local).

begin;

insert into permissoes (nome) values ('Contador - Pacote') on conflict (nome) do nothing;

create or replace function public.posicao_proprio_em_data(p_loja bigint, p_data date)
returns table (codigo_produto bigint, codigo_local_estoque bigint, saldo numeric, cmc numeric)
language sql stable security invoker set search_path = public as $$
  with s as (
    select m.codigo_produto, m.codigo_local_estoque, sum(m.quantidade) as saldo
      from estoque_movimentos m
     where m.loja_id = p_loja and m.data_ref <= p_data
     group by m.codigo_produto, m.codigo_local_estoque
  ), c as (
    select distinct on (m.codigo_produto) m.codigo_produto, m.cmc_apos
      from estoque_movimentos m
     where m.loja_id = p_loja and m.data_ref <= p_data
     order by m.codigo_produto, m.id desc
  )
  select s.codigo_produto, s.codigo_local_estoque, round(s.saldo, 6), coalesce(c.cmc_apos, 0)
    from s left join c on c.codigo_produto = s.codigo_produto
$$;
revoke all on function public.posicao_proprio_em_data(bigint, date) from public, anon;
grant execute on function public.posicao_proprio_em_data(bigint, date) to authenticated, service_role;

-- Índice para o "até a data" (o estoque_movimentos_data da 132 é (loja_id, data_ref) e já serve; este cobre o custo).
create index if not exists estoque_movimentos_produto_id on public.estoque_movimentos (loja_id, codigo_produto, id desc);

notify pgrst, 'reload schema';

commit;
