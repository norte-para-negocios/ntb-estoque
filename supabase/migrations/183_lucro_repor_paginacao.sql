-- 183: Lucro e "produtos a repor" sem o corte de 1.000 linhas do PostgREST (Fase A, Task 15; matriz N9/R1 e N5).
-- lucro_proprio: corpo de produção em 18/10/2026 (pg_get_functiondef, migration 150) + desempate por rótulo na ordem,
-- para a paginação (rpcTodos) não repetir nem pular linha. produtos_repor: sem produtos inativos, ordem por código
-- (paginação estável) e sem acesso anônimo. Mesmas assinaturas e saídas.
-- Tudo numa transação: se algo falhar, nada fica pela metade (os drop/create de função não se aplicam sozinhos).

begin;

create or replace function public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text DEFAULT 'produto'::text)
 RETURNS TABLE(rotulo text, quantidade numeric, faturamento numeric, cmv numeric, lucro numeric, margem numeric, itens_sem_baixa integer, itens_sem_custo integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with linhas as (
    select v.id as venda_id, v.data, i.linha, i.codigo_produto, coalesce(i.componentes, '{}'::bigint[]) as componentes,
           coalesce(nullif(i.nome, ''), i.codigo) as nome, i.quantidade as qtde, i.valor,
           coalesce(nullif(i.nome, ''), '') ~* '^taxa de servi' as taxa
      from vendas_proprio v join vendas_proprio_itens i on i.venda_id = v.id
     where v.loja_id = p_loja and v.data between p_ini and p_fim and not v.cancelado and not v.devolvido
  ), custos as (
    select c.* from vendas_proprio_cmv c where c.venda_id in (select distinct venda_id from linhas)
  ), candidatas as (
    -- o custo de um código vai para a linha que o vende ou o tem como componente (peso = quantidade)
    select c.venda_id, c.codigo_produto as cod, l.linha, l.qtde::numeric as peso
      from custos c join linhas l on l.venda_id = c.venda_id
       and (l.codigo_produto = c.codigo_produto or c.codigo_produto = any(l.componentes))
  ), destino_orfao as (
    -- linhas que recebem custo sem dono: as que não são taxa e não têm custo próprio (ex.: pizza sem código);
    -- se toda linha já tem custo próprio, todas as que não são taxa
    select l.*, bool_or(x.linha is null) over (partition by l.venda_id) as ha_livre, x.linha is null as livre
      from linhas l
      left join (select distinct venda_id, linha from candidatas) x on x.venda_id = l.venda_id and x.linha = l.linha
     where not l.taxa
  ), orfaos as (
    -- código sem linha (venda antiga sem componentes): rateado pelo valor, nunca some do relatório
    select c.venda_id, c.codigo_produto as cod, l.linha,
           case when sum(l.valor) over (partition by c.venda_id, c.codigo_produto) > 0 then l.valor else l.qtde end::numeric as peso
      from custos c join destino_orfao l on l.venda_id = c.venda_id and (l.livre or not l.ha_livre)
     where not exists (select 1 from candidatas x where x.venda_id = c.venda_id and x.cod is not distinct from c.codigo_produto)
  ), alocado as (
    select a.*, a.peso / nullif(sum(a.peso) over (partition by a.venda_id, a.cod), 0) as fracao
      from (select * from candidatas union all select * from orfaos) a
  ), por_linha as (
    select a.venda_id, a.linha, sum(c.cmv * coalesce(a.fracao, 0)) as cmv,
           sum(case when c.movimentos_sem_custo > 0 then 1 else 0 end) as sem_custo
      from alocado a join custos c on c.venda_id = a.venda_id and c.codigo_produto is not distinct from a.cod
     group by a.venda_id, a.linha
  ), base as (
    select l.*, p.descricao, coalesce(p.descricao_familia, pc.descricao_familia) as descricao_familia,
           coalesce(p.tipo_item, pc.tipo_item) as tipo_item, pl.cmv, pl.sem_custo,
           -- taxa de serviço não baixa estoque por natureza: não conta como "item sem baixa" (custo zero, margem 100%)
           (pl.venda_id is null and not l.taxa) as sem_baixa
      from linhas l
      left join por_linha pl on pl.venda_id = l.venda_id and pl.linha = l.linha
      left join produtos p on p.loja_id = p_loja and p.codigo_produto = l.codigo_produto
      left join produtos pc on l.codigo_produto is null and pc.loja_id = p_loja and pc.codigo_produto = l.componentes[1]
  )
  select case p_dim
           when 'familia' then coalesce(nullif(descricao_familia, ''), 'Sem família')
           when 'tipo' then rotulo_tipo_item(tipo_item)
           when 'dia' then to_char(data, 'YYYY-MM-DD')
           when 'mes' then to_char(data, 'YYYY-MM')
           else coalesce(nullif(descricao, ''), nullif(nome, ''), 'Produto não identificado') end as rotulo,
         sum(qtde) as quantidade,
         round(sum(valor), 2) as faturamento,
         round(sum(coalesce(cmv, 0)), 2) as cmv,
         round(sum(valor) - sum(coalesce(cmv, 0)), 2) as lucro,
         case when sum(valor) > 0 then round((sum(valor) - sum(coalesce(cmv, 0))) / sum(valor) * 100, 1) end as margem,
         count(*) filter (where sem_baixa)::int as itens_sem_baixa,
         count(*) filter (where not sem_baixa and coalesce(sem_custo, 0) > 0)::int as itens_sem_custo
    from base
   group by 1
   order by 4 desc nulls last, 1 -- 183: ordem total, a tela lê em páginas de 1.000
$function$;

create or replace function public.produtos_repor(p_loja_id bigint)
 returns setof bigint
 language sql
 stable
as $function$
  with ultima as (
    select max(data_posicao) as d from posicao_estoques where loja_id = p_loja_id
  ),
  pos as (
    select n_cod_prod, sum(n_saldo) as saldo, sum(estoque_minimo) as min_omie
    from posicao_estoques, ultima
    where loja_id = p_loja_id and data_posicao = ultima.d
    group by n_cod_prod
  )
  select p.codigo_produto
  from produtos p
  join pos on pos.n_cod_prod = p.codigo_produto
  left join previsao_venda pv on pv.loja_id = p.loja_id
    and pv.n_cod_prod = p.codigo_produto
    and pv.janela_dias = 7
  where p.loja_id = p_loja_id
    and coalesce(p.inativo, false) = false
    and coalesce(p.estoque_minimo, pos.min_omie) > 0
    and greatest(0, coalesce(p.estoque_minimo, pos.min_omie) + coalesce(pv.qtde, 0) - pos.saldo) > 0
  order by p.codigo_produto;
$function$;

revoke execute on function public.produtos_repor(bigint) from public, anon;
grant execute on function public.produtos_repor(bigint) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
