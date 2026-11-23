-- 478 — Maquininha (adquirente do cartão) em cada pagamento da venda de estoque próprio (ex.: ODARA, que não usa Omie).
-- O caixa do Norte Vendas grava payment_details.methods[].acquirer (getnet, rede, cielo, stone, pagseguro, mercadopago, sumup) e o
-- fechamento de faturamento passa a mandar `maquininha` por pagamento. Aqui: coluna nova (opcional) e registrar_venda_proprio a grava.
-- Payload antigo, sem o campo, continua valendo (maquininha = null). Mesma assinatura da 150 (create or replace, sem overload).
alter table public.vendas_proprio_pagamentos add column if not exists maquininha text;

create or replace function public.registrar_venda_proprio(p_loja bigint, p_venda jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_modo text; v_id bigint; v_cupom bigint; v_existia boolean; v_data date; v_item jsonb; v_pag jsonb; v_linha int := 0; v_seq int := 0;
  v_ref text := p_venda ->> 'pedidoRef';
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if v_ref is null or btrim(v_ref) = '' then raise exception 'pedidoRef é obrigatório' using errcode = '22023'; end if;
  v_data := coalesce((p_venda ->> 'data')::date, (now() at time zone 'America/Sao_Paulo')::date);

  perform pg_advisory_xact_lock(hashtext('venda_proprio:' || p_loja || ':' || v_ref));
  select id, n_id_cupom into v_id, v_cupom from vendas_proprio where loja_id = p_loja and pedido_ref = v_ref;
  v_existia := v_id is not null;

  if v_existia then
    update vendas_proprio set data = v_data, hora = p_venda ->> 'hora', tipo = p_venda ->> 'tipo', mesa = p_venda ->> 'mesa',
           valor = coalesce((p_venda ->> 'valor')::numeric, 0), desconto = coalesce((p_venda ->> 'desconto')::numeric, 0),
           taxa = coalesce((p_venda ->> 'taxa')::numeric, 0), cancelado = coalesce((p_venda ->> 'cancelado')::boolean, false),
           devolvido = coalesce((p_venda ->> 'devolvido')::boolean, false), operador = p_venda ->> 'operador',
           nota_chave = p_venda #>> '{nota,chave}', nota_numero = p_venda #>> '{nota,numero}', nota_serie = p_venda #>> '{nota,serie}',
           nota_status = p_venda #>> '{nota,status}', frio_enviado_em = null, updated_at = now()
     where id = v_id;
    delete from vendas_proprio_itens where venda_id = v_id;
    delete from vendas_proprio_pagamentos where venda_id = v_id;
  else
    insert into vendas_proprio (loja_id, pedido_ref, data, hora, tipo, mesa, valor, desconto, taxa, cancelado, devolvido, operador,
                                nota_chave, nota_numero, nota_serie, nota_status)
    values (p_loja, v_ref, v_data, p_venda ->> 'hora', p_venda ->> 'tipo', p_venda ->> 'mesa',
            coalesce((p_venda ->> 'valor')::numeric, 0), coalesce((p_venda ->> 'desconto')::numeric, 0), coalesce((p_venda ->> 'taxa')::numeric, 0),
            coalesce((p_venda ->> 'cancelado')::boolean, false), coalesce((p_venda ->> 'devolvido')::boolean, false), p_venda ->> 'operador',
            p_venda #>> '{nota,chave}', p_venda #>> '{nota,numero}', p_venda #>> '{nota,serie}', p_venda #>> '{nota,status}')
    returning id, n_id_cupom into v_id, v_cupom;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_venda -> 'itens', '[]'::jsonb)) loop
    v_linha := v_linha + 1;
    insert into vendas_proprio_itens (venda_id, linha, codigo, codigo_produto, nome, quantidade, valor_unitario, desconto, valor, ncm, cfop, componentes)
    values (v_id, coalesce((v_item ->> 'linha')::int, v_linha), v_item ->> 'codigo',
            (select pr.codigo_produto from produtos pr where pr.loja_id = p_loja and pr.codigo = v_item ->> 'codigo' limit 1),
            v_item ->> 'nome', coalesce((v_item ->> 'quantidade')::numeric, 0), coalesce((v_item ->> 'valorUnitario')::numeric, 0),
            coalesce((v_item ->> 'desconto')::numeric, 0),
            coalesce((v_item ->> 'valor')::numeric, coalesce((v_item ->> 'valorUnitario')::numeric, 0) * coalesce((v_item ->> 'quantidade')::numeric, 0) - coalesce((v_item ->> 'desconto')::numeric, 0)),
            v_item ->> 'ncm', v_item ->> 'cfop',
            (select array_agg(pr.codigo_produto order by c.ord)
               from jsonb_array_elements_text(case when jsonb_typeof(v_item -> 'componentes') = 'array' then v_item -> 'componentes' else '[]'::jsonb end) with ordinality c(cod, ord)
               join produtos pr on pr.loja_id = p_loja and pr.codigo = c.cod))
    on conflict (venda_id, linha) do update set codigo = excluded.codigo, codigo_produto = excluded.codigo_produto, nome = excluded.nome,
         quantidade = excluded.quantidade, valor_unitario = excluded.valor_unitario, desconto = excluded.desconto, valor = excluded.valor,
         componentes = excluded.componentes;
  end loop;

  for v_pag in select * from jsonb_array_elements(coalesce(p_venda -> 'pagamentos', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    insert into vendas_proprio_pagamentos (venda_id, sequencia, metodo, tipo_doc, valor, bandeira, maquininha)
    values (v_id, coalesce((v_pag ->> 'sequencia')::int, v_seq), v_pag ->> 'metodo', sigla_forma_pgto(v_pag ->> 'metodo'),
            coalesce((v_pag ->> 'valor')::numeric, 0), v_pag ->> 'bandeira', nullif(left(btrim(coalesce(v_pag ->> 'maquininha', '')), 40), ''))
    on conflict (venda_id, sequencia) do update set metodo = excluded.metodo, tipo_doc = excluded.tipo_doc, valor = excluded.valor, bandeira = excluded.bandeira, maquininha = excluded.maquininha;
  end loop;

  perform recalcular_faturamento_proprio(p_loja, to_char(v_data, 'YYYY-MM'));
  return jsonb_build_object('ok', true, 'venda_id', v_id, 'n_id_cupom', v_cupom, 'duplicado', v_existia);
end $function$;
