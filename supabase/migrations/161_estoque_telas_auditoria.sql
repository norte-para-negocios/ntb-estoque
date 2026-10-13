-- 161 — "Nosso Omie" Fases 2 e 3 (telas de informação e auditoria do estoque): só índices e RLS, nenhum dado muda.
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md). Depende da 159 (kardex_omie) e da 160.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 161_estoque_telas_auditoria.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
--  1. kardex da loja inteira por período (/estoque/kardex, Saúde do estoque): índice por (loja, data, id_mov).
--  2. ajustes por período (/estoque/ajustes, Quem mexeu): índice por (loja, data).
--  3. RLS de kardex_omie/kardex_omie_carga no padrão initplan da 156 (a 159 criou no padrão "função por linha",
--     que fica lento numa leitura da loja inteira como usuário logado). Mesmas linhas visíveis.
--  4. primeiro_mov_apos(loja, data): 1º movimento DEPOIS da data por produto+local. O "saldo em data" usa para o
--     local que não teve movimento até a data (saldo antes = saldo_apos − quantidade); sem ele o saldo do produto
--     saía menor (só os locais com movimento até a data).

create index if not exists kardex_omie_loja_data_idx on public.kardex_omie (loja_id, data_mov desc, id_mov desc);
create index if not exists movimentos_loja_data_idx on public.movimentos (loja_id, data desc);

drop policy if exists kardex_omie_select_por_loja on public.kardex_omie;
create policy kardex_omie_select_por_loja on public.kardex_omie for select using (
  (select usuario_e_admin()) or loja_id in (select usuario_lojas())
);
drop policy if exists kardex_omie_carga_select_por_loja on public.kardex_omie_carga;
create policy kardex_omie_carga_select_por_loja on public.kardex_omie_carga for select using (
  (select usuario_e_admin()) or loja_id in (select usuario_lojas())
);

create or replace function public.primeiro_mov_apos(p_loja_id bigint, p_data date)
returns table (n_cod_prod bigint, codigo_local_estoque bigint, quantidade numeric, saldo_apos numeric, cmc_apos numeric, data_mov date)
language sql stable set search_path = public as $$
  select distinct on (k.n_cod_prod, k.codigo_local_estoque)
         k.n_cod_prod, k.codigo_local_estoque, k.quantidade, k.saldo_apos, k.cmc_apos, k.data_mov
  from kardex_omie k
  where k.loja_id = p_loja_id and k.data_mov > p_data and not k.cancelado
  order by k.n_cod_prod, k.codigo_local_estoque, k.data_mov, k.id_mov
$$;
revoke all on function public.primeiro_mov_apos(bigint, date) from public, anon;
grant execute on function public.primeiro_mov_apos(bigint, date) to authenticated;
