-- 241 — Fase C2: lead time por fornecedor (estoque próprio) e requisições na entrada prevista da sugestão.
-- Depende da 240 (requisicoes_compra) e da 201 (sugestao_compra_proprio, recriada aqui com a MESMA assinatura e as
-- mesmas colunas + lead_time_origem e entrada_requisicoes; o TS antigo ignora as chaves novas).
--   lead time = produto (produto_compra_param) > fornecedor da última nota (fornecedor_compra_param) > vazio (1 dia, no TS).
--   entrada_requisicoes = itens (× fator) de requisições abertas/aprovadas com sugestão de entrega até o fim da estimativa
--   (Omie: "previsão de entradas = pedidos de compra + requisições + OPs"; hipótese H6 contar também a aberta).
-- O modo Omie (sugestao_compra_omie) não muda.
-- Aplicar (manual, com backup e OK do dono), depois da 240:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 241_lead_time_fornecedor.sql
-- Depois: NOTIFY pgrst; desktop/scripts/gerar-schema.sh.

begin;

create table if not exists public.fornecedor_compra_param (
  loja_id         bigint not null references public.lojas(id),
  fornecedor_id   bigint not null references public.fornecedores(id) on delete cascade,
  lead_time_dias  int not null check (lead_time_dias between 1 and 365),
  updated_by      text,
  updated_at      timestamptz not null default now(),
  primary key (loja_id, fornecedor_id)
);
alter table public.fornecedor_compra_param enable row level security;
drop policy if exists fornecedor_compra_param_select_por_loja on public.fornecedor_compra_param;
create policy fornecedor_compra_param_select_por_loja on public.fornecedor_compra_param for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.fornecedor_compra_param from anon, authenticated;
grant select on public.fornecedor_compra_param to authenticated;
grant all on public.fornecedor_compra_param to service_role;

