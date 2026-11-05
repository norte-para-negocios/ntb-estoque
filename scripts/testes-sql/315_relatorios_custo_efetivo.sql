-- Teste da migration 315 (relatórios leem o custo efetivo). CÓPIA local, nunca produção. Precisa da 311 e da 312; a 315
-- é aplicada NO MEIO deste arquivo (\i), para comparar a saída antes × depois. Rodar da raiz do repositório:
--   begin; \i supabase/migrations/311_custo_revisao.sql \i supabase/migrations/312_reprocessar_custo.sql
--          \i scripts/testes-sql/315_relatorios_custo_efetivo.sql rollback;
-- Espera: NOTICE "315 RELATORIOS CUSTO EFETIVO OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99315, '00000000099315', 'TESTE 315', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99315, 8000000031501, 'Loja', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, descricao_familia) values
  (99315, 8000000031511, '31511', 'Coca 315', 'UN', '00', 'BEBIDAS'),
  (99315, 8000000031512, '31512', 'Peixe 315', 'KG', '00', 'INSUMOS'),
  (99315, 8000000031513, '31513', 'Moqueca 315', 'UN', '04', 'PRATOS');

do $$
declare L bigint := 8000000031501; COCA bigint := 8000000031511; PEI bigint := 8000000031512; MOQ bigint := 8000000031513;
        v_f bigint; v1 bigint; v2 bigint; v3 bigint; r jsonb;
begin
  insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento) values (99315, MOQ, 1, 1) returning id into v_f;
  insert into ficha_tecnica_itens (ficha_id, loja_id, codigo_insumo, quantidade_liquida, ordem) values (v_f, 99315, PEI, 0.4, 1);
  perform registrar_movimento(99315, L, COCA, 'ENT', 'COMPRA', 'c0', 4, 5.00, null, null, 0, null, null, '2026-10-05');
  perform registrar_movimento(99315, L, PEI, 'ENT', 'COMPRA', 'c1', 10, 30.00, null, null, 0, null, null, '2026-10-05');
  insert into vendas_proprio (loja_id, pedido_ref, data, valor) values (99315, 'p315-1', '2026-10-20', 20) returning id into v1;
  insert into vendas_proprio (loja_id, pedido_ref, data, valor) values (99315, 'p315-2', '2026-10-21', 80) returning id into v2;
  insert into vendas_proprio (loja_id, pedido_ref, data, valor) values (99315, 'p315-3', '2026-10-22', 10) returning id into v3;
  insert into vendas_proprio_itens (venda_id, linha, codigo_produto, nome, quantidade, valor) values
    (v1, 1, COCA, 'Coca', 2, 20), (v2, 1, MOQ, 'Moqueca', 1, 80), (v3, 1, COCA, 'Coca', 1, 10);
  perform registrar_movimento(99315, L, COCA, 'SAI', 'VENDA', 'p315-1', 2, null, null, null, 0, null, null, '2026-10-20');
  perform consumo_por_receita(99315, MOQ, 1, L, 'p315-2', null, 1, 'VENDA');
  r := registrar_movimento(99315, L, COCA, 'SAI', 'VENDA', 'p315-3', 1, null, null, null, 0, null, null, '2026-10-22');
  perform estornar_movimento((r->>'id')::bigint, null, 'item devolvido');
  -- nota de 09/10 lançada agora com a data dela, ainda sem reprocessar
  perform registrar_movimento(99315, L, COCA, 'ENT', 'COMPRA', 'c2', 10, 4.00, null, null, 0, null, null, '2026-10-09');
end $$;

-- ANTES da 315 (definição de produção)
create temp table t315_lucro_antes on commit drop as
  select d.dim, l.* from unnest(array['produto', 'familia', 'tipo', 'dia', 'mes']) d(dim), lateral lucro_proprio(99315, '2026-10-01', '2026-10-31', d.dim) l;
