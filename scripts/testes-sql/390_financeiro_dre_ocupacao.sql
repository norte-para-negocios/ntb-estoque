-- Teste da migration 390 (linha Ocupação na DRE e taxa de cartão nas deduções). Rodar com scripts/testes-sql/390_rodar.sh
-- (BEGIN … ROLLBACK, nada fica gravado). Escreve só na loja 19 "ZZ NORTE ERP LAB"; a ODARA (15) é só lida.
do $$
declare
  L constant bigint := 19; r jsonb; v_id bigint; v_ev int;
begin
  assert (select modo_estoque = 'proprio' and is_test from lojas where id = L), 'loja 19 tem de ser a loja-laboratório própria';

  -- 1) CHECK e fin_categoria_salvar aceitam a linha nova; linha inventada continua recusada
  r := fin_categoria_salvar(L, null, jsonb_build_object('nome', 'Condomínio teste 390', 'tipo', 'despesa', 'grupo_dre', 'despesa_ocupacao'), 'u-teste', 'Teste 390');
  v_id := (r->>'id')::bigint;
  assert (select grupo_dre from fin_categorias where id = v_id) = 'despesa_ocupacao', 'categoria nova em ocupação';
  begin perform fin_categoria_salvar(L, null, jsonb_build_object('nome', 'Inválida 390', 'grupo_dre', 'ocupacao_errada'));
    raise exception 'aceitou linha da DRE inválida';
  exception when sqlstate '22023' then null; end;
  begin insert into fin_categorias (loja_id, nome, grupo_dre) values (L, 'Direto 390', 'qualquer'); raise exception 'CHECK não barrou';
  exception when check_violation then null; end;

  -- 2) reclassificação: aluguel foi para ocupação; energia, mexida à mão antes da 390, ficou como o usuário deixou
  assert (select grupo_dre from fin_categorias where loja_id = L and padrao = 'oper_aluguel') = 'despesa_ocupacao', 'aluguel em ocupação';
  assert (select grupo_dre from fin_categorias where loja_id = L and padrao = 'oper_energia') = 'despesa_administrativa', 'escolha do usuário mantida';
  assert exists (select 1 from fin_eventos where loja_id = L and entidade = 'categoria' and user_nome = 'Migration 390'
                 and detalhe->>'grupo_dre' = 'despesa_ocupacao'), 'reclassificação vira evento';
  -- ODARA (só leitura dentro da transação): aluguel e energia padrão foram para ocupação
  assert (select count(*) from fin_categorias where loja_id = 15 and padrao in ('oper_aluguel', 'oper_energia') and grupo_dre = 'despesa_ocupacao') = 2,
    'ODARA: aluguel e energia em ocupação';

  -- 3) taxa de cartão nas deduções; a antiga vira "Tarifas bancárias" (financeiras)
  assert (select grupo_dre from fin_categorias where loja_id = L and padrao = 'ded_taxas_cartao') = 'deducoes', 'taxa de cartão em deduções';
  assert (select grupo_dre from fin_categorias where loja_id = 15 and padrao = 'ded_taxas_cartao') = 'deducoes', 'ODARA também ganha';
  assert (select nome || '|' || grupo_dre from fin_categorias where loja_id = L and padrao = 'fin_taxas') = 'Tarifas bancárias|despesa_financeira', 'tarifas bancárias';

  -- 4) idempotente: semear de novo não cria nada nem reclassifica de novo
  select count(*) into v_ev from fin_eventos where loja_id = L;
  assert fin_categorias_semear(L) = 0, 'semear de novo não cria nada';
  assert (select count(*) from fin_eventos where loja_id = L) = v_ev, 'nenhum evento novo';
  assert (select count(*) from fin_categorias where loja_id = L and padrao is not null) = 18, '18 categorias padrão';

  -- 5) permissões: só o servidor (service_role) chama
  assert not has_function_privilege('authenticated', 'fin_categoria_salvar(bigint,bigint,jsonb,text,text)', 'execute'), 'sem grant para authenticated';
  assert has_function_privilege('service_role', 'fin_categorias_semear(bigint)', 'execute'), 'service_role chama a semente';
  raise notice '390 DRE OCUPACAO OK';
end $$;
