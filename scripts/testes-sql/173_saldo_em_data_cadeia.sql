-- Teste de saldo_em_data / primeiro_mov_apos com a ordem do Omie (cadeia de saldo) — migration 173.
-- Rodar numa cópia local (nunca em produção). Linhas reais do kardex da loja 5 (produto 2453421862, local 2424369390):
--   31/08: compra +2 (2502,5→2504,5, id maior) e ajuste +2995,5 (2504,5→5500, id MENOR) → fim do dia = 5500.
--   15/09: nota +10 (4→14, id maior) e ajuste −11 (14→3, id MENOR) → fim do dia = 3; abertura = 4.
-- Produto 2: dia em ciclo (10→15→10) → cai no maior id_mov (fim = 10).
insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, quantidade, saldo_apos, cmc_apos, cancelado) values
 (5, 3811642145, 2453421862, 2424369390, '2026-08-31', 2995.5, 5500, 27.492109, false),
 (5, 3814628292, 2453421862, 2424369390, '2026-08-31', 2, 2504.5, 27.499334, false),
 (5, 3817519218, 2453421862, 2424369390, '2026-09-15', -11, 3, 27.494063, false),
 (5, 3827727948, 2453421862, 2424369390, '2026-09-15', 10, 14, 16.062589, false),
 (5, 1, 2, 9, '2026-09-01', 5, 15, 1, false),
 (5, 2, 2, 9, '2026-09-01', -5, 10, 1, false),
 (5, 3, 2, 9, '2026-09-02', 999, 99999, 1, true);
do $$
declare r record;
begin
  select * into r from saldo_em_data(5, '2026-08-31') where n_cod_prod = 2453421862;
  if r.saldo <> 5500 then raise exception '31/08: fim do dia devia ser 5500, veio %', r.saldo; end if;
  select * into r from saldo_em_data(5, '2026-09-20') where n_cod_prod = 2453421862;
  if r.saldo <> 3 then raise exception '15/09: fim do dia devia ser 3, veio %', r.saldo; end if;
  select * into r from saldo_em_data(5, '2026-09-05') where n_cod_prod = 2;
  if r.saldo <> 10 or r.id_mov <> 2 then raise exception 'ciclo: devia ser 10 (id 2), veio % (id %)', r.saldo, r.id_mov; end if;
  -- 1º movimento depois de 10/09 = abertura de 15/09 (saldo antes = 4)
  select * into r from primeiro_mov_apos(5, '2026-09-10') where n_cod_prod = 2453421862;
  if r.saldo_apos - r.quantidade <> 4 then raise exception '15/09: abertura devia ser 4, veio %', r.saldo_apos - r.quantidade; end if;
  raise notice 'saldo_em_data / primeiro_mov_apos (cadeia) OK';
end $$;