create temp table t315_cmv_antes on commit drop as select * from vendas_proprio_cmv where loja_id = 99315;
create temp table t315_kardex_antes on commit drop as
  select x - 'revisado' - 'revisado_em' - 'custo_original' - 'data_ref_original' as linha
    from jsonb_array_elements(kardex_proprio(99315, '2026-10-01', '2026-11-30', p_limite => 1000)->'linhas') x;

\i supabase/migrations/315_relatorios_custo_efetivo.sql

do $$
declare n int; k jsonb;
begin
  -- 1) sem revisão: saída idêntica
  select count(*) into n from (
    (select d.dim, l.* from unnest(array['produto', 'familia', 'tipo', 'dia', 'mes']) d(dim), lateral lucro_proprio(99315, '2026-10-01', '2026-10-31', d.dim) l
     except select * from t315_lucro_antes)
    union all
    (select * from t315_lucro_antes
     except select d.dim, l.* from unnest(array['produto', 'familia', 'tipo', 'dia', 'mes']) d(dim), lateral lucro_proprio(99315, '2026-10-01', '2026-10-31', d.dim) l)) x;
  assert n = 0, 'lucro_proprio mudou sem revisão: ' || n;
  assert (select count(*) from t315_lucro_antes) = 10, 'linhas do lucro: 2 produtos + 2 famílias + 2 tipos + 3 dias + 1 mês';
  select count(*) into n from ((select * from vendas_proprio_cmv where loja_id = 99315 except select * from t315_cmv_antes)
                                union all (select * from t315_cmv_antes except select * from vendas_proprio_cmv where loja_id = 99315)) x;
  assert n = 0, 'vendas_proprio_cmv mudou sem revisão';
  select count(*) into n from ((select x - 'revisado' - 'revisado_em' - 'custo_original' - 'data_ref_original'
                                  from jsonb_array_elements(kardex_proprio(99315, '2026-10-01', '2026-11-30', p_limite => 1000)->'linhas') x
                                except select linha from t315_kardex_antes)
                                union all (select linha from t315_kardex_antes except select x - 'revisado' - 'revisado_em' - 'custo_original' - 'data_ref_original'
                                  from jsonb_array_elements(kardex_proprio(99315, '2026-10-01', '2026-11-30', p_limite => 1000)->'linhas') x)) y;
  assert n = 0, 'kardex_proprio mudou sem revisão';
  assert (select cmv from lucro_proprio(99315, '2026-10-01', '2026-10-31', 'produto') where rotulo = 'Coca 315') = 10, 'antes: coca a 5';

  -- 2) com revisão: o relatório devolve o custo novo
  perform reprocessar_custo(99315, array[8000000031511::bigint], '2026-10-09', 'nota atrasada');
  -- coca: (4·5 + 10·4)/14 = 4,285714 → 2 × 4,285714 = 8,57; a venda 3 foi estornada (par fora: 0)
  assert (select cmv from lucro_proprio(99315, '2026-10-01', '2026-10-31', 'produto') where rotulo = 'Coca 315') = 8.57,
    'lucro_proprio com o custo revisado: ' || (select cmv from lucro_proprio(99315, '2026-10-01', '2026-10-31', 'produto') where rotulo = 'Coca 315');
  assert (select cmv from lucro_proprio(99315, '2026-10-01', '2026-10-31', 'produto') where rotulo = 'Moqueca 315') = 12, 'moqueca (sem revisão) igual: 0,4 × 30';
  select x into k from jsonb_array_elements(kardex_proprio(99315, '2026-10-01', '2026-11-30', p_limite => 1000)->'linhas') x where x->>'ref' = 'p315-1';
  assert (k->>'revisado')::boolean and (k->>'custo')::numeric = 4.285714 and (k->>'custo_original')::numeric = 5, 'kardex mostra o custo revisado: ' || k::text;
  assert k->>'revisado_em' is not null, 'kardex traz quando foi revisado';
  raise notice '315 RELATORIOS CUSTO EFETIVO OK';
end $$;
