-- 137 — Inventário existente também funciona em loja de estoque próprio (06/10/2026).
-- A tela, a lista, o PDF e o Excel continuam lendo inventarios / inventario_items. Em loja 'proprio' o "envio"
-- do item lança um ajuste (AJU) no ledger em vez de chamar o Omie. Esta migration só acrescenta colunas:
--   inventario_items.motivo     motivo da diferença (obrigatório acima do limite de valor da loja)
--   inventario_items.diferenca  diferença lançada (contado − saldo no momento do envio), na unidade base
--   inventarios.curva           curva ABC usada para montar uma contagem cíclica (A/B/C, ex.: 'A' ou 'A,B')
alter table public.inventario_items add column if not exists motivo text;
alter table public.inventario_items add column if not exists diferenca numeric(18,6);
alter table public.inventarios add column if not exists curva text;

-- Espelho diário em movimentos_historico (entradas/saídas por produto e dia), para o Histórico de Movimentações e o relatório
-- de movimentação funcionarem em loja de estoque próprio exatamente como funcionam hoje. Transferência entre locais não conta
-- (sai de um local e entra no outro). Estorno desfaz o lado oposto do dia do movimento original.
create or replace function public.trg_estoque_movimentos_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ent numeric := 0; v_sai numeric := 0; v_cod text; v_desc text;
begin
  if new.tipo = 'TRF' then return null; end if;
  if new.tipo = 'EST' then
    if new.quantidade > 0 then v_sai := -new.quantidade; else v_ent := new.quantidade; end if;
  elsif new.quantidade > 0 then v_ent := new.quantidade;
  else v_sai := -new.quantidade;
  end if;
  select codigo, descricao into v_cod, v_desc from produtos where loja_id = new.loja_id and codigo_produto = new.codigo_produto;
  insert into movimentos_historico (loja_id, cod_prod, codigo, descricao, data, entradas, saidas)
  values (new.loja_id, new.codigo_produto, v_cod, v_desc, new.data_ref, greatest(v_ent, 0), greatest(v_sai, 0))
  on conflict (loja_id, cod_prod, data) do update
    set entradas = greatest(coalesce(movimentos_historico.entradas, 0) + v_ent, 0),
        saidas   = greatest(coalesce(movimentos_historico.saidas, 0) + v_sai, 0);
  return null;
end $$;
drop trigger if exists estoque_movimentos_historico on public.estoque_movimentos;
create trigger estoque_movimentos_historico after insert on public.estoque_movimentos
  for each row execute function public.trg_estoque_movimentos_historico();

-- Reconstrói o que já existe no ledger (só lojas de estoque próprio).
insert into movimentos_historico (loja_id, cod_prod, codigo, descricao, data, entradas, saidas)
select m.loja_id, m.codigo_produto, max(p.codigo), max(p.descricao), m.data_ref,
       greatest(sum(case when m.tipo = 'EST' then (case when m.quantidade < 0 then m.quantidade else 0 end)
                         when m.quantidade > 0 then m.quantidade else 0 end), 0),
       greatest(sum(case when m.tipo = 'EST' then (case when m.quantidade > 0 then -m.quantidade else 0 end)
                         when m.quantidade < 0 then -m.quantidade else 0 end), 0)
  from estoque_movimentos m
  join lojas l on l.id = m.loja_id and l.modo_estoque = 'proprio'
  left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.codigo_produto
 where m.tipo <> 'TRF'
 group by m.loja_id, m.codigo_produto, m.data_ref
on conflict (loja_id, cod_prod, data) do update set entradas = excluded.entradas, saidas = excluded.saidas;


-- Kardex da loja (tela de Movimentações em estoque próprio): busca livre, filtros combináveis, ordenação, totais do filtro e
-- paginação num lugar só. Só o servidor chama (service_role); a tela confere a permissão antes.
create index if not exists estoque_movimentos_ref on public.estoque_movimentos (loja_id, ref);
create index if not exists estoque_movimentos_user on public.estoque_movimentos (loja_id, user_id);
create index if not exists estoque_movimentos_loja_id_desc on public.estoque_movimentos (loja_id, id desc);

