-- Teste da 146 (roda dentro de BEGIN ... ROLLBACK junto com a migration): índices existem e o planner
-- consegue usá-los num ilike '%texto%' quando a varredura sequencial está desligada.
do $$
declare n int; plano text;
begin
  select count(*) into n from pg_indexes where indexname in
    ('estoque_movimentos_ref_trgm','estoque_movimentos_obs_trgm','estoque_movimentos_user_trgm','estoque_movimentos_trf_trgm','produtos_descricao_trgm','produtos_codigo_trgm');
  assert n = 6, 'indices trgm: ' || n;
  set local enable_seqscan = off;
  execute 'explain select id from estoque_movimentos where ref ilike ''%odara%''' into plano;
  assert plano ilike '%trgm%' or plano ilike '%Bitmap%', 'plano nao usa indice: ' || plano;
  raise notice 'KARDEX TRGM OK';
end $$;
