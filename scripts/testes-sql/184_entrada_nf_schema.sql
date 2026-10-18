-- Teste da migration 184 (esquema da entrada de nota completa, Fase B). Cópia local com o esquema público de produção
-- + Fase A (175–183) + 184. Nunca em produção.
do $$
declare v_loja bigint; v_compra bigint; it compras_proprio_itens%rowtype; n int; ch text := '29260999111222000149550220001310551123456781';
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 184', '00000000000184', 'proprio') returning id into v_loja;
  insert into compras_proprio (loja_id, origem, numero) values (v_loja, 'manual', '1') returning id into v_compra;

  -- (a) insert só com as colunas da 135: padrões novos
  insert into compras_proprio_itens (compra_id, loja_id, linha, quantidade, valor_unitario, valor_total)
    values (v_compra, v_loja, 1, 2, 5, 10) returning * into it;
  if it.movimenta_estoque is not true then raise exception '(a) movimenta_estoque = % (esperado true)', it.movimenta_estoque; end if;
  if it.gera_conta_pagar is not true then raise exception '(a) gera_conta_pagar = %', it.gera_conta_pagar; end if;
  if it.custo_icms is not null or it.valor_total_item is not null or it.cfop_entrada is not null then raise exception '(a) colunas novas não nulas: %', row_to_json(it); end if;
  if it.frete_cte <> 0 or it.aliq_cred_pis <> 0 or it.aliq_cred_cofins <> 0 then raise exception '(a) padrões numéricos: %', row_to_json(it); end if;

  -- (b) CFOP de saída recusado
  begin
    update compras_proprio_itens set cfop_entrada = '5102' where id = it.id;
    raise exception '(b) cfop 5102 aceito';
  exception when check_violation then null; end;

  -- (c) marcações: todas ou nenhuma
  begin
    update compras_proprio_itens set custo_icms = true where id = it.id;
    raise exception '(c) só custo_icms aceito';
  exception when check_violation then
    get stacked diagnostics ch = constraint_name;
    if ch <> 'compras_proprio_itens_flags_todas' then raise exception '(c) constraint %', ch; end if;
  end;
  ch := '29260999111222000149550220001310551123456781';
  update compras_proprio_itens set custo_icms = false, custo_icms_st = true, custo_ipi = true, custo_seguro = false, custo_pis = false,
         custo_cofins = false, custo_frete = false, custo_outras = false, cfop_entrada = '1102', quantidade_recebida = 24 where id = it.id;
  begin
    update compras_proprio_itens set quantidade_recebida = 0 where id = it.id;
    raise exception '(c) quantidade_recebida 0 aceita';
  exception when check_violation then null; end;

  -- (d) uma manifestação conclusiva em andamento/registrada por nota; a ciência não conta
  insert into sefaz_manifestacoes (loja_id, chave, tp_evento, status) values (v_loja, ch, '210210', 'registrada');
  insert into sefaz_manifestacoes (loja_id, chave, tp_evento, status) values (v_loja, ch, '210200', 'enviando');
  begin
    insert into sefaz_manifestacoes (loja_id, chave, tp_evento, status) values (v_loja, ch, '210200', 'enviando');
    raise exception '(d) 2ª conclusiva aceita';
  exception when unique_violation then null; end;
  insert into sefaz_manifestacoes (loja_id, chave, tp_evento, status) values (v_loja, ch, '210240', 'recusada');

  -- eventos, CT-e e busca por chave existem com os checks
  insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe) values (v_loja, v_compra, 'criada', '{}');
  begin
    insert into compras_proprio_eventos (loja_id, compra_id, tipo) values (v_loja, v_compra, 'xpto');
    raise exception 'evento xpto aceito';
  exception when check_violation then null; end;
  insert into sefaz_busca_chave (loja_id, chave, ultima_em) values (v_loja, ch, now());
  insert into compras_proprio_cte (loja_id, valor, origem) values (v_loja, 120, 'manual');
  insert into compras_proprio_cte_compra (cte_id, compra_id, loja_id, valor, percentual)
    select id, v_compra, v_loja, 120, 100 from compras_proprio_cte where loja_id = v_loja;
  update compras_proprio set conferida_em = now(), conferida_por = 'teste' where id = v_compra;

  -- (e) RLS nas 5 tabelas novas
  select count(*) into n from pg_policies where tablename in ('compras_proprio_eventos', 'sefaz_manifestacoes', 'sefaz_busca_chave', 'compras_proprio_cte', 'compras_proprio_cte_compra');
  if n <> 5 then raise exception '(e) políticas: % (esperado 5)', n; end if;
  if has_table_privilege('authenticated', 'sefaz_manifestacoes', 'INSERT') then raise exception '(e) authenticated pode inserir em sefaz_manifestacoes'; end if;
  if not exists (select 1 from permissoes where nome = 'Notas Fiscais - Manifestar na SEFAZ') then raise exception 'permissão nova ausente'; end if;
  raise notice '184 OK';
end $$;
