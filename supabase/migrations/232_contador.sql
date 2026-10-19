-- 232 — Fase F: pacote do contador (XMLs das notas de entrada, livro de entradas, inventário tipo Bloco H numa data).
-- Plano: docs/superpowers/plans/2026-10-19-fase-f-contador.md (R6–R8, R10). Só leitura: nada aqui escreve.
--
-- posicao_proprio_em_data: posição do estoque próprio numa data, pelo ledger (append-only): saldo = Σ quantidade com
-- data_ref ≤ data por produto × local; custo médio refeito na ordem da data (data_ref, id). Com o mês
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
language plpgsql stable security invoker set search_path = public as $$
declare
  m record; v_prod bigint; v_s numeric := 0; v_c numeric := 0; v_q numeric; v_novo numeric;
  v_prods bigint[] := '{}'; v_cmcs numeric[] := '{}';
begin
  -- Saldo por produto × local: soma direta do ledger até a data.
  -- Custo médio por produto: refeito na ORDEM DA DATA (data_ref, depois id), com as mesmas regras do
  -- registrar_movimento (174) e da devolução (231). O cmc_apos gravado não serve: movimento retroativo gravado depois
  -- carrega o custo do momento da gravação (revisão I3).
  for m in
    select e.codigo_produto, e.tipo, e.origem, e.quantidade, e.custo_unitario, e.custo_estimado
      from estoque_movimentos e
     where e.loja_id = p_loja and e.data_ref <= p_data
     order by e.codigo_produto, e.data_ref, e.id
  loop
    if v_prod is distinct from m.codigo_produto then
      if v_prod is not null then v_prods := v_prods || v_prod; v_cmcs := v_cmcs || v_c; end if;
      v_prod := m.codigo_produto; v_s := 0; v_c := 0;
    end if;
    v_q := m.quantidade;
    if m.tipo = 'TRF' then
      null;                                                             -- transferência não muda saldo total nem custo
    elsif v_q > 0 and not coalesce(m.custo_estimado, false) and coalesce(m.custo_unitario, 0) > 0 then
      if v_s + v_q = 0 then v_c := m.custo_unitario;
      else
        v_novo := round((v_s * v_c + v_q * m.custo_unitario) / (v_s + v_q), 6);
        v_c := case when v_novo <= 0 then m.custo_unitario else v_novo end;
      end if;
    elsif v_q < 0 and m.origem = 'DEVOLUCAO_FORNECEDOR' and v_s + v_q > 0 and coalesce(m.custo_unitario, 0) > 0 then
      v_novo := round((v_s * v_c + v_q * m.custo_unitario) / (v_s + v_q), 6);   -- 231: tira as unidades ao custo da entrada
      if v_novo > 0 then v_c := v_novo; end if;
    end if;
    if m.tipo <> 'TRF' then v_s := v_s + v_q; end if;
  end loop;
  if v_prod is not null then v_prods := v_prods || v_prod; v_cmcs := v_cmcs || v_c; end if;

  return query
    select s.codigo_produto, s.codigo_local_estoque, round(s.saldo, 6), coalesce(c.cmc, 0)
      from (select e.codigo_produto, e.codigo_local_estoque, sum(e.quantidade) as saldo
              from estoque_movimentos e
             where e.loja_id = p_loja and e.data_ref <= p_data
             group by e.codigo_produto, e.codigo_local_estoque) s
      left join unnest(v_prods, v_cmcs) as c(codigo_produto, cmc) on c.codigo_produto = s.codigo_produto;
end $$;
revoke all on function public.posicao_proprio_em_data(bigint, date) from public, anon;
grant execute on function public.posicao_proprio_em_data(bigint, date) to authenticated, service_role;

-- Índice para a reconstrução do custo na ordem da data.
create index if not exists estoque_movimentos_produto_data on public.estoque_movimentos (loja_id, codigo_produto, data_ref, id);

notify pgrst, 'reload schema';

commit;