create or replace function public.kardex_proprio(
  p_loja bigint, p_ini date, p_fim date, p_texto text default null, p_tipo text default null, p_origem text default null,
  p_local bigint default null, p_familia text default null, p_usuario text default null,
  p_so_negativos boolean default false, p_so_estornos boolean default false,
  p_ord text default 'data', p_dir text default 'desc', p_limite int default 50, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_t text := nullif(btrim(coalesce(p_texto, '')), ''); v_u text := nullif(btrim(coalesce(p_usuario, '')), '');
        v_res jsonb; v_asc boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
begin
  with base as (
    select m.*, pr.codigo as p_codigo, pr.descricao as p_descricao, pr.unidade as p_unidade, pr.descricao_familia as p_familia,
           l.descricao as l_nome, pf.name as u_nome
      from estoque_movimentos m
      left join produtos pr on pr.loja_id = m.loja_id and pr.codigo_produto = m.codigo_produto
      left join local_estoques l on l.loja_id = m.loja_id and l.codigo_local_estoque = m.codigo_local_estoque
      left join profiles pf on pf.id::text = m.user_id
     where m.loja_id = p_loja
       and (p_ini is null or m.data_ref >= p_ini) and (p_fim is null or m.data_ref <= p_fim)
       and (p_tipo is null or p_tipo = '' or m.tipo = p_tipo)
       and (p_origem is null or p_origem = '' or
            case p_origem
              when 'AJUSTE' then m.origem in ('MANUAL', 'SALDO_INICIAL')
              else m.origem = p_origem end)
       and (p_local is null or m.codigo_local_estoque = p_local)
       and (p_familia is null or p_familia = '' or pr.descricao_familia = p_familia)
       and (not p_so_negativos or m.saldo_apos < 0)
       and (not p_so_estornos or m.tipo = 'EST' or m.reverses_id is not null
            or exists (select 1 from estoque_movimentos e where e.reverses_id = m.id))
       and (v_u is null or coalesce(m.user_id, '') ilike '%' || v_u || '%' or coalesce(pf.name, '') ilike '%' || v_u || '%')
       and (v_t is null or pr.descricao ilike '%' || v_t || '%' or pr.codigo ilike '%' || v_t || '%'
            or m.ref ilike '%' || v_t || '%' or coalesce(m.obs, '') ilike '%' || v_t || '%'
            or coalesce(m.user_id, '') ilike '%' || v_t || '%' or coalesce(pf.name, '') ilike '%' || v_t || '%'
            or coalesce(m.transferencia_ref, '') ilike '%' || v_t || '%')
  ), tot as (
    select count(*) as total,
           coalesce(sum(case when tipo <> 'TRF' and quantidade > 0 then quantidade end), 0) as entradas,
           coalesce(sum(case when tipo <> 'TRF' and quantidade < 0 then -quantidade end), 0) as saidas,
           coalesce(sum(case when tipo <> 'TRF' and quantidade > 0 then quantidade * coalesce(custo_unitario, 0) end), 0) as valor_entradas,
           coalesce(sum(case when tipo <> 'TRF' and quantidade < 0 then -quantidade * coalesce(custo_unitario, 0) end), 0) as valor_saidas
      from base
  ), pag as (
    select b.*, (select e.id from estoque_movimentos e where e.reverses_id = b.id limit 1) as estornado_por
      from base b
     order by
       case when p_ord = 'data' and v_asc then b.id end asc, case when p_ord = 'data' and not v_asc then b.id end desc,
       case when p_ord = 'produto' and v_asc then b.p_descricao end asc, case when p_ord = 'produto' and not v_asc then b.p_descricao end desc,
       case when p_ord = 'quantidade' and v_asc then b.quantidade end asc, case when p_ord = 'quantidade' and not v_asc then b.quantidade end desc,
       case when p_ord = 'saldo' and v_asc then b.saldo_apos end asc, case when p_ord = 'saldo' and not v_asc then b.saldo_apos end desc,
       case when p_ord = 'custo' and v_asc then b.custo_unitario end asc, case when p_ord = 'custo' and not v_asc then b.custo_unitario end desc,
       case when p_ord = 'local' and v_asc then b.l_nome end asc, case when p_ord = 'local' and not v_asc then b.l_nome end desc,
       case when p_ord = 'tipo' and v_asc then b.tipo end asc, case when p_ord = 'tipo' and not v_asc then b.tipo end desc,
       case when p_ord = 'origem' and v_asc then b.origem end asc, case when p_ord = 'origem' and not v_asc then b.origem end desc,
       b.id desc
     limit greatest(1, least(coalesce(p_limite, 50), 20000)) offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select total from tot), 'entradas', (select entradas from tot), 'saidas', (select saidas from tot),
    'valor_entradas', (select valor_entradas from tot), 'valor_saidas', (select valor_saidas from tot),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'quando', created_at, 'data_ref', data_ref, 'tipo', tipo, 'origem', origem, 'ref', ref, 'linha', linha,
        'quantidade', quantidade, 'custo', custo_unitario, 'saldo_apos', saldo_apos, 'user_id', user_id, 'user_nome', u_nome,
        'obs', obs, 'codigo_local', codigo_local_estoque, 'local_nome', l_nome, 'codigo_produto', codigo_produto,
        'codigo', p_codigo, 'descricao', p_descricao, 'unidade', p_unidade, 'reverses_id', reverses_id,
        'estornado_por', estornado_por, 'transferencia_ref', transferencia_ref, 'custo_estimado', custo_estimado)
        order by ord) from (select pag.*, row_number() over () as ord from pag) pag), '[]'::jsonb))
  into v_res;
  return v_res;
end $$;
revoke all on function public.kardex_proprio(bigint, date, date, text, text, text, bigint, text, text, boolean, boolean, text, text, int, int) from public, anon, authenticated;
grant execute on function public.kardex_proprio(bigint, date, date, text, text, text, bigint, text, text, boolean, boolean, text, text, int, int) to service_role;

notify pgrst, 'reload schema';
