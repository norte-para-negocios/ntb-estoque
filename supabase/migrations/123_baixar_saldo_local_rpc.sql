-- Função atômica pra baixar_saldo_local -- corrige achado da revisão da
-- Task 2 (docs/superpowers/specs/2026-08-18-estoque-independente-omie-lojas-teste-design.md):
-- o padrão anterior (select saldo, depois upsert saldo-delta) tinha race
-- condition real sob concorrência (lost update). UPDATE...SET saldo =
-- saldo - delta num único statement é atômico de verdade no Postgres.
-- INSERT ... ON CONFLICT DO UPDATE cobre tanto "produto ainda sem linha"
-- quanto "já tem saldo" numa única chamada.
create or replace function baixar_saldo_local(
  p_loja_id bigint,
  p_codigo_produto bigint,
  p_quantidade numeric
) returns numeric
language sql
security definer
set search_path = public
as $$
  insert into estoque_local_saldos (loja_id, codigo_produto, saldo, atualizado_em)
  values (p_loja_id, p_codigo_produto, -p_quantidade, now())
  on conflict (loja_id, codigo_produto)
  do update set saldo = estoque_local_saldos.saldo - p_quantidade, atualizado_em = now()
  returning saldo;
$$;

revoke all on function baixar_saldo_local(bigint, bigint, numeric) from public;
grant execute on function baixar_saldo_local(bigint, bigint, numeric) to service_role;
