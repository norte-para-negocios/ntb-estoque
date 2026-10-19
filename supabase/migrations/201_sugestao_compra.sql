-- 201 — Fase C (paridade com o Omie): dados da Sugestão de Compra [I6], uma função por modo de estoque.
-- A fórmula fica em TS (lib/compras/sugestao-puro.ts, provada contra as 50 linhas capturadas do Omie em 17/10/2026);
-- aqui só os insumos dela, por produto. As funções são security invoker (o RLS de cada tabela vale para quem chama) e
-- devolvem UM jsonb (array) para não cair no corte de 1.000 linhas do PostgREST nem repetir a consulta por página.
-- SÓ ADITIVA. Depende da 200 (pedidos_compra_itens_situacao, usada no modo próprio).
-- Aplicar (manual, com backup e OK do dono), depois da 200:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 201_sugestao_compra.sql
-- Depois: NOTIFY pgrst; desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
-- Modo 'omie' (sugestao_compra_omie): consumo = movimentos_historico.saidas (as saídas oficiais do Omie, todos os locais);
--   estoque/mínimo = foto mais recente de posicao_estoques (mínimo = soma de todos os locais, incluindo a sentinela 0);
--   lead time = produtos.full_object.lead_time (cadastro do Omie); entrada prevista = notas do fornecedor ainda não
--   recebidas (etapa 40, quantidade em unidade de estoque itensAjustes.nQtdeRecebida — provado nos dados) + OPs abertas
--   do produto; consumo nas OPs abertas = ficha gravada na OP (itensDetalhes); fornecedor = o da última nota do produto.
-- Modo 'proprio' (sugestao_compra_proprio): consumo = saídas do ledger (SAI, PRD e AJU negativos) não estornadas;
--   estoque/mínimo = estoque_saldos; lead time = produto_compra_param (padrão 1 dia, no TS); entrada prevista = compras
--   pendentes (nota ainda não lançada) + saldo dos pedidos aguardando/aprovados ainda não vinculado a nota + OPs abertas.

begin;

insert into permissoes (nome) values ('Compras - Sugestao') on conflict (nome) do nothing;

-- Lead time de ressuprimento por produto (estoque próprio; no Omie vem do cadastro do produto no Omie).
create table if not exists public.produto_compra_param (
  loja_id         bigint not null references public.lojas(id),
  codigo_produto  bigint not null,
  lead_time_dias  int not null check (lead_time_dias between 1 and 365),
  updated_by      text,
  updated_at      timestamptz not null default now(),
  primary key (loja_id, codigo_produto),
  foreign key (codigo_produto, loja_id) references public.produtos(codigo_produto, loja_id)
);
alter table public.produto_compra_param enable row level security;
drop policy if exists produto_compra_param_select_por_loja on public.produto_compra_param;
create policy produto_compra_param_select_por_loja on public.produto_compra_param for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.produto_compra_param from anon, authenticated;
grant select on public.produto_compra_param to authenticated;
grant all on public.produto_compra_param to service_role;

-- Previsão de venda (previsao_venda tem janelas de 7/15/30 dias): a menor janela que cobre a estimativa, senão a maior.
create or replace function public._sugestao_previsao(p_loja bigint, p_dias int)
returns table (n_cod_prod bigint, qtde numeric, dias int)
language sql stable security invoker set search_path = public as $$
  select distinct on (v.n_cod_prod) v.n_cod_prod, v.qtde, coalesce(v.janela_dias, (v.periodo_fim - v.periodo_ini) + 1)::int
    from previsao_venda v
   where v.loja_id = p_loja and coalesce(v.janela_dias, (v.periodo_fim - v.periodo_ini) + 1) > 0
   order by v.n_cod_prod, (coalesce(v.janela_dias, (v.periodo_fim - v.periodo_ini) + 1) >= p_dias) desc,
            case when coalesce(v.janela_dias, (v.periodo_fim - v.periodo_ini) + 1) >= p_dias
                 then coalesce(v.janela_dias, (v.periodo_fim - v.periodo_ini) + 1) else -coalesce(v.janela_dias, (v.periodo_fim - v.periodo_ini) + 1) end
$$;

-- OPs em aberto com previsão até o fim da estimativa. Loja Omie com espelho completo: aberta_omie; senão concluida = false.
create or replace function public._sugestao_ops_abertas(p_loja bigint, p_proj_fim date)
returns table (produto bigint, quantidade numeric, itens jsonb)
language sql stable security invoker set search_path = public as $$
  select o.identificacao_n_cod_produto, coalesce(o.identificacao_n_qtde, o.quantidade, 0),
         case when jsonb_typeof(o.full_object->'itensDetalhes') = 'array' then o.full_object->'itensDetalhes' else '[]'::jsonb end
    from ordens_producao o join lojas l on l.id = o.loja_id
   where o.loja_id = p_loja
     and case when coalesce(l.espelho_completo, false) then coalesce(o.aberta_omie, false) else not coalesce(o.concluida, false) end
     and (o.identificacao_d_dt_previsao is null or o.identificacao_d_dt_previsao <= p_proj_fim)
$$;

