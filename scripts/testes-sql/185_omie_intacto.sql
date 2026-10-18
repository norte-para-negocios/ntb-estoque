-- Regressão do modo Omie na 185 (custo_estoque_item_omie recriada com o ramo do bloco `sefaz`). Rodar DUAS vezes numa
-- cópia LOCAL com itens de NF reais do Omie (loja 5, set/2026 — carga local a partir de ~/Projects/omie-rea/bruto/
-- nf_itens_loja5.csv.gz): 1ª vez ANTES de aplicar a 185 (guarda os números), aplicar a 185, 2ª vez DEPOIS (compara).
-- A tabela _teste_185_omie_intacto é só desta cópia local. Nunca em produção.
--
-- Consulta do P-MIG da 185 em produção (só leitura, lojas 2–7, antes e depois; os números têm de ser iguais):
--   select i.loja_id, md5(string_agg(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)::text, ',' order by i.id)),
--          (select valor_estoque from relatorio_compras_total(i.loja_id, '2026-09-01', '2026-09-30'))
--     from nota_fiscal_items i join notas_fiscais nf on nf.id = i.nota_fiscal_id
--    where i.loja_id between 2 and 7 and nf.d_emissao_nfe between '2026-09-01' and '2026-09-30' group by i.loja_id order by 1;
create table if not exists _teste_185_omie_intacto (loja_id bigint primary key, md5 text not null, compras numeric not null, itens int not null);
do $$
declare r record; antes _teste_185_omie_intacto%rowtype; v_md5 text; v_compras numeric; v_itens int; n int := 0;
begin
  for r in select distinct i.loja_id from nota_fiscal_items i join notas_fiscais nf on nf.id = i.nota_fiscal_id
            where i.loja_id between 2 and 7 and nf.d_emissao_nfe between '2026-09-01' and '2026-09-30' order by 1 loop
    select md5(string_agg(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)::text, ',' order by i.id)), count(*)
      into v_md5, v_itens
      from nota_fiscal_items i join notas_fiscais nf on nf.id = i.nota_fiscal_id
     where i.loja_id = r.loja_id and nf.d_emissao_nfe between '2026-09-01' and '2026-09-30';
    select valor_estoque into v_compras from relatorio_compras_total(r.loja_id, '2026-09-01', '2026-09-30');
    select * into antes from _teste_185_omie_intacto where loja_id = r.loja_id;
    if not found then
      insert into _teste_185_omie_intacto values (r.loja_id, v_md5, v_compras, v_itens);
      raise notice 'loja %: antes gravado (% itens, Compras set/2026 valor de estoque %)', r.loja_id, v_itens, v_compras;
    else
      if antes.md5 <> v_md5 or antes.compras <> v_compras or antes.itens <> v_itens then
        raise exception 'loja %: MUDOU (md5 % → %, Compras % → %, itens % → %)', r.loja_id, antes.md5, v_md5, antes.compras, v_compras, antes.itens, v_itens;
      end if;
      n := n + 1;
      raise notice 'loja %: igual (% itens, Compras set/2026 %)', r.loja_id, v_itens, v_compras;
    end if;
  end loop;
  if n > 0 then raise notice 'Omie intacto (md5 igual, Compras set/2026 igual)'; end if;
end $$;
