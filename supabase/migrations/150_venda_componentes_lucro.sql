-- 150 — Lucro do estoque próprio para produto que baixa por COMPONENTE (pizza meio a meio, variação, borda/adicional com código).
-- Achado na QA rodada 3 (ODARA, 07/10): na pizza meio a meio o produto do cardápio não tem código e quem baixa são os sabores
-- (opções com código). O CMV ficava no código de cada sabor, que não aparece como item do faturamento, e o relatório de Lucro
-- mostrava a pizza com custo zero e margem 100% ("sem baixa"), perdendo o custo dos sabores.
-- Agora: (1) o Vendas manda, por item, os códigos das opções escolhidas (`componentes`); (2) o custo de cada código vai para a
-- linha que o tem como produto ou componente; (3) custo de código que não casa com nenhuma linha (venda antiga, sem componentes)
-- é rateado nas linhas da venda que não são taxa, pelo valor — o total de CMV da venda nunca some do relatório.
alter table public.vendas_proprio_itens add column if not exists componentes bigint[];

create or replace function public.registrar_venda_proprio(p_loja bigint, p_venda jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_modo text; v_id bigint; v_cupom bigint; v_existia boolean; v_data date; v_item jsonb; v_pag jsonb; v_linha int := 0; v_seq int := 0;
  v_ref text := p_venda ->> 'pedidoRef';
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if v_ref is null or btrim(v_ref) = '' then raise exception 'pedidoRef é obrigatório' using errcode = '22023'; end if;
  v_data := coalesce((p_venda ->> 'data')::date, (now() at time zone 'America/Sao_Paulo')::date);

  perform pg_advisory_xact_lock(hashtext('venda_proprio:' || p_loja || ':' || v_ref));
  select id, n_id_cupom into v_id, v_cupom from vendas_proprio where loja_id = p_loja and pedido_ref = v_ref;
  v_existia := v_id is not null;

  if v_existia then
    update vendas_proprio set data = v_data, hora = p_venda ->> 'hora', tipo = p_venda ->> 'tipo', mesa = p_venda ->> 'mesa',
           valor = coalesce((p_venda ->> 'valor')::numeric, 0), desconto = coalesce((p_venda ->> 'desconto')::numeric, 0),
           taxa = coalesce((p_venda ->> 'taxa')::numeric, 0), cancelado = coalesce((p_venda ->> 'cancelado')::boolean, false),
           devolvido = coalesce((p_venda ->> 'devolvido')::boolean, false), operador = p_venda ->> 'operador',
           nota_chave = p_venda #>> '{nota,chave}', nota_numero = p_venda #>> '{nota,numero}', nota_serie = p_venda #>> '{nota,serie}',
           nota_status = p_venda #>> '{nota,status}', frio_enviado_em = null, updated_at = now()
     where id = v_id;
    delete from vendas_proprio_itens where venda_id = v_id;
    delete from vendas_proprio_pagamentos where venda_id = v_id;
  else
    insert into vendas_proprio (loja_id, pedido_ref, data, hora, tipo, mesa, valor, desconto, taxa, cancelado, devolvido, operador,
                                nota_chave, nota_numero, nota_serie, nota_status)
    values (p_loja, v_ref, v_data, p_venda ->> 'hora', p_venda ->> 'tipo', p_venda ->> 'mesa',
            coalesce((p_venda ->> 'valor')::numeric, 0), coalesce((p_venda ->> 'desconto')::numeric, 0), coalesce((p_venda ->> 'taxa')::numeric, 0),
            coalesce((p_venda ->> 'cancelado')::boolean, false), coalesce((p_venda ->> 'devolvido')::boolean, false), p_venda ->> 'operador',
            p_venda #>> '{nota,chave}', p_venda #>> '{nota,numero}', p_venda #>> '{nota,serie}', p_venda #>> '{nota,status}')
    returning id, n_id_cupom into v_id, v_cupom;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_venda -> 'itens', '[]'::jsonb)) loop
    v_linha := v_linha + 1;
    insert into vendas_proprio_itens (venda_id, linha, codigo, codigo_produto, nome, quantidade, valor_unitario, desconto, valor, ncm, cfop, componentes)
    values (v_id, coalesce((v_item ->> 'linha')::int, v_linha), v_item ->> 'codigo',
            (select pr.codigo_produto from produtos pr where pr.loja_id = p_loja and pr.codigo = v_item ->> 'codigo' limit 1),
            v_item ->> 'nome', coalesce((v_item ->> 'quantidade')::numeric, 0), coalesce((v_item ->> 'valorUnitario')::numeric, 0),
            coalesce((v_item ->> 'desconto')::numeric, 0),
            coalesce((v_item ->> 'valor')::numeric, coalesce((v_item ->> 'valorUnitario')::numeric, 0) * coalesce((v_item ->> 'quantidade')::numeric, 0) - coalesce((v_item ->> 'desconto')::numeric, 0)),
            v_item ->> 'ncm', v_item ->> 'cfop',
            (select array_agg(pr.codigo_produto order by c.ord)
               from jsonb_array_elements_text(case when jsonb_typeof(v_item -> 'componentes') = 'array' then v_item -> 'componentes' else '[]'::jsonb end) with ordinality c(cod, ord)
               join produtos pr on pr.loja_id = p_loja and pr.codigo = c.cod))
    on conflict (venda_id, linha) do update set codigo = excluded.codigo, codigo_produto = excluded.codigo_produto, nome = excluded.nome,
         quantidade = excluded.quantidade, valor_unitario = excluded.valor_unitario, desconto = excluded.desconto, valor = excluded.valor,
         componentes = excluded.componentes;
  end loop;

  for v_pag in select * from jsonb_array_elements(coalesce(p_venda -> 'pagamentos', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    insert into vendas_proprio_pagamentos (venda_id, sequencia, metodo, tipo_doc, valor, bandeira)
    values (v_id, coalesce((v_pag ->> 'sequencia')::int, v_seq), v_pag ->> 'metodo', sigla_forma_pgto(v_pag ->> 'metodo'),
            coalesce((v_pag ->> 'valor')::numeric, 0), v_pag ->> 'bandeira')
    on conflict (venda_id, sequencia) do update set metodo = excluded.metodo, tipo_doc = excluded.tipo_doc, valor = excluded.valor, bandeira = excluded.bandeira;
  end loop;

  perform recalcular_faturamento_proprio(p_loja, to_char(v_data, 'YYYY-MM'));
  return jsonb_build_object('ok', true, 'venda_id', v_id, 'n_id_cupom', v_cupom, 'duplicado', v_existia);
end $function$;

-- Pré-agregado: item sem código próprio (pizza meio a meio) herda tipo e família do primeiro componente.
create or replace function public.recalcular_faturamento_proprio(p_loja bigint, p_mes text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from faturamento_importado
   where loja_id = p_loja and mes = p_mes
     and dimensao in ('tipo', 'familia', 'produto', 'tipo>familia', 'familia>produto', 'forma_pgto');

  insert into faturamento_importado (loja_id, dimensao, rotulo, mes, valor)
  select p_loja, x.dimensao, x.rotulo, p_mes, round(sum(x.valor), 2)
    from (
      select d.dimensao, d.rotulo, i.valor
        from vendas_proprio v
        join vendas_proprio_itens i on i.venda_id = v.id
        left join produtos p on p.loja_id = v.loja_id and p.codigo_produto = i.codigo_produto
        left join produtos pc on p.codigo_produto is null and pc.loja_id = v.loja_id and pc.codigo_produto = i.componentes[1]
        cross join lateral (
          select rotulo_tipo_item(coalesce(p.tipo_item, pc.tipo_item)) as tipo,
                 coalesce(nullif(p.descricao_familia, ''), nullif(pc.descricao_familia, ''), 'Sem família') as familia,
                 coalesce(nullif(p.descricao, ''), nullif(i.nome, ''), 'Produto não identificado') as prod
        ) r
        cross join lateral (values
          ('tipo', r.tipo), ('familia', r.familia), ('produto', r.prod),
          ('tipo>familia', r.tipo || '>>' || r.familia), ('familia>produto', r.familia || '>>' || r.prod)
        ) d(dimensao, rotulo)
       where v.loja_id = p_loja and to_char(v.data, 'YYYY-MM') = p_mes and not v.cancelado and not v.devolvido and i.valor <> 0
      union all
      select 'forma_pgto', rotulo_forma_pgto(g.tipo_doc), g.valor
        from vendas_proprio v join vendas_proprio_pagamentos g on g.venda_id = v.id
       where v.loja_id = p_loja and to_char(v.data, 'YYYY-MM') = p_mes and not v.cancelado and not v.devolvido and g.valor <> 0
    ) x
   group by x.dimensao, x.rotulo
  having round(sum(x.valor), 2) <> 0;
  get diagnostics n = row_count;

  insert into faturamento_import_meta (loja_id, importado_em, importado_por, arquivo, linhas)
  values (p_loja, now(), null, 'Norte Vendas (fechamento)', n)
  on conflict (loja_id) do update set importado_em = excluded.importado_em, arquivo = excluded.arquivo, linhas = excluded.linhas;
  return n;
end $$;

create or replace function public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text default 'produto')
returns table (rotulo text, quantidade numeric, faturamento numeric, cmv numeric, lucro numeric, margem numeric, itens_sem_baixa int, itens_sem_custo int)
language sql stable security definer set search_path = public as $$
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
   order by 4 desc nulls last
$$;