create or replace function public.sugestao_compra_omie(p_loja bigint, p_ini date, p_fim date, p_proj_ini date, p_proj_fim date)
returns jsonb language sql stable security invoker set search_path = public as $$
with prod as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.descricao_familia as familia,
         case when (p.full_object->>'lead_time') ~ '^[0-9]+$' then (p.full_object->>'lead_time')::int end as lead_time
    from produtos p where p.loja_id = p_loja and not coalesce(p.inativo, false)
), cons as (
  select h.cod_prod, sum(coalesce(h.saidas, 0)) as s from movimentos_historico h
   where h.loja_id = p_loja and h.data between p_ini and p_fim group by 1
), foto as (
  select max(data_posicao) as d from posicao_estoques where loja_id = p_loja and codigo_local_estoque <> 0
), pos as (
  select pe.n_cod_prod, sum(pe.n_saldo) filter (where pe.codigo_local_estoque <> 0) as saldo, sum(coalesce(pe.estoque_minimo, 0)) as minimo,
         max(pe.n_cmc) filter (where pe.n_cmc > 0 and pe.n_cmc < 10000000) as cmc   -- custo médio do Omie (fora de (0, 1e7) = suspeito)
    from posicao_estoques pe join foto on pe.data_posicao = foto.d where pe.loja_id = p_loja group by 1
), nf_itens as (
  select i.n_id_produto, n.id as nota_id, n.c_etapa, n.d_emissao_nfe, n.n_id_fornecedor, coalesce(nullif(btrim(n.c_razao_social), ''), n.c_nome) as nome,
         coalesce(nullif((i.full_object->'itensAjustes'->>'nQtdeRecebida')::numeric, 0), i.n_qtde_nfe) as qtd_estoque,
         coalesce(i.v_total_item, i.n_qtde_nfe * i.n_preco_unit) as valor,
         coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') as nao_mov
    from notas_fiscais n join nota_fiscal_items i on i.nota_fiscal_id = n.id
   where n.loja_id = p_loja and n.deleted_at is null and n.c_etapa in ('40', '60')
     and coalesce(n.full_object->'infoCadastro'->>'cCancelada', 'N') <> 'S'
     and i.n_id_produto is not null and coalesce(i.c_ignorar_item, 'N') <> 'S'
), nfp as (
  select n_id_produto, sum(qtd_estoque) as q from nf_itens where c_etapa = '40' and nao_mov <> 'S' group by 1
), ult as (
  select distinct on (n_id_produto) n_id_produto, n_id_fornecedor, nome, d_emissao_nfe,
         case when qtd_estoque > 0 then round(valor / qtd_estoque, 6) end as custo
    from nf_itens order by n_id_produto, d_emissao_nfe desc nulls last, nota_id desc
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
  select distinct codigo_produto from estrutura_produto_cache where loja_id = p_loja
), linhas as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.familia,
         coalesce(c.s, 0) as consumo_total, coalesce(pos.saldo, 0) as estoque_atual, coalesce(pos.minimo, 0) as estoque_minimo,
         p.lead_time, coalesce(nfp.q, 0) as entrada_nf, coalesce(opent.q, 0) as entrada_ops, 0::numeric as entrada_pedidos,
         coalesce(opcons.q, 0) as consumo_ops, coalesce(prev.qtde, 0) as previsao_qtde, coalesce(prev.dias, 0) as previsao_dias,
         (ficha.codigo_produto is not null) as tem_ficha,
         f.id as fornecedor_id, coalesce(ult.nome, f.razao_social) as fornecedor_nome,
         nullif(regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g'), '') as fornecedor_cnpj,
         ult.custo as ultimo_custo, ult.d_emissao_nfe as ultima_compra, pos.cmc
    from prod p
    left join cons c on c.cod_prod = p.codigo_produto
    left join pos on pos.n_cod_prod = p.codigo_produto
    left join nfp on nfp.n_id_produto = p.codigo_produto
    left join opent on opent.produto = p.codigo_produto
    left join opcons on opcons.insumo = p.codigo_produto
    left join prev on prev.n_cod_prod = p.codigo_produto
    left join ficha on ficha.codigo_produto = p.codigo_produto
    left join ult on ult.n_id_produto = p.codigo_produto
    left join fornecedores f on f.loja_id = p_loja and f.codigo_omie = ult.n_id_fornecedor
)
select coalesce(jsonb_agg(to_jsonb(l) order by l.codigo_produto), '[]'::jsonb) from linhas l
 where l.consumo_total <> 0 or l.estoque_minimo <> 0 or l.estoque_atual <> 0 or l.entrada_nf <> 0 or l.entrada_ops <> 0 or l.consumo_ops <> 0
$$;

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
         p.lead_time, coalesce(nfp.q, 0) as entrada_nf, coalesce(opent.q, 0) as entrada_ops, coalesce(ped.q, 0) as entrada_pedidos,
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
)
select coalesce(jsonb_agg(to_jsonb(l) order by l.codigo_produto), '[]'::jsonb) from linhas l
 where l.consumo_total <> 0 or l.estoque_minimo <> 0 or l.estoque_atual <> 0 or l.entrada_nf <> 0 or l.entrada_ops <> 0
    or l.entrada_pedidos <> 0 or l.consumo_ops <> 0
$$;

do $$ declare f text; begin
  foreach f in array array['_sugestao_previsao(bigint, int)', '_sugestao_ops_abertas(bigint, date)',
                           'sugestao_compra_omie(bigint, date, date, date, date)', 'sugestao_compra_proprio(bigint, date, date, date, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

commit;
