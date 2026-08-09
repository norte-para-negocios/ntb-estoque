-- 105_movimentacao_preco_cache_delete_orfaos.sql
-- Achado real (revisão da Task 9 da auditoria de relatórios, 2026-08-09):
-- atualizar_preco_recente (migration 090) só faz UPSERT -- nunca DELETE. Se um
-- produto tinha exatamente 1 nota_fiscal_items com preço válido e essa NF é
-- cancelada depois (notas_fiscais.deleted_at setado), o produto some do
-- resultado do cálculo fresco (o WHERE já filtra deleted_at is null), mas a
-- linha antiga em produto_preco_recente nunca é tocada por nenhum UPSERT
-- seguinte -- fica presa pra sempre com o preço da NF cancelada. Divergência
-- permanente e silenciosa (exatamente o padrão que esta auditoria existe pra
-- achar), confirmada ao vivo antes deste fix: loja 5, sentido entradas, 6
-- produtos órfãos (3798014703, 3798020537, 3798811088, 2453990802, 3798808816,
-- 3798348118), R$927,05 de diferença total entre o cache e o cálculo fresco.
--
-- Fix: dentro da mesma chamada da função (mesma transação implícita), apaga
-- primeiro qualquer linha da loja que não tenha mais NENHUMA
-- nota_fiscal_items válida (não-cancelada, preço>0) pro código de produto --
-- só depois faz o upsert de quem sobrou/mudou (lógica idêntica à migration 090).
create or replace function atualizar_preco_recente(p_loja_id bigint)
returns void
language sql
as $$
  delete from produto_preco_recente pr
  where pr.loja_id = p_loja_id
    and not exists (
      select 1
      from nota_fiscal_items i
      join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
      where i.loja_id = p_loja_id
        and nf.deleted_at is null
        and i.n_preco_unit > 0
        and i.n_id_produto = pr.codigo_produto
    );

  insert into produto_preco_recente (loja_id, codigo_produto, preco_unit, atualizado_em)
  select distinct on (i.n_id_produto)
    p_loja_id, i.n_id_produto, i.n_preco_unit, now()
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  where i.loja_id = p_loja_id and nf.deleted_at is null and i.n_preco_unit > 0 and i.n_id_produto is not null
  order by i.n_id_produto, nf.d_emissao_nfe desc
  on conflict (loja_id, codigo_produto) do update
    set preco_unit = excluded.preco_unit, atualizado_em = excluded.atualizado_em;
$$;

-- Signature igual à migration 090 -- CREATE OR REPLACE preserva os grants
-- existentes, mas reafirma aqui por segurança/idempotência (mesmo padrão do
-- arquivo original).
revoke execute on function atualizar_preco_recente(bigint) from public;
revoke execute on function atualizar_preco_recente(bigint) from anon, authenticated;
grant  execute on function atualizar_preco_recente(bigint) to service_role;
