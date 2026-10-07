-- 144 — Estoque próprio: o custo médio é um só por produto, mas a projeção em posicao_estoques guarda o
-- n_cmc em cada linha (local). Quando uma entrada num local muda o custo médio, as linhas dos OUTROS locais
-- ficavam com o custo antigo e o Estoque Valorizado errava (achado do QA de 07/10/2026: R$ 5.008,02 na tela
-- contra R$ 5.008,53 somando saldo x custo médio). Aditiva; só toca lojas em modo 'proprio'.

create or replace function public.trg_estoque_custos_projeta_cmc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cmc is distinct from old.cmc then
    update posicao_estoques
       set n_cmc = new.cmc, updated_at = now()
     where loja_id = new.loja_id and n_cod_prod = new.codigo_produto
       and data_posicao = (now() at time zone 'America/Sao_Paulo')::date
       and n_cmc is distinct from new.cmc;
  end if;
  return null;
end $$;
drop trigger if exists estoque_custos_projeta_cmc on public.estoque_custos;
create trigger estoque_custos_projeta_cmc after update of cmc on public.estoque_custos
  for each row execute function public.trg_estoque_custos_projeta_cmc();

-- Projeção diária: além de criar as linhas que faltam, atualiza saldo e custo das que já existem no dia.
create or replace function public.projetar_posicao_dia(p_loja bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, c_codigo, c_descricao, n_saldo, fisico, n_cmc, estoque_minimo)
  select s.loja_id, s.codigo_local_estoque, s.codigo_produto, (now() at time zone 'America/Sao_Paulo')::date,
         pr.codigo, pr.descricao, s.saldo, s.saldo, c.cmc, coalesce(s.minimo, pr.estoque_minimo)
    from estoque_saldos s
    left join produtos pr on pr.loja_id = s.loja_id and pr.codigo_produto = s.codigo_produto
    left join estoque_custos c on c.loja_id = s.loja_id and c.codigo_produto = s.codigo_produto
   where s.loja_id = p_loja
  on conflict (loja_id, codigo_local_estoque, n_cod_prod, data_posicao)
  do update set n_saldo = excluded.n_saldo, fisico = excluded.fisico, n_cmc = excluded.n_cmc,
                estoque_minimo = excluded.estoque_minimo, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.projetar_posicao_dia(bigint) from public, anon, authenticated;
grant execute on function public.projetar_posicao_dia(bigint) to service_role;
