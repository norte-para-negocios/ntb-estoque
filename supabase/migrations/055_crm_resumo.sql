-- B.4: Totais agregados por parceiro (cards do detalhe do CRM).
-- Necessario porque um parceiro pode ter >500 contas (ex.: cliente consumidor
-- generico com milhares de titulos); somar no app limitaria a 500 linhas.

-- Totais de contas em aberto: cliente -> contas_receber, fornecedor -> contas_pagar
create or replace function crm_resumo_contas(p_loja_id bigint, p_codigo bigint, p_tipo text)
returns table(total numeric, atrasado numeric, qtd bigint)
language plpgsql stable security definer
as $$
begin
  if p_tipo = 'fornecedor' then
    return query
      select coalesce(sum(valor_documento), 0)::numeric,
             coalesce(sum(valor_documento) filter (where status_titulo = 'ATRASADO'), 0)::numeric,
             count(*)::bigint
      from contas_pagar
      where loja_id = p_loja_id and codigo_cliente_fornecedor = p_codigo;
  else
    return query
      select coalesce(sum(valor_documento), 0)::numeric,
             coalesce(sum(valor_documento) filter (where status_titulo = 'ATRASADO'), 0)::numeric,
             count(*)::bigint
      from contas_receber
      where loja_id = p_loja_id and codigo_cliente_fornecedor = p_codigo;
  end if;
end;
$$;

grant execute on function crm_resumo_contas(bigint, bigint, text) to authenticated, anon;

-- Total comprado e qtd de NFs de entrada de um fornecedor
create or replace function crm_fornecedor_nf(p_loja_id bigint, p_codigo bigint)
returns table(total numeric, qtd bigint)
language sql stable security definer
as $$
  select coalesce(sum(n_valor_nfe), 0)::numeric, count(*)::bigint
  from notas_fiscais
  where loja_id = p_loja_id and n_id_fornecedor = p_codigo and deleted_at is null;
$$;

grant execute on function crm_fornecedor_nf(bigint, bigint) to authenticated, anon;
