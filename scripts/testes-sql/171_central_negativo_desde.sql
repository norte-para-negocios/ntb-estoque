-- Teste da função central_negativo_desde (migration 171). Rodar numa cópia local (nunca em produção).
-- Produto 1/local 9: positivo → negativo em 05/10 → positivo 07/10 → negativo desde 10/10 (trecho atual).
-- Produto 2/local 9: negativo em toda a janela e já era negativo antes (começa antes).
-- Produto 3/local 9: era positivo antes da 1ª linha e ficou negativo nela (desde a 1ª).
-- Produto 4/local 9: termina positivo (fora).
insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, quantidade, saldo_apos, cancelado) values
 (5, 1, 1, 9, '2026-10-01', 5, 5, false), (5, 2, 1, 9, '2026-10-05', -8, -3, false), (5, 3, 1, 9, '2026-10-07', 10, 7, false),
 (5, 4, 1, 9, '2026-10-10', -9, -2, false), (5, 5, 1, 9, '2026-10-11', -1, -3, false),
 (5, 6, 2, 9, '2026-10-02', -1, -4, false), (5, 7, 2, 9, '2026-10-03', -1, -5, false),
 (5, 8, 3, 9, '2026-10-04', -6, -1, false), (5, 9, 3, 9, '2026-10-06', -1, -2, false),
 (5, 10, 4, 9, '2026-10-04', -6, -1, false), (5, 11, 4, 9, '2026-10-06', 5, 4, false),
 (5, 12, 1, 9, '2026-10-12', -100, -103, true);
do $$
declare r record; n int := 0;
begin
  for r in select * from central_negativo_desde(5, array[1,2,3,4]::bigint[], '2026-09-30') order by n_cod_prod loop
    n := n + 1;
    if r.n_cod_prod = 1 and not (r.desde = '2026-10-10' and not r.comeca_antes) then raise exception 'produto 1: %', r; end if;
    if r.n_cod_prod = 2 and not (r.desde = '2026-10-02' and r.comeca_antes) then raise exception 'produto 2: %', r; end if;
    if r.n_cod_prod = 3 and not (r.desde = '2026-10-04' and not r.comeca_antes) then raise exception 'produto 3: %', r; end if;
    if r.n_cod_prod = 4 then raise exception 'produto 4 não devia aparecer'; end if;
  end loop;
  if n <> 3 then raise exception 'esperava 3 linhas, veio %', n; end if;
  raise notice 'central_negativo_desde OK';
end $$;
