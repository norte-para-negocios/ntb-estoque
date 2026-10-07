-- 143 — Correções do QA de 07/10 na sincronização do catálogo (aditiva: só redefine aplicar_catalogo_vendas).
--  1) Categoria "padrão" que o Vendas cria para um grupo de 1º nível (mesmo nome do grupo) não vira subgrupo duplicado.
--  2) Produto em subgrupo mais fundo que o 2º nível não é "achatado" para o subgrupo do Vendas na volta.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 143_catalogo_sync_correcoes.sql

create or replace function public.aplicar_catalogo_vendas(p_loja bigint, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; g jsonb; p jsonb; v_id bigint; v_pai bigint; v_ts timestamptz; v_atual produtos%rowtype; v_gatual grupos_produto%rowtype;
  v_codigo text; v_cp bigint; v_grupo bigint; v_paicp bigint; v_ativo boolean; v_novo boolean; v_nome text;
  r_g jsonb := '[]'::jsonb; r_p jsonb := '[]'::jsonb; v_tipo text; v_un text; v_mapa jsonb := '{}'::jsonb; v_painome text;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  perform set_config('ntb.sync_skip', '1', true);

  for g in select * from jsonb_array_elements(coalesce(p_payload -> 'grupos', '[]'::jsonb)) loop
    v_ts := coalesce((g ->> 'updated_at')::timestamptz, now());
    v_nome := btrim(g ->> 'nome');
    if v_nome is null or v_nome = '' then continue; end if;
    v_pai := null;
    if nullif(g ->> 'pai_vendas_ref', '') is not null then
      select id into v_pai from grupos_produto where loja_id = p_loja and vendas_ref = (g ->> 'pai_vendas_ref')::uuid;
    end if;
    select * into v_gatual from grupos_produto where loja_id = p_loja and vendas_ref = (g ->> 'vendas_ref')::uuid;
    -- Categoria que o Vendas cria sozinho para um grupo de 1º nível (mesmo nome do grupo): é o próprio grupo aqui,
    -- não um subgrupo novo (achado do QA de 07/10: o produto do grupo virava um subgrupo duplicado).
    if not found and v_pai is not null then
      select nome into v_painome from grupos_produto where id = v_pai;
      if lower(v_painome) = lower(v_nome) then
        v_mapa := v_mapa || jsonb_build_object(g ->> 'vendas_ref', v_pai);
        r_g := r_g || jsonb_build_object('vendas_ref', g ->> 'vendas_ref', 'grupo_id', v_pai, 'categoria_padrao', true);
        continue;
      end if;
    end if;
    if not found then
      -- tenta ligar a um grupo de mesmo nome e mesmo pai que ainda não tem vínculo
      select * into v_gatual from grupos_produto where loja_id = p_loja and vendas_ref is null
         and coalesce(pai_id, 0) = coalesce(v_pai, 0) and lower(nome) = lower(v_nome) limit 1;
      if found then
        update grupos_produto set vendas_ref = (g ->> 'vendas_ref')::uuid where id = v_gatual.id;
      end if;
    end if;
    if not found then
      insert into grupos_produto (loja_id, pai_id, nome, ordem, ativo, vendas_ref)
      values (p_loja, v_pai, v_nome, coalesce((g ->> 'ordem')::int, 0), coalesce((g ->> 'ativo')::boolean, true), (g ->> 'vendas_ref')::uuid)
      returning id into v_id;
    else
      v_id := v_gatual.id;
      if v_ts > v_gatual.updated_at then
        update grupos_produto set nome = v_nome, ordem = coalesce((g ->> 'ordem')::int, ordem),
               ativo = coalesce((g ->> 'ativo')::boolean, ativo), pai_id = coalesce(v_pai, pai_id)
         where id = v_id;
      end if;
    end if;
    r_g := r_g || jsonb_build_object('vendas_ref', g ->> 'vendas_ref', 'grupo_id', v_id);
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_payload -> 'produtos', '[]'::jsonb)) loop
    v_ts := coalesce((p ->> 'updated_at')::timestamptz, now());
    v_nome := btrim(p ->> 'nome');
    v_ativo := coalesce((p ->> 'ativo')::boolean, true);
    v_novo := false;
    v_grupo := null;
    if nullif(p ->> 'grupo_vendas_ref', '') is not null then
      v_grupo := (v_mapa ->> (p ->> 'grupo_vendas_ref'))::bigint;
      if v_grupo is null then
        select id into v_grupo from grupos_produto where loja_id = p_loja and vendas_ref = (p ->> 'grupo_vendas_ref')::uuid;
      end if;
    end if;
    v_paicp := null;
    if nullif(p ->> 'pai_codigo', '') is not null then
      select codigo_produto into v_paicp from produtos where loja_id = p_loja and codigo = p ->> 'pai_codigo';
    end if;
    -- mãe criada no mesmo lote (ainda sem código no Vendas): o vínculo vem pelo id do Vendas
    if v_paicp is null and nullif(p ->> 'pai_vendas_ref', '') is not null then
      select codigo_produto into v_paicp from produtos where loja_id = p_loja and vendas_ref = (p ->> 'pai_vendas_ref')::uuid;
    end if;

    v_atual := null;
    if nullif(p ->> 'codigo', '') is not null then
      select * into v_atual from produtos where loja_id = p_loja and codigo = p ->> 'codigo';
    end if;
    if v_atual.id is null and nullif(p ->> 'vendas_ref', '') is not null then
      select * into v_atual from produtos where loja_id = p_loja and vendas_ref = (p ->> 'vendas_ref')::uuid;
    end if;

    if v_atual.id is null then
      if v_nome is null or v_nome = '' then continue; end if;
      v_tipo := coalesce(nullif(p ->> 'tipo_item', ''), '04');
      v_un := coalesce(nullif(p ->> 'unidade', ''), 'UN');
      v_codigo := proximo_codigo_produto(p_loja, v_tipo);
      v_cp := novo_id_produto_proprio();
      insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, ncm, valor_unitario, pdv, inativo,
                            grupo_id, eh_mae, produto_pai_codigo, atributos, vendas_ref, sync_atualizado_em, updated_at)
      values (p_loja, v_cp, v_codigo, v_nome, v_un, v_tipo, nullif(regexp_replace(coalesce(p ->> 'ncm', ''), '\D', '', 'g'), ''),
              coalesce((p ->> 'preco')::numeric, 0), true, not v_ativo,
              v_grupo, coalesce((p ->> 'mae')::boolean, false), v_paicp, coalesce(p -> 'atributos', '{}'::jsonb),
              nullif(p ->> 'vendas_ref', '')::uuid, now(), v_ts);
      v_novo := true;
    else
      v_codigo := v_atual.codigo;
      v_cp := v_atual.codigo_produto;
      -- preço: o Vendas manda, sempre
      if nullif(p ->> 'preco', '') is not null then
        update produtos set valor_unitario = (p ->> 'preco')::numeric where id = v_atual.id and valor_unitario is distinct from (p ->> 'preco')::numeric;
      end if;
      if nullif(p ->> 'vendas_ref', '') is not null and v_atual.vendas_ref is null then
        update produtos set vendas_ref = (p ->> 'vendas_ref')::uuid where id = v_atual.id;
      end if;
      -- nome, ativo, grupo, atributos: vence o mais novo
      if v_ts > v_atual.updated_at then
        update produtos set descricao = coalesce(nullif(v_nome, ''), descricao), inativo = not v_ativo,
               grupo_id = case
                 when v_grupo is null then grupo_id
                 when grupo_id is not null and exists (
                   with recursive anc as (
                     select id, pai_id from grupos_produto where id = v_atual.grupo_id
                     union all
                     select gp.id, gp.pai_id from grupos_produto gp join anc on gp.id = anc.pai_id
                   ) select 1 from anc where anc.id = v_grupo) then grupo_id
                 else v_grupo end,
               atributos = coalesce(p -> 'atributos', atributos), updated_at = v_ts
         where id = v_atual.id;
      end if;
      -- vínculo mãe/variação (só quando ainda não existe; o Estoque manda na estrutura depois)
      if v_paicp is not null and v_atual.produto_pai_codigo is null and not v_atual.eh_mae then
        update produtos set produto_pai_codigo = v_paicp where id = v_atual.id;
      end if;
      if coalesce((p ->> 'mae')::boolean, false) and not v_atual.eh_mae and v_atual.produto_pai_codigo is null
         and not exists (select 1 from estoque_movimentos where loja_id = p_loja and codigo_produto = v_atual.codigo_produto) then
        update produtos set eh_mae = true where id = v_atual.id;
      end if;
      update produtos set sync_atualizado_em = now() where id = v_atual.id;
    end if;
    r_p := r_p || jsonb_build_object('vendas_ref', p ->> 'vendas_ref', 'codigo', v_codigo, 'codigo_produto', v_cp, 'criado', v_novo);
  end loop;

  return jsonb_build_object('ok', true, 'grupos', r_g, 'produtos', r_p);
end $$;

revoke all on function public.aplicar_catalogo_vendas(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_catalogo_vendas(bigint,jsonb) to service_role;
notify pgrst, 'reload schema';
