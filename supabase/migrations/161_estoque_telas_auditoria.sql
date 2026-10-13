-- 161 — "Nosso Omie" Fases 2 e 3 (telas de informação e auditoria do estoque): só índices e RLS, nenhum dado muda.
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md). Depende da 159 (kardex_omie) e da 160.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 161_estoque_telas_auditoria.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
--  1. kardex da loja inteira por período (/estoque/kardex, Saúde do estoque): índice por (loja, data, id_mov).
--  2. ajustes por período (/estoque/ajustes, Quem mexeu): índice por (loja, data).
--  3. RLS de kardex_omie/kardex_omie_carga no padrão initplan da 156 (a 159 criou no padrão "função por linha",
--     que fica lento numa leitura da loja inteira como usuário logado). Mesmas linhas visíveis.

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