-- p_dias null = tirar o prazo do fornecedor.
create or replace function public.fornecedor_lead_time_salvar(p_loja bigint, p_fornecedor bigint, p_dias int, p_user text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _pc_loja_propria(p_loja);
  if not exists (select 1 from fornecedores where id = p_fornecedor and loja_id = p_loja) then
    raise exception 'Fornecedor % não é desta loja', p_fornecedor using errcode = '22023';
  end if;
  if p_dias is null then
    delete from fornecedor_compra_param where loja_id = p_loja and fornecedor_id = p_fornecedor;
  elsif p_dias between 1 and 365 then
    insert into fornecedor_compra_param (loja_id, fornecedor_id, lead_time_dias, updated_by) values (p_loja, p_fornecedor, p_dias, p_user)
    on conflict (loja_id, fornecedor_id) do update set lead_time_dias = excluded.lead_time_dias, updated_by = excluded.updated_by, updated_at = now();
  else
    raise exception 'Prazo de entrega entre 1 e 365 dias' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sugestao_compra_proprio(p_loja bigint, p_ini date, p_fim date, p_proj_ini date, p_proj_fim date)
returns jsonb language sql stable security invoker set search_path = public as $$
with prod as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.descricao_familia as familia, pc.lead_time_dias as lead_time
    from produtos p left join produto_compra_param pc on pc.loja_id = p.loja_id and pc.codigo_produto = p.codigo_produto
   where p.loja_id = p_loja and not coalesce(p.inativo, false)
), cons as (
  -- saídas do período (venda, consumo de produção, ajuste para baixo); transferência entre locais não é consumo;
  -- saída estornada não conta (o estorno aponta para ela em reverses_id)
  select m.codigo_produto, sum(-m.quantidade) as s from estoque_movimentos m
   where m.loja_id = p_loja and m.data_ref between p_ini and p_fim and m.tipo in ('SAI', 'PRD', 'AJU') and m.quantidade < 0
     and m.reverses_id is null and not exists (select 1 from estoque_movimentos e where e.reverses_id = m.id)
   group by 1
), pos as (
  select s.codigo_produto, sum(s.saldo) as saldo, sum(coalesce(s.minimo, 0)) as minimo from estoque_saldos s where s.loja_id = p_loja group by 1
), cmc as (
  select codigo_produto, nullif(cmc, 0) as cmc from estoque_custos where loja_id = p_loja
), nfp as (
  -- nota do fornecedor já recebida no sistema e ainda não lançada no estoque ("faturado pelo fornecedor")
  select i.codigo_produto, sum(coalesce(i.quantidade_recebida, i.quantidade * i.fator)) as q
    from compras_proprio c join compras_proprio_itens i on i.compra_id = c.id
   where c.loja_id = p_loja and c.status in ('pendente', 'parcial') and not i.lancado and i.codigo_produto is not null
     and coalesce(i.movimenta_estoque, true)
   group by 1
), ped as (
  -- saldo dos pedidos aguardando/aprovados que ainda não está em nenhuma nota (o que já está em nota conta em nfp)
  select s.codigo_produto, sum(greatest(0, s.quantidade_base - s.vinculado)) as q
    from pedidos_compra_itens_situacao s join pedidos_compra pc on pc.id = s.pedido_id
   where pc.loja_id = p_loja and pc.etapa in ('aguardando_aprovacao', 'aprovado')
     and (pc.previsao_entrega is null or pc.previsao_entrega <= p_proj_fim)
   group by 1
), req as (
  -- 241: requisições abertas ou aprovadas com entrega até o fim da estimativa. A que virou pedido conta aqui enquanto o
  -- pedido é rascunho (ped só conta aguardando/aprovado); depois disso conta só em ped.
  select i.codigo_produto, sum(i.quantidade * i.fator) as q
    from requisicoes_compra r join requisicoes_compra_itens i on i.requisicao_id = r.id
    left join pedidos_compra pr on pr.id = i.pedido_id
   where r.loja_id = p_loja and (r.etapa in ('aberta', 'aprovada') or (r.etapa = 'pedido' and pr.etapa = 'rascunho'))
     and (r.sugestao_entrega is null or r.sugestao_entrega <= p_proj_fim)
   group by 1
), ops as (
  select * from _sugestao_ops_abertas(p_loja, p_proj_fim)
), opent as (
  select produto, sum(quantidade) as q from ops group by 1
), opcons as (
  select (it->>'nIdProdutoMalha')::bigint as insumo, sum(coalesce((it->>'nQtde')::numeric, 0)) as q
    from ops, jsonb_array_elements(ops.itens) it where (it->>'nIdProdutoMalha') ~ '^[0-9]+$' group by 1
), prev as (
  select * from _sugestao_previsao(p_loja, (p_proj_fim - p_proj_ini) + 1)
), ficha as (
  select codigo_produto from fichas_tecnicas where loja_id = p_loja and ativa
), ult as (
  select distinct on (i.codigo_produto) i.codigo_produto, c.fornecedor_nome, nullif(regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g'), '') as cnpj,
         coalesce(c.emissao, c.created_at::date) as data,
         coalesce(i.custo_unitario_base, round((i.valor_total - i.desconto) / nullif(i.quantidade * i.fator, 0), 6)) as custo
    from compras_proprio c join compras_proprio_itens i on i.compra_id = c.id
   where c.loja_id = p_loja and c.status <> 'cancelada' and i.codigo_produto is not null
   order by i.codigo_produto, coalesce(c.emissao, c.created_at::date) desc, c.id desc
), linhas as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.familia,
         coalesce(c.s, 0) as consumo_total, coalesce(pos.saldo, 0) as estoque_atual, coalesce(pos.minimo, 0) as estoque_minimo,
         coalesce(p.lead_time, fcp.lead_time_dias) as lead_time,   -- 241: do produto; senão do fornecedor da última nota
         case when p.lead_time is not null then 'produto' when fcp.lead_time_dias is not null then 'fornecedor' end as lead_time_origem,
         coalesce(req.q, 0) as entrada_requisicoes,
         coalesce(nfp.q, 0) as entrada_nf, coalesce(opent.q, 0) as entrada_ops, coalesce(ped.q, 0) as entrada_pedidos,
         coalesce(opcons.q, 0) as consumo_ops, coalesce(prev.qtde, 0) as previsao_qtde, coalesce(prev.dias, 0) as previsao_dias,
         (ficha.codigo_produto is not null) as tem_ficha,
         f.id as fornecedor_id, coalesce(ult.fornecedor_nome, f.razao_social) as fornecedor_nome, ult.cnpj as fornecedor_cnpj,
         ult.custo as ultimo_custo, ult.data as ultima_compra, cmc.cmc
    from prod p
    left join cons c on c.codigo_produto = p.codigo_produto
    left join pos on pos.codigo_produto = p.codigo_produto
    left join nfp on nfp.codigo_produto = p.codigo_produto
    left join ped on ped.codigo_produto = p.codigo_produto
    left join opent on opent.produto = p.codigo_produto
    left join opcons on opcons.insumo = p.codigo_produto
    left join prev on prev.n_cod_prod = p.codigo_produto
    left join ficha on ficha.codigo_produto = p.codigo_produto
    left join ult on ult.codigo_produto = p.codigo_produto
    left join cmc on cmc.codigo_produto = p.codigo_produto
    left join lateral (select f.id, f.razao_social from fornecedores f
                        where f.loja_id = p_loja and ult.cnpj is not null and regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g') = ult.cnpj
                        order by f.id limit 1) f on true
    left join fornecedor_compra_param fcp on fcp.loja_id = p_loja and fcp.fornecedor_id = f.id
    left join req on req.codigo_produto = p.codigo_produto
)
select coalesce(jsonb_agg(to_jsonb(l) order by l.codigo_produto), '[]'::jsonb) from linhas l
 where l.consumo_total <> 0 or l.estoque_minimo <> 0 or l.estoque_atual <> 0 or l.entrada_nf <> 0 or l.entrada_ops <> 0
    or l.entrada_pedidos <> 0 or l.consumo_ops <> 0 or l.entrada_requisicoes <> 0
$$;


revoke all on function public.fornecedor_lead_time_salvar(bigint, bigint, int, text) from public, anon, authenticated;
grant execute on function public.fornecedor_lead_time_salvar(bigint, bigint, int, text) to service_role;
revoke all on function public.sugestao_compra_proprio(bigint, date, date, date, date) from public, anon;
grant execute on function public.sugestao_compra_proprio(bigint, date, date, date, date) to authenticated, service_role;

commit;
