-- Volume sintético parecido com a ODARA de out/2026 (~4.000 movimentos: ~2.400 PRD, ~1.150 vendas, ~450 compras, uma
-- parte das notas lançada dias depois com a data delas) para medir o pior caso de reprocessar_custo. Só na CÓPIA local,
-- depois da 311 e da 312 (e da 314, se for medir com ela). Não tem asserts: quem confere é o chamador
-- (tempo + comparação com lib/estoque/reprocessar-custo-puro.ts por scripts/testes-sql/312_comparar_ts.mjs).
-- Loja 99330: 60 insumos, 20 PIs (2-3 insumos), 40 pratos (1 PI + 1-2 insumos), 21 dias.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99330, '00000000099330', 'VOLUME 312', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99330, 1, 'Estoque', 'S'), (99330, 2, 'Cozinha', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item)
select 99330, g, 'V' || g, 'Volume ' || g, 'UN', case when g <= 60 then '00' when g <= 80 then '06' else '04' end
  from generate_series(1, 120) g;

do $$
declare d date; i int; k int; v_prato int; v_pi int; v_ins int; v_ref text; v_n int := 0; v_atraso int;
        pend_d date[] := '{}'; pend_p int[] := '{}'; pend_q numeric[] := '{}'; pend_c numeric[] := '{}';
begin
  perform setseed(0.311);
  for d in select generate_series('2026-10-13'::date, '2026-11-02'::date, '1 day')::date loop
    -- ~22 compras por dia; 1/3 delas chega atrasada (lançada no fim, com a data da nota)
    for i in 1..22 loop
      v_ins := 1 + floor(random() * 60)::int;
      if random() < 0.33 then
        pend_d := pend_d || d; pend_p := pend_p || v_ins; pend_q := pend_q || (5 + floor(random() * 20))::numeric;
        pend_c := pend_c || round((1 + random() * 30)::numeric, 2);
      else
        perform registrar_movimento(99330, 1, v_ins, 'ENT', 'COMPRA', format('c%s-%s', d, i), (5 + floor(random() * 20))::numeric, round((1 + random() * 30)::numeric, 2),
                                    null, null, 0, null, null, d);
      end if;
      -- transferência para a cozinha
      if random() < 0.12 then
        perform registrar_movimento(99330, 1, v_ins, 'TRF', 'TRANSFERENCIA', format('t%s-%s', d, i), -2, null, null, null, 0, null, format('t%s-%s', d, i), d);
        perform registrar_movimento(99330, 2, v_ins, 'TRF', 'TRANSFERENCIA', format('t%s-%s', d, i), 2, null, null, null, 0, null, format('t%s-%s', d, i), d);
      end if;
    end loop;
    -- ~10 OPs de PI por dia (2-3 insumos cada)
    for i in 1..10 loop
      v_pi := 61 + floor(random() * 20)::int; v_ref := format('opi%s-%s', d, i);
      for k in 0..(1 + (v_pi % 2)) loop
        perform registrar_movimento(99330, 2, 1 + ((v_pi * 7 + k * 13) % 60), 'PRD', 'PRODUCAO', v_ref, -round((0.2 + random())::numeric, 3), null, null, null, 0, null, null, d);
      end loop;
      perform registrar_movimento(99330, 2, v_pi, 'PRD', 'PRODUCAO', v_ref, 4, null, null, null, 0, null, null, d);
    end loop;
    -- ~55 vendas por dia: OP do prato (1 PI + às vezes 1 insumo) e a venda
    for i in 1..55 loop
      v_prato := 81 + floor(random() * 40)::int; v_ref := format('opv%s-%s', d, i);
      perform registrar_movimento(99330, 2, 61 + (v_prato % 20), 'PRD', 'PRODUCAO', v_ref, -0.25, null, null, null, 0, null, null, d);
      if random() < 0.3 then
        perform registrar_movimento(99330, 2, 1 + ((v_prato * 11) % 60), 'PRD', 'PRODUCAO', v_ref, -0.3, null, null, null, 0, null, null, d);
      end if;
      perform registrar_movimento(99330, 2, v_prato, 'PRD', 'PRODUCAO', v_ref, 1, null, null, null, 0, null, null, d);
      perform registrar_movimento(99330, 2, v_prato, 'SAI', 'VENDA', format('v%s-%s', d, i), 1, null, null, null, 0, null, null, d);
    end loop;
  end loop;
  -- notas atrasadas: lançadas agora, com a data delas
  for i in 1..cardinality(pend_d) loop
    perform registrar_movimento(99330, 1, pend_p[i], 'ENT', 'COMPRA', format('atr-%s', i), pend_q[i], pend_c[i], null, null, 0, null, null, pend_d[i]);
  end loop;
  -- 2 entradas erradas estornadas (fardo)
  perform estornar_movimento((select id from estoque_movimentos where loja_id = 99330 and origem = 'COMPRA' order by id limit 1 offset 10), null, 'fardo');
  perform estornar_movimento((select id from estoque_movimentos where loja_id = 99330 and origem = 'COMPRA' order by id limit 1 offset 50), null, 'fardo');
  raise notice 'volume: % movimentos', (select count(*) from estoque_movimentos where loja_id = 99330);
end $$;
