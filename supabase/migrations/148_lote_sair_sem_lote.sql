-- 148 — Correção da 145: saída de item sem nenhum lote (nunca abastecido, saldo indo a negativo) gravava o vínculo
-- com lote_id nulo e derrubava a venda/OP inteira ("null value in column lote_id"). Estoque negativo volta a ser permitido.
create or replace function public._lote_sair(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_preferido bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare v_rest numeric := p_qtd; v_tira numeric; l record; v_sem_lote bigint;
begin
  if p_qtd <= 0 then return; end if;
  if p_preferido is not null then
    select * into l from estoque_lotes
     where id = p_preferido and loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;
    if found and l.saldo > 0 then
      v_tira := least(l.saldo, v_rest);
      update estoque_lotes set saldo = saldo - v_tira, updated_at = now() where id = l.id;
      insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, l.id, -v_tira);
      v_rest := v_rest - v_tira;
    end if;
  end if;
  for l in
    select * from estoque_lotes
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and saldo > 0
       and not (lote is null and validade is null)
     order by validade nulls last, created_at, id
     for update
  loop
    exit when v_rest <= 0;
    v_tira := least(l.saldo, v_rest);
    update estoque_lotes set saldo = saldo - v_tira, updated_at = now() where id = l.id;
    insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, l.id, -v_tira);
    v_rest := v_rest - v_tira;
  end loop;
  if v_rest > 0 then
    -- "sem lote" é o último a sair e o único que pode ficar negativo (o ledger permite saldo negativo).
    -- O id vem ANTES do UPDATE: chamado dentro do WHERE, o _lote_sem_lote criava a linha depois do snapshot
    -- do UPDATE, nada era atualizado e o vínculo saía com lote_id nulo (venda de item nunca abastecido falhava).
    v_sem_lote := _lote_sem_lote(p_loja, p_local, p_produto);
    update estoque_lotes set saldo = saldo - v_rest, updated_at = now() where id = v_sem_lote;
    insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, v_sem_lote, -v_rest);
  end if;
end $$;

notify pgrst, 'reload schema';
