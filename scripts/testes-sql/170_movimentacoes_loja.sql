-- Teste da 170 (RPC movimentacoes_loja). Rodar numa cópia local com o esquema de produção e dados da loja 5 (nunca em produção).
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c4e94fe-93be-4914-84b1-263efdbbb7f2","role":"authenticated"}', true) \g /dev/null
\timing on
\set ON_ERROR_STOP 1
do $$
declare
  v_tot bigint; v_n bigint; v_ent numeric; v_sai numeric; v_ent_calc numeric; v_sai_calc numeric; r record; v_x numeric; v_y numeric; v_p bigint;
begin
  -- 1. total = numero de linhas (sem paginar) e totais batem com as linhas
  select max(total), count(*), max(entradas), max(saidas),
         sum(case when not contagem and quantidade > 0 then quantidade else 0 end),
         sum(case when not contagem and quantidade < 0 then -quantidade else 0 end)
    into v_tot, v_n, v_ent, v_sai, v_ent_calc, v_sai_calc
    from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_limit => 1000000);
  if v_tot is distinct from v_n then raise exception 'total % <> linhas %', v_tot, v_n; end if;
  if v_n < 1000 then raise exception 'poucas linhas: %', v_n; end if;
  if round(v_ent, 3) <> round(v_ent_calc, 3) or round(v_sai, 3) <> round(v_sai_calc, 3) then raise exception 'totais % % <> % %', v_ent, v_sai, v_ent_calc, v_sai_calc; end if;
  -- 2. todas as origens aparecem
  for r in select o from unnest(array['pdv','op_producao','op_consumo','inventario']) o loop
    if not exists (select 1 from movimentacoes_loja(5, '2026-09-01', '2026-10-07', p_origem => r.o, p_limit => 1)) then raise exception 'origem % sem linhas', r.o; end if;
  end loop;
  -- 3. consumo de OP = soma da ficha gravada nas OPs concluidas no periodo (insumo mais usado)
  select (i->>'nIdProdutoMalha')::bigint into v_p from ordens_producao o, jsonb_array_elements(o.full_object->'itensDetalhes') i
   where o.loja_id = 5 and o.concluida and o.dt_conclusao_real between '2026-10-01' and '2026-10-07' group by 1 order by count(*) desc limit 1;
  select -sum(quantidade) into v_x from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_produtos => array[v_p], p_origem => 'op_consumo', p_limit => 100000);
  select sum((i->>'nQtde')::numeric) into v_y from ordens_producao o, jsonb_array_elements(o.full_object->'itensDetalhes') i
   where o.loja_id = 5 and o.concluida and o.dt_conclusao_real between '2026-10-01' and '2026-10-07'
     and (i->>'nIdProdutoMalha')::bigint = v_p;
  if v_x is null or round(v_x,3) <> round(v_y,3) then raise exception 'consumo % % <> %', v_p, v_x, v_y; end if;
  -- 4. NF sempre entrada (+), com doc nf
  if exists (select 1 from movimentacoes_loja(5, '2026-06-01', '2026-10-07', p_origem => 'nf', p_limit => 100000) where quantidade <= 0 or doc_tipo <> 'nf' or doc_id is null) then raise exception 'NF com sinal/doc errado'; end if;
  if not exists (select 1 from movimentacoes_loja(5, '2026-06-01', '2026-10-07', p_origem => 'nf', p_limit => 1)) then raise exception 'nenhuma NF'; end if;
  -- 5. filtro de produto/local/doc/autor
  if exists (select 1 from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_produtos => array[2469498669]::bigint[], p_limit => 100000) where n_cod_prod <> 2469498669) then raise exception 'filtro produto'; end if;
  select codigo_local_estoque into v_x from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_limit => 1) ;
  if exists (select 1 from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_local => v_x::bigint, p_limit => 100000) where codigo_local_estoque <> v_x and local_destino is distinct from v_x::bigint) then raise exception 'filtro local'; end if;
  if exists (select 1 from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_doc => '0039', p_limit => 100000) where doc_rotulo not ilike '%0039%') then raise exception 'filtro doc'; end if;
  -- 6. paginacao estavel: pagina 1 + pagina 2 = primeiras 200 sem repetir
  select count(distinct chave) into v_n from (
    select chave from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_limit => 100, p_offset => 0)
    union all select chave from movimentacoes_loja(5, '2026-10-01', '2026-10-07', p_limit => 100, p_offset => 100)) s;
  if v_n <> 200 then raise exception 'paginacao repetiu: %', v_n; end if;
  -- 7. contagem (SLD) marcada e fora dos totais
  if exists (select 1 from movimentacoes_loja(5, '2026-09-01', '2026-10-07', p_origem => 'inventario', p_limit => 100000) where not contagem) then raise exception 'SLD sem contagem'; end if;
  raise notice 'OK: % linhas na semana, entradas %, saidas %', v_tot, v_ent, v_sai;
end $$;
rollback;
