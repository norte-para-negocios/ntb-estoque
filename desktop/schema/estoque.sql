--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: _expandir_receita(bigint, bigint, numeric, integer, bigint[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_nivel integer, p_caminho bigint[]) RETURNS TABLE(codigo_insumo bigint, quantidade numeric)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare f fichas_tecnicas%rowtype; i record; filha fichas_tecnicas%rowtype; fator numeric;
begin
  if p_nivel > 10 then raise exception 'Receita com profundidade excessiva (ciclo?)' using errcode = '23514'; end if;
  select * into f from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then return; end if;
  fator := p_quantidade / f.rendimento;
  for i in select * from ficha_tecnica_itens where ficha_id = f.id order by ordem loop
    if i.codigo_insumo = any (p_caminho) then raise exception 'Receita circular em %', i.codigo_insumo using errcode = '23514'; end if;
    select * into filha from fichas_tecnicas where loja_id = p_loja and codigo_produto = i.codigo_insumo and ativa and expandir_na_venda;
    if found then
      return query select * from _expandir_receita(p_loja, i.codigo_insumo, i.quantidade_bruta * fator, p_nivel + 1, p_caminho || i.codigo_insumo);
    else
      codigo_insumo := i.codigo_insumo; quantidade := i.quantidade_bruta * fator; return next;
    end if;
  end loop;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: estoque_movimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_movimentos (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_local_estoque bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    tipo text NOT NULL,
    origem text NOT NULL,
    ref text NOT NULL,
    linha integer DEFAULT 0 NOT NULL,
    quantidade numeric(18,6) NOT NULL,
    custo_unitario numeric(18,6),
    saldo_apos numeric(18,6) NOT NULL,
    saldo_total_apos numeric(18,6) NOT NULL,
    cmc_apos numeric(18,6),
    custo_estimado boolean DEFAULT false NOT NULL,
    reverses_id bigint,
    transferencia_ref text,
    user_id text,
    obs text,
    data_ref date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_movimentos_quantidade_check CHECK ((quantidade <> (0)::numeric)),
    CONSTRAINT estoque_movimentos_tipo_check CHECK ((tipo = ANY (ARRAY['ENT'::text, 'SAI'::text, 'AJU'::text, 'TRF'::text, 'PRD'::text, 'EST'::text])))
);


--
-- Name: _lote_da_entrada(public.estoque_movimentos); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._lote_da_entrada(m public.estoque_movimentos, OUT o_lote text, OUT o_validade date) RETURNS record
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_dias int; v_op ordens_producao%rowtype; v_guc_l text; v_guc_v text; v_map jsonb;
begin
  o_lote := null; o_validade := null;
  -- 1) contexto explícito da transação (entrada manual com lote, testes)
  begin v_guc_l := nullif(current_setting('estoque.lote', true), ''); exception when others then v_guc_l := null; end;
  begin v_guc_v := nullif(current_setting('estoque.validade', true), ''); exception when others then v_guc_v := null; end;
  if v_guc_l is not null or v_guc_v is not null then
    o_lote := v_guc_l; o_validade := v_guc_v::date; return;
  end if;
  -- 2) compra: item da compra pela (ref = chave ou 'compra:id', linha)
  if m.origem = 'COMPRA' then
    select i.lote, i.validade into o_lote, o_validade
      from compras_proprio_itens i join compras_proprio c on c.id = i.compra_id
     where c.loja_id = m.loja_id and i.linha = m.linha
       and coalesce(c.chave_acesso, 'compra:' || c.id) = m.ref
     limit 1;
    -- compra lançada e criada na mesma chamada (lancar_compra_com_lotes): mapa linha -> {lote, validade} da transação
    if o_lote is null and o_validade is null then
      begin
        v_map := nullif(current_setting('estoque.lotes_compra', true), '')::jsonb;
      exception when others then v_map := null; end;
      if v_map is not null and v_map ? m.linha::text then
        o_lote := nullif(btrim(v_map -> m.linha::text ->> 'lote'), '');
        o_validade := nullif(v_map -> m.linha::text ->> 'validade', '')::date;
      end if;
    end if;
  -- 3) produção da OP: ref = 'OP:<id>:<n>' → validade e número da OP
  elsif m.origem = 'PRODUCAO' and m.ref like 'OP:%' then
    select * into v_op from ordens_producao where id = nullif(split_part(m.ref, ':', 2), '')::bigint and loja_id = m.loja_id;
    if found then
      o_lote := coalesce(v_op.identificacao_c_num_op, v_op.num_ordem::text);
      o_validade := v_op.validade;
    end if;
  elsif m.origem = 'PRODUCAO' then
    o_lote := m.ref;
  end if;
  -- 4) sem validade informada: prazo padrão do produto (entrada de compra e produção)
  if o_validade is null and m.origem in ('COMPRA', 'PRODUCAO', 'ENTRADA_MANUAL', 'MANUAL') then
    select validade_dias into v_dias from produtos where loja_id = m.loja_id and codigo_produto = m.codigo_produto;
    if v_dias is not null then o_validade := m.data_ref + v_dias; end if;
  end if;
end $$;


--
-- Name: _lote_entrar(bigint, bigint, bigint, bigint, numeric, text, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._lote_entrar(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_lote text, p_validade date, p_origem text, p_ref text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v bigint;
begin
  if p_qtd <= 0 then return; end if;
  if p_lote is null and p_validade is null then
    v := _lote_sem_lote(p_loja, p_local, p_produto);
  else
    select id into v from estoque_lotes
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto
       and coalesce(lote, '') = coalesce(p_lote, '') and coalesce(validade, '0001-01-01'::date) = coalesce(p_validade, '0001-01-01'::date)
       and not (lote is null and validade is null)
     for update;
    if v is null then
      insert into estoque_lotes (loja_id, codigo_local_estoque, codigo_produto, lote, validade, origem, ref, movimento_origem_id)
      values (p_loja, p_local, p_produto, p_lote, p_validade, p_origem, p_ref, p_mov)
      returning id into v;
    end if;
  end if;
  update estoque_lotes set saldo = saldo + p_qtd, quantidade_entrada = quantidade_entrada + p_qtd, updated_at = now() where id = v;
  insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, v, p_qtd);
end $$;


--
-- Name: _lote_sair(bigint, bigint, bigint, bigint, numeric, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._lote_sair(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_preferido bigint) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_rest numeric := p_qtd; v_tira numeric; l record; v_sem_lote bigint;
begin
  if p_qtd <= 0 then return; end if;
  if p_preferido is not null then
    select * into l from estoque_lotes
     where id = p_preferido and loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;
    if found and l.saldo > 0 then
      v_tira := least(l.saldo, v_rest);
      update estoque_lotes set saldo = saldo - v_tira, updated_at = now() where id = l.id;
      insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, l.id, -v_tira);
      v_rest := v_rest - v_tira;
    end if;
  end if;
  for l in
    select * from estoque_lotes
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and saldo > 0
       and not (lote is null and validade is null)
     order by validade nulls last, created_at, id
     for update
  loop
    exit when v_rest <= 0;
    v_tira := least(l.saldo, v_rest);
    update estoque_lotes set saldo = saldo - v_tira, updated_at = now() where id = l.id;
    insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, l.id, -v_tira);
    v_rest := v_rest - v_tira;
  end loop;
  if v_rest > 0 then
    -- "sem lote" é o último a sair e o único que pode ficar negativo (o ledger permite saldo negativo).
    -- O id vem ANTES do UPDATE: chamado dentro do WHERE, o _lote_sem_lote criava a linha depois do snapshot
    -- do UPDATE, nada era atualizado e o vínculo saía com lote_id nulo (venda de item nunca abastecido falhava).
    v_sem_lote := _lote_sem_lote(p_loja, p_local, p_produto);
    update estoque_lotes set saldo = saldo - v_rest, updated_at = now() where id = v_sem_lote;
    insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, v_sem_lote, -v_rest);
  end if;
end $$;


--
-- Name: _lote_sem_lote(bigint, bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._lote_sem_lote(p_loja bigint, p_local bigint, p_produto bigint) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v bigint;
begin
  select id into v from estoque_lotes
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and lote is null and validade is null;
  if v is null then
    insert into estoque_lotes (loja_id, codigo_local_estoque, codigo_produto, origem)
    values (p_loja, p_local, p_produto, 'sem_lote')
    on conflict do nothing;
    select id into v from estoque_lotes
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and lote is null and validade is null;
  end if;
  return v;
end $$;


--
-- Name: _op_itens_detalhes(bigint, bigint, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._op_itens_detalhes(p_loja bigint, p_produto bigint, p_qtde numeric) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object('itensDetalhes', coalesce(jsonb_agg(jsonb_build_object(
           'nIdProdutoMalha', e.codigo_insumo, 'nQtde', e.quantidade, 'cUtilizarDoEstoque', 'S') order by e.codigo_insumo), '[]'::jsonb))
    from expandir_receita(p_loja, p_produto, p_qtde) e
$$;


--
-- Name: _rotulo_produto(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._rotulo_produto(p_loja bigint, p_produto bigint) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((select nullif(btrim(coalesce(codigo, '') || ' ' || coalesce(descricao, '')), '')
                     from produtos where loja_id = p_loja and codigo_produto = p_produto limit 1), p_produto::text)
$$;


--
-- Name: _travar_custos(bigint, bigint[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._travar_custos(p_loja bigint, p_produtos bigint[]) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare p bigint;
begin
  for p in select distinct x from unnest(p_produtos) x order by x loop
    insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p) on conflict do nothing;
    perform 1 from estoque_custos where loja_id = p_loja and codigo_produto = p for update;
  end loop;
end $$;


--
-- Name: abrir_inventario(bigint, bigint, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.abrir_inventario(p_loja bigint, p_local bigint, p_user text DEFAULT NULL::text, p_tipo text DEFAULT 'geral'::text, p_classe text DEFAULT NULL::text, p_descricao text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_modo text; v_id bigint; v_n int;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local) then
    raise exception 'Local inexistente' using errcode = '22023';
  end if;
  if p_tipo = 'ciclica' and p_classe is null then raise exception 'Contagem cíclica exige a classe (A, B ou C)' using errcode = '22023'; end if;
  begin
    insert into inventarios_proprio (loja_id, codigo_local_estoque, tipo, classe, descricao, aberto_por)
    values (p_loja, p_local, coalesce(p_tipo, 'geral'), case when p_tipo = 'ciclica' then p_classe end, p_descricao, p_user)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe um inventário aberto neste local' using errcode = '23505';
  end;
  -- Itens: tudo que o sistema acredita haver no local (saldo <> 0). Em contagem cíclica, só os da classe.
  insert into inventario_proprio_itens (inventario_id, loja_id, codigo_produto, saldo_snapshot)
  select v_id, p_loja, s.codigo_produto, s.saldo
    from estoque_saldos s
    join produtos pr on pr.loja_id = s.loja_id and pr.codigo_produto = s.codigo_produto and coalesce(pr.inativo, false) = false
   where s.loja_id = p_loja and s.codigo_local_estoque = p_local and s.saldo <> 0
     and (p_tipo is distinct from 'ciclica' or exists (select 1 from curva_abc(p_loja) c where c.codigo_produto = s.codigo_produto and c.classe = p_classe));
  get diagnostics v_n = row_count;
  update inventarios_proprio set total_itens = v_n where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'itens', v_n);
end $$;


--
-- Name: aplicar_catalogo_vendas(bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aplicar_catalogo_vendas(p_loja bigint, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    if v_gatual.id is null and v_pai is not null then
      select nome into v_painome from grupos_produto where id = v_pai;
      if lower(v_painome) = lower(v_nome) then
        v_mapa := v_mapa || jsonb_build_object(g ->> 'vendas_ref', v_pai);
        r_g := r_g || jsonb_build_object('vendas_ref', g ->> 'vendas_ref', 'grupo_id', v_pai, 'categoria_padrao', true);
        continue;
      end if;
    end if;
    if v_gatual.id is null then
      -- liga ao grupo de mesmo nome e mesmo pai (sem vínculo ou com vínculo de uma categoria antiga do Vendas)
      select * into v_gatual from grupos_produto where loja_id = p_loja
         and coalesce(pai_id, 0) = coalesce(v_pai, 0) and lower(nome) = lower(v_nome) limit 1;
      if found then
        update grupos_produto set vendas_ref = (g ->> 'vendas_ref')::uuid where id = v_gatual.id;
      end if;
    end if;
    if v_gatual.id is null then
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


--
-- Name: atualizar_preco_recente(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.atualizar_preco_recente(p_loja_id bigint) RETURNS void
    LANGUAGE sql
    AS $$
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


--
-- Name: baixar_lote(bigint, bigint, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.baixar_lote(p_loja bigint, p_lote_id bigint, p_quantidade numeric, p_motivo text, p_ref text, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare l estoque_lotes%rowtype; r jsonb; v_q numeric;
begin
  select * into l from estoque_lotes where id = p_lote_id and loja_id = p_loja;
  if not found then raise exception 'Lote % não existe nesta loja', p_lote_id using errcode = '22023'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 3 then raise exception 'Informe o motivo da baixa' using errcode = '22023'; end if;
  v_q := coalesce(p_quantidade, l.saldo);
  if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  if v_q > l.saldo then raise exception 'O lote só tem % em saldo', l.saldo using errcode = '22023'; end if;
  perform set_config('estoque.lote_id', l.id::text, true);
  r := registrar_movimento(p_loja, l.codigo_local_estoque, l.codigo_produto, 'SAI', 'PERDA', p_ref, v_q, null, p_user,
                           'Baixa por vencimento' || coalesce(' · lote ' || l.lote, '') || coalesce(' · val. ' || to_char(l.validade, 'DD/MM/YYYY'), '')
                           || ' · ' || btrim(p_motivo));
  perform set_config('estoque.lote_id', '', true);
  return r;
end $$;


--
-- Name: baixar_saldo_local(bigint, bigint, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.baixar_saldo_local(p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric) RETURNS numeric
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into estoque_local_saldos (loja_id, codigo_produto, saldo, atualizado_em)
  values (p_loja_id, p_codigo_produto, -p_quantidade, now())
  on conflict (loja_id, codigo_produto)
  do update set saldo = estoque_local_saldos.saldo - p_quantidade, atualizado_em = now()
  returning saldo;
$$;


--
-- Name: cancelar_inventario(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancelar_inventario(p_inventario bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update inventarios_proprio set status = 'cancelado', fechado_por = p_user, fechado_em = now()
   where id = p_inventario and status = 'aberto';
  if not found then raise exception 'Inventário não está aberto' using errcode = '55000'; end if;
  return jsonb_build_object('ok', true);
end $$;


--
-- Name: cancelar_venda_proprio(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancelar_venda_proprio(p_loja bigint, p_ref text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id bigint; v_data date;
begin
  update vendas_proprio set cancelado = true, frio_enviado_em = null, updated_at = now()
   where loja_id = p_loja and pedido_ref = p_ref returning id, data into v_id, v_data;
  if v_id is null then return jsonb_build_object('ok', true, 'encontrada', false); end if;
  perform recalcular_faturamento_proprio(p_loja, to_char(v_data, 'YYYY-MM'));
  return jsonb_build_object('ok', true, 'encontrada', true, 'venda_id', v_id);
end $$;


--
-- Name: cmc_efetivo_proprio(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cmc_efetivo_proprio(p_loja bigint) RETURNS TABLE(codigo_produto bigint, cmc numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.codigo_produto,
         coalesce(nullif(c.cmc, 0), custo_unitario_ficha(p_loja, p.codigo_produto)) as cmc
    from produtos p left join estoque_custos c on c.loja_id = p.loja_id and c.codigo_produto = p.codigo_produto
   where p.loja_id = p_loja
$$;


--
-- Name: cmc_recente_da_loja(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cmc_recente_da_loja(p_loja_id bigint) RETURNS TABLE(n_cod_prod bigint, cmc numeric)
    LANGUAGE sql STABLE
    AS $$
  select distinct on (pe.n_cod_prod)
         pe.n_cod_prod,
         pe.n_cmc as cmc
    from posicao_estoques pe
   where pe.loja_id = p_loja_id
     and pe.n_cmc is not null
     and pe.n_cmc > 0
   order by pe.n_cod_prod, pe.data_posicao desc
$$;


--
-- Name: compras_fornecedores(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compras_fornecedores(p_loja_id bigint) RETURNS TABLE(fornecedor text)
    LANGUAGE sql STABLE
    AS $$
  select distinct coalesce(nf.c_razao_social, nf.c_nome) as fornecedor
  from notas_fiscais nf
  where nf.loja_id = p_loja_id
    and nf.deleted_at is null
    and coalesce(nf.c_razao_social, nf.c_nome) is not null
    and length(trim(coalesce(nf.c_razao_social, nf.c_nome))) > 0
  order by 1;
$$;


--
-- Name: compras_precos_produtos(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compras_precos_produtos(p_loja_id bigint, p_busca text DEFAULT NULL::text) RETURNS TABLE(codigo text, descricao text, ultimo_preco numeric, ultima_data date, menor_preco numeric, maior_preco numeric, preco_tipico numeric, qtd_compras bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  with itens as (
    select
      nfi.c_codigo_produto as codigo,
      nfi.c_descricao_produto as descricao,
      nfi.n_preco_unit::numeric as preco,
      nf.d_emissao_nfe as data
    from nota_fiscal_items nfi
    join notas_fiscais nf on nf.id = nfi.nota_fiscal_id and nf.deleted_at is null
    where nfi.loja_id = p_loja_id
      and nfi.n_preco_unit > 0
      and nfi.c_codigo_produto is not null
      and (p_busca is null or nfi.c_descricao_produto ilike '%' || p_busca || '%' or nfi.c_codigo_produto ilike '%' || p_busca || '%')
  ),
  agg as (
    select codigo,
      min(preco) as menor_preco, max(preco) as maior_preco,
      -- mediana: resistente a erros de digitacao (NFs com preco absurdo)
      percentile_cont(0.5) within group (order by preco)::numeric as preco_tipico,
      count(*) as qtd_compras
    from itens group by codigo
  ),
  ult as (
    select distinct on (codigo) codigo, descricao, preco as ultimo_preco, data as ultima_data
    from itens order by codigo, data desc nulls last
  )
  select
    ult.codigo, ult.descricao,
    ult.ultimo_preco, ult.ultima_data,
    agg.menor_preco, agg.maior_preco, round(agg.preco_tipico, 2) as preco_tipico,
    agg.qtd_compras
  from ult join agg on agg.codigo = ult.codigo
  order by agg.qtd_compras desc, ult.descricao
  limit 300;
$$;


--
-- Name: compras_produtos_do_fornecedor(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compras_produtos_do_fornecedor(p_loja_id bigint, p_fornecedor text) RETURNS TABLE(cod bigint)
    LANGUAGE sql STABLE
    AS $$
  select distinct i.n_id_produto::bigint as cod
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and coalesce(nf.c_razao_social, nf.c_nome) = p_fornecedor
    and i.n_id_produto is not null;
$$;


--
-- Name: compras_ranking_fornecedores(bigint, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compras_ranking_fornecedores(p_loja_id bigint, p_desde date DEFAULT NULL::date) RETURNS TABLE(codigo_omie bigint, razao_social text, total numeric, qtd_nf bigint, ultima_compra date)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select
    nf.n_id_fornecedor as codigo_omie,
    coalesce(max(f.razao_social), max(nf.c_razao_social), '(sem nome)') as razao_social,
    sum(nf.n_valor_nfe)::numeric as total,
    count(*)::bigint as qtd_nf,
    max(nf.d_emissao_nfe) as ultima_compra
  from notas_fiscais nf
  left join fornecedores f on f.loja_id = nf.loja_id and f.codigo_omie = nf.n_id_fornecedor
  where nf.loja_id = p_loja_id
    and nf.deleted_at is null
    and (p_desde is null or nf.d_emissao_nfe >= p_desde)
  group by nf.n_id_fornecedor
  order by total desc nulls last
  limit 100;
$$;


--
-- Name: consumo_por_receita(bigint, bigint, numeric, bigint, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consumo_por_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local bigint, p_ref text, p_user text DEFAULT NULL::text, p_linha_base integer DEFAULT 0, p_origem text DEFAULT 'VENDA'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ref text; r record; v_res jsonb; v_itens jsonb := '[]'::jsonb;
  v_negativo boolean := false; v_ids bigint[];
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then return jsonb_build_object('ok', true, 'tem_receita', false); end if;

  v_ref := p_ref || '|' || p_produto || '|' || p_linha_base;
  select array_agg(e.codigo_insumo) into v_ids from expandir_receita(p_loja, p_produto, p_quantidade) e;
  if v_ids is null then return jsonb_build_object('ok', true, 'tem_receita', false); end if;
  perform _travar_custos(p_loja, v_ids);

  for r in select * from expandir_receita(p_loja, p_produto, p_quantidade) order by 1 loop
    v_res := registrar_movimento(p_loja, p_local, r.codigo_insumo, 'SAI', p_origem, v_ref, r.quantidade, null, p_user,
                                 'Receita ' || _rotulo_produto(p_loja, p_produto) || ' v' || v_ficha.versao, 0, null, null, null);
    if not coalesce((v_res ->> 'duplicado')::boolean, false) then
      insert into estoque_receita_consumos (movimento_id, loja_id, ficha_id, versao, produto_vendido, quantidade_vendida)
      values ((v_res ->> 'id')::bigint, p_loja, v_ficha.id, v_ficha.versao, p_produto, p_quantidade) on conflict do nothing;
    end if;
    if coalesce((v_res ->> 'negativo')::boolean, false) then v_negativo := true; end if;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric, 'duplicado', coalesce((v_res ->> 'duplicado')::boolean, false)));
  end loop;
  return jsonb_build_object('ok', true, 'tem_receita', true, 'ficha_id', v_ficha.id, 'versao', v_ficha.versao, 'negativo', v_negativo, 'itens', v_itens);
end $$;


--
-- Name: contar_item(bigint, bigint, numeric, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contar_item(p_inventario bigint, p_produto bigint, p_contado numeric, p_user text DEFAULT NULL::text, p_motivo text DEFAULT NULL::text, p_em timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare inv inventarios_proprio%rowtype; v_saldo numeric;
begin
  select * into inv from inventarios_proprio where id = p_inventario for share;
  if not found then raise exception 'Inventário inexistente' using errcode = '22023'; end if;
  if inv.status <> 'aberto' then raise exception 'Este inventário não está aberto' using errcode = '55000'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'Quantidade contada inválida' using errcode = '22023'; end if;
  if not exists (select 1 from produtos where loja_id = inv.loja_id and codigo_produto = p_produto) then
    raise exception 'Produto inexistente' using errcode = '22023';
  end if;
  select coalesce((select saldo from estoque_saldos where loja_id = inv.loja_id and codigo_local_estoque = inv.codigo_local_estoque and codigo_produto = p_produto), 0) into v_saldo;
  insert into inventario_proprio_itens (inventario_id, loja_id, codigo_produto, saldo_snapshot, contado, contado_em, contado_por, motivo)
  values (p_inventario, inv.loja_id, p_produto, v_saldo, p_contado, coalesce(p_em, clock_timestamp()), p_user, nullif(btrim(p_motivo), ''))
  on conflict (inventario_id, codigo_produto) do update
    set contado = excluded.contado, contado_em = excluded.contado_em, contado_por = excluded.contado_por,
        motivo = coalesce(nullif(btrim(p_motivo), ''), inventario_proprio_itens.motivo);
  return jsonb_build_object('ok', true);
end $$;


--
-- Name: crm_fornecedor_nf(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_fornecedor_nf(p_loja_id bigint, p_codigo bigint) RETURNS TABLE(total numeric, qtd bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select coalesce(sum(n_valor_nfe), 0)::numeric, count(*)::bigint
  from notas_fiscais
  where loja_id = p_loja_id and n_id_fornecedor = p_codigo and deleted_at is null;
$$;


--
-- Name: crm_resumo_contas(bigint, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_resumo_contas(p_loja_id bigint, p_codigo bigint, p_tipo text) RETURNS TABLE(total numeric, atrasado numeric, qtd bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
begin
  if p_tipo = 'fornecedor' then
    return query
      select coalesce(sum(valor_documento), 0)::numeric,
             coalesce(sum(valor_documento) filter (where status_titulo = 'ATRASADO'), 0)::numeric,
             count(*)::bigint
      from contas_pagar
      where loja_id = p_loja_id and codigo_cliente_fornecedor = p_codigo;
  else
    return query
      select coalesce(sum(valor_documento), 0)::numeric,
             coalesce(sum(valor_documento) filter (where status_titulo = 'ATRASADO'), 0)::numeric,
             count(*)::bigint
      from contas_receber
      where loja_id = p_loja_id and codigo_cliente_fornecedor = p_codigo;
  end if;
end;
$$;


--
-- Name: curva_abc(bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.curva_abc(p_loja bigint, p_dias integer DEFAULT NULL::integer) RETURNS TABLE(codigo_produto bigint, valor_movimentado numeric, percentual_acumulado numeric, classe text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with cfg as (select coalesce(p_dias, (select dias_curva_abc from estoque_config where loja_id = p_loja), 90) as dias),
  base as (
    select m.codigo_produto, sum(abs(m.quantidade) * coalesce(m.custo_unitario, 0)) as v
      from estoque_movimentos m, cfg
     where m.loja_id = p_loja and m.tipo = 'SAI' and m.created_at >= now() - make_interval(days => cfg.dias)
     group by m.codigo_produto
  ),
  rot as (select b.codigo_produto, b.v, sum(b.v) over (order by b.v desc, b.codigo_produto) as acum, sum(b.v) over () as total from base b),
  todos as (
    select pr.codigo_produto, coalesce(r.v, 0) as v, r.acum, r.total
      from produtos pr left join rot r on r.codigo_produto = pr.codigo_produto
     where pr.loja_id = p_loja and coalesce(pr.inativo, false) = false
  )
  select t.codigo_produto, t.v,
         case when t.total > 0 then round(coalesce(t.acum, t.total) / t.total * 100, 2) else 100 end,
         case when t.v <= 0 or t.total is null or t.total <= 0 then 'C'
              when (t.acum - t.v) / t.total < 0.80 then 'A'
              when (t.acum - t.v) / t.total < 0.95 then 'B'
              else 'C' end
    from todos t
$$;


--
-- Name: custo_unitario_ficha(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.custo_unitario_ficha(p_loja bigint, p_produto bigint) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select case when count(*) = 0 then null else round(sum(e.quantidade * coalesce(c.cmc, 0)), 6) end
    from expandir_receita(p_loja, p_produto, 1) e
    left join estoque_custos c on c.loja_id = p_loja and c.codigo_produto = e.codigo_insumo
$$;


--
-- Name: desativar_ficha(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.desativar_ficha(p_loja bigint, p_produto bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n int;
begin
  update fichas_tecnicas set ativa = false where loja_id = p_loja and codigo_produto = p_produto and ativa;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'desativadas', n);
end $$;


--
-- Name: estoque_saldo_em(bigint, bigint, bigint, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estoque_saldo_em(p_loja bigint, p_local bigint, p_produto bigint, p_ate timestamp with time zone) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select saldo_apos from estoque_movimentos
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and created_at <= p_ate
     order by id desc limit 1), 0)
$$;


--
-- Name: estornar_compra(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estornar_compra(p_compra_id bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare c compras_proprio%rowtype; i record; n int := 0;
begin
  select * into c from compras_proprio where id = p_compra_id for update;
  if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  if c.status = 'cancelada' then return jsonb_build_object('ok', true, 'estornados', 0, 'duplicado', true); end if;
  for i in select * from compras_proprio_itens where compra_id = c.id and lancado and movimento_id is not null order by linha loop
    perform estornar_movimento(i.movimento_id, p_user, 'Estorno da compra ' || coalesce(c.numero, c.id::text));
    update compras_proprio_itens set lancado = false where id = i.id;
    n := n + 1;
  end loop;
  update compras_proprio set status = 'cancelada', updated_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'estornados', n, 'duplicado', false);
end $$;


--
-- Name: estornar_movimento(bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estornar_movimento(p_id bigint, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare m estoque_movimentos%rowtype;
begin
  select * into m from estoque_movimentos where id = p_id;
  if not found then raise exception 'Movimento % não existe', p_id using errcode = '22023'; end if;
  if m.tipo = 'EST' or m.reverses_id is not null then raise exception 'Estorno não se estorna' using errcode = '22023'; end if;
  return registrar_movimento(m.loja_id, m.codigo_local_estoque, m.codigo_produto,
                             case when m.tipo = 'TRF' then 'TRF' else 'EST' end, 'ESTORNO', 'mov:' || m.id,
                             -m.quantidade, m.custo_unitario, p_user, coalesce(p_obs, 'Estorno do movimento ' || m.id),
                             0, m.id, m.transferencia_ref, null);
end $$;


--
-- Name: estornar_transferencia_item(bigint, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estornar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_modo text; mv movimentos%rowtype; n int := 0;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  select * into mv from movimentos where id = p_movimento and loja_id = p_loja for update;
  if not found then raise exception 'Item de transferência % não existe', p_movimento using errcode = '22023'; end if;
  if mv.ledger_ref is not null then
    n := trf_desfazer_lancamento(p_loja, mv.ledger_ref, p_user);
    update movimentos set ledger_ref = null, status = 'Iniciado', valor = null, updated_at = now() where id = p_movimento;
  end if;
  return jsonb_build_object('ok', true, 'estornados', n);
end $$;


--
-- Name: evolucao_preco_produtos(bigint, bigint[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.evolucao_preco_produtos(p_loja_id bigint, p_codigos bigint[]) RETURNS TABLE(cod_produto bigint, preco_atual numeric, data_atual date, fornecedor_atual text, preco_anterior numeric, data_anterior date)
    LANGUAGE sql STABLE
    AS $$
  with compras as (
    select
      i.n_id_produto::bigint as cod_produto,
      i.n_preco_unit as preco,
      nf.d_emissao_nfe as data,
      coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
      row_number() over (partition by i.n_id_produto order by nf.d_emissao_nfe desc, i.id desc) as rn
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    where i.loja_id = p_loja_id
      and nf.deleted_at is null
      and i.n_id_produto = any(p_codigos)
      and i.n_preco_unit > 0
  )
  select
    c1.cod_produto,
    c1.preco as preco_atual,
    c1.data as data_atual,
    c1.fornecedor as fornecedor_atual,
    c2.preco as preco_anterior,
    c2.data as data_anterior
  from compras c1
  left join compras c2 on c2.cod_produto = c1.cod_produto and c2.rn = 2
  where c1.rn = 1;
$$;


--
-- Name: expandir_receita(bigint, bigint, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric) RETURNS TABLE(codigo_insumo bigint, quantidade numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select e.codigo_insumo, round(sum(e.quantidade), 6)
    from _expandir_receita(p_loja, p_produto, p_quantidade, 0, array[p_produto]) e
   group by e.codigo_insumo
   order by e.codigo_insumo
$$;


--
-- Name: familias_da_loja(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.familias_da_loja(p_loja_id bigint) RETURNS TABLE(descricao_familia character varying)
    LANGUAGE sql STABLE
    AS $$
  select distinct p.descricao_familia
    from produtos p
   where p.loja_id = p_loja_id
     and p.descricao_familia is not null
     and btrim(p.descricao_familia) <> ''
   order by p.descricao_familia
$$;


--
-- Name: fechar_inventario(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fechar_inventario(p_inventario bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  inv inventarios_proprio%rowtype; v record; n_ajustes int := 0; n_contados int := 0; v_valor numeric := 0; v_sem_motivo int; r jsonb;
begin
  select * into inv from inventarios_proprio where id = p_inventario for update;
  if not found then raise exception 'Inventário inexistente' using errcode = '22023'; end if;
  if inv.status = 'fechado' then
    return jsonb_build_object('ok', true, 'duplicado', true, 'ajustes', inv.total_contados, 'valor_ajustes', inv.total_ajustes_valor);
  end if;
  if inv.status <> 'aberto' then raise exception 'Este inventário não está aberto' using errcode = '55000'; end if;

  select count(*) into v_sem_motivo from inventario_variancia(p_inventario) x where x.delta <> 0 and x.exige_motivo and (x.motivo is null or btrim(x.motivo) = '');
  if v_sem_motivo > 0 then
    raise exception 'Faltam motivos em % item(ns) com diferença acima do limite', v_sem_motivo using errcode = '23514';
  end if;

  -- Ordem fixa por produto (evita deadlock com vendas em paralelo).
  for v in select * from inventario_variancia(p_inventario) order by codigo_produto loop
    n_contados := n_contados + 1;
    if v.delta <> 0 then
      r := registrar_movimento(inv.loja_id, inv.codigo_local_estoque, v.codigo_produto, 'AJU', 'INVENTARIO', 'inv-' || inv.id,
                               v.delta, null, p_user, 'Inventário #' || inv.id || coalesce(' — ' || nullif(btrim(v.motivo), ''), ''), 0, null, null, null);
      update inventario_proprio_itens set delta_aplicado = v.delta, movimento_id = (r->>'id')::bigint
       where inventario_id = inv.id and codigo_produto = v.codigo_produto;
      n_ajustes := n_ajustes + 1;
      v_valor := v_valor + v.valor_delta;
    else
      update inventario_proprio_itens set delta_aplicado = 0 where inventario_id = inv.id and codigo_produto = v.codigo_produto;
    end if;
  end loop;

  update inventarios_proprio set status = 'fechado', fechado_por = p_user, fechado_em = now(),
         total_contados = n_contados, total_ajustes_valor = v_valor
   where id = inv.id;
  return jsonb_build_object('ok', true, 'duplicado', false, 'contados', n_contados, 'ajustes', n_ajustes, 'valor_ajustes', v_valor);
end $$;


--
-- Name: ficha_tem_ciclo(bigint, bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ficha_tem_ciclo(p_loja bigint, p_produto bigint, p_insumo bigint) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with recursive descendentes(codigo_produto, nivel) as (
    select p_insumo, 0
    union
    select i.codigo_insumo, d.nivel + 1
      from descendentes d
      join fichas_tecnicas f on f.loja_id = p_loja and f.codigo_produto = d.codigo_produto and f.ativa
      join ficha_tecnica_itens i on i.ficha_id = f.id
     where d.nivel < 12
  )
  select exists (select 1 from descendentes where codigo_produto = p_produto)
$$;


--
-- Name: financeiro_fluxo_caixa(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.financeiro_fluxo_caixa(p_loja_id bigint) RETURNS TABLE(mes text, entradas numeric, saidas numeric, saldo_mes numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  with cr as (
    select to_char(data_vencimento, 'YYYY-MM') as mes, sum(valor_documento) as v
    from contas_receber
    where loja_id = p_loja_id and data_vencimento is not null
    group by 1
  ),
  cp as (
    select to_char(data_vencimento, 'YYYY-MM') as mes, sum(valor_documento) as v
    from contas_pagar
    where loja_id = p_loja_id and data_vencimento is not null
    group by 1
  )
  select
    coalesce(cr.mes, cp.mes)                       as mes,
    coalesce(cr.v, 0)                              as entradas,
    coalesce(cp.v, 0)                              as saidas,
    coalesce(cr.v, 0) - coalesce(cp.v, 0)         as saldo_mes
  from cr
  full outer join cp on cr.mes = cp.mes
  order by mes;
$$;


--
-- Name: financeiro_resumo_cr(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.financeiro_resumo_cr(p_loja_id bigint) RETURNS TABLE(mes text, total numeric, n bigint, atrasado bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  select
    to_char(data_vencimento, 'YYYY-MM') as mes,
    sum(valor_documento) as total,
    count(*) as n,
    count(*) filter (where status_titulo = 'ATRASADO') as atrasado
  from contas_receber
  where loja_id = p_loja_id
    and data_vencimento is not null
  group by to_char(data_vencimento, 'YYYY-MM')
  order by mes;
$$;


--
-- Name: gravar_nota_sefaz(bigint, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gravar_nota_sefaz(p_loja bigint, p_cab jsonb, p_itens jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_modo text; v_chave text := nullif(btrim(coalesce(p_cab->>'chave', '')), '');
  n notas_fiscais%rowtype; v_idr text; v_criada boolean := false; v_nitens int := 0; it jsonb; v_fo jsonb := coalesce(p_cab->'full_object', '{}'::jsonb);
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;

  if v_chave is not null then
    select * into n from notas_fiscais where loja_id = p_loja and c_chave_nfe = v_chave and deleted_at is null for update;
  end if;

  if n.id is null then
    v_idr := nextval('public.seq_nf_proprio')::text;
    insert into notas_fiscais (loja_id, n_id_receb, n_id_fornecedor, c_pessoa_fisica, c_nome, c_razao_social, c_inscricao, c_cnpj_cpf, c_chave_nfe,
        c_etapa, c_numero_nfe, c_serie_nfe, c_modelo_nfe, d_emissao_nfe, n_valor_nfe, c_ambiente_nfe, c_natureza_operacao, full_object, origem)
    values (p_loja, v_idr, null, case when length(regexp_replace(coalesce(p_cab->>'fornecedor_cnpj', ''), '\D', '', 'g')) = 11 then 'S' else 'N' end,
        p_cab->>'fornecedor_fantasia', p_cab->>'fornecedor_nome', p_cab->>'ie', p_cab->>'fornecedor_cnpj', v_chave,
        coalesce(p_cab->>'etapa', '40'), p_cab->>'numero', p_cab->>'serie', p_cab->>'modelo', nullif(p_cab->>'emissao', '')::date,
        coalesce((p_cab->>'valor')::numeric, 0), p_cab->>'ambiente', p_cab->>'natureza', v_fo, 'sefaz')
    returning * into n;
    v_criada := true;
  else
    v_idr := n.n_id_receb;
    update notas_fiscais set
        c_nome = coalesce(p_cab->>'fornecedor_fantasia', c_nome), c_razao_social = coalesce(p_cab->>'fornecedor_nome', c_razao_social),
        c_inscricao = coalesce(p_cab->>'ie', c_inscricao), c_cnpj_cpf = coalesce(p_cab->>'fornecedor_cnpj', c_cnpj_cpf),
        c_numero_nfe = coalesce(p_cab->>'numero', c_numero_nfe), c_serie_nfe = coalesce(p_cab->>'serie', c_serie_nfe),
        c_modelo_nfe = coalesce(p_cab->>'modelo', c_modelo_nfe), d_emissao_nfe = coalesce(nullif(p_cab->>'emissao', '')::date, d_emissao_nfe),
        n_valor_nfe = coalesce((p_cab->>'valor')::numeric, n_valor_nfe), c_natureza_operacao = coalesce(p_cab->>'natureza', c_natureza_operacao),
        -- situação (infoCadastro) que já existe vence: não perde 'recebido' nem 'cancelada'; os demais blocos vêm da versão nova
        full_object = (coalesce(n.full_object, '{}'::jsonb) || v_fo)
                      || jsonb_build_object('infoCadastro', coalesce(v_fo->'infoCadastro', '{}'::jsonb) || coalesce(n.full_object->'infoCadastro', '{}'::jsonb)),
        updated_at = now()
     where id = n.id
    returning * into n;
  end if;

  for it in select value from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_receb, n_sequencia, produto_codigo, n_id_item, n_id_produto, c_codigo_produto,
        c_descricao_produto, c_ncm, c_ean, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_desconto, v_frete, v_total_item, full_object)
    values (p_loja, n.id, v_idr, (it->>'seq')::bigint, nullif(it->>'n_id_produto', ''), (it->>'seq')::bigint, nullif(it->>'n_id_produto', '')::bigint, it->>'c_prod',
        it->>'descricao', it->>'ncm', it->>'ean', it->>'cfop', coalesce((it->>'qtde')::numeric, 0), it->>'unidade',
        coalesce((it->>'preco_unit')::numeric, 0), coalesce((it->>'desconto')::numeric, 0), coalesce((it->>'frete')::numeric, 0),
        coalesce((it->>'total')::numeric, 0), it->'full_object')
    on conflict (loja_id, n_id_receb, n_sequencia) do update set
        c_codigo_produto = excluded.c_codigo_produto, c_descricao_produto = excluded.c_descricao_produto, c_ncm = excluded.c_ncm, c_ean = excluded.c_ean,
        c_cfop = excluded.c_cfop, n_qtde_nfe = excluded.n_qtde_nfe, c_unidade_nfe = excluded.c_unidade_nfe, n_preco_unit = excluded.n_preco_unit,
        v_desconto = excluded.v_desconto, v_frete = excluded.v_frete, v_total_item = excluded.v_total_item,
        n_id_produto = coalesce(nota_fiscal_items.n_id_produto, excluded.n_id_produto),
        produto_codigo = coalesce(nota_fiscal_items.produto_codigo, excluded.produto_codigo),
        full_object = coalesce(excluded.full_object, nota_fiscal_items.full_object), updated_at = now();
    v_nitens := v_nitens + 1;
  end loop;

  return jsonb_build_object('ok', true, 'nota_id', n.id, 'n_id_receb', v_idr, 'criada', v_criada, 'itens', v_nitens);
end $$;


--
-- Name: inventario_cobertura(bigint, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventario_cobertura(p_loja_id bigint, p_ini date, p_fim date, p_periodo text DEFAULT 'dia'::text) RETURNS TABLE(periodo_inicio date, qtd_inventarios bigint, produtos_contados bigint, total_produtos bigint)
    LANGUAGE sql STABLE
    AS $$
  with trunc_unit as (
    select case p_periodo
      when 'semana' then 'week'
      when 'mes'    then 'month'
      else               'day'
    end as u
  ),
  grupos as (
    select
      date_trunc((select u from trunc_unit), inv.data::date)::date as per,
      count(distinct inv.id) as qtd_inv,
      count(distinct ii.produto_codigo_produto) as prod_contados
    from inventarios inv
    left join inventario_items ii
      on ii.inventario_id = inv.id and ii.loja_id = inv.loja_id
    where inv.loja_id = p_loja_id
      and inv.data::date >= p_ini
      and inv.data::date <= p_fim
    group by 1
  ),
  total as (
    select count(*) as total_prod
    from produtos
    where loja_id = p_loja_id and inativo = false
  )
  select
    g.per as periodo_inicio,
    g.qtd_inv as qtd_inventarios,
    g.prod_contados as produtos_contados,
    t.total_prod as total_produtos
  from grupos g, total t
  order by g.per desc;
$$;


--
-- Name: inventario_nao_contados(bigint, bigint, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventario_nao_contados(p_inventario_id bigint, p_loja_id bigint, p_tipo_item text DEFAULT NULL::text, p_familia text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50) RETURNS TABLE(codigo_produto bigint, codigo text, descricao text, tipo_item text, descricao_familia text, unidade text, saldo numeric, estoque_minimo numeric, total bigint)
    LANGUAGE sql STABLE
    AS $$
  with foto_max as (
    select max(data_posicao) as dp
    from posicao_estoques
    where loja_id = p_loja_id
  ),
  saldos as (
    select n_cod_prod, sum(n_saldo) as saldo
    from posicao_estoques pe, foto_max
    where pe.loja_id = p_loja_id and pe.data_posicao = foto_max.dp
    group by n_cod_prod
  ),
  filtrados as (
    select p.codigo_produto, p.codigo, p.descricao, p.tipo_item, p.descricao_familia, p.unidade,
           coalesce(s.saldo, 0) as saldo, coalesce(p.estoque_minimo, 0) as estoque_minimo
    from produtos p
    left join saldos s on s.n_cod_prod = p.codigo_produto
    where p.loja_id = p_loja_id
      and p.inativo = false
      and not exists (
        select 1 from inventario_items ii
        where ii.inventario_id = p_inventario_id
          and ii.produto_codigo_produto = p.codigo_produto
      )
      and (p_tipo_item is null or p.tipo_item = p_tipo_item)
      and (p_familia   is null or p.descricao_familia = p_familia)
      and (p_busca     is null
           or p.descricao ilike '%' || p_busca || '%'
           or p.codigo    ilike '%' || p_busca || '%')
  )
  select
    f.codigo_produto, f.codigo, f.descricao, f.tipo_item, f.descricao_familia, f.unidade,
    f.saldo, f.estoque_minimo,
    count(*) over() as total
  from filtrados f
  order by f.descricao
  offset p_offset limit p_limit;
$$;


--
-- Name: inventario_variancia(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inventario_variancia(p_inventario bigint) RETURNS TABLE(codigo_produto bigint, saldo_snapshot numeric, esperado numeric, contado numeric, contado_em timestamp with time zone, delta numeric, cmc numeric, valor_delta numeric, motivo text, exige_motivo boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with inv as (select i.* from inventarios_proprio i where i.id = p_inventario),
  lim as (select coalesce((select limite_motivo_inventario from estoque_config c where c.loja_id = (select loja_id from inv)), 50.00) as v)
  select it.codigo_produto, it.saldo_snapshot,
         estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em) as esperado,
         it.contado, it.contado_em,
         it.contado - estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em) as delta,
         coalesce(c.cmc, 0),
         round((it.contado - estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em)) * coalesce(c.cmc, 0), 4),
         it.motivo,
         abs((it.contado - estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em)) * coalesce(c.cmc, 0)) > (select v from lim)
    from inventario_proprio_itens it
    left join estoque_custos c on c.loja_id = it.loja_id and c.codigo_produto = it.codigo_produto
   where it.inventario_id = p_inventario and it.contado is not null
$$;


--
-- Name: kardex_proprio(bigint, date, date, text, text, text, bigint, text, text, boolean, boolean, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kardex_proprio(p_loja bigint, p_ini date, p_fim date, p_texto text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_familia text DEFAULT NULL::text, p_usuario text DEFAULT NULL::text, p_so_negativos boolean DEFAULT false, p_so_estornos boolean DEFAULT false, p_ord text DEFAULT 'data'::text, p_dir text DEFAULT 'desc'::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: lancar_compra(jsonb, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lancar_compra(p_compra jsonb, p_local bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_loja bigint := (p_compra->>'loja_id')::bigint;
  v_modo text; v_chave text := nullif(btrim(coalesce(p_compra->>'chave_acesso', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_compra->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
  v_comp compras_proprio%rowtype; d record; it compras_proprio_itens%rowtype;
  v_total_liq numeric; v_n int; v_share numeric; v_custo_total numeric; v_qtd_base numeric; v_custo_unit numeric;
  v_ref text; r jsonb; v_lanc int := 0; v_pend int := 0; v_ja int := 0; v_saida jsonb := '[]'::jsonb; v_status text;
  v_nitens int; v_tinha_pendente boolean;
begin
  select modo_estoque into v_modo from lojas where id = v_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', v_loja using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = v_loja and codigo_local_estoque = p_local) then
    raise exception 'Local de estoque % inexistente', p_local using errcode = '22023';
  end if;

  -- compra existente (por id ou por chave) ou nova
  if nullif(p_compra->>'id', '') is not null then
    select * into v_comp from compras_proprio where id = (p_compra->>'id')::bigint and loja_id = v_loja for update;
    if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  elsif v_chave is not null then
    select * into v_comp from compras_proprio where loja_id = v_loja and chave_acesso = v_chave for update;
  end if;
  if v_comp.id is null then
    insert into compras_proprio (loja_id, origem, chave_acesso, numero, serie, fornecedor_cnpj, fornecedor_nome, emissao,
        valor_produtos, valor_frete, valor_desconto, valor_total, icms_recuperavel, codigo_local_estoque, user_id, obs)
    values (v_loja, coalesce(p_compra->>'origem', case when v_chave is null then 'manual' else 'xml' end), v_chave,
        p_compra->>'numero', p_compra->>'serie', v_cnpj, p_compra->>'fornecedor_nome', nullif(p_compra->>'emissao', '')::date,
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0),
        coalesce((p_compra->>'valor_frete')::numeric, 0), coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0) - coalesce((x->>'desconto')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0)
          + coalesce((p_compra->>'valor_frete')::numeric, 0) - coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((p_compra->>'icms_recuperavel')::boolean, false), p_local, p_user, p_compra->>'obs')
    returning * into v_comp;
  elsif v_comp.status = 'cancelada' then
    raise exception 'Compra cancelada não pode ser lançada de novo' using errcode = '22023';
  end if;

  -- itens: cria os que faltam; nos já existentes só atualiza o mapeamento (e só se ainda não lançados)
  for d in select value as item, ordinality::int as ord from jsonb_array_elements(coalesce(p_compra->'itens', '[]'::jsonb)) with ordinality loop
    insert into compras_proprio_itens (compra_id, loja_id, linha, c_prod, ean, descricao, ncm, cfop, unidade_compra,
        quantidade, valor_unitario, valor_total, desconto, icms_valor, fator, codigo_produto)
    values (v_comp.id, v_loja, coalesce((d.item->>'linha')::int, d.ord), d.item->>'c_prod', d.item->>'ean', d.item->>'descricao',
        d.item->>'ncm', d.item->>'cfop', d.item->>'unidade_compra', coalesce((d.item->>'quantidade')::numeric, 0),
        coalesce((d.item->>'valor_unitario')::numeric, 0), coalesce((d.item->>'valor_total')::numeric, 0),
        coalesce((d.item->>'desconto')::numeric, 0), coalesce((d.item->>'icms_valor')::numeric, 0),
        coalesce(nullif((d.item->>'fator')::numeric, 0), 1), nullif(d.item->>'codigo_produto', '')::bigint)
    on conflict (compra_id, linha) do update
      set codigo_produto = coalesce(excluded.codigo_produto, compras_proprio_itens.codigo_produto),
          fator = case when excluded.codigo_produto is not null then excluded.fator else compras_proprio_itens.fator end
      where not compras_proprio_itens.lancado;
  end loop;

  -- completa o mapeamento pelo de-para do fornecedor
  if v_cnpj is null then v_cnpj := v_comp.fornecedor_cnpj; end if;
  if v_cnpj is not null then
    update compras_proprio_itens i set codigo_produto = dp.codigo_produto, fator = dp.fator
      from fornecedor_produto_depara dp
     where i.compra_id = v_comp.id and not i.lancado and i.codigo_produto is null and i.c_prod is not null
       and dp.loja_id = v_loja and dp.fornecedor_cnpj = v_cnpj and dp.c_prod = i.c_prod;
  end if;

  -- rateio estável: base = valor líquido de TODOS os itens (não depende da ordem de mapeamento)
  select coalesce(sum(valor_total - desconto), 0), count(*) into v_total_liq, v_n from compras_proprio_itens where compra_id = v_comp.id;
  v_ref := coalesce(v_comp.chave_acesso, 'compra:' || v_comp.id);

  for it in select * from compras_proprio_itens where compra_id = v_comp.id order by linha loop
    if it.lancado then v_ja := v_ja + 1; continue; end if;
    v_qtd_base := it.quantidade * it.fator;
    if it.codigo_produto is null or v_qtd_base <= 0
       or not exists (select 1 from produtos where loja_id = v_loja and codigo_produto = it.codigo_produto) then
      v_pend := v_pend + 1;
      v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', false,
          'motivo', case when it.codigo_produto is null then 'sem_produto' when v_qtd_base <= 0 then 'quantidade_zero' else 'produto_inexistente' end);
      continue;
    end if;
    v_share := case when v_total_liq > 0 then (it.valor_total - it.desconto) / v_total_liq else 1.0 / greatest(v_n, 1) end;
    v_custo_total := (it.valor_total - it.desconto) + v_comp.valor_frete * v_share - v_comp.valor_desconto * v_share
                     - case when v_comp.icms_recuperavel then it.icms_valor else 0 end;
    v_custo_unit := round(v_custo_total / v_qtd_base, 6);
    r := registrar_movimento(v_loja, p_local, it.codigo_produto, 'ENT', 'COMPRA', v_ref, v_qtd_base,
                             case when v_custo_unit > 0 then v_custo_unit else null end, p_user,
                             'Compra ' || coalesce(v_comp.numero, v_comp.id::text), it.linha, null, null, null);
    update compras_proprio_itens set lancado = true, movimento_id = (r->>'id')::bigint, custo_unitario_base = v_custo_unit where id = it.id;
    if v_cnpj is not null and it.c_prod is not null then
      insert into fornecedor_produto_depara (loja_id, fornecedor_cnpj, c_prod, codigo_produto, fator, unidade_compra)
      values (v_loja, v_cnpj, it.c_prod, it.codigo_produto, it.fator, it.unidade_compra)
      on conflict (loja_id, fornecedor_cnpj, c_prod) do update
        set codigo_produto = excluded.codigo_produto, fator = excluded.fator, unidade_compra = excluded.unidade_compra, updated_at = now();
    end if;
    v_lanc := v_lanc + 1;
    v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', true, 'saldo', r->'saldo', 'cmc', r->'cmc',
                                             'custo_unitario_base', v_custo_unit, 'duplicado', r->'duplicado');
  end loop;

  select count(*) into v_nitens from compras_proprio_itens where compra_id = v_comp.id;
  v_status := case when v_nitens = 0 or (v_lanc + v_ja) = 0 then 'pendente' when (v_lanc + v_ja) < v_nitens then 'parcial' else 'lancada' end;
  update compras_proprio set status = v_status, codigo_local_estoque = p_local, updated_at = now(),
         lancada_em = case when v_status = 'lancada' then coalesce(lancada_em, now()) else lancada_em end
   where id = v_comp.id;

  return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'status', v_status, 'lancados', v_lanc, 'ja_lancados', v_ja,
                            'pendentes', v_pend, 'duplicado', (v_lanc = 0 and v_ja > 0 and v_pend = 0), 'itens', v_saida);
end $$;


--
-- Name: lancar_compra_com_lotes(jsonb, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lancar_compra_com_lotes(p_compra jsonb, p_local bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_map jsonb := '{}'::jsonb; d record; r jsonb;
begin
  for d in select value as item, ordinality::int as ord from jsonb_array_elements(coalesce(p_compra->'itens', '[]'::jsonb)) with ordinality loop
    if nullif(btrim(d.item->>'lote'), '') is not null or nullif(d.item->>'validade', '') is not null then
      v_map := v_map || jsonb_build_object(coalesce((d.item->>'linha')::int, d.ord)::text,
                 jsonb_build_object('lote', nullif(btrim(d.item->>'lote'), ''), 'validade', nullif(d.item->>'validade', '')));
    end if;
  end loop;
  perform set_config('estoque.lotes_compra', v_map::text, true);
  r := lancar_compra(p_compra, p_local, p_user);
  perform set_config('estoque.lotes_compra', '', true);
  update compras_proprio_itens i
     set lote = nullif(v_map -> i.linha::text ->> 'lote', ''), validade = nullif(v_map -> i.linha::text ->> 'validade', '')::date
   where i.compra_id = (r->>'compra_id')::bigint and v_map ? i.linha::text;
  return r;
end $$;


--
-- Name: lancar_transferencia_item(bigint, bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lancar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_modo text; mv movimentos%rowtype; v_de bigint; v_para bigint; v_ref text; v_res jsonb; v_cmc numeric;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  select * into mv from movimentos where id = p_movimento and loja_id = p_loja for update;
  if not found then raise exception 'Item de transferência % não existe', p_movimento using errcode = '22023'; end if;
  if mv.transferencia_id is null then raise exception 'Movimento % não pertence a uma transferência', p_movimento using errcode = '22023'; end if;
  if mv.quan is null or mv.quan <= 0 then raise exception 'Informe uma quantidade maior que zero' using errcode = '22023'; end if;
  v_de := mv.codigo_local_estoque; v_para := mv.codigo_local_estoque_destino;
  if v_de is null or v_para is null or v_de = v_para then raise exception 'Origem e destino precisam ser locais diferentes' using errcode = '22023'; end if;

  if mv.ledger_ref is not null then
    perform trf_desfazer_lancamento(p_loja, mv.ledger_ref, p_user);
  end if;
  v_ref := 'trf:' || p_movimento || ':v' || (mv.ledger_versao + 1);
  v_res := transferir_estoque(p_loja, v_de, v_para, mv.id_prod, mv.quan, v_ref, p_user, p_obs);
  select cmc into v_cmc from estoque_custos where loja_id = p_loja and codigo_produto = mv.id_prod;

  update movimentos
     set ledger_ref = v_ref, ledger_versao = mv.ledger_versao + 1, status = 'Concluido', valor = v_cmc,
         codigo_status = null, descricao_status = null, response = null, tentativas = 0, updated_at = now()
   where id = p_movimento;
  return jsonb_build_object('ok', true, 'ref', v_ref, 'cmc', v_cmc, 'saida', v_res -> 'saida', 'entrada', v_res -> 'entrada');
end $$;


--
-- Name: lucro_proprio(bigint, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text DEFAULT 'produto'::text) RETURNS TABLE(rotulo text, quantidade numeric, faturamento numeric, cmv numeric, lucro numeric, margem numeric, itens_sem_baixa integer, itens_sem_custo integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: meses_arquivaveis(text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.meses_arquivaveis(p_tabela text, p_col text, p_corte date) RETURNS TABLE(periodo text, linhas bigint)
    LANGUAGE plpgsql
    AS $_$
begin
  return query execute format(
    'select to_char(%1$I, ''YYYY-MM'') as periodo, count(*)::bigint as linhas
       from %2$I
      where %1$I is not null and %1$I < $1
      group by 1 order by 1',
    p_col, p_tabela
  ) using p_corte;
end;
$_$;


--
-- Name: motivo_item_inventario(bigint, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.motivo_item_inventario(p_inventario bigint, p_produto bigint, p_motivo text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update inventario_proprio_itens set motivo = nullif(btrim(p_motivo), '')
   where inventario_id = p_inventario and codigo_produto = p_produto
     and exists (select 1 from inventarios_proprio i where i.id = p_inventario and i.status = 'aberto');
  if not found then raise exception 'Item não encontrado em inventário aberto' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end $$;


--
-- Name: nf_bate_status(text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.nf_bate_status(p_c_etapa text, p_full_object jsonb, p_status text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select case coalesce(p_status, 'CONCLUIDA')
    when 'TODAS' then true
    when 'CANCELADA' then coalesce(p_full_object->'infoCadastro'->>'cCancelada', 'N') = 'S'
    when 'MANIFESTADA' then coalesce(p_full_object->'infoCadastro'->>'cRecebido', 'N') = 'S'
    when 'PENDENTE' then p_c_etapa <> '60' and coalesce(p_full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    else p_c_etapa = '60' and coalesce(p_full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
  end;
$$;


--
-- Name: novo_id_local_proprio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.novo_id_local_proprio() RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select nextval('public.seq_id_local_proprio') $$;


--
-- Name: novo_id_produto_proprio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.novo_id_produto_proprio() RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select nextval('public.seq_id_produto_proprio') $$;


--
-- Name: op_proprio_alterar(bigint, bigint, date, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.op_proprio_alterar(p_loja bigint, p_op bigint, p_data date DEFAULT NULL::date, p_qtde numeric DEFAULT NULL::numeric, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o ordens_producao%rowtype; v_qtd numeric;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then raise exception 'Não dá para alterar uma OP concluída. Reverta a conclusão primeiro.' using errcode = '22023'; end if;
  if p_qtde is not null and p_qtde <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  v_qtd := coalesce(p_qtde, o.identificacao_n_qtde);
  update ordens_producao set
    identificacao_d_dt_previsao = coalesce(p_data, identificacao_d_dt_previsao),
    adicionais_d_dt_inicio = coalesce(p_data, adicionais_d_dt_inicio),
    identificacao_n_qtde = v_qtd,
    full_object = _op_itens_detalhes(p_loja, o.identificacao_n_cod_produto, v_qtd),
    updated_at = now()
  where id = o.id;
  insert into op_qtde_planejada (loja_id, n_cod_op, qtde_planejada, dt_previsao, ultima_vez_em)
  values (p_loja, o.identificacao_n_cod_op, v_qtd, coalesce(p_data, o.identificacao_d_dt_previsao), (now() at time zone 'America/Sao_Paulo')::date)
  on conflict (loja_id, n_cod_op) do update set qtde_planejada = excluded.qtde_planejada, dt_previsao = excluded.dt_previsao, ultima_vez_em = excluded.ultima_vez_em;
  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'alterada', p_user, v_qtd,
          jsonb_build_object('data_antes', o.identificacao_d_dt_previsao, 'data_depois', coalesce(p_data, o.identificacao_d_dt_previsao),
                             'qtde_antes', o.identificacao_n_qtde, 'qtde_depois', v_qtd));
  return jsonb_build_object('ok', true, 'n_cod_op', o.identificacao_n_cod_op);
end $$;


--
-- Name: op_proprio_concluir(bigint, bigint, date, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.op_proprio_concluir(p_loja bigint, p_op bigint, p_data date DEFAULT NULL::date, p_qtde numeric DEFAULT NULL::numeric, p_user text DEFAULT NULL::text, p_user_uuid uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  o ordens_producao%rowtype; v_qtd numeric; v_n int; v_ref text; v_consumo bigint; v_destino bigint; v_res jsonb; v_ficha fichas_tecnicas%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then raise exception 'Esta OP já está concluída' using errcode = '22023'; end if;
  v_qtd := coalesce(nullif(p_qtde, 0), o.identificacao_n_qtde, 1);
  if v_qtd <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  v_consumo := coalesce(o.identificacao_codigo_local_estoque,
                        (select codigo_local_estoque from local_estoques where loja_id = p_loja and padrao = 'S' order by id limit 1));
  if v_consumo is null then raise exception 'A OP não tem local de estoque e a loja não tem local padrão' using errcode = '22023'; end if;
  v_destino := coalesce(o.local_destino, v_consumo);
  v_n := o.producao_n + 1;
  v_ref := 'OP:' || o.id || ':' || v_n;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = o.identificacao_n_cod_produto and ativa;

  v_res := produzir(p_loja, o.identificacao_n_cod_produto, v_qtd, v_consumo, v_destino, v_ref, p_user,
                    'OP ' || coalesce(o.identificacao_c_num_op, o.id::text));

  update ordens_producao set
    concluida = true, dt_conclusao_real = least(coalesce(p_data, v_hoje), v_hoje), concluida_por = p_user_uuid, concluida_por_nome = p_user,
    identificacao_n_qtde = v_qtd, producao_ref = v_ref, producao_n = v_n,
    ficha_id = v_ficha.id, ficha_versao = v_ficha.versao,
    custo_total = (v_res ->> 'custo_total')::numeric, custo_unitario = (v_res ->> 'custo_unitario')::numeric,
    full_object = _op_itens_detalhes(p_loja, o.identificacao_n_cod_produto, v_qtd),
    conclusao_status = null, conclusao_erro_msg = null, conclusao_tentativas = 0, updated_at = now()
  where id = o.id;

  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, user_uuid, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'concluida', p_user, p_user_uuid, v_qtd,
          jsonb_build_object('ref', v_ref, 'ficha_versao', v_ficha.versao, 'custo_total', v_res -> 'custo_total', 'custo_unitario', v_res -> 'custo_unitario',
                             'local_consumo', v_consumo, 'local_destino', v_destino, 'data', least(coalesce(p_data, v_hoje), v_hoje)));

  return v_res || jsonb_build_object('op_id', o.id, 'ref', v_ref);
end $$;


--
-- Name: op_proprio_criar(bigint, bigint, date, numeric, bigint, bigint, date, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.op_proprio_criar(p_loja bigint, p_produto bigint, p_data date, p_qtde numeric, p_local bigint DEFAULT NULL::bigint, p_local_destino bigint DEFAULT NULL::bigint, p_validade date DEFAULT NULL::date, p_obs text DEFAULT NULL::text, p_user text DEFAULT NULL::text, p_venda_ref text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_modo text; v_pr produtos%rowtype; v_local bigint; v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_n int; v_cod bigint; v_num text; v_id bigint; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ficha fichas_tecnicas%rowtype;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_qtde is null or p_qtde <= 0 then raise exception 'Informe a quantidade' using errcode = '22023'; end if;
  select * into v_pr from produtos where loja_id = p_loja and codigo_produto = p_produto;
  if not found then raise exception 'Produto % não existe nesta loja', p_produto using errcode = '22023'; end if;
  v_local := coalesce(p_local, (select codigo_local_estoque from local_estoques where loja_id = p_loja and padrao = 'S' order by id limit 1));
  if v_local is not null and not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = v_local) then
    raise exception 'Local de estoque inexistente' using errcode = '22023';
  end if;
  if p_local_destino is not null and not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_destino) then
    raise exception 'Local de destino inexistente' using errcode = '22023';
  end if;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;

  insert into op_numeracao (loja_id, ano, ultimo) values (p_loja, v_ano, 1)
    on conflict (loja_id, ano) do update set ultimo = op_numeracao.ultimo + 1 returning ultimo into v_n;
  v_num := v_ano || '/' || lpad(v_n::text, 5, '0');
  v_cod := nextval('public.seq_op_proprio');

  insert into ordens_producao (
    loja_id, num_ordem, validade, identificacao_n_cod_op, identificacao_c_cod_int_op, identificacao_c_num_op,
    identificacao_n_cod_produto, identificacao_c_cod_int_prod, identificacao_d_dt_previsao, identificacao_n_qtde,
    identificacao_codigo_local_estoque, local_destino, adicionais_d_dt_inicio, produto_codigo, produto_descricao,
    produto_tipo_item, produto_unidade, concluida, dt_inclusao, observacao, full_object, criada_por, ficha_id, ficha_versao, venda_ref
  ) values (
    p_loja, v_num, p_validade, v_cod, 'NTB-' || v_cod, v_num,
    p_produto, v_pr.codigo, coalesce(p_data, v_hoje), p_qtde,
    v_local, p_local_destino, coalesce(p_data, v_hoje), v_pr.codigo, v_pr.descricao,
    v_pr.tipo_item, v_pr.unidade, false, v_hoje, nullif(btrim(concat_ws(' · ', p_obs, p_user)), ''),
    _op_itens_detalhes(p_loja, p_produto, p_qtde), p_user, v_ficha.id, v_ficha.versao, p_venda_ref
  ) returning id into v_id;

  -- Previsto x produzido (relatório de produção): guarda o planejado enquanto a OP está aberta.
  insert into op_qtde_planejada (loja_id, n_cod_op, qtde_planejada, dt_previsao, ultima_vez_em)
  values (p_loja, v_cod, p_qtde, coalesce(p_data, v_hoje), v_hoje)
  on conflict (loja_id, n_cod_op) do update set qtde_planejada = excluded.qtde_planejada, dt_previsao = excluded.dt_previsao, ultima_vez_em = excluded.ultima_vez_em;

  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, v_id, v_cod, v_num, 'criada', p_user, p_qtde,
          jsonb_build_object('produto', p_produto, 'data_prevista', coalesce(p_data, v_hoje), 'local_consumo', v_local, 'local_destino', p_local_destino,
                             'ficha_versao', v_ficha.versao, 'venda_ref', p_venda_ref));

  return jsonb_build_object('ok', true, 'id', v_id, 'n_cod_op', v_cod, 'num_op', v_num);
end $$;


--
-- Name: op_proprio_detalhe(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.op_proprio_detalhe(p_loja bigint, p_op bigint) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o ordens_producao%rowtype; v_ficha jsonb; v_exec jsonb; v_hist jsonb;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja;
  if not found then return null; end if;

  select jsonb_build_object('id', f.id, 'versao', f.versao, 'rendimento', f.rendimento, 'ativa', f.ativa, 'itens', coalesce((
           select jsonb_agg(jsonb_build_object('codigo_insumo', i.codigo_insumo, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
                    'quantidade_liquida', i.quantidade_liquida, 'fator_correcao', i.fator_correcao, 'perda_pct', i.perda_pct, 'quantidade_bruta', i.quantidade_bruta) order by i.ordem)
             from ficha_tecnica_itens i left join produtos p on p.loja_id = f.loja_id and p.codigo_produto = i.codigo_insumo where i.ficha_id = f.id), '[]'::jsonb))
    into v_ficha from fichas_tecnicas f where f.id = o.ficha_id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.n), '[]'::jsonb) into v_exec from (
    select (regexp_replace(op.ref, '^OP:\d+:', ''))::int as n, op.ref, op.status, op.quantidade, op.custo_total, op.custo_unitario, op.local_consumo, op.local_destino,
           op.user_id, op.created_at,
           (select jsonb_agg(jsonb_build_object('codigo_insumo', it.codigo_insumo, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
                    'quantidade_bruta', it.quantidade, 'custo_unitario', it.custo_unitario, 'custo_total', round(it.quantidade * it.custo_unitario, 6), 'movimento_id', it.movimento_id)
                    order by it.id)
              from ordens_producao_proprio_itens it left join produtos p on p.loja_id = op.loja_id and p.codigo_produto = it.codigo_insumo where it.ordem_id = op.id) as insumos,
           (select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'codigo_produto', m.codigo_produto, 'codigo', p.codigo, 'descricao', p.descricao,
                    'codigo_local_estoque', m.codigo_local_estoque, 'local', l.descricao, 'quantidade', m.quantidade, 'custo_unitario', m.custo_unitario,
                    'saldo_apos', m.saldo_apos, 'created_at', m.created_at,
                    'estornado', exists (select 1 from estoque_movimentos r where r.reverses_id = m.id)) order by m.id)
              from estoque_movimentos m
              left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.codigo_produto
              left join local_estoques l on l.loja_id = m.loja_id and l.codigo_local_estoque = m.codigo_local_estoque
             where m.loja_id = op.loja_id and m.origem = 'PRODUCAO' and m.ref = op.ref) as movimentos
      from ordens_producao_proprio op
     where op.loja_id = p_loja and op.ref like 'OP:' || o.id || ':%'
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'evento', h.evento, 'user_nome', h.user_nome, 'quantidade', h.quantidade, 'detalhes', h.detalhes, 'created_at', h.created_at)
                  order by h.id), '[]'::jsonb)
    into v_hist from op_historico h where h.loja_id = p_loja and h.n_cod_op = o.identificacao_n_cod_op;

  return jsonb_build_object('ficha', v_ficha, 'execucoes', v_exec, 'historico', v_hist);
end $$;


--
-- Name: op_proprio_excluir(bigint, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.op_proprio_excluir(p_loja bigint, p_op bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o ordens_producao%rowtype;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then perform op_proprio_reverter(p_loja, p_op, p_user); end if;
  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'excluida', p_user, o.identificacao_n_qtde, '{}'::jsonb);
  delete from op_qtde_planejada where loja_id = p_loja and n_cod_op = o.identificacao_n_cod_op;
  delete from ordens_producao where id = p_op and loja_id = p_loja;
  return jsonb_build_object('ok', true);
end $$;


--
-- Name: op_proprio_ids_por_insumo(bigint, bigint[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.op_proprio_ids_por_insumo(p_loja bigint, p_codigos bigint[]) RETURNS TABLE(id bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select o.id from ordens_producao o
   where o.loja_id = p_loja
     and exists (select 1 from jsonb_array_elements(coalesce(o.full_object -> 'itensDetalhes', '[]'::jsonb)) e
                  where (e ->> 'nIdProdutoMalha')::bigint = any (p_codigos))
$$;


--
-- Name: op_proprio_reverter(bigint, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.op_proprio_reverter(p_loja bigint, p_op bigint, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  o ordens_producao%rowtype; m record; v_prods bigint[]; v_cont int := 0;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if not coalesce(o.concluida, false) then raise exception 'Só dá para reverter uma OP concluída' using errcode = '22023'; end if;
  if o.producao_ref is not null then
    select array_agg(distinct codigo_produto order by codigo_produto) into v_prods
      from estoque_movimentos where loja_id = p_loja and origem = 'PRODUCAO' and ref = o.producao_ref;
    if v_prods is not null then perform _travar_custos(p_loja, v_prods); end if;
    for m in select id from estoque_movimentos where loja_id = p_loja and origem = 'PRODUCAO' and ref = o.producao_ref order by id desc loop
      perform estornar_movimento(m.id, p_user, 'Reversão da OP ' || coalesce(o.identificacao_c_num_op, o.id::text));
      v_cont := v_cont + 1;
    end loop;
    update ordens_producao_proprio set status = 'revertida' where loja_id = p_loja and ref = o.producao_ref;
  end if;
  update ordens_producao set concluida = false, dt_conclusao_real = null, concluida_por = null, concluida_por_nome = null,
         revertida_em = now(), revertida_por = p_user, custo_total = null, custo_unitario = null, updated_at = now()
   where id = o.id;
  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'revertida', p_user, o.identificacao_n_qtde,
          jsonb_build_object('ref', o.producao_ref, 'estornados', v_cont));
  return jsonb_build_object('ok', true, 'estornados', v_cont);
end $$;


--
-- Name: ops_relacionadas_por_produto(bigint, bigint[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_relacionadas_por_produto(p_loja_id bigint, p_produto_codes bigint[], p_data_ini date, p_data_fim date) RETURNS TABLE(id bigint, identificacao_n_cod_op bigint, identificacao_c_num_op text, num_ordem text, identificacao_n_cod_produto bigint, identificacao_n_qtde numeric, identificacao_codigo_local_estoque bigint, dt_conclusao_real date, identificacao_d_dt_previsao date, concluida boolean, insumos_batidos bigint[], data_ref date)
    LANGUAGE sql STABLE
    AS $_$
  select
    op.id,
    op.identificacao_n_cod_op,
    op.identificacao_c_num_op,
    op.num_ordem,
    op.identificacao_n_cod_produto,
    op.identificacao_n_qtde,
    op.identificacao_codigo_local_estoque,
    op.dt_conclusao_real,
    op.identificacao_d_dt_previsao,
    op.concluida,
    array_agg(distinct (item ->> 'nIdProdutoMalha')::bigint) as insumos_batidos,
    coalesce(op.dt_conclusao_real, op.identificacao_d_dt_previsao) as data_ref
  from ordens_producao op,
       jsonb_array_elements(coalesce(op.full_object -> 'itensDetalhes', '[]'::jsonb)) as item
  where op.loja_id = p_loja_id
    and coalesce(op.dt_conclusao_real, op.identificacao_d_dt_previsao) between p_data_ini and p_data_fim
    and (item ->> 'nIdProdutoMalha') ~ '^\d+$'
    and (item ->> 'nIdProdutoMalha')::bigint = any(p_produto_codes)
  group by op.id, op.identificacao_n_cod_op, op.identificacao_c_num_op, op.num_ordem,
           op.identificacao_n_cod_produto, op.identificacao_n_qtde, op.identificacao_codigo_local_estoque,
           op.dt_conclusao_real, op.identificacao_d_dt_previsao, op.concluida
  order by data_ref desc
$_$;


--
-- Name: outbox_capture(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.outbox_capture() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if (tg_op = 'DELETE') then
    insert into outbox (table_name, operation, row_data) values (tg_table_name, tg_op, row_to_json(old)::jsonb);
    return old;
  end if;
  -- update sem mudança real (sync do Omie reescreve linhas iguais) não precisa de replay
  if (tg_op = 'UPDATE' and old is not distinct from new) then
    return new;
  end if;
  insert into outbox (table_name, operation, row_data) values (tg_table_name, tg_op, row_to_json(new)::jsonb);
  return new;
end;
$$;


--
-- Name: prefixo_codigo_por_tipo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prefixo_codigo_por_tipo(p_tipo_item text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case coalesce(p_tipo_item, '04')
    when '04' then '90' when '00' then '90'
    when '01' then '80'
    when '03' then '70' when '06' then '70' when '05' then '70'
    when '07' then '60' when '10' then '60'
    else '50' end
$$;


--
-- Name: produtos_repor(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.produtos_repor(p_loja_id bigint) RETURNS SETOF bigint
    LANGUAGE sql STABLE
    AS $$
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
    and coalesce(p.estoque_minimo, pos.min_omie) > 0
    and greatest(0, coalesce(p.estoque_minimo, pos.min_omie) + coalesce(pv.qtde, 0) - pos.saldo) > 0;
$$;


--
-- Name: produzir(bigint, bigint, numeric, bigint, bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ex ordens_producao_proprio%rowtype; v_ids bigint[]; r record; v_res jsonb;
  v_total numeric := 0; v_custo_un numeric; v_ordem bigint; v_out jsonb; v_itens jsonb := '[]'::jsonb;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade a produzir deve ser maior que zero' using errcode = '22023'; end if;
  if p_ref is null or btrim(p_ref) = '' then raise exception 'ref é obrigatório (idempotência)' using errcode = '22023'; end if;

  select * into v_ex from ordens_producao_proprio where loja_id = p_loja and ref = p_ref;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'ordem_id', v_ex.id, 'custo_unitario', v_ex.custo_unitario, 'custo_total', v_ex.custo_total);
  end if;

  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then raise exception 'O produto % não tem ficha técnica ativa', p_produto using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_consumo)
     or not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_destino) then
    raise exception 'Local de consumo ou de destino inexistente' using errcode = '22023';
  end if;

  select array_agg(e.codigo_insumo) into v_ids from expandir_receita(p_loja, p_produto, p_quantidade) e;
  perform _travar_custos(p_loja, coalesce(v_ids, '{}') || p_produto);

  insert into ordens_producao_proprio (loja_id, ref, codigo_produto, ficha_id, quantidade, local_consumo, local_destino, user_id, obs)
  values (p_loja, p_ref, p_produto, v_ficha.id, p_quantidade, p_local_consumo, p_local_destino, p_user, p_obs) returning id into v_ordem;

  for r in select * from expandir_receita(p_loja, p_produto, p_quantidade) order by 1 loop
    v_res := registrar_movimento(p_loja, p_local_consumo, r.codigo_insumo, 'PRD', 'PRODUCAO', p_ref, -r.quantidade, null, p_user,
                                 'Produção de ' || _rotulo_produto(p_loja, p_produto), 0, null, null, null);
    v_total := v_total + r.quantidade * coalesce((v_res ->> 'cmc')::numeric, 0);
    insert into ordens_producao_proprio_itens (ordem_id, codigo_insumo, quantidade, custo_unitario, movimento_id)
    values (v_ordem, r.codigo_insumo, r.quantidade, coalesce((v_res ->> 'cmc')::numeric, 0), (v_res ->> 'id')::bigint);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric));
  end loop;

  v_custo_un := round(v_total / p_quantidade, 6);
  v_out := registrar_movimento(p_loja, p_local_destino, p_produto, 'PRD', 'PRODUCAO', p_ref, p_quantidade,
                               case when v_custo_un > 0 then v_custo_un else null end, p_user, coalesce(p_obs, 'Produção de lote'), 0, null, null, null);
  update ordens_producao_proprio set custo_total = round(v_total, 6), custo_unitario = v_custo_un where id = v_ordem;
  return jsonb_build_object('ok', true, 'duplicado', false, 'ordem_id', v_ordem, 'custo_total', round(v_total, 6), 'custo_unitario', v_custo_un,
                            'saldo_produto', (v_out ->> 'saldo')::numeric, 'cmc_produto', (v_out ->> 'cmc')::numeric, 'itens', v_itens);
end $$;


--
-- Name: projetar_posicao_dia(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.projetar_posicao_dia(p_loja bigint) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: proximo_codigo_produto(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proximo_codigo_produto(p_loja bigint, p_tipo_item text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_pref text := prefixo_codigo_por_tipo(p_tipo_item); v_n int; v_cod text;
begin
  loop
    insert into estoque_codigo_seq (loja_id, prefixo, ultimo) values (p_loja, v_pref, 1)
      on conflict (loja_id, prefixo) do update set ultimo = estoque_codigo_seq.ultimo + 1
      returning ultimo into v_n;
    v_cod := v_pref || lpad(v_n::text, 3, '0');
    exit when not exists (select 1 from produtos where loja_id = p_loja and codigo = v_cod);
  end loop;
  return v_cod;
end $$;


--
-- Name: recalcular_faturamento_proprio(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalcular_faturamento_proprio(p_loja bigint, p_mes text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: reconciliar_lotes(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconciliar_lotes(p_loja bigint) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record; n int := 0; v bigint;
begin
  for r in select * from estoque_lotes_divergencia where loja_id = p_loja loop
    v := _lote_sem_lote(r.loja_id, r.codigo_local_estoque, r.codigo_produto);
    update estoque_lotes set saldo = saldo + (r.saldo_ledger - r.saldo_lotes), updated_at = now() where id = v;
    n := n + 1;
  end loop;
  return n;
end $$;


--
-- Name: registrar_compra_sefaz(jsonb, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_compra_sefaz(p_compra jsonb, p_local bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_loja bigint := (p_compra->>'loja_id')::bigint; v_modo text; v_chave text := nullif(btrim(coalesce(p_compra->>'chave_acesso', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_compra->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
  v_comp compras_proprio%rowtype; d record; v_criada boolean := false; v_n int := 0;
begin
  select modo_estoque into v_modo from lojas where id = v_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', v_loja using errcode = '22023'; end if;
  if v_chave is null then raise exception 'A compra vinda da SEFAZ precisa da chave de acesso' using errcode = '22023'; end if;

  select * into v_comp from compras_proprio where loja_id = v_loja and chave_acesso = v_chave for update;
  if not found then
    insert into compras_proprio (loja_id, origem, chave_acesso, numero, serie, fornecedor_cnpj, fornecedor_nome, emissao,
        valor_produtos, valor_frete, valor_desconto, valor_total, icms_recuperavel, codigo_local_estoque, nota_fiscal_id, status)
    values (v_loja, 'sefaz', v_chave, p_compra->>'numero', p_compra->>'serie', v_cnpj, p_compra->>'fornecedor_nome', nullif(p_compra->>'emissao', '')::date,
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0),
        coalesce((p_compra->>'valor_frete')::numeric, 0), coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0) - coalesce((x->>'desconto')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0)
          + coalesce((p_compra->>'valor_frete')::numeric, 0) - coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((p_compra->>'icms_recuperavel')::boolean, false), p_local, nullif(p_compra->>'nota_fiscal_id', '')::bigint, 'pendente')
    returning * into v_comp;
    v_criada := true;
  else
    update compras_proprio set nota_fiscal_id = coalesce(nota_fiscal_id, nullif(p_compra->>'nota_fiscal_id', '')::bigint),
           codigo_local_estoque = coalesce(codigo_local_estoque, p_local), updated_at = now()
     where id = v_comp.id returning * into v_comp;
  end if;

  for d in select value as item, ordinality::int as ord from jsonb_array_elements(coalesce(p_compra->'itens', '[]'::jsonb)) with ordinality loop
    insert into compras_proprio_itens (compra_id, loja_id, linha, c_prod, ean, descricao, ncm, cfop, unidade_compra, quantidade, valor_unitario,
        valor_total, desconto, icms_valor, fator, codigo_produto, match_origem, match_score, sugestao_codigo_produto)
    values (v_comp.id, v_loja, coalesce((d.item->>'linha')::int, d.ord), d.item->>'c_prod', d.item->>'ean', d.item->>'descricao', d.item->>'ncm',
        d.item->>'cfop', d.item->>'unidade_compra', coalesce((d.item->>'quantidade')::numeric, 0), coalesce((d.item->>'valor_unitario')::numeric, 0),
        coalesce((d.item->>'valor_total')::numeric, 0), coalesce((d.item->>'desconto')::numeric, 0), coalesce((d.item->>'icms_valor')::numeric, 0),
        coalesce(nullif((d.item->>'fator')::numeric, 0), 1), nullif(d.item->>'codigo_produto', '')::bigint, nullif(d.item->>'match_origem', ''),
        nullif(d.item->>'match_score', '')::numeric, nullif(d.item->>'sugestao_codigo_produto', '')::bigint)
    on conflict (compra_id, linha) do update set
        match_origem = coalesce(compras_proprio_itens.match_origem, excluded.match_origem),
        match_score = coalesce(compras_proprio_itens.match_score, excluded.match_score),
        sugestao_codigo_produto = coalesce(compras_proprio_itens.sugestao_codigo_produto, excluded.sugestao_codigo_produto),
        codigo_produto = coalesce(compras_proprio_itens.codigo_produto, excluded.codigo_produto),
        fator = case when compras_proprio_itens.codigo_produto is null and excluded.codigo_produto is not null then excluded.fator else compras_proprio_itens.fator end
      where not compras_proprio_itens.lancado;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'criada', v_criada, 'status', v_comp.status, 'itens', v_n);
end $$;


--
-- Name: registrar_entrada_lote(bigint, bigint, bigint, numeric, numeric, text, text, text, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_entrada_lote(p_loja bigint, p_local bigint, p_produto bigint, p_quantidade numeric, p_custo numeric, p_origem text, p_ref text, p_lote text DEFAULT NULL::text, p_validade date DEFAULT NULL::date, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r jsonb;
begin
  perform set_config('estoque.lote', coalesce(nullif(btrim(p_lote), ''), ''), true);
  perform set_config('estoque.validade', coalesce(p_validade::text, ''), true);
  r := registrar_movimento(p_loja, p_local, p_produto, 'ENT', p_origem, p_ref, abs(p_quantidade), p_custo, p_user, p_obs);
  perform set_config('estoque.lote', '', true);
  perform set_config('estoque.validade', '', true);
  return r;
end $$;


--
-- Name: registrar_mapa_vendas(bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_mapa_vendas(p_loja bigint, p_mapa jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare m jsonb;
begin
  perform set_config('ntb.sync_skip', '1', true);
  for m in select * from jsonb_array_elements(coalesce(p_mapa -> 'grupos', '[]'::jsonb)) loop
    update grupos_produto set vendas_ref = (m ->> 'vendas_ref')::uuid where loja_id = p_loja and id = (m ->> 'estoque_id')::bigint and vendas_ref is null;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_mapa -> 'produtos', '[]'::jsonb)) loop
    update produtos set vendas_ref = (m ->> 'vendas_ref')::uuid, sync_atualizado_em = now()
     where loja_id = p_loja and codigo = m ->> 'codigo' and vendas_ref is null;
  end loop;
  -- carimba tudo o que acabou de ser entregue (a reconciliação não reenvia o que já foi)
  update produtos set sync_atualizado_em = now()
   where loja_id = p_loja and codigo in (select jsonb_array_elements_text(coalesce(p_mapa -> 'codigos', '[]'::jsonb)));
end $$;


--
-- Name: registrar_movimento(bigint, bigint, bigint, text, text, text, numeric, numeric, text, text, integer, bigint, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_movimento(p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text, p_quantidade numeric, p_custo numeric DEFAULT NULL::numeric, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text, p_linha integer DEFAULT 0, p_reverses bigint DEFAULT NULL::bigint, p_transferencia_ref text DEFAULT NULL::text, p_data date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_modo text; v_delta numeric; v_custos estoque_custos%rowtype; v_saldo_ant numeric; v_saldo_novo numeric;
  v_total_novo numeric; v_cmc_novo numeric; v_custo_mov numeric; v_estimado boolean := false;
  v_exist estoque_movimentos%rowtype; v_id bigint; v_cons text;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then
    raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023';
  end if;
  if p_tipo not in ('ENT', 'SAI', 'AJU', 'TRF', 'PRD', 'EST') then
    raise exception 'Tipo de movimento inválido: %', p_tipo using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade = 0 then
    raise exception 'Quantidade zero ou ausente' using errcode = '22023';
  end if;
  if p_origem is null or p_ref is null then
    raise exception 'origem e ref são obrigatórios (idempotência)' using errcode = '22023';
  end if;

  select * into v_exist from estoque_movimentos
   where loja_id = p_loja and origem = p_origem and ref = p_ref
     and codigo_produto = p_produto and codigo_local_estoque = p_local and linha = p_linha;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end if;

  v_delta := case p_tipo when 'ENT' then abs(p_quantidade) when 'SAI' then -abs(p_quantidade) else p_quantidade end;

  -- Trava SEMPRE na mesma ordem: custo do produto, depois saldo do local (evita deadlock).
  insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p_produto) on conflict do nothing;
  select * into v_custos from estoque_custos where loja_id = p_loja and codigo_produto = p_produto for update;
  insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto) values (p_loja, p_local, p_produto) on conflict do nothing;
  select saldo into v_saldo_ant from estoque_saldos
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;

  if p_tipo = 'TRF' then
    v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc;                 -- transferência não muda custo
  elsif v_delta > 0 then
    if p_custo is not null and p_custo > 0 then
      v_custo_mov := p_custo;
      if v_custos.saldo_total <= 0 then v_cmc_novo := p_custo;               -- saldo negativo/zero: o custo da entrada assume
      else v_cmc_novo := round((v_custos.saldo_total * v_custos.cmc + v_delta * p_custo) / (v_custos.saldo_total + v_delta), 6);
      end if;
    else
      v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc; v_estimado := true;  -- sem custo: não dilui nem zera o CMC
    end if;
  else
    v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc;                 -- saída ao CMC vigente (não recalcula)
  end if;

  v_saldo_novo := v_saldo_ant + v_delta;
  v_total_novo := v_custos.saldo_total + v_delta;

  begin
    insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, linha, quantidade,
        custo_unitario, saldo_apos, saldo_total_apos, cmc_apos, custo_estimado, reverses_id, transferencia_ref, user_id, obs, data_ref)
    values (p_loja, p_local, p_produto, p_tipo, p_origem, p_ref, p_linha, v_delta,
        v_custo_mov, v_saldo_novo, v_total_novo, v_cmc_novo, v_estimado, p_reverses, p_transferencia_ref, p_user, p_obs,
        coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date))
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons like '%reverses_id%' then
      raise exception 'Este movimento já foi estornado' using errcode = '23505';
    end if;
    select * into v_exist from estoque_movimentos
     where loja_id = p_loja and origem = p_origem and ref = p_ref
       and codigo_produto = p_produto and codigo_local_estoque = p_local and linha = p_linha;
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end;

  update estoque_saldos set saldo = v_saldo_novo, updated_at = now()
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto;
  update estoque_custos set cmc = v_cmc_novo, saldo_total = v_total_novo,
         ultimo_custo = case when p_custo is not null and p_custo > 0 and v_delta > 0 and p_tipo <> 'TRF' then p_custo else ultimo_custo end,
         updated_at = now()
   where loja_id = p_loja and codigo_produto = p_produto;

  -- Projeção para os relatórios atuais (posição do dia).
  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, c_codigo, c_descricao, n_saldo, fisico, n_cmc, estoque_minimo)
  select p_loja, p_local, p_produto, (now() at time zone 'America/Sao_Paulo')::date, pr.codigo, pr.descricao,
         v_saldo_novo, v_saldo_novo, v_cmc_novo, pr.estoque_minimo
    from (select 1) x left join produtos pr on pr.loja_id = p_loja and pr.codigo_produto = p_produto
  on conflict (loja_id, codigo_local_estoque, n_cod_prod, data_posicao)
  do update set n_saldo = excluded.n_saldo, fisico = excluded.fisico, n_cmc = excluded.n_cmc, updated_at = now();

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'saldo', v_saldo_novo, 'saldo_total', v_total_novo,
                            'cmc', v_cmc_novo, 'negativo', v_saldo_novo < 0, 'custo_estimado', v_estimado);
end $$;


--
-- Name: registrar_venda_proprio(bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_venda_proprio(p_loja bigint, p_venda jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
end $$;


--
-- Name: relatorio_auditoria_fiscal_cfop(bigint, date, date, text, text[], text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_auditoria_fiscal_cfop(p_loja_id bigint, p_ini date, p_fim date, p_produto text DEFAULT NULL::text, p_familias text[] DEFAULT NULL::text[], p_fornecedor text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text) RETURNS TABLE(cfop_doc text, cfop_entrada text, itens bigint, valor numeric, credita_icms bigint, move_estoque bigint, icms_creditado numeric)
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    count(*)::bigint as itens,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S'
    )::bigint as credita_icms,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S'
    )::bigint as move_estoque,
    sum(
      case when coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S'
        then coalesce((i.full_object->'itensICMS'->>'nValor')::numeric, 0)
        else 0
      end
    )::numeric as icms_creditado
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  group by 1, 2
  order by valor desc, cfop_doc, cfop_entrada;
$$;


--
-- Name: relatorio_auditoria_fiscal_cst(bigint, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_auditoria_fiscal_cst(p_loja_id bigint, p_ini date, p_fim date) RETURNS TABLE(cst_doc text, cst_entrada text, cfop_entrada text, itens_com_credito bigint, valor_com_credito numeric, itens_sem_credito bigint, valor_sem_credito numeric, itens bigint, valor numeric)
    LANGUAGE sql STABLE
    AS $$
  with base as (
    select
      coalesce(nullif(i.full_object->'itensICMS'->>'cSitTrib', ''), '—')                                as cst_doc,
      coalesce(nullif(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cSitTribICMSE', ''), '—')     as cst_entrada,
      coalesce(nullif(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '—')                         as cfop_entrada,
      i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE'                                as nao_credita,
      coalesce((i.full_object->'itensCabec'->>'vTotalItem')::numeric, 0)                                as v
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id
    where i.loja_id = p_loja_id
      and nf.loja_id = p_loja_id
      and nf.deleted_at is null
      and nf.d_emissao_nfe >= p_ini
      and nf.d_emissao_nfe <= p_fim
      -- so itens que realmente trazem o bloco fiscal de entrada; sem isso,
      -- nota sem detalhamento viraria uma linha "—/—/—" gigante e inutil.
      and i.full_object->'itensAjustes'->'itensSitTribEnt' is not null
  )
  select
    cst_doc,
    cst_entrada,
    cfop_entrada,
    count(*) filter (where nao_credita = 'N')::bigint            as itens_com_credito,
    round(coalesce(sum(v) filter (where nao_credita = 'N'), 0), 2) as valor_com_credito,
    count(*) filter (where nao_credita = 'S')::bigint            as itens_sem_credito,
    round(coalesce(sum(v) filter (where nao_credita = 'S'), 0), 2) as valor_sem_credito,
    count(*)::bigint                                             as itens,
    round(sum(v), 2)                                             as valor
  from base
  group by 1, 2, 3
  order by round(sum(v), 2) desc nulls last
$$;


--
-- Name: relatorio_auditoria_fiscal_itens(bigint, date, date, text, text, text, text, text[], bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_auditoria_fiscal_itens(p_loja_id bigint, p_ini date, p_fim date, p_cfop_doc text DEFAULT NULL::text, p_cfop_entrada text DEFAULT NULL::text, p_fornecedor text DEFAULT NULL::text, p_produto text DEFAULT NULL::text, p_familias text[] DEFAULT NULL::text[], p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text) RETURNS TABLE(data date, nota text, fornecedor text, produto text, codigo text, cfop_doc text, cfop_entrada text, cst_icms text, origem text, credita_icms boolean, move_estoque boolean, valor numeric, item_id bigint)
    LANGUAGE sql STABLE
    AS $$
  select
    nf.d_emissao_nfe as data,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    i.full_object->'itensICMS'->>'cSitTrib' as cst_icms,
    i.full_object->'itensICMS'->>'cOrigem' as origem,
    (coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S') as credita_icms,
    (coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S') as move_estoque,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    i.id as item_id
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and (p_cfop_doc is null or coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') = p_cfop_doc)
    and (p_cfop_entrada is null
         or (p_cfop_entrada = '__sem__' and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or i.full_object->'itensAjustes'->>'cCFOPEntrada' = p_cfop_entrada)
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  order by nf.d_emissao_nfe desc, i.id;
$$;


--
-- Name: relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[], text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_fornecedor text DEFAULT NULL::text, p_cfops text[] DEFAULT NULL::text[], p_produto text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text) RETURNS TABLE(data date, mes text, nota text, fornecedor text, tipo text, familia text, produto text, codigo text, ncm text, cfop text, unidade text, qtde numeric, preco_unit numeric, total numeric)
    LANGUAGE sql STABLE
    AS $$
  select
    nf.d_emissao_nfe as data,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    p.tipo_item as tipo,
    p.descricao_familia as familia,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    i.c_ncm as ncm,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop,
    i.c_unidade_nfe as unidade,
    coalesce(i.n_qtde_nfe, 0)::numeric as qtde,
    coalesce(i.n_preco_unit, 0)::numeric as preco_unit,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as total
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  order by nf.d_emissao_nfe desc, total desc, i.id;
$$;


--
-- Name: relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[], text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_fornecedor text DEFAULT NULL::text, p_cfops text[] DEFAULT NULL::text[], p_produto text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text) RETURNS TABLE(rotulo text, valor numeric, itens bigint)
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
      end, ''), 'Sem classificação') as rotulo,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*)::bigint as itens
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1
  order by valor desc;
$$;


--
-- Name: relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[], text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_fornecedor text DEFAULT NULL::text, p_cfops text[] DEFAULT NULL::text[], p_produto text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text) RETURNS TABLE(rotulo text, mes text, valor numeric)
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
      end, ''), 'Sem classificação') as rotulo,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1, 2
  order by 1, 2;
$$;


--
-- Name: relatorio_compras_total(bigint, date, date, text[], text[], text, text[], text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[] DEFAULT NULL::text[], p_tipos text[] DEFAULT NULL::text[], p_fornecedor text DEFAULT NULL::text, p_cfops text[] DEFAULT NULL::text[], p_produto text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_status text DEFAULT 'CONCLUIDA'::text) RETURNS TABLE(valor numeric, n_notas bigint)
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0)), 0)::numeric,
    count(distinct nf.id)::bigint
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908');
$$;


--
-- Name: relatorio_estoque_valorizado(bigint, text[], text[], bigint[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[] DEFAULT NULL::text[], p_tipo text[] DEFAULT NULL::text[], p_local bigint[] DEFAULT NULL::bigint[], p_busca text DEFAULT NULL::text) RETURNS TABLE(codigo_produto bigint, codigo text, descricao text, descricao_familia text, tipo_item text, unidade text, n_saldo numeric, n_cmc numeric, n_preco_unitario numeric, margem_pct numeric, valor_total numeric, data_foto date)
    LANGUAGE sql STABLE
    AS $$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
      and (p_local is null or codigo_local_estoque = any(p_local))
  ),
  pos as (
    select
      pe.n_cod_prod,
      sum(pe.n_saldo)          as n_saldo,
      -- Pondera por linha (local): soma de custo x quantidade de cada local,
      -- em vez do maior CMC entre locais vezes a soma total de quantidade.
      sum(pe.n_cmc * pe.n_saldo) as valor_total
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
      and (p_local is null or pe.codigo_local_estoque = any(p_local))
    group by pe.n_cod_prod
  )
  select
    p.codigo_produto,
    p.codigo::text,
    p.descricao::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    pos.n_saldo,
    case when pos.n_saldo <> 0 then pos.valor_total / pos.n_saldo else null end as n_cmc,
    p.valor_unitario::numeric                          as n_preco_unitario,
    case
      when p.valor_unitario > 0 and pos.n_saldo <> 0 and (pos.valor_total / pos.n_saldo) > 0
      then round(((p.valor_unitario - (pos.valor_total / pos.n_saldo)) / p.valor_unitario) * 100, 1)
      else null
    end                                                as margem_pct,
    pos.valor_total,
    foto.d                                             as data_foto
  from pos
  join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  cross join foto
  where pos.n_saldo > 0
    and pos.valor_total > 0
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by pos.valor_total desc, p.codigo_produto asc
$$;


--
-- Name: relatorio_estoque_valorizado_local(bigint, text[], text[], bigint[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[] DEFAULT NULL::text[], p_tipo text[] DEFAULT NULL::text[], p_local bigint[] DEFAULT NULL::bigint[], p_busca text DEFAULT NULL::text) RETURNS TABLE(codigo_produto bigint, codigo text, descricao text, descricao_familia text, tipo_item text, unidade text, codigo_local_estoque bigint, local_descricao text, n_saldo numeric, n_cmc numeric, valor_total numeric, data_foto date, data_ultimo_inventario date)
    LANGUAGE sql STABLE
    AS $$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
      and (p_local is null or codigo_local_estoque = any(p_local))
  ),
  pos as (
    select
      pe.n_cod_prod,
      pe.codigo_local_estoque,
      pe.n_saldo,
      pe.n_cmc,
      pe.n_cmc * pe.n_saldo as valor_total
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
      and (p_local is null or pe.codigo_local_estoque = any(p_local))
  ),
  ultimos as (
    select
      ii.produto_codigo_produto as n_cod_prod,
      i.codigo_local_estoque,
      max(i.data)::date as data_ultimo_inventario
    from inventario_items ii
    join inventarios i on i.id = ii.inventario_id
    where i.loja_id = p_loja_id
    group by ii.produto_codigo_produto, i.codigo_local_estoque
  )
  select
    p.codigo_produto,
    p.codigo::text,
    p.descricao::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    pos.codigo_local_estoque,
    le.descricao::text as local_descricao,
    pos.n_saldo,
    pos.n_cmc,
    pos.valor_total,
    foto.d as data_foto,
    u.data_ultimo_inventario
  from pos
  join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  left join local_estoques le
    on le.codigo_local_estoque = pos.codigo_local_estoque and le.loja_id = p_loja_id
  left join ultimos u
    on u.n_cod_prod = pos.n_cod_prod and u.codigo_local_estoque = pos.codigo_local_estoque
  cross join foto
  where pos.n_saldo > 0
    and pos.valor_total > 0
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by pos.valor_total desc, p.codigo_produto asc, pos.codigo_local_estoque asc
$$;


--
-- Name: relatorio_faturamento_matriz(bigint, text, text, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_faturamento_matriz(p_loja_id bigint, p_dim text, p_mes_ini text DEFAULT NULL::text, p_mes_fim text DEFAULT NULL::text, p_rotulos text[] DEFAULT NULL::text[]) RETURNS TABLE(rotulo text, mes text, valor numeric)
    LANGUAGE sql STABLE
    AS $$
  select rotulo, mes, sum(valor)::numeric
  from faturamento_importado
  where loja_id = p_loja_id
    and dimensao = p_dim
    and (p_mes_ini is null or mes >= p_mes_ini)
    and (p_mes_fim is null or mes <= p_mes_fim)
    and (p_rotulos is null or rotulo = any(p_rotulos))
  group by rotulo, mes
  order by rotulo, mes;
$$;


--
-- Name: relatorio_faturamento_opcoes(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_faturamento_opcoes(p_loja_id bigint) RETURNS TABLE(dimensao text, rotulo text)
    LANGUAGE sql STABLE
    AS $$
  select distinct dimensao, rotulo
  from faturamento_importado
  where loja_id = p_loja_id
  order by dimensao, rotulo;
$$;


--
-- Name: relatorio_margem_snapshot_matriz(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_margem_snapshot_matriz(p_loja_id bigint) RETURNS TABLE(codigo text, descricao text, familia text, mes text, pdv numeric, cmc numeric, margem numeric, dias integer)
    LANGUAGE sql STABLE
    AS $$
  select
    codigo,
    max(descricao) as descricao,
    max(descricao_familia) as familia,
    to_char(data_snapshot, 'YYYY-MM') as mes,
    avg(pdv) as pdv,
    avg(cmc) as cmc,
    avg(margem) as margem,
    count(distinct data_snapshot)::int as dias
  from margem_snapshot_diario
  where loja_id = p_loja_id
  group by codigo, to_char(data_snapshot, 'YYYY-MM')
  order by codigo, mes
$$;


--
-- Name: relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_movimentacao_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text, p_cod_prods bigint[] DEFAULT NULL::bigint[], p_produto text DEFAULT NULL::text) RETURNS TABLE(rotulo text, mes text, qtde numeric, valor numeric)
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(nullif(
      case p_dim
        when 'tipo'    then p.tipo_item
        when 'familia' then p.descricao_familia
        when 'produto' then m.descricao
      end, ''), 'Sem classificação') as rotulo,
    to_char(m.data, 'YYYY-MM') as mes,
    sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end)::numeric as qtde,
    sum((case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) * coalesce(pr.preco_unit, 0))::numeric as valor
  from movimentos_historico m
  left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.cod_prod
  left join produto_preco_recente pr on pr.loja_id = m.loja_id and pr.codigo_produto = m.cod_prod
  where m.loja_id = p_loja_id and m.data >= p_ini and m.data <= p_fim
    and (p_cod_prods is null or m.cod_prod = any(p_cod_prods))
    and (p_produto is null or p_produto = ''
         or m.descricao ilike '%' || p_produto || '%'
         or m.codigo    ilike '%' || p_produto || '%')
  group by 1, 2
  having sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) <> 0
  order by 1, 2;
$$;


--
-- Name: relatorio_movimentacao_total(bigint, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_movimentacao_total(p_loja_id bigint, p_ini date, p_fim date, p_sentido text) RETURNS TABLE(qtde numeric, valor numeric)
    LANGUAGE sql STABLE
    AS $$
  with preco as (
    select distinct on (i.n_id_produto) i.n_id_produto, i.n_preco_unit
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    where i.loja_id = p_loja_id and nf.deleted_at is null and i.n_preco_unit > 0 and i.n_id_produto is not null
    order by i.n_id_produto, nf.d_emissao_nfe desc
  )
  select
    coalesce(sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end), 0)::numeric,
    coalesce(sum((case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) * coalesce(pr.n_preco_unit, 0)), 0)::numeric
  from movimentos_historico m
  left join preco pr on pr.n_id_produto = m.cod_prod
  where m.loja_id = p_loja_id and m.data >= p_ini and m.data <= p_fim;
$$;


--
-- Name: relatorio_movimentacao_valor_matriz(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_movimentacao_valor_matriz(p_loja_id bigint, p_dim text) RETURNS TABLE(rotulo text, mes text, valor numeric)
    LANGUAGE sql STABLE
    AS $$
  select rotulo, mes, sum(valor)::numeric
  from movimentacao_importada
  where loja_id = p_loja_id and dimensao = p_dim
  group by rotulo, mes
  order by rotulo, mes;
$$;


--
-- Name: relatorio_op_previsto_produzido(bigint, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_op_previsto_produzido(p_loja_id bigint, p_ini date, p_fim date) RETURNS TABLE(n_cod_op bigint, num_op text, produto text, dt_previsao date, dt_conclusao date, qtde_planejada numeric, qtde_produzida numeric, divergencia numeric, pct numeric)
    LANGUAGE sql STABLE
    AS $$
  select
    p.n_cod_op,
    op.identificacao_c_num_op                              as num_op,
    op.produto_descricao                                   as produto,
    p.dt_previsao,
    op.dt_conclusao_real                                   as dt_conclusao,
    p.qtde_planejada,
    op.identificacao_n_qtde                                as qtde_produzida,
    (op.identificacao_n_qtde - p.qtde_planejada)           as divergencia,
    case when p.qtde_planejada > 0
      then round(((op.identificacao_n_qtde - p.qtde_planejada) / p.qtde_planejada) * 100, 1)
      else null end                                        as pct
  from op_qtde_planejada p
  join ordens_producao op
    on op.loja_id = p.loja_id
   and op.identificacao_n_cod_op = p.n_cod_op
  where p.loja_id = p_loja_id
    and op.concluida
    and p.qtde_planejada is not null
    and op.identificacao_n_qtde is not null
    and op.identificacao_n_qtde <> p.qtde_planejada
    and op.dt_conclusao_real >= p_ini
    and op.dt_conclusao_real <= p_fim
  order by abs(op.identificacao_n_qtde - p.qtde_planejada) desc
$$;


--
-- Name: relatorio_rejeitos_por_tipo(bigint, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relatorio_rejeitos_por_tipo(p_loja_id bigint, p_data_ini date, p_data_fim date) RETURNS TABLE(categoria text, valor_total numeric, qtd_movimentos bigint)
    LANGUAGE sql STABLE
    AS $$
  select
    case
      when p.tipo_item = '01' then 'Matéria-prima'
      when p.tipo_item = '00' then 'Revenda'
      when p.tipo_item in ('03', '06') then 'Produto em processo'
      when p.tipo_item = '07' and p.descricao_familia ilike '%gastos%ger%' then 'Gastos Gerais'
      when p.tipo_item = '07' and p.descricao_familia ilike '%despes%funcion%' then 'Despesas Funcionários'
      when p.tipo_item = '07' then 'Material de Consumo'
      else 'Outros'
    end as categoria,
    sum(coalesce(m.valor, 0) * coalesce(m.quan, 0)) as valor_total,
    count(*) as qtd_movimentos
  from movimentos m
  join produtos p on p.codigo_produto = m.id_prod and p.loja_id = m.loja_id
  where m.loja_id = p_loja_id
    and m.motivo = 'TPQ'
    and m.status = 'Concluido'
    and m.data >= p_data_ini
    and m.data < (p_data_fim + 1)
  group by categoria
  order by valor_total desc nulls last
$$;


--
-- Name: rotulo_forma_pgto(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rotulo_forma_pgto(p_sigla text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case p_sigla when 'PIX' then 'Pix' when 'CRC' then 'Cartão de Crédito' when 'CRD' then 'Cartão de Débito'
                      when 'DIN' then 'Dinheiro' else 'Outros' end
$$;


--
-- Name: rotulo_tipo_item(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rotulo_tipo_item(p_tipo text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when p_tipo is null or p_tipo = '' then 'Não classificado'
    when p_tipo = '00' then 'Mercadoria p/ revenda' when p_tipo = '01' then 'Matéria-prima' when p_tipo = '02' then 'Embalagem'
    when p_tipo = '03' then 'Produto em processo' when p_tipo = '04' then 'Produto acabado' when p_tipo = '05' then 'Subproduto'
    when p_tipo = '06' then 'Produto intermediário' when p_tipo = '07' then 'Uso e consumo' when p_tipo = '08' then 'Ativo imobilizado'
    when p_tipo = '09' then 'Serviços' when p_tipo = '10' then 'Outros insumos' when p_tipo = '99' then 'Outras'
    else 'Tipo ' || p_tipo end
$$;


--
-- Name: salvar_ficha(bigint, bigint, numeric, jsonb, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.salvar_ficha(p_loja bigint, p_produto bigint, p_rendimento numeric, p_itens jsonb, p_expandir_na_venda boolean DEFAULT false, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_modo text; v_versao int; v_id bigint; v_item jsonb; v_ordem int := 0;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_rendimento is null or p_rendimento <= 0 then raise exception 'Rendimento deve ser maior que zero' using errcode = '22023'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'A ficha precisa de pelo menos um insumo' using errcode = '22023';
  end if;
  if not exists (select 1 from produtos where loja_id = p_loja and codigo_produto = p_produto) then
    raise exception 'Produto % não existe nesta loja', p_produto using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ficha:' || p_loja || ':' || p_produto));
  update fichas_tecnicas set ativa = false where loja_id = p_loja and codigo_produto = p_produto and ativa;
  select coalesce(max(versao), 0) + 1 into v_versao from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto;
  insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento, expandir_na_venda, ativa, obs, criada_por)
  values (p_loja, p_produto, v_versao, p_rendimento, coalesce(p_expandir_na_venda, false), true, p_obs, p_user)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_ordem := v_ordem + 1;
    insert into ficha_tecnica_itens (ficha_id, loja_id, codigo_insumo, quantidade_liquida, fator_correcao, perda_pct, ordem)
    values (v_id, p_loja, (v_item ->> 'codigo_insumo')::bigint, (v_item ->> 'quantidade_liquida')::numeric,
            coalesce((v_item ->> 'fator_correcao')::numeric, 1), coalesce((v_item ->> 'perda_pct')::numeric, 0), v_ordem);
  end loop;
  return jsonb_build_object('ok', true, 'ficha_id', v_id, 'versao', v_versao);
end $$;


--
-- Name: saude_banco(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.saude_banco() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  resultado jsonb;
begin
  select jsonb_build_object(
    'total_mb', round((pg_database_size(current_database()) / 1048576.0)::numeric, 1),
    'tabelas', (
      select jsonb_agg(jsonb_build_object(
        'nome', t.relname,
        'mb', round((t.relsize / 1048576.0)::numeric, 1),
        'linhas', t.reltuples::bigint
      ) order by t.relsize desc)
      from (
        select c.relname, c.reltuples, pg_total_relation_size(c.oid) as relsize
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 12
      ) t
    ),
    'novas_linhas_7d', jsonb_build_object(
      'movimentos', (select count(*) from movimentos where created_at >= now() - interval '7 days'),
      'ordens_producao', (select count(*) from ordens_producao where created_at >= now() - interval '7 days'),
      'nota_fiscal_items', (select count(*) from nota_fiscal_items where created_at >= now() - interval '7 days')
    )
  ) into resultado;
  return resultado;
end;
$$;


--
-- Name: sefaz_marcar_cancelada(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sefaz_marcar_cancelada(p_loja bigint, p_chave text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n notas_fiscais%rowtype; c compras_proprio%rowtype; v_aviso boolean := false;
begin
  select * into n from notas_fiscais where loja_id = p_loja and c_chave_nfe = p_chave and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', true, 'nota', false); end if;
  update notas_fiscais set updated_at = now(),
         full_object = jsonb_set(coalesce(full_object, '{}'::jsonb), '{infoCadastro}', coalesce(full_object->'infoCadastro', '{}'::jsonb) || jsonb_build_object('cCancelada', 'S'), true)
   where id = n.id;
  select * into c from compras_proprio where loja_id = p_loja and chave_acesso = p_chave for update;
  if found then
    if c.status in ('pendente') then update compras_proprio set status = 'cancelada', updated_at = now() where id = c.id;
    elsif c.status in ('lancada', 'parcial') then v_aviso := true; end if;
  end if;
  return jsonb_build_object('ok', true, 'nota', true, 'nota_id', n.id, 'ja_lancada_confira', v_aviso);
end $$;


--
-- Name: sigla_forma_pgto(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sigla_forma_pgto(p_metodo text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case upper(coalesce(p_metodo, ''))
    when 'CREDIT' then 'CRC' when 'DEBIT' then 'CRD' when 'PIX' then 'PIX' when 'CASH' then 'DIN' else '99999' end
$$;


--
-- Name: sincronizar_situacao_nota(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sincronizar_situacao_nota(p_loja bigint, p_nota bigint) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare n notas_fiscais%rowtype; c compras_proprio%rowtype; v_sit text; v_etapa text := '40'; v_itens int; v_ic jsonb; v_alertas int;
begin
  select * into n from notas_fiscais where id = p_nota and loja_id = p_loja;
  if not found then return null; end if;
  select * into c from compras_proprio where loja_id = p_loja and nota_fiscal_id = p_nota limit 1;
  if c.id is null and n.c_chave_nfe is not null then select * into c from compras_proprio where loja_id = p_loja and chave_acesso = n.c_chave_nfe limit 1; end if;
  select count(*) into v_itens from nota_fiscal_items where nota_fiscal_id = n.id;
  v_alertas := coalesce(jsonb_array_length(n.full_object->'sefaz'->'alertas'), 0);

  if v_itens = 0 and c.id is null then v_sit := 'resumo';
  elsif c.id is null then v_sit := 'a_conferir';
  elsif c.status = 'lancada' then v_sit := 'lancada'; v_etapa := '60';
  elsif c.status = 'parcial' then v_sit := 'parcial';
  elsif c.status = 'cancelada' then v_sit := 'estornada';
  elsif v_alertas > 0 then v_sit := 'divergente';
  else v_sit := 'a_conferir'; end if;

  v_ic := coalesce(n.full_object->'infoCadastro', '{}'::jsonb);
  if v_etapa = '60' then
    v_ic := v_ic || jsonb_build_object('cRecebido', 'S',
        'dRec', coalesce(v_ic->>'dRec', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
        'hRec', coalesce(v_ic->>'hRec', to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI:SS')),
        'cUsuarioRec', coalesce(v_ic->>'cUsuarioRec', 'Norte Estoque'));
  else
    v_ic := (v_ic - 'dRec' - 'hRec' - 'cUsuarioRec') || jsonb_build_object('cRecebido', 'N');
  end if;

  update notas_fiscais set c_etapa = v_etapa, updated_at = now(),
         full_object = jsonb_set(jsonb_set(coalesce(full_object, '{}'::jsonb), '{infoCadastro}', v_ic, true), '{sefaz,situacao}', to_jsonb(v_sit), true)
   where id = n.id;
  return v_sit;
end $$;


--
-- Name: transferir_estoque(bigint, bigint, bigint, bigint, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transferir_estoque(p_loja bigint, p_de bigint, p_para bigint, p_produto bigint, p_quantidade numeric, p_ref text, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare a jsonb; b jsonb;
begin
  if p_de = p_para then raise exception 'Origem e destino iguais' using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  a := registrar_movimento(p_loja, p_de,   p_produto, 'TRF', 'TRANSFERENCIA', p_ref, -abs(p_quantidade), null, p_user, p_obs, 0, null, p_ref, null);
  b := registrar_movimento(p_loja, p_para, p_produto, 'TRF', 'TRANSFERENCIA', p_ref,  abs(p_quantidade), null, p_user, p_obs, 1, null, p_ref, null);
  return jsonb_build_object('ok', true, 'saida', a, 'entrada', b);
end $$;


--
-- Name: trf_desfazer_lancamento(bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trf_desfazer_lancamento(p_loja bigint, p_ref text, p_user text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare r record; n int := 0;
begin
  for r in
    select m.id from estoque_movimentos m
     where m.loja_id = p_loja and m.origem = 'TRANSFERENCIA' and m.ref = p_ref
       and not exists (select 1 from estoque_movimentos x where x.reverses_id = m.id)
     order by m.id
  loop
    perform estornar_movimento(r.id, p_user, 'Transferência alterada: lançamento anterior estornado');
    n := n + 1;
  end loop;
  return n;
end $$;


--
-- Name: trg_estoque_custos_projeta_cmc(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_estoque_custos_projeta_cmc() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: trg_estoque_movimentos_historico(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_estoque_movimentos_historico() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: trg_estoque_movimentos_imutavel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_estoque_movimentos_imutavel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'estoque_movimentos é append-only: use estorno' using errcode = '55000';
end $$;


--
-- Name: trg_estoque_movimentos_lotes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_estoque_movimentos_lotes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r record; v_pref bigint; v_lote text; v_val date; v_par bigint; v_achou boolean := false;
begin
  -- a) estorno: espelha os lotes do original (devolve ao mesmo lote)
  if new.reverses_id is not null then
    for r in select lm.lote_id, lm.quantidade, l.lote, l.validade from estoque_lote_movimentos lm join estoque_lotes l on l.id = lm.lote_id
              where lm.movimento_id = new.reverses_id loop
      v_achou := true;
      if -r.quantidade > 0 then
        -- devolve ao lote de onde saiu (se o local for outro, recria no local do estorno)
        if exists (select 1 from estoque_lotes where id = r.lote_id and codigo_local_estoque = new.codigo_local_estoque) then
          update estoque_lotes set saldo = saldo - r.quantidade, updated_at = now() where id = r.lote_id;
          insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (new.loja_id, new.id, r.lote_id, -r.quantidade);
        else
          perform _lote_entrar(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, -r.quantidade, r.lote, r.validade, new.origem, new.ref);
        end if;
      else
        perform _lote_sair(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, r.quantidade, r.lote_id);
      end if;
    end loop;
    if v_achou then return null; end if;
    -- original anterior aos lotes: segue como movimento comum
  end if;

  if new.quantidade > 0 then
    -- b) perna de ENTRADA de transferência: recria os lotes que a perna de saída tirou
    if new.tipo = 'TRF' and new.transferencia_ref is not null then
      select id into v_par from estoque_movimentos
       where loja_id = new.loja_id and origem = new.origem and ref = new.ref and codigo_produto = new.codigo_produto
         and transferencia_ref = new.transferencia_ref and quantidade < 0 and id <> new.id and reverses_id is null
       order by id desc limit 1;
      if v_par is not null then
        for r in select l.lote, l.validade, -lm.quantidade as q from estoque_lote_movimentos lm join estoque_lotes l on l.id = lm.lote_id
                  where lm.movimento_id = v_par loop
          v_achou := true;
          perform _lote_entrar(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, r.q, r.lote, r.validade, new.origem, new.ref);
        end loop;
        if v_achou then return null; end if;
      end if;
    end if;
    -- c) entrada comum
    select o_lote, o_validade into v_lote, v_val from _lote_da_entrada(new);
    perform _lote_entrar(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, new.quantidade, v_lote, v_val, new.origem, new.ref);
  else
    -- d) saída: lote dirigido (baixa por vencimento) ou FEFO
    begin v_pref := nullif(current_setting('estoque.lote_id', true), '')::bigint; exception when others then v_pref := null; end;
    perform _lote_sair(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, -new.quantidade, v_pref);
  end if;
  return null;
end $$;


--
-- Name: trg_ficha_itens_ciclo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_ficha_itens_ciclo() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_produto bigint;
begin
  select codigo_produto into v_produto from fichas_tecnicas where id = new.ficha_id;
  if new.codigo_insumo = v_produto or ficha_tem_ciclo(new.loja_id, v_produto, new.codigo_insumo) then
    raise exception 'Receita circular: o insumo % já usa este produto', new.codigo_insumo using errcode = '23514';
  end if;
  return new;
end $$;


--
-- Name: trg_ficha_itens_imutavel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_ficha_itens_imutavel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'Itens de ficha técnica são imutáveis: grave uma nova versão' using errcode = '55000';
end $$;


--
-- Name: trg_grupos_produto_arvore(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_grupos_produto_arvore() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_pai grupos_produto%rowtype; v_prof int := 1; v_atual bigint;
begin
  new.updated_at := now();
  if new.pai_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.pai_id = new.id then raise exception 'Um grupo não pode ser pai de si mesmo' using errcode = '23514'; end if;
  select * into v_pai from grupos_produto where id = new.pai_id;
  if not found or v_pai.loja_id <> new.loja_id then raise exception 'Grupo pai inválido' using errcode = '23514'; end if;
  v_atual := v_pai.pai_id;
  while v_atual is not null loop
    v_prof := v_prof + 1;
    if tg_op = 'UPDATE' and v_atual = new.id then raise exception 'A árvore de grupos não pode ter ciclo' using errcode = '23514'; end if;
    if v_prof > 5 then raise exception 'No máximo 5 níveis de grupos' using errcode = '23514'; end if;
    select pai_id into v_atual from grupos_produto where id = v_atual;
  end loop;
  return new;
end $$;


--
-- Name: trg_lojas_modo_estoque(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_lojas_modo_estoque() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.modo_estoque is distinct from old.modo_estoque
     and exists (select 1 from estoque_movimentos where loja_id = old.id) then
    raise exception 'A loja já tem movimentos de estoque próprio: o modo não pode mais ser trocado' using errcode = '23514';
  end if;
  return new;
end $$;


--
-- Name: trg_movimento_nao_mae(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_movimento_nao_mae() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if exists (select 1 from produtos where loja_id = new.loja_id and codigo_produto = new.codigo_produto and eh_mae) then
    raise exception 'Produto mãe não tem estoque: lance o movimento em uma variação' using errcode = '23514';
  end if;
  return new;
end $$;


--
-- Name: trg_op_historico_imutavel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_op_historico_imutavel() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin raise exception 'op_historico é append-only' using errcode = '55000'; end $$;


--
-- Name: trg_produtos_codigo_proprio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_produtos_codigo_proprio() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_modo text;
begin
  select modo_estoque into v_modo from lojas where id = new.loja_id;
  if v_modo is distinct from 'proprio' then return new; end if;
  if new.codigo is null or btrim(new.codigo) = '' then
    raise exception 'Produto sem código' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.codigo is distinct from old.codigo then
    raise exception 'O código do produto não pode ser alterado' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and exists (select 1 from produtos where loja_id = new.loja_id and codigo = new.codigo) then
    raise exception 'Código % já existe nesta loja', new.codigo using errcode = '23505';
  end if;
  return new;
end $$;


--
-- Name: trg_produtos_mae_variacao(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_produtos_mae_variacao() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_pai produtos%rowtype;
begin
  if new.eh_mae and new.produto_pai_codigo is not null then
    raise exception 'Um produto mãe não pode ser variação de outro' using errcode = '23514';
  end if;
  if new.produto_pai_codigo is not null then
    select * into v_pai from produtos where loja_id = new.loja_id and codigo_produto = new.produto_pai_codigo;
    if not found then raise exception 'Produto mãe não encontrado' using errcode = '23514'; end if;
    if not v_pai.eh_mae then raise exception 'O produto % não é um produto mãe', v_pai.codigo using errcode = '23514'; end if;
  end if;
  if new.eh_mae and (tg_op = 'INSERT' or old.eh_mae is distinct from true)
     and exists (select 1 from estoque_movimentos where loja_id = new.loja_id and codigo_produto = new.codigo_produto) then
    raise exception 'O produto já tem movimentos de estoque e não pode virar mãe' using errcode = '23514';
  end if;
  return new;
end $$;


--
-- Name: trg_sync_outbox_catalogo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sync_outbox_catalogo() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_loja bigint; v_modo text; v_vendas uuid; v_ref text; v_ent text; v_op text := 'upsert'; r record;
begin
  if coalesce(current_setting('ntb.sync_skip', true), '') = '1' then return null; end if;
  if tg_op = 'DELETE' then r := old; v_op := 'delete'; else r := new; end if;
  v_loja := r.loja_id;
  select modo_estoque, vendas_store_id into v_modo, v_vendas from lojas where id = v_loja;
  if v_modo is distinct from 'proprio' or v_vendas is null then return null; end if;
  if tg_table_name = 'produtos' then
    v_ent := 'produto'; v_ref := r.codigo;
    if v_ref is null then return null; end if;
  else
    v_ent := 'grupo'; v_ref := r.id::text;
  end if;
  insert into sync_outbox (loja_id, entidade, ref, operacao) values (v_loja, v_ent, v_ref, v_op)
  on conflict (loja_id, entidade, ref) where status = 'pending'
  do update set operacao = excluded.operacao, atualizado_em = now(), proxima_tentativa = least(sync_outbox.proxima_tentativa, now());
  return null;
exception when others then
  return null;   -- sincronização nunca derruba o cadastro
end $$;


--
-- Name: upsert_movimentos_ajuste(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_movimentos_ajuste(p_rows jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  insert into movimentos (
    loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque,
    codigo_local_estoque_destino, data, motivo, obs, origem, status
  )
  select
    (r->>'loja_id')::bigint,
    (r->>'id_ajuste')::bigint,
    (r->>'id_prod')::bigint,
    r->>'tipo',
    (r->>'quan')::numeric,
    (r->>'valor')::numeric,
    (r->>'codigo_local_estoque')::bigint,
    (r->>'codigo_local_estoque_destino')::bigint,
    (r->>'data')::timestamptz,
    r->>'motivo',
    r->>'obs',
    r->>'origem',
    r->>'status'
  from jsonb_array_elements(p_rows) as r
  on conflict (loja_id, id_ajuste) where id_ajuste is not null do update set
    id_prod = excluded.id_prod,
    tipo = excluded.tipo,
    quan = excluded.quan,
    valor = excluded.valor,
    codigo_local_estoque = excluded.codigo_local_estoque,
    codigo_local_estoque_destino = excluded.codigo_local_estoque_destino,
    data = excluded.data,
    motivo = excluded.motivo,
    obs = excluded.obs,
    origem = excluded.origem,
    status = excluded.status,
    updated_at = now();
end;
$$;


--
-- Name: usuario_compartilha_loja(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usuario_compartilha_loja(p_outro_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from loja_user lu1
    join loja_user lu2 on lu1.loja_id = lu2.loja_id
    where lu1.user_id = auth.uid() and lu2.user_id = p_outro_user_id
  );
$$;


--
-- Name: usuario_e_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usuario_e_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from profiles pr
    where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true)
  );
$$;


--
-- Name: usuario_lojas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usuario_lojas() RETURNS SETOF bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select lu.loja_id::bigint from loja_user lu where lu.user_id = auth.uid()
$$;


--
-- Name: usuario_pode_aprovar_pendentes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usuario_pode_aprovar_pendentes() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from profiles pr
    where pr.id = auth.uid()
      and (pr.perfil = 'Admin' or pr.perfil = 'AdminLoja' or pr.is_super_admin = true)
  );
$$;


--
-- Name: usuario_tem_acesso_loja(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.usuario_tem_acesso_loja(p_loja_id bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from loja_user lu
    where lu.loja_id = p_loja_id and lu.user_id = auth.uid()
  );
$$;


--
-- Name: vincular_item_compra(bigint, bigint, bigint, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vincular_item_compra(p_loja bigint, p_compra_item bigint, p_produto bigint, p_fator numeric DEFAULT 1, p_user text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare i compras_proprio_itens%rowtype; c compras_proprio%rowtype;
begin
  select * into i from compras_proprio_itens where id = p_compra_item and loja_id = p_loja for update;
  if not found then raise exception 'Item não encontrado' using errcode = '22023'; end if;
  if i.lancado then raise exception 'Item já lançado no estoque' using errcode = '22023'; end if;
  if not exists (select 1 from produtos where loja_id = p_loja and codigo_produto = p_produto) then raise exception 'Produto % não existe nesta loja', p_produto using errcode = '22023'; end if;
  if p_fator is null or p_fator <= 0 then raise exception 'Fator de conversão inválido' using errcode = '22023'; end if;
  select * into c from compras_proprio where id = i.compra_id;
  update compras_proprio_itens set codigo_produto = p_produto, fator = p_fator, match_origem = 'manual', match_score = 1 where id = i.id;
  if c.fornecedor_cnpj is not null and i.c_prod is not null then
    insert into fornecedor_produto_depara (loja_id, fornecedor_cnpj, c_prod, codigo_produto, fator, unidade_compra)
    values (p_loja, c.fornecedor_cnpj, i.c_prod, p_produto, p_fator, i.unidade_compra)
    on conflict (loja_id, fornecedor_cnpj, c_prod) do update set codigo_produto = excluded.codigo_produto, fator = excluded.fator,
         unidade_compra = excluded.unidade_compra, updated_at = now();
  end if;
  -- espelha no item da nota (relatórios e tela de detalhe)
  update nota_fiscal_items nfi set n_id_produto = p_produto, produto_codigo = p_produto::text, updated_at = now()
   where nfi.loja_id = p_loja and nfi.nota_fiscal_id = c.nota_fiscal_id and nfi.n_sequencia = i.linha;
  return jsonb_build_object('ok', true, 'compra_id', c.id, 'nota_id', c.nota_fiscal_id);
end $$;


--
-- Name: arquivos_mortos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arquivos_mortos (
    id bigint NOT NULL,
    tabela text NOT NULL,
    periodo text NOT NULL,
    path text NOT NULL,
    linhas integer NOT NULL,
    bytes bigint,
    criado_em timestamp with time zone DEFAULT now(),
    restaurado_em timestamp with time zone
);


--
-- Name: arquivos_mortos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.arquivos_mortos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: arquivos_mortos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.arquivos_mortos_id_seq OWNED BY public.arquivos_mortos.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    loja_id bigint,
    user_id uuid,
    user_nome text,
    acao character varying(16) NOT NULL,
    entidade character varying(40) NOT NULL,
    entidade_id text,
    descricao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cargo_permissao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_permissao (
    cargo_id bigint NOT NULL,
    permissao_id bigint NOT NULL
);


--
-- Name: cargos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargos (
    id bigint NOT NULL,
    nome character varying(40) NOT NULL,
    descricao character varying(160),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cargos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cargos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cargos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cargos_id_seq OWNED BY public.cargos.id;


--
-- Name: categorias_contabeis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorias_contabeis (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    nome text NOT NULL,
    ativa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categorias_contabeis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.categorias_contabeis ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.categorias_contabeis_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_omie bigint,
    codigo_integracao character varying(60),
    razao_social character varying(150) NOT NULL,
    nome_fantasia character varying(120),
    cnpj_cpf character varying(20),
    pessoa_fisica boolean DEFAULT false NOT NULL,
    inscricao_estadual character varying(20),
    inscricao_municipal character varying(20),
    cest character varying(10),
    email character varying(120),
    telefone character varying(30),
    cep character varying(10),
    uf character varying(2),
    cidade character varying(100),
    bairro character varying(100),
    logradouro character varying(200),
    numero character varying(20),
    complemento character varying(120),
    inativo boolean DEFAULT false NOT NULL,
    origem character varying(10) DEFAULT 'local'::character varying NOT NULL,
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clientes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clientes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clientes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clientes_id_seq OWNED BY public.clientes.id;


--
-- Name: compras_proprio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras_proprio (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    origem text NOT NULL,
    chave_acesso text,
    numero text,
    serie text,
    fornecedor_cnpj text,
    fornecedor_nome text,
    emissao date,
    valor_produtos numeric(18,4) DEFAULT 0 NOT NULL,
    valor_frete numeric(18,4) DEFAULT 0 NOT NULL,
    valor_desconto numeric(18,4) DEFAULT 0 NOT NULL,
    valor_total numeric(18,4) DEFAULT 0 NOT NULL,
    icms_recuperavel boolean DEFAULT false NOT NULL,
    codigo_local_estoque bigint,
    status text DEFAULT 'pendente'::text NOT NULL,
    user_id text,
    obs text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lancada_em timestamp with time zone,
    nota_fiscal_id bigint,
    CONSTRAINT compras_proprio_chave_acesso_check CHECK (((chave_acesso IS NULL) OR (chave_acesso ~ '^[0-9]{44}$'::text))),
    CONSTRAINT compras_proprio_origem_check CHECK ((origem = ANY (ARRAY['manual'::text, 'xml'::text, 'sefaz'::text]))),
    CONSTRAINT compras_proprio_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'parcial'::text, 'lancada'::text, 'cancelada'::text])))
);


--
-- Name: compras_proprio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.compras_proprio ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.compras_proprio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: compras_proprio_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras_proprio_itens (
    id bigint NOT NULL,
    compra_id bigint NOT NULL,
    loja_id bigint NOT NULL,
    linha integer NOT NULL,
    c_prod text,
    ean text,
    descricao text,
    ncm text,
    cfop text,
    unidade_compra text,
    quantidade numeric(18,6) DEFAULT 0 NOT NULL,
    valor_unitario numeric(18,6) DEFAULT 0 NOT NULL,
    valor_total numeric(18,4) DEFAULT 0 NOT NULL,
    desconto numeric(18,4) DEFAULT 0 NOT NULL,
    icms_valor numeric(18,4) DEFAULT 0 NOT NULL,
    fator numeric(18,6) DEFAULT 1 NOT NULL,
    codigo_produto bigint,
    custo_unitario_base numeric(18,6),
    movimento_id bigint,
    lancado boolean DEFAULT false NOT NULL,
    match_origem text,
    match_score numeric(5,4),
    sugestao_codigo_produto bigint,
    lote text,
    validade date,
    CONSTRAINT compras_proprio_itens_match_origem_chk CHECK (((match_origem IS NULL) OR (match_origem = ANY (ARRAY['depara'::text, 'ean'::text, 'descricao'::text, 'manual'::text]))))
);


--
-- Name: compras_proprio_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.compras_proprio_itens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.compras_proprio_itens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: contas_correntes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contas_correntes (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_cc bigint NOT NULL,
    descricao text,
    tipo text,
    tipo_descricao text,
    codigo_banco text,
    numero_conta text,
    saldo_atual numeric(14,2),
    saldo_previsto numeric(14,2),
    saldo_disponivel numeric(14,2),
    saldo_conciliado numeric(14,2),
    inclui_fluxo_caixa boolean DEFAULT true,
    synced_at timestamp with time zone DEFAULT now()
);


--
-- Name: contas_correntes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contas_correntes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contas_correntes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contas_correntes_id_seq OWNED BY public.contas_correntes.id;


--
-- Name: contas_pagar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contas_pagar (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_lancamento_omie bigint NOT NULL,
    codigo_cliente_fornecedor bigint,
    data_emissao date,
    data_vencimento date,
    data_previsao date,
    data_entrada date,
    valor_documento numeric(14,2),
    status_titulo text,
    codigo_categoria text,
    codigo_tipo_documento text,
    numero_documento text,
    numero_documento_fiscal text,
    numero_parcela text,
    id_conta_corrente bigint,
    synced_at timestamp with time zone DEFAULT now()
);


--
-- Name: contas_pagar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contas_pagar_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contas_pagar_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contas_pagar_id_seq OWNED BY public.contas_pagar.id;


--
-- Name: contas_receber; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contas_receber (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_lancamento_omie bigint NOT NULL,
    codigo_cliente_fornecedor bigint,
    data_emissao date,
    data_vencimento date,
    data_previsao date,
    data_registro date,
    valor_documento numeric(14,2),
    status_titulo text,
    codigo_categoria text,
    codigo_tipo_documento text,
    numero_documento text,
    numero_documento_fiscal text,
    numero_parcela text,
    numero_pedido text,
    chave_nfe text,
    id_conta_corrente bigint,
    synced_at timestamp with time zone DEFAULT now()
);


--
-- Name: contas_receber_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contas_receber_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contas_receber_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contas_receber_id_seq OWNED BY public.contas_receber.id;


--
-- Name: convites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.convites (
    id bigint NOT NULL,
    codigo character varying(16) NOT NULL,
    loja_id bigint NOT NULL,
    perfil character varying(16) DEFAULT 'Usuario'::character varying NOT NULL,
    permissoes jsonb DEFAULT '[]'::jsonb NOT NULL,
    criado_por uuid,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    usado_em timestamp with time zone,
    usado_por uuid,
    expira_em timestamp with time zone,
    CONSTRAINT convites_perfil_check CHECK (((perfil)::text = ANY ((ARRAY['Usuario'::character varying, 'AdminLoja'::character varying])::text[])))
);


--
-- Name: convites_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.convites ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.convites_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: estoque_codigo_seq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_codigo_seq (
    loja_id bigint NOT NULL,
    prefixo text NOT NULL,
    ultimo integer DEFAULT 0 NOT NULL
);


--
-- Name: estoque_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_config (
    loja_id bigint NOT NULL,
    limite_motivo_inventario numeric(14,2) DEFAULT 50.00 NOT NULL,
    dias_curva_abc integer DEFAULT 90 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    validade_alerta_dias integer DEFAULT 7 NOT NULL,
    CONSTRAINT estoque_config_dias_curva_abc_check CHECK (((dias_curva_abc >= 7) AND (dias_curva_abc <= 730))),
    CONSTRAINT estoque_config_validade_alerta_dias_check CHECK (((validade_alerta_dias >= 1) AND (validade_alerta_dias <= 365)))
);


--
-- Name: estoque_custos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_custos (
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    cmc numeric(18,6) DEFAULT 0 NOT NULL,
    ultimo_custo numeric(18,6),
    saldo_total numeric(18,6) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estoque_local_saldos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_local_saldos (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    saldo numeric(20,6) DEFAULT 0 NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estoque_local_saldos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estoque_local_saldos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estoque_local_saldos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estoque_local_saldos_id_seq OWNED BY public.estoque_local_saldos.id;


--
-- Name: estoque_lote_movimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_lote_movimentos (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    movimento_id bigint NOT NULL,
    lote_id bigint NOT NULL,
    quantidade numeric(18,6) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_lote_movimentos_quantidade_check CHECK ((quantidade <> (0)::numeric))
);


--
-- Name: estoque_lote_movimentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.estoque_lote_movimentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.estoque_lote_movimentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: estoque_lotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_lotes (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_local_estoque bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    lote text,
    validade date,
    saldo numeric(18,6) DEFAULT 0 NOT NULL,
    quantidade_entrada numeric(18,6) DEFAULT 0 NOT NULL,
    origem text,
    ref text,
    movimento_origem_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estoque_lotes_check CHECK (((saldo >= (0)::numeric) OR ((lote IS NULL) AND (validade IS NULL))))
);


--
-- Name: estoque_saldos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_saldos (
    loja_id bigint NOT NULL,
    codigo_local_estoque bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    saldo numeric(18,6) DEFAULT 0 NOT NULL,
    minimo numeric(18,6),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estoque_lotes_divergencia; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.estoque_lotes_divergencia WITH (security_invoker='true') AS
 SELECT COALESCE(s.loja_id, l.loja_id) AS loja_id,
    COALESCE(s.codigo_local_estoque, l.codigo_local_estoque) AS codigo_local_estoque,
    COALESCE(s.codigo_produto, l.codigo_produto) AS codigo_produto,
    COALESCE(s.saldo, (0)::numeric) AS saldo_ledger,
    COALESCE(l.saldo, (0)::numeric) AS saldo_lotes
   FROM (public.estoque_saldos s
     FULL JOIN ( SELECT estoque_lotes.loja_id,
            estoque_lotes.codigo_local_estoque,
            estoque_lotes.codigo_produto,
            sum(estoque_lotes.saldo) AS saldo
           FROM public.estoque_lotes
          GROUP BY estoque_lotes.loja_id, estoque_lotes.codigo_local_estoque, estoque_lotes.codigo_produto) l ON (((l.loja_id = s.loja_id) AND (l.codigo_local_estoque = s.codigo_local_estoque) AND (l.codigo_produto = s.codigo_produto))))
  WHERE (round(COALESCE(s.saldo, (0)::numeric), 6) <> round(COALESCE(l.saldo, (0)::numeric), 6));


--
-- Name: estoque_lotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.estoque_lotes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.estoque_lotes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: estoque_movimentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.estoque_movimentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.estoque_movimentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: produtos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.produtos (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    codigo character varying(60),
    descricao character varying(120),
    codigo_familia bigint,
    descricao_familia character varying(50),
    tipo_item character varying(2),
    unidade character varying(6),
    valor_unitario numeric(20,6),
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    estoque_minimo numeric(20,6),
    inativo boolean DEFAULT false,
    bloqueado boolean DEFAULT false,
    ncm character varying(20),
    ean character varying(20),
    campos_editados jsonb DEFAULT '[]'::jsonb NOT NULL,
    pdv boolean DEFAULT false NOT NULL,
    ficha_tecnica_checada_em timestamp with time zone,
    grupo_id bigint,
    eh_mae boolean DEFAULT false NOT NULL,
    produto_pai_codigo bigint,
    atributos jsonb DEFAULT '{}'::jsonb NOT NULL,
    vendas_ref uuid,
    sync_atualizado_em timestamp with time zone,
    validade_dias integer,
    CONSTRAINT produtos_validade_dias_check CHECK (((validade_dias IS NULL) OR (validade_dias > 0)))
);


--
-- Name: estoque_negativos; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.estoque_negativos WITH (security_invoker='true') AS
 SELECT s.loja_id,
    s.codigo_local_estoque,
    s.codigo_produto,
    s.saldo,
    pr.codigo,
    pr.descricao,
    pr.unidade
   FROM (public.estoque_saldos s
     LEFT JOIN public.produtos pr ON (((pr.loja_id = s.loja_id) AND (pr.codigo_produto = s.codigo_produto))))
  WHERE (s.saldo < (0)::numeric);


--
-- Name: estoque_receita_consumos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_receita_consumos (
    movimento_id bigint NOT NULL,
    loja_id bigint NOT NULL,
    ficha_id bigint NOT NULL,
    versao integer NOT NULL,
    produto_vendido bigint NOT NULL,
    quantidade_vendida numeric(18,6) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estrutura_produto_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estrutura_produto_cache (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    codigo_produto_insumo bigint NOT NULL,
    descricao_insumo text,
    quantidade numeric(20,6) NOT NULL,
    percentual_perda numeric(6,2) DEFAULT 0 NOT NULL,
    unidade character varying(10),
    tipo_insumo character varying(2),
    sincronizado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estrutura_produto_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estrutura_produto_cache_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estrutura_produto_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estrutura_produto_cache_id_seq OWNED BY public.estrutura_produto_cache.id;


--
-- Name: etiqueta_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etiqueta_config (
    loja_id bigint NOT NULL,
    nome_exibido text,
    mostrar_fabricacao boolean DEFAULT true NOT NULL,
    mostrar_validade boolean DEFAULT true NOT NULL,
    mostrar_qtde_nf boolean DEFAULT true NOT NULL,
    mostrar_qtde_etiqueta boolean DEFAULT true NOT NULL,
    mostrar_lote boolean DEFAULT true NOT NULL,
    mostrar_recebido boolean DEFAULT true NOT NULL,
    mostrar_fornecedor boolean DEFAULT true NOT NULL,
    mostrar_cnpj boolean DEFAULT true NOT NULL,
    ordem_campos text[] DEFAULT ARRAY['fabricacao'::text, 'validade'::text, 'qtde_nf'::text, 'qtde_etiqueta'::text, 'lote'::text, 'recebido'::text, 'fornecedor'::text] NOT NULL,
    fonte_escala numeric DEFAULT 1.0 NOT NULL,
    negrito_nome boolean DEFAULT true NOT NULL,
    negrito_descricao boolean DEFAULT true NOT NULL,
    cor_destaque text,
    mostrar_logo boolean DEFAULT true NOT NULL,
    mostrar_borda boolean DEFAULT false NOT NULL,
    largura_cm numeric DEFAULT 7.26 NOT NULL,
    altura_cm numeric DEFAULT 4.0 NOT NULL,
    offset_x numeric DEFAULT 0 NOT NULL,
    offset_y numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT etiqueta_config_altura_cm_check CHECK (((altura_cm >= (2)::numeric) AND (altura_cm <= (30)::numeric))),
    CONSTRAINT etiqueta_config_fonte_escala_check CHECK (((fonte_escala >= 0.7) AND (fonte_escala <= 1.5))),
    CONSTRAINT etiqueta_config_largura_cm_check CHECK (((largura_cm >= (2)::numeric) AND (largura_cm <= (30)::numeric)))
);


--
-- Name: familias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.familias (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_familia bigint,
    codigo character varying(60),
    nome character varying(120) NOT NULL,
    inativo boolean DEFAULT false NOT NULL,
    origem character varying(10) DEFAULT 'local'::character varying NOT NULL,
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: familias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.familias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: familias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.familias_id_seq OWNED BY public.familias.id;


--
-- Name: faturamento_import_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faturamento_import_meta (
    loja_id bigint NOT NULL,
    importado_em timestamp with time zone DEFAULT now() NOT NULL,
    importado_por uuid,
    linhas integer DEFAULT 0 NOT NULL,
    arquivo text
);


--
-- Name: faturamento_importado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faturamento_importado (
    loja_id bigint NOT NULL,
    dimensao text NOT NULL,
    rotulo text NOT NULL,
    mes text NOT NULL,
    valor numeric NOT NULL
);


--
-- Name: ficha_tecnica_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ficha_tecnica_itens (
    id bigint NOT NULL,
    ficha_id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_insumo bigint NOT NULL,
    quantidade_liquida numeric(18,6) NOT NULL,
    fator_correcao numeric(9,4) DEFAULT 1 NOT NULL,
    perda_pct numeric(6,3) DEFAULT 0 NOT NULL,
    quantidade_bruta numeric(18,6) GENERATED ALWAYS AS (round(((quantidade_liquida * fator_correcao) * ((1)::numeric + (perda_pct / (100)::numeric))), 6)) STORED,
    ordem integer DEFAULT 0 NOT NULL,
    CONSTRAINT ficha_tecnica_itens_fator_correcao_check CHECK ((fator_correcao > (0)::numeric)),
    CONSTRAINT ficha_tecnica_itens_perda_pct_check CHECK (((perda_pct >= (0)::numeric) AND (perda_pct <= (100)::numeric))),
    CONSTRAINT ficha_tecnica_itens_quantidade_liquida_check CHECK ((quantidade_liquida > (0)::numeric))
);


--
-- Name: ficha_tecnica_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ficha_tecnica_itens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ficha_tecnica_itens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ficha_tecnica_local; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ficha_tecnica_local (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    codigo_produto_insumo bigint NOT NULL,
    descricao_insumo text,
    quantidade numeric(20,6) NOT NULL,
    percentual_perda numeric(6,2) DEFAULT 0 NOT NULL,
    unidade character varying(10),
    sincronizado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ficha_tecnica_local_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ficha_tecnica_local_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ficha_tecnica_local_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ficha_tecnica_local_id_seq OWNED BY public.ficha_tecnica_local.id;


--
-- Name: fichas_tecnicas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fichas_tecnicas (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    versao integer NOT NULL,
    rendimento numeric(18,6) NOT NULL,
    expandir_na_venda boolean DEFAULT false NOT NULL,
    ativa boolean DEFAULT true NOT NULL,
    obs text,
    criada_por text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fichas_tecnicas_rendimento_check CHECK ((rendimento > (0)::numeric))
);


--
-- Name: fichas_tecnicas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fichas_tecnicas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fichas_tecnicas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fornecedor_produto_depara; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fornecedor_produto_depara (
    loja_id bigint NOT NULL,
    fornecedor_cnpj text NOT NULL,
    c_prod text NOT NULL,
    codigo_produto bigint NOT NULL,
    fator numeric(18,6) DEFAULT 1 NOT NULL,
    unidade_compra text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fornecedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fornecedores (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_omie bigint,
    codigo_integracao character varying(60),
    razao_social character varying(150) NOT NULL,
    nome_fantasia character varying(120),
    cnpj_cpf character varying(20),
    pessoa_fisica boolean DEFAULT false NOT NULL,
    inscricao_estadual character varying(20),
    inscricao_municipal character varying(20),
    email character varying(120),
    telefone character varying(30),
    cep character varying(10),
    uf character varying(2),
    cidade character varying(100),
    bairro character varying(100),
    logradouro character varying(200),
    numero character varying(20),
    complemento character varying(120),
    inativo boolean DEFAULT false NOT NULL,
    origem character varying(10) DEFAULT 'local'::character varying NOT NULL,
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fornecedores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fornecedores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fornecedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fornecedores_id_seq OWNED BY public.fornecedores.id;


--
-- Name: grupos_produto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grupos_produto (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    pai_id bigint,
    nome text NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    vendas_ref uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT grupos_produto_nome_check CHECK ((btrim(nome) <> ''::text))
);


--
-- Name: grupos_produto_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.grupos_produto ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.grupos_produto_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: impressao_etiquetas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impressao_etiquetas (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    origem text NOT NULL,
    referencia_id bigint NOT NULL,
    qtd_etiquetas integer DEFAULT 0 NOT NULL,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT impressao_etiquetas_origem_check CHECK ((origem = ANY (ARRAY['NF'::text, 'OP'::text, 'PRODUTO'::text, 'CATALOGO'::text])))
);


--
-- Name: impressao_etiquetas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.impressao_etiquetas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: impressao_etiquetas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.impressao_etiquetas_id_seq OWNED BY public.impressao_etiquetas.id;


--
-- Name: integration_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_attempts (
    id bigint NOT NULL,
    loja_id bigint,
    model character varying(120),
    request text,
    response text,
    code character varying(3),
    error boolean DEFAULT false,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.integration_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: integration_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.integration_attempts_id_seq OWNED BY public.integration_attempts.id;


--
-- Name: inventario_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario_items (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    inventario_id bigint NOT NULL,
    produto_codigo_produto bigint,
    produto_codigo character varying(60),
    produto_descricao character varying(120),
    produto_familia character varying(50),
    quan numeric(20,6),
    valor numeric(20,6),
    response text,
    codigo_status character varying(20),
    descricao_status text,
    id_movest bigint,
    id_ajuste bigint,
    status character varying(30),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tentativas integer DEFAULT 0 NOT NULL,
    ultima_tentativa_em timestamp with time zone,
    motivo text,
    diferenca numeric(18,6)
);


--
-- Name: inventario_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventario_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventario_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventario_items_id_seq OWNED BY public.inventario_items.id;


--
-- Name: inventario_proprio_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventario_proprio_itens (
    id bigint NOT NULL,
    inventario_id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    saldo_snapshot numeric(18,6) DEFAULT 0 NOT NULL,
    contado numeric(18,6),
    contado_em timestamp with time zone,
    contado_por text,
    motivo text,
    delta_aplicado numeric(18,6),
    movimento_id bigint,
    CONSTRAINT inventario_proprio_itens_contado_check CHECK (((contado IS NULL) OR (contado >= (0)::numeric)))
);


--
-- Name: inventario_proprio_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inventario_proprio_itens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inventario_proprio_itens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventarios (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_local_estoque bigint NOT NULL,
    data timestamp with time zone DEFAULT now() NOT NULL,
    tipo character varying(3) DEFAULT 'SLD'::character varying,
    origem character varying(3) DEFAULT 'AJU'::character varying,
    motivo character varying(3) DEFAULT 'INV'::character varying,
    finalizado timestamp with time zone,
    status character varying(30) DEFAULT 'Em contagem'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    curva text
);


--
-- Name: inventarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventarios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventarios_id_seq OWNED BY public.inventarios.id;


--
-- Name: inventarios_proprio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventarios_proprio (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_local_estoque bigint NOT NULL,
    status text DEFAULT 'aberto'::text NOT NULL,
    tipo text DEFAULT 'geral'::text NOT NULL,
    classe text,
    descricao text,
    aberto_por text,
    aberto_em timestamp with time zone DEFAULT now() NOT NULL,
    fechado_por text,
    fechado_em timestamp with time zone,
    total_itens integer,
    total_contados integer,
    total_ajustes_valor numeric(18,4),
    obs text,
    CONSTRAINT inventarios_proprio_classe_check CHECK ((classe = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]))),
    CONSTRAINT inventarios_proprio_status_check CHECK ((status = ANY (ARRAY['aberto'::text, 'fechado'::text, 'cancelado'::text]))),
    CONSTRAINT inventarios_proprio_tipo_check CHECK ((tipo = ANY (ARRAY['geral'::text, 'ciclica'::text])))
);


--
-- Name: inventarios_proprio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.inventarios_proprio ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.inventarios_proprio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: local_estoque_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_estoque_user (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    local_estoque_id bigint NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: local_estoque_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.local_estoque_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: local_estoque_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.local_estoque_user_id_seq OWNED BY public.local_estoque_user.id;


--
-- Name: local_estoques; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_estoques (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_local_estoque bigint NOT NULL,
    codigo character varying(50),
    descricao character varying(250),
    tipo character varying(1),
    padrao character varying(1),
    inativo character varying(1),
    codigo_cliente bigint,
    disp_ordem_producao character varying(1),
    disp_consumo_op character varying(1),
    disp_remessa character varying(1),
    disp_venda character varying(1),
    d_inc character varying(10),
    h_inc character varying(8),
    u_inc character varying(50),
    d_alt character varying(10),
    h_alt character varying(8),
    u_alt character varying(50),
    full_object jsonb,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: local_estoques_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.local_estoques_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: local_estoques_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.local_estoques_id_seq OWNED BY public.local_estoques.id;


--
-- Name: loja_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loja_user (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cargo_id bigint
);


--
-- Name: loja_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loja_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loja_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loja_user_id_seq OWNED BY public.loja_user.id;


--
-- Name: lojas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lojas (
    id bigint NOT NULL,
    cnpj character varying(18) NOT NULL,
    nome character varying(120) NOT NULL,
    nome_fantasia character varying(80),
    cep character varying(10),
    uf character varying(2),
    cidade character varying(100),
    bairro character varying(100),
    logradouro character varying(200),
    numero character varying(20),
    omie_app_key text,
    omie_app_secret text,
    ativo boolean DEFAULT true NOT NULL,
    local_estoque_ultima_atualizacao timestamp with time zone,
    local_estoque_status character varying(20),
    produto_ultima_atualizacao timestamp with time zone,
    produto_status character varying(20),
    posicao_estoque_ultima_atualizacao timestamp with time zone,
    posicao_estoque_status character varying(20),
    nota_fiscal_ultima_atualizacao timestamp with time zone,
    nota_fiscal_status character varying(20),
    ordem_producao_ultima_atualizacao timestamp with time zone,
    ordem_producao_status character varying(20),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    razao_social character varying(150),
    inscricao_estadual character varying(20),
    inscricao_municipal character varying(20),
    cnae character varying(10),
    cnae_municipal character varying(10),
    regime_tributario character varying(5),
    optante_simples_nacional character varying(1),
    csc_producao text,
    csc_id_producao character varying(10),
    codigo_empresa bigint,
    complemento character varying(100),
    email character varying(120),
    website character varying(200),
    telefone1 character varying(20),
    telefone2 character varying(20),
    sped_nome_contador character varying(150),
    sped_cpf_contador character varying(14),
    sped_email_contador character varying(120),
    empresa_ultima_atualizacao timestamp with time zone,
    empresa_status character varying(20),
    full_object_empresa jsonb,
    certificado_path text,
    certificado_nome text,
    certificado_senha_enc text,
    certificado_validade date,
    certificado_atualizado timestamp with time zone,
    familia_ultima_atualizacao timestamp with time zone,
    familia_status character varying(20),
    fornecedor_ultima_atualizacao timestamp with time zone,
    fornecedor_status character varying(20),
    cliente_ultima_atualizacao timestamp with time zone,
    cliente_status character varying(20),
    codigo_onboarding character varying(12),
    integracao_api_key text,
    meta_compras_pct numeric,
    integracao_teste_api_key text,
    is_test boolean DEFAULT false NOT NULL,
    loja_origem_id bigint,
    local_estoque_cozinha_codigo bigint,
    local_estoque_bar_codigo bigint,
    local_estoque_por_setor jsonb,
    local_estoque_por_produto jsonb,
    modo_estoque text DEFAULT 'omie'::text NOT NULL,
    vendas_store_id uuid,
    CONSTRAINT lojas_meta_compras_pct_check CHECK (((meta_compras_pct >= (0)::numeric) AND (meta_compras_pct <= (100)::numeric))),
    CONSTRAINT lojas_modo_estoque_chk CHECK ((modo_estoque = ANY (ARRAY['omie'::text, 'proprio'::text, 'nenhum'::text])))
);


--
-- Name: lojas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lojas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lojas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lojas_id_seq OWNED BY public.lojas.id;


--
-- Name: margem_import_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.margem_import_meta (
    loja_id bigint NOT NULL,
    importado_em timestamp with time zone DEFAULT now() NOT NULL,
    importado_por uuid,
    linhas integer DEFAULT 0 NOT NULL,
    arquivo text
);


--
-- Name: margem_importada; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.margem_importada (
    loja_id bigint NOT NULL,
    codigo text NOT NULL,
    descricao text,
    familia text,
    mes text NOT NULL,
    pdv numeric,
    cmc numeric,
    margem numeric
);


--
-- Name: margem_snapshot_diario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.margem_snapshot_diario (
    loja_id bigint NOT NULL,
    data_snapshot date NOT NULL,
    codigo_produto bigint NOT NULL,
    codigo text,
    descricao text,
    descricao_familia text,
    pdv numeric,
    cmc numeric,
    margem numeric
);


--
-- Name: metas_faturamento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metas_faturamento (
    loja_id bigint NOT NULL,
    valor_diario numeric(14,2) NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_por uuid,
    CONSTRAINT metas_faturamento_valor_diario_check CHECK ((valor_diario >= (0)::numeric))
);


--
-- Name: metas_mensais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metas_mensais (
    loja_id bigint NOT NULL,
    mes character(7) NOT NULL,
    valor_mensal numeric(14,2) NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_por uuid,
    CONSTRAINT metas_mensais_mes_check CHECK ((mes ~ '^\d{4}-(0[1-9]|1[0-2])$'::text)),
    CONSTRAINT metas_mensais_valor_mensal_check CHECK ((valor_mensal > (0)::numeric))
);


--
-- Name: movimentacao_import_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentacao_import_meta (
    loja_id bigint NOT NULL,
    importado_em timestamp with time zone DEFAULT now() NOT NULL,
    importado_por uuid,
    linhas integer DEFAULT 0 NOT NULL,
    arquivo text
);


--
-- Name: movimentacao_importada; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentacao_importada (
    loja_id bigint NOT NULL,
    dimensao text NOT NULL,
    rotulo text NOT NULL,
    mes text NOT NULL,
    valor numeric NOT NULL
);


--
-- Name: movimentacao_operacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentacao_operacao (
    loja_id bigint NOT NULL,
    origem text NOT NULL,
    sentido text NOT NULL,
    local text NOT NULL,
    tipo_sped text NOT NULL,
    familia text NOT NULL,
    mes text NOT NULL,
    inventario boolean DEFAULT false NOT NULL,
    qtde numeric DEFAULT 0 NOT NULL,
    valor numeric DEFAULT 0 NOT NULL,
    CONSTRAINT movimentacao_operacao_sentido_check CHECK ((sentido = ANY (ARRAY['E'::text, 'S'::text])))
);


--
-- Name: movimentacao_operacao_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentacao_operacao_meta (
    loja_id bigint NOT NULL,
    importado_em timestamp with time zone DEFAULT now() NOT NULL,
    importado_por uuid,
    linhas integer DEFAULT 0 NOT NULL,
    arquivo text
);


--
-- Name: movimentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentos (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    transferencia_id bigint,
    codigo_local_estoque bigint NOT NULL,
    id_prod bigint NOT NULL,
    data timestamp with time zone NOT NULL,
    tipo character varying(3) NOT NULL,
    quan numeric(20,6),
    valor numeric(10,2),
    obs text,
    origem character varying(3) DEFAULT 'AJU'::character varying,
    motivo character varying(3),
    codigo_local_estoque_destino bigint,
    codigo_status character varying(20),
    descricao_status text,
    id_movest bigint,
    id_ajuste bigint,
    response text,
    status character varying(20),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tentativas integer DEFAULT 0 NOT NULL,
    ultima_tentativa_em timestamp with time zone,
    obs_item text,
    ledger_ref text,
    ledger_versao integer DEFAULT 0 NOT NULL,
    CONSTRAINT movimentos_origem_check CHECK (((origem)::text = ANY ((ARRAY['AJU'::character varying, 'PDV'::character varying])::text[]))),
    CONSTRAINT movimentos_status_check CHECK (((status)::text = ANY ((ARRAY['Iniciado'::character varying, 'Processando'::character varying, 'Concluido'::character varying, 'Erro'::character varying, 'Sem CMC'::character varying])::text[]))),
    CONSTRAINT movimentos_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['ENT'::character varying, 'SAI'::character varying, 'SLD'::character varying, 'TRF'::character varying, 'TPQ'::character varying])::text[])))
);


--
-- Name: movimentos_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentos_historico (
    loja_id integer NOT NULL,
    cod_prod bigint NOT NULL,
    codigo text,
    descricao text,
    data date NOT NULL,
    entradas numeric DEFAULT 0,
    saidas numeric DEFAULT 0
);


--
-- Name: movimentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.movimentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: movimentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.movimentos_id_seq OWNED BY public.movimentos.id;


--
-- Name: movimentos_locais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimentos_locais (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    tipo character varying(3) NOT NULL,
    quantidade numeric(20,6) NOT NULL,
    saldo_apos numeric(20,6) NOT NULL,
    origem_n_cod_op bigint,
    pedido_ref text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT movimentos_locais_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['SAI'::character varying, 'ENT'::character varying])::text[])))
);


--
-- Name: movimentos_locais_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.movimentos_locais_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: movimentos_locais_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.movimentos_locais_id_seq OWNED BY public.movimentos_locais.id;


--
-- Name: nota_fiscal_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nota_fiscal_items (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    nota_fiscal_id bigint,
    n_id_receb character varying(20),
    produto_codigo character varying(20),
    quantidade integer,
    n_sequencia bigint,
    n_id_item bigint,
    n_id_pedido bigint,
    n_id_it_pedido bigint,
    n_id_produto bigint,
    c_codigo_produto character varying(60),
    c_descricao_produto character varying(120),
    c_ignorar_item character varying(1),
    c_adicionar_novo character varying(1),
    c_associar_existente character varying(1),
    c_item_devolvido character varying(1),
    c_ncm character varying(13),
    c_ean character varying(14),
    c_cfop character varying(10),
    n_qtde_nfe numeric(20,6),
    c_unidade_nfe character varying(6),
    n_preco_unit numeric(20,6),
    v_desconto numeric(10,2),
    v_frete numeric(10,2),
    v_total_item numeric(10,2),
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    categoria_contabil_id bigint
);


--
-- Name: nota_fiscal_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nota_fiscal_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nota_fiscal_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nota_fiscal_items_id_seq OWNED BY public.nota_fiscal_items.id;


--
-- Name: notas_fiscais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_fiscais (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    n_id_receb character varying(20),
    n_id_fornecedor bigint,
    c_pessoa_fisica character varying(1),
    c_nome character varying(100),
    c_razao_social character varying(60),
    c_inscricao character varying(20),
    c_cnpj_cpf character varying(20),
    c_chave_nfe character varying(44),
    c_etapa character varying(2),
    c_numero_nfe character varying(10),
    c_serie_nfe character varying(3),
    c_modelo_nfe character varying(2),
    d_emissao_nfe date,
    n_valor_nfe numeric(20,6),
    c_ambiente_nfe character varying(1),
    c_natureza_operacao character varying(60),
    full_object jsonb,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origem character varying(10) DEFAULT 'omie'::character varying NOT NULL,
    CONSTRAINT notas_fiscais_origem_check CHECK (((origem)::text = ANY ((ARRAY['omie'::character varying, 'sefaz'::character varying])::text[])))
);


--
-- Name: notas_fiscais_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notas_fiscais_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notas_fiscais_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notas_fiscais_id_seq OWNED BY public.notas_fiscais.id;


--
-- Name: op_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.op_historico (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    op_id bigint,
    n_cod_op bigint NOT NULL,
    num_op text,
    evento text NOT NULL,
    user_nome text,
    user_uuid uuid,
    quantidade numeric(18,6),
    detalhes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT op_historico_evento_check CHECK ((evento = ANY (ARRAY['criada'::text, 'alterada'::text, 'concluida'::text, 'revertida'::text, 'excluida'::text])))
);


--
-- Name: op_historico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.op_historico ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.op_historico_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: op_numeracao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.op_numeracao (
    loja_id bigint NOT NULL,
    ano integer NOT NULL,
    ultimo integer DEFAULT 0 NOT NULL
);


--
-- Name: op_qtde_planejada; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.op_qtde_planejada (
    loja_id bigint NOT NULL,
    n_cod_op bigint NOT NULL,
    qtde_planejada numeric(20,6),
    dt_previsao date,
    primeira_vez_em date DEFAULT CURRENT_DATE NOT NULL,
    ultima_vez_em date NOT NULL
);


--
-- Name: ordens_producao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordens_producao (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    num_ordem character varying(60),
    validade date,
    quantidade numeric(20,6),
    identificacao_n_cod_op bigint,
    identificacao_c_cod_int_op character varying(20),
    identificacao_c_num_op character varying(15),
    identificacao_n_cod_produto bigint,
    identificacao_c_cod_int_prod character varying(60),
    identificacao_d_dt_previsao date,
    identificacao_n_qtde numeric(20,6),
    identificacao_codigo_local_estoque bigint,
    adicionais_c_etapa character varying(2),
    adicionais_n_cod_projeto bigint,
    adicionais_d_dt_inicio date,
    adicionais_d_dt_conclusao date,
    produto_codigo character varying(60),
    produto_descricao character varying(120),
    produto_tipo_item character varying(2),
    produto_unidade character varying(6),
    full_object jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    concluida boolean,
    dt_conclusao_real date,
    dt_inclusao date,
    observacao text,
    conclusao_status text,
    conclusao_erro_msg text,
    conclusao_qtde_desejada numeric(20,6),
    conclusao_data_desejada date,
    conclusao_tentativas integer DEFAULT 0 NOT NULL,
    conclusao_ultima_tentativa_em timestamp with time zone,
    concluida_por uuid,
    alterado_por_omie text,
    dt_ultima_alteracao_omie date,
    local_destino bigint,
    producao_ref text,
    producao_n integer DEFAULT 0 NOT NULL,
    criada_por text,
    concluida_por_nome text,
    revertida_em timestamp with time zone,
    revertida_por text,
    ficha_id bigint,
    ficha_versao integer,
    custo_total numeric(18,6),
    custo_unitario numeric(18,6),
    venda_ref text
);


--
-- Name: ordens_producao_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ordens_producao_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ordens_producao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ordens_producao_id_seq OWNED BY public.ordens_producao.id;


--
-- Name: ordens_producao_proprio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordens_producao_proprio (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    ref text NOT NULL,
    codigo_produto bigint NOT NULL,
    ficha_id bigint NOT NULL,
    quantidade numeric(18,6) NOT NULL,
    local_consumo bigint NOT NULL,
    local_destino bigint NOT NULL,
    custo_total numeric(18,6) DEFAULT 0 NOT NULL,
    custo_unitario numeric(18,6) DEFAULT 0 NOT NULL,
    status text DEFAULT 'concluida'::text NOT NULL,
    user_id text,
    obs text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ordens_producao_proprio_quantidade_check CHECK ((quantidade > (0)::numeric))
);


--
-- Name: ordens_producao_proprio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ordens_producao_proprio ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ordens_producao_proprio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ordens_producao_proprio_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordens_producao_proprio_itens (
    id bigint NOT NULL,
    ordem_id bigint NOT NULL,
    codigo_insumo bigint NOT NULL,
    quantidade numeric(18,6) NOT NULL,
    custo_unitario numeric(18,6) DEFAULT 0 NOT NULL,
    movimento_id bigint
);


--
-- Name: ordens_producao_proprio_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ordens_producao_proprio_itens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ordens_producao_proprio_itens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ordens_producao_teste; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ordens_producao_teste (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_produto bigint,
    codigo_produto_texto text NOT NULL,
    quantidade numeric NOT NULL,
    pedido_ref text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ordens_producao_teste_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ordens_producao_teste ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ordens_producao_teste_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    id bigint DEFAULT nextval('public.outbox_id_seq'::regclass) NOT NULL,
    table_name text NOT NULL,
    operation text NOT NULL,
    row_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_new_operation_check CHECK ((operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: permissao_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissao_user (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    permissao_id bigint NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: permissao_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissao_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissao_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissao_user_id_seq OWNED BY public.permissao_user.id;


--
-- Name: permissoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissoes (
    id bigint NOT NULL,
    nome character varying(60) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permissoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissoes_id_seq OWNED BY public.permissoes.id;


--
-- Name: posicao_estoques; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posicao_estoques (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_local_estoque bigint NOT NULL,
    n_cod_prod bigint NOT NULL,
    data_posicao date NOT NULL,
    c_cod_int character varying(60),
    c_codigo character varying(60),
    c_descricao character varying(120),
    n_preco_unitario numeric(20,6),
    n_saldo numeric(20,6),
    n_cmc numeric(20,6),
    n_pendente numeric(20,6),
    estoque_minimo numeric(20,6),
    reservado numeric(20,6),
    fisico numeric(20,6),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: posicao_estoques_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.posicao_estoques_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: posicao_estoques_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.posicao_estoques_id_seq OWNED BY public.posicao_estoques.id;


--
-- Name: previsao_venda; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.previsao_venda (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    n_cod_prod bigint NOT NULL,
    qtde numeric(20,6) DEFAULT 0 NOT NULL,
    periodo_ini date,
    periodo_fim date,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    janela_dias integer DEFAULT 7 NOT NULL
);


--
-- Name: previsao_venda_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.previsao_venda_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: previsao_venda_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.previsao_venda_id_seq OWNED BY public.previsao_venda.id;


--
-- Name: produto_preco_recente; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.produto_preco_recente (
    loja_id bigint NOT NULL,
    codigo_produto bigint NOT NULL,
    preco_unit numeric NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: produto_sem_estrutura; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.produto_sem_estrutura (
    loja_id integer NOT NULL,
    codigo_produto bigint NOT NULL,
    visto_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: produto_substituicoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.produto_substituicoes (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    n_cod_prod bigint NOT NULL,
    substitui_n_cod_prod bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: produto_substituicoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.produto_substituicoes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.produto_substituicoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: produtos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.produtos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: produtos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.produtos_id_seq OWNED BY public.produtos.id;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    current_loja_id bigint,
    perfil character varying(20) DEFAULT 'Usuario'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'aprovado'::character varying NOT NULL,
    email character varying(255),
    is_super_admin boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_perfil_check CHECK (((perfil)::text = ANY ((ARRAY['Admin'::character varying, 'AdminLoja'::character varying, 'Usuario'::character varying])::text[])))
);


--
-- Name: sefaz_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sefaz_documentos (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    nsu text NOT NULL,
    schema text,
    tipo text DEFAULT 'outro'::text NOT NULL,
    chave text,
    completo boolean DEFAULT false NOT NULL,
    xml text,
    nota_fiscal_id bigint,
    processado boolean DEFAULT false NOT NULL,
    ignorado text,
    erro text,
    ciencia_em timestamp with time zone,
    ciencia_cstat text,
    recebido_em timestamp with time zone DEFAULT now() NOT NULL,
    busca_chave_em timestamp with time zone,
    CONSTRAINT sefaz_documentos_tipo_check CHECK ((tipo = ANY (ARRAY['resNFe'::text, 'procNFe'::text, 'resEvento'::text, 'procEventoNFe'::text, 'outro'::text])))
);


--
-- Name: sefaz_documentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sefaz_documentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sefaz_documentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sefaz_nsu; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sefaz_nsu (
    loja_id bigint NOT NULL,
    cnpj text,
    ambiente smallint DEFAULT 1 NOT NULL,
    ult_nsu text DEFAULT '0'::text NOT NULL,
    max_nsu text,
    bloqueado_ate timestamp with time zone,
    ultima_consulta timestamp with time zone,
    ultimo_cstat text,
    ultimo_motivo text,
    ultimo_erro text,
    auto_lancar boolean DEFAULT true NOT NULL,
    auto_ciencia boolean DEFAULT true NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sefaz_nsu_ambiente_check CHECK ((ambiente = ANY (ARRAY[1, 2])))
);


--
-- Name: seq_cupom_proprio; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_cupom_proprio
    START WITH 8000000000001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_id_local_proprio; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_id_local_proprio
    START WITH 8000000000001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_id_produto_proprio; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_id_produto_proprio
    START WITH 8000000000001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_nf_proprio; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_nf_proprio
    START WITH 8000000000001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_op_proprio; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_op_proprio
    START WITH 8000000000001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sugestao_compra; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sugestao_compra WITH (security_invoker='true') AS
 SELECT s.loja_id,
    s.codigo_local_estoque,
    s.codigo_produto,
    pr.codigo,
    pr.descricao,
    pr.unidade,
    pr.codigo_familia,
    COALESCE(f.nome, 'Sem família'::character varying) AS familia,
    s.saldo,
    s.minimo,
    (s.minimo - s.saldo) AS falta,
    COALESCE(c.cmc, (0)::numeric) AS cmc,
    c.ultimo_custo,
    round(((s.minimo - s.saldo) * COALESCE(c.ultimo_custo, c.cmc, (0)::numeric)), 2) AS valor_estimado
   FROM (((public.estoque_saldos s
     JOIN public.produtos pr ON (((pr.loja_id = s.loja_id) AND (pr.codigo_produto = s.codigo_produto) AND (COALESCE(pr.inativo, false) = false))))
     LEFT JOIN public.familias f ON (((f.loja_id = pr.loja_id) AND (f.codigo_familia = pr.codigo_familia))))
     LEFT JOIN public.estoque_custos c ON (((c.loja_id = s.loja_id) AND (c.codigo_produto = s.codigo_produto))))
  WHERE ((s.minimo IS NOT NULL) AND (s.minimo > (0)::numeric) AND (s.saldo < s.minimo));


--
-- Name: sync_divergencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_divergencias (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    entidade text NOT NULL,
    ref text NOT NULL,
    tipo text NOT NULL,
    detalhe text,
    detectado_em timestamp with time zone DEFAULT now() NOT NULL,
    resolvido_em timestamp with time zone
);


--
-- Name: sync_divergencias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sync_divergencias ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sync_divergencias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sync_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_outbox (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    entidade text NOT NULL,
    ref text NOT NULL,
    operacao text DEFAULT 'upsert'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    tentativas integer DEFAULT 0 NOT NULL,
    erro text,
    proxima_tentativa timestamp with time zone DEFAULT now() NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_outbox_entidade_check CHECK ((entidade = ANY (ARRAY['produto'::text, 'grupo'::text]))),
    CONSTRAINT sync_outbox_operacao_check CHECK ((operacao = ANY (ARRAY['upsert'::text, 'delete'::text]))),
    CONSTRAINT sync_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ok'::text, 'erro'::text])))
);


--
-- Name: sync_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sync_outbox ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sync_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: transferencias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transferencias (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    codigo_local_origem bigint NOT NULL,
    codigo_local_destino bigint NOT NULL,
    motivo character varying(50),
    data timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(30) DEFAULT 'Em contagem'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    observacao text
);


--
-- Name: transferencias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transferencias_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transferencias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transferencias_id_seq OWNED BY public.transferencias.id;


--
-- Name: vendas_integracao_fila; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendas_integracao_fila (
    id bigint NOT NULL,
    loja_id integer NOT NULL,
    tipo text NOT NULL,
    ref text,
    payload jsonb NOT NULL,
    status text DEFAULT 'Pendente'::text NOT NULL,
    tentativas integer DEFAULT 0 NOT NULL,
    proximo_em timestamp with time zone DEFAULT now() NOT NULL,
    ultimo_erro text,
    resultado jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendas_integracao_fila_status_check CHECK ((status = ANY (ARRAY['Pendente'::text, 'Concluido'::text, 'Erro'::text]))),
    CONSTRAINT vendas_integracao_fila_tipo_check CHECK ((tipo = ANY (ARRAY['op'::text, 'nfce'::text])))
);


--
-- Name: vendas_integracao_fila_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendas_integracao_fila_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendas_integracao_fila_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendas_integracao_fila_id_seq OWNED BY public.vendas_integracao_fila.id;


--
-- Name: vendas_proprio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendas_proprio (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    pedido_ref text NOT NULL,
    n_id_cupom bigint DEFAULT nextval('public.seq_cupom_proprio'::regclass) NOT NULL,
    data date NOT NULL,
    hora text,
    tipo text,
    mesa text,
    valor numeric(14,2) DEFAULT 0 NOT NULL,
    desconto numeric(14,2) DEFAULT 0 NOT NULL,
    taxa numeric(14,2) DEFAULT 0 NOT NULL,
    cancelado boolean DEFAULT false NOT NULL,
    devolvido boolean DEFAULT false NOT NULL,
    operador text,
    nota_chave text,
    nota_numero text,
    nota_serie text,
    nota_status text,
    frio_enviado_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendas_proprio_cmv; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vendas_proprio_cmv WITH (security_invoker='true') AS
 WITH movs AS (
         SELECT v.id AS venda_id,
            v.loja_id,
                CASE
                    WHEN (m_1.ref = v.pedido_ref) THEN m_1.codigo_produto
                    ELSE (NULLIF(split_part(m_1.ref, '|'::text, 2), ''::text))::bigint
                END AS produto_vendido,
            m_1.id,
            m_1.quantidade,
            m_1.custo_unitario
           FROM (public.vendas_proprio v
             JOIN public.estoque_movimentos m_1 ON (((m_1.loja_id = v.loja_id) AND (m_1.origem = 'VENDA'::text) AND ((m_1.ref = v.pedido_ref) OR (m_1.ref ~~ (v.pedido_ref || '|%'::text))))))
        ), est AS (
         SELECT estoque_movimentos.reverses_id,
            sum((estoque_movimentos.quantidade * COALESCE(estoque_movimentos.custo_unitario, (0)::numeric))) AS valor
           FROM public.estoque_movimentos
          WHERE (estoque_movimentos.reverses_id IS NOT NULL)
          GROUP BY estoque_movimentos.reverses_id
        )
 SELECT m.venda_id,
    m.loja_id,
    m.produto_vendido AS codigo_produto,
    round((- (sum((m.quantidade * COALESCE(m.custo_unitario, (0)::numeric))) + COALESCE(sum(e.valor), (0)::numeric))), 4) AS cmv,
    count(*) FILTER (WHERE (COALESCE(m.custo_unitario, (0)::numeric) = (0)::numeric)) AS movimentos_sem_custo,
    count(*) AS movimentos
   FROM (movs m
     LEFT JOIN est e ON ((e.reverses_id = m.id)))
  GROUP BY m.venda_id, m.loja_id, m.produto_vendido;


--
-- Name: vendas_proprio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vendas_proprio ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vendas_proprio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vendas_proprio_itens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendas_proprio_itens (
    id bigint NOT NULL,
    venda_id bigint NOT NULL,
    linha integer NOT NULL,
    codigo text,
    codigo_produto bigint,
    nome text,
    quantidade numeric(18,6) DEFAULT 0 NOT NULL,
    valor_unitario numeric(14,4) DEFAULT 0 NOT NULL,
    desconto numeric(14,2) DEFAULT 0 NOT NULL,
    valor numeric(14,2) DEFAULT 0 NOT NULL,
    ncm text,
    cfop text,
    componentes bigint[]
);


--
-- Name: vendas_proprio_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vendas_proprio_itens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vendas_proprio_itens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vendas_proprio_pagamentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendas_proprio_pagamentos (
    id bigint NOT NULL,
    venda_id bigint NOT NULL,
    sequencia integer NOT NULL,
    metodo text,
    tipo_doc text,
    valor numeric(14,2) DEFAULT 0 NOT NULL,
    bandeira text
);


--
-- Name: vendas_proprio_pagamentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vendas_proprio_pagamentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vendas_proprio_pagamentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id bigint NOT NULL,
    loja_id bigint NOT NULL,
    message_id character varying(40) NOT NULL,
    message jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhooks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhooks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhooks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhooks_id_seq OWNED BY public.webhooks.id;


--
-- Name: arquivos_mortos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arquivos_mortos ALTER COLUMN id SET DEFAULT nextval('public.arquivos_mortos_id_seq'::regclass);


--
-- Name: cargos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargos ALTER COLUMN id SET DEFAULT nextval('public.cargos_id_seq'::regclass);


--
-- Name: clientes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes ALTER COLUMN id SET DEFAULT nextval('public.clientes_id_seq'::regclass);


--
-- Name: contas_correntes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_correntes ALTER COLUMN id SET DEFAULT nextval('public.contas_correntes_id_seq'::regclass);


--
-- Name: contas_pagar id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_pagar ALTER COLUMN id SET DEFAULT nextval('public.contas_pagar_id_seq'::regclass);


--
-- Name: contas_receber id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_receber ALTER COLUMN id SET DEFAULT nextval('public.contas_receber_id_seq'::regclass);


--
-- Name: estoque_local_saldos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_local_saldos ALTER COLUMN id SET DEFAULT nextval('public.estoque_local_saldos_id_seq'::regclass);


--
-- Name: estrutura_produto_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estrutura_produto_cache ALTER COLUMN id SET DEFAULT nextval('public.estrutura_produto_cache_id_seq'::regclass);


--
-- Name: familias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.familias ALTER COLUMN id SET DEFAULT nextval('public.familias_id_seq'::regclass);


--
-- Name: ficha_tecnica_local id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_local ALTER COLUMN id SET DEFAULT nextval('public.ficha_tecnica_local_id_seq'::regclass);


--
-- Name: fornecedores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedores ALTER COLUMN id SET DEFAULT nextval('public.fornecedores_id_seq'::regclass);


--
-- Name: impressao_etiquetas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impressao_etiquetas ALTER COLUMN id SET DEFAULT nextval('public.impressao_etiquetas_id_seq'::regclass);


--
-- Name: integration_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_attempts ALTER COLUMN id SET DEFAULT nextval('public.integration_attempts_id_seq'::regclass);


--
-- Name: inventario_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_items ALTER COLUMN id SET DEFAULT nextval('public.inventario_items_id_seq'::regclass);


--
-- Name: inventarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventarios ALTER COLUMN id SET DEFAULT nextval('public.inventarios_id_seq'::regclass);


--
-- Name: local_estoque_user id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoque_user ALTER COLUMN id SET DEFAULT nextval('public.local_estoque_user_id_seq'::regclass);


--
-- Name: local_estoques id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoques ALTER COLUMN id SET DEFAULT nextval('public.local_estoques_id_seq'::regclass);


--
-- Name: loja_user id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_user ALTER COLUMN id SET DEFAULT nextval('public.loja_user_id_seq'::regclass);


--
-- Name: lojas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lojas ALTER COLUMN id SET DEFAULT nextval('public.lojas_id_seq'::regclass);


--
-- Name: movimentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos ALTER COLUMN id SET DEFAULT nextval('public.movimentos_id_seq'::regclass);


--
-- Name: movimentos_locais id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos_locais ALTER COLUMN id SET DEFAULT nextval('public.movimentos_locais_id_seq'::regclass);


--
-- Name: nota_fiscal_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_fiscal_items ALTER COLUMN id SET DEFAULT nextval('public.nota_fiscal_items_id_seq'::regclass);


--
-- Name: notas_fiscais id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fiscais ALTER COLUMN id SET DEFAULT nextval('public.notas_fiscais_id_seq'::regclass);


--
-- Name: ordens_producao id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao ALTER COLUMN id SET DEFAULT nextval('public.ordens_producao_id_seq'::regclass);


--
-- Name: permissao_user id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissao_user ALTER COLUMN id SET DEFAULT nextval('public.permissao_user_id_seq'::regclass);


--
-- Name: permissoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissoes ALTER COLUMN id SET DEFAULT nextval('public.permissoes_id_seq'::regclass);


--
-- Name: posicao_estoques id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posicao_estoques ALTER COLUMN id SET DEFAULT nextval('public.posicao_estoques_id_seq'::regclass);


--
-- Name: previsao_venda id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.previsao_venda ALTER COLUMN id SET DEFAULT nextval('public.previsao_venda_id_seq'::regclass);


--
-- Name: produtos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos ALTER COLUMN id SET DEFAULT nextval('public.produtos_id_seq'::regclass);


--
-- Name: transferencias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencias ALTER COLUMN id SET DEFAULT nextval('public.transferencias_id_seq'::regclass);


--
-- Name: vendas_integracao_fila id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_integracao_fila ALTER COLUMN id SET DEFAULT nextval('public.vendas_integracao_fila_id_seq'::regclass);


--
-- Name: webhooks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks ALTER COLUMN id SET DEFAULT nextval('public.webhooks_id_seq'::regclass);


--
-- Name: arquivos_mortos arquivos_mortos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arquivos_mortos
    ADD CONSTRAINT arquivos_mortos_pkey PRIMARY KEY (id);


--
-- Name: arquivos_mortos arquivos_mortos_tabela_periodo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arquivos_mortos
    ADD CONSTRAINT arquivos_mortos_tabela_periodo_key UNIQUE (tabela, periodo);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: cargo_permissao cargo_permissao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_permissao
    ADD CONSTRAINT cargo_permissao_pkey PRIMARY KEY (cargo_id, permissao_id);


--
-- Name: cargos cargos_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargos
    ADD CONSTRAINT cargos_nome_key UNIQUE (nome);


--
-- Name: cargos cargos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargos
    ADD CONSTRAINT cargos_pkey PRIMARY KEY (id);


--
-- Name: categorias_contabeis categorias_contabeis_loja_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias_contabeis
    ADD CONSTRAINT categorias_contabeis_loja_id_nome_key UNIQUE (loja_id, nome);


--
-- Name: categorias_contabeis categorias_contabeis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias_contabeis
    ADD CONSTRAINT categorias_contabeis_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: compras_proprio_itens compras_proprio_itens_compra_id_linha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_proprio_itens
    ADD CONSTRAINT compras_proprio_itens_compra_id_linha_key UNIQUE (compra_id, linha);


--
-- Name: compras_proprio_itens compras_proprio_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_proprio_itens
    ADD CONSTRAINT compras_proprio_itens_pkey PRIMARY KEY (id);


--
-- Name: compras_proprio compras_proprio_loja_id_chave_acesso_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_proprio
    ADD CONSTRAINT compras_proprio_loja_id_chave_acesso_key UNIQUE (loja_id, chave_acesso);


--
-- Name: compras_proprio compras_proprio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_proprio
    ADD CONSTRAINT compras_proprio_pkey PRIMARY KEY (id);


--
-- Name: contas_correntes contas_correntes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_correntes
    ADD CONSTRAINT contas_correntes_pkey PRIMARY KEY (id);


--
-- Name: contas_pagar contas_pagar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_pagar
    ADD CONSTRAINT contas_pagar_pkey PRIMARY KEY (id);


--
-- Name: contas_receber contas_receber_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_receber
    ADD CONSTRAINT contas_receber_pkey PRIMARY KEY (id);


--
-- Name: convites convites_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convites
    ADD CONSTRAINT convites_codigo_key UNIQUE (codigo);


--
-- Name: convites convites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convites
    ADD CONSTRAINT convites_pkey PRIMARY KEY (id);


--
-- Name: estoque_codigo_seq estoque_codigo_seq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_codigo_seq
    ADD CONSTRAINT estoque_codigo_seq_pkey PRIMARY KEY (loja_id, prefixo);


--
-- Name: estoque_config estoque_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_config
    ADD CONSTRAINT estoque_config_pkey PRIMARY KEY (loja_id);


--
-- Name: estoque_custos estoque_custos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_custos
    ADD CONSTRAINT estoque_custos_pkey PRIMARY KEY (loja_id, codigo_produto);


--
-- Name: estoque_local_saldos estoque_local_saldos_loja_id_codigo_produto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_local_saldos
    ADD CONSTRAINT estoque_local_saldos_loja_id_codigo_produto_key UNIQUE (loja_id, codigo_produto);


--
-- Name: estoque_local_saldos estoque_local_saldos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_local_saldos
    ADD CONSTRAINT estoque_local_saldos_pkey PRIMARY KEY (id);


--
-- Name: estoque_lote_movimentos estoque_lote_movimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_lote_movimentos
    ADD CONSTRAINT estoque_lote_movimentos_pkey PRIMARY KEY (id);


--
-- Name: estoque_lotes estoque_lotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_lotes
    ADD CONSTRAINT estoque_lotes_pkey PRIMARY KEY (id);


--
-- Name: estoque_movimentos estoque_movimentos_loja_id_origem_ref_codigo_produto_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_movimentos
    ADD CONSTRAINT estoque_movimentos_loja_id_origem_ref_codigo_produto_codigo_key UNIQUE (loja_id, origem, ref, codigo_produto, codigo_local_estoque, linha);


--
-- Name: estoque_movimentos estoque_movimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_movimentos
    ADD CONSTRAINT estoque_movimentos_pkey PRIMARY KEY (id);


--
-- Name: estoque_movimentos estoque_movimentos_reverses_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_movimentos
    ADD CONSTRAINT estoque_movimentos_reverses_id_key UNIQUE (reverses_id);


--
-- Name: estoque_receita_consumos estoque_receita_consumos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_receita_consumos
    ADD CONSTRAINT estoque_receita_consumos_pkey PRIMARY KEY (movimento_id);


--
-- Name: estoque_saldos estoque_saldos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_saldos
    ADD CONSTRAINT estoque_saldos_pkey PRIMARY KEY (loja_id, codigo_local_estoque, codigo_produto);


--
-- Name: estrutura_produto_cache estrutura_produto_cache_loja_id_codigo_produto_codigo_produ_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estrutura_produto_cache
    ADD CONSTRAINT estrutura_produto_cache_loja_id_codigo_produto_codigo_produ_key UNIQUE (loja_id, codigo_produto, codigo_produto_insumo);


--
-- Name: estrutura_produto_cache estrutura_produto_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estrutura_produto_cache
    ADD CONSTRAINT estrutura_produto_cache_pkey PRIMARY KEY (id);


--
-- Name: etiqueta_config etiqueta_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etiqueta_config
    ADD CONSTRAINT etiqueta_config_pkey PRIMARY KEY (loja_id);


--
-- Name: familias familias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.familias
    ADD CONSTRAINT familias_pkey PRIMARY KEY (id);


--
-- Name: faturamento_import_meta faturamento_import_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faturamento_import_meta
    ADD CONSTRAINT faturamento_import_meta_pkey PRIMARY KEY (loja_id);


--
-- Name: faturamento_importado faturamento_importado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faturamento_importado
    ADD CONSTRAINT faturamento_importado_pkey PRIMARY KEY (loja_id, dimensao, rotulo, mes);


--
-- Name: ficha_tecnica_itens ficha_tecnica_itens_ficha_id_codigo_insumo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_itens
    ADD CONSTRAINT ficha_tecnica_itens_ficha_id_codigo_insumo_key UNIQUE (ficha_id, codigo_insumo);


--
-- Name: ficha_tecnica_itens ficha_tecnica_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_itens
    ADD CONSTRAINT ficha_tecnica_itens_pkey PRIMARY KEY (id);


--
-- Name: ficha_tecnica_local ficha_tecnica_local_loja_id_codigo_produto_codigo_produto_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_local
    ADD CONSTRAINT ficha_tecnica_local_loja_id_codigo_produto_codigo_produto_i_key UNIQUE (loja_id, codigo_produto, codigo_produto_insumo);


--
-- Name: ficha_tecnica_local ficha_tecnica_local_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_local
    ADD CONSTRAINT ficha_tecnica_local_pkey PRIMARY KEY (id);


--
-- Name: fichas_tecnicas fichas_tecnicas_loja_id_codigo_produto_versao_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_tecnicas
    ADD CONSTRAINT fichas_tecnicas_loja_id_codigo_produto_versao_key UNIQUE (loja_id, codigo_produto, versao);


--
-- Name: fichas_tecnicas fichas_tecnicas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_tecnicas
    ADD CONSTRAINT fichas_tecnicas_pkey PRIMARY KEY (id);


--
-- Name: fornecedor_produto_depara fornecedor_produto_depara_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedor_produto_depara
    ADD CONSTRAINT fornecedor_produto_depara_pkey PRIMARY KEY (loja_id, fornecedor_cnpj, c_prod);


--
-- Name: fornecedores fornecedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedores
    ADD CONSTRAINT fornecedores_pkey PRIMARY KEY (id);


--
-- Name: grupos_produto grupos_produto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grupos_produto
    ADD CONSTRAINT grupos_produto_pkey PRIMARY KEY (id);


--
-- Name: impressao_etiquetas impressao_etiquetas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impressao_etiquetas
    ADD CONSTRAINT impressao_etiquetas_pkey PRIMARY KEY (id);


--
-- Name: integration_attempts integration_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_attempts
    ADD CONSTRAINT integration_attempts_pkey PRIMARY KEY (id);


--
-- Name: inventario_items inventario_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_items
    ADD CONSTRAINT inventario_items_pkey PRIMARY KEY (id);


--
-- Name: inventario_proprio_itens inventario_proprio_itens_inventario_id_codigo_produto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_proprio_itens
    ADD CONSTRAINT inventario_proprio_itens_inventario_id_codigo_produto_key UNIQUE (inventario_id, codigo_produto);


--
-- Name: inventario_proprio_itens inventario_proprio_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_proprio_itens
    ADD CONSTRAINT inventario_proprio_itens_pkey PRIMARY KEY (id);


--
-- Name: inventarios inventarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventarios
    ADD CONSTRAINT inventarios_pkey PRIMARY KEY (id);


--
-- Name: inventarios_proprio inventarios_proprio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventarios_proprio
    ADD CONSTRAINT inventarios_proprio_pkey PRIMARY KEY (id);


--
-- Name: local_estoque_user local_estoque_user_loja_id_local_estoque_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoque_user
    ADD CONSTRAINT local_estoque_user_loja_id_local_estoque_id_user_id_key UNIQUE (loja_id, local_estoque_id, user_id);


--
-- Name: local_estoque_user local_estoque_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoque_user
    ADD CONSTRAINT local_estoque_user_pkey PRIMARY KEY (id);


--
-- Name: local_estoques local_estoques_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoques
    ADD CONSTRAINT local_estoques_pkey PRIMARY KEY (id);


--
-- Name: loja_user loja_user_loja_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_user
    ADD CONSTRAINT loja_user_loja_id_user_id_key UNIQUE (loja_id, user_id);


--
-- Name: loja_user loja_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_user
    ADD CONSTRAINT loja_user_pkey PRIMARY KEY (id);


--
-- Name: lojas lojas_integracao_api_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lojas
    ADD CONSTRAINT lojas_integracao_api_key_key UNIQUE (integracao_api_key);


--
-- Name: lojas lojas_integracao_teste_api_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lojas
    ADD CONSTRAINT lojas_integracao_teste_api_key_key UNIQUE (integracao_teste_api_key);


--
-- Name: lojas lojas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lojas
    ADD CONSTRAINT lojas_pkey PRIMARY KEY (id);


--
-- Name: margem_import_meta margem_import_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margem_import_meta
    ADD CONSTRAINT margem_import_meta_pkey PRIMARY KEY (loja_id);


--
-- Name: margem_importada margem_importada_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margem_importada
    ADD CONSTRAINT margem_importada_pkey PRIMARY KEY (loja_id, codigo, mes);


--
-- Name: margem_snapshot_diario margem_snapshot_diario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margem_snapshot_diario
    ADD CONSTRAINT margem_snapshot_diario_pkey PRIMARY KEY (loja_id, data_snapshot, codigo_produto);


--
-- Name: metas_faturamento metas_faturamento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metas_faturamento
    ADD CONSTRAINT metas_faturamento_pkey PRIMARY KEY (loja_id);


--
-- Name: metas_mensais metas_mensais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metas_mensais
    ADD CONSTRAINT metas_mensais_pkey PRIMARY KEY (loja_id, mes);


--
-- Name: movimentacao_import_meta movimentacao_import_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_import_meta
    ADD CONSTRAINT movimentacao_import_meta_pkey PRIMARY KEY (loja_id);


--
-- Name: movimentacao_importada movimentacao_importada_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_importada
    ADD CONSTRAINT movimentacao_importada_pkey PRIMARY KEY (loja_id, dimensao, rotulo, mes);


--
-- Name: movimentacao_operacao_meta movimentacao_operacao_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_operacao_meta
    ADD CONSTRAINT movimentacao_operacao_meta_pkey PRIMARY KEY (loja_id);


--
-- Name: movimentacao_operacao movimentacao_operacao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_operacao
    ADD CONSTRAINT movimentacao_operacao_pkey PRIMARY KEY (loja_id, origem, sentido, local, tipo_sped, familia, mes, inventario);


--
-- Name: movimentos_historico movimentos_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos_historico
    ADD CONSTRAINT movimentos_historico_pkey PRIMARY KEY (loja_id, cod_prod, data);


--
-- Name: movimentos_locais movimentos_locais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos_locais
    ADD CONSTRAINT movimentos_locais_pkey PRIMARY KEY (id);


--
-- Name: movimentos movimentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos
    ADD CONSTRAINT movimentos_pkey PRIMARY KEY (id);


--
-- Name: nota_fiscal_items nota_fiscal_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_fiscal_items
    ADD CONSTRAINT nota_fiscal_items_pkey PRIMARY KEY (id);


--
-- Name: notas_fiscais notas_fiscais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fiscais
    ADD CONSTRAINT notas_fiscais_pkey PRIMARY KEY (id);


--
-- Name: op_historico op_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.op_historico
    ADD CONSTRAINT op_historico_pkey PRIMARY KEY (id);


--
-- Name: op_numeracao op_numeracao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.op_numeracao
    ADD CONSTRAINT op_numeracao_pkey PRIMARY KEY (loja_id, ano);


--
-- Name: op_qtde_planejada op_qtde_planejada_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.op_qtde_planejada
    ADD CONSTRAINT op_qtde_planejada_pkey PRIMARY KEY (loja_id, n_cod_op);


--
-- Name: ordens_producao ordens_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao
    ADD CONSTRAINT ordens_producao_pkey PRIMARY KEY (id);


--
-- Name: ordens_producao_proprio_itens ordens_producao_proprio_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_proprio_itens
    ADD CONSTRAINT ordens_producao_proprio_itens_pkey PRIMARY KEY (id);


--
-- Name: ordens_producao_proprio ordens_producao_proprio_loja_id_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_proprio
    ADD CONSTRAINT ordens_producao_proprio_loja_id_ref_key UNIQUE (loja_id, ref);


--
-- Name: ordens_producao_proprio ordens_producao_proprio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_proprio
    ADD CONSTRAINT ordens_producao_proprio_pkey PRIMARY KEY (id);


--
-- Name: ordens_producao_teste ordens_producao_teste_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_teste
    ADD CONSTRAINT ordens_producao_teste_pkey PRIMARY KEY (id);


--
-- Name: outbox outbox_pkey_n; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey_n PRIMARY KEY (id);


--
-- Name: permissao_user permissao_user_loja_id_permissao_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissao_user
    ADD CONSTRAINT permissao_user_loja_id_permissao_id_user_id_key UNIQUE (loja_id, permissao_id, user_id);


--
-- Name: permissao_user permissao_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissao_user
    ADD CONSTRAINT permissao_user_pkey PRIMARY KEY (id);


--
-- Name: permissoes permissoes_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissoes
    ADD CONSTRAINT permissoes_nome_key UNIQUE (nome);


--
-- Name: permissoes permissoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissoes
    ADD CONSTRAINT permissoes_pkey PRIMARY KEY (id);


--
-- Name: posicao_estoques posicao_estoques_loja_id_codigo_local_estoque_n_cod_prod_da_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posicao_estoques
    ADD CONSTRAINT posicao_estoques_loja_id_codigo_local_estoque_n_cod_prod_da_key UNIQUE (loja_id, codigo_local_estoque, n_cod_prod, data_posicao);


--
-- Name: posicao_estoques posicao_estoques_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posicao_estoques
    ADD CONSTRAINT posicao_estoques_pkey PRIMARY KEY (id);


--
-- Name: previsao_venda previsao_venda_loja_produto_janela_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.previsao_venda
    ADD CONSTRAINT previsao_venda_loja_produto_janela_key UNIQUE (loja_id, n_cod_prod, janela_dias);


--
-- Name: previsao_venda previsao_venda_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.previsao_venda
    ADD CONSTRAINT previsao_venda_pkey PRIMARY KEY (id);


--
-- Name: produto_preco_recente produto_preco_recente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produto_preco_recente
    ADD CONSTRAINT produto_preco_recente_pkey PRIMARY KEY (loja_id, codigo_produto);


--
-- Name: produto_sem_estrutura produto_sem_estrutura_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produto_sem_estrutura
    ADD CONSTRAINT produto_sem_estrutura_pkey PRIMARY KEY (loja_id, codigo_produto);


--
-- Name: produto_substituicoes produto_substituicoes_loja_id_n_cod_prod_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produto_substituicoes
    ADD CONSTRAINT produto_substituicoes_loja_id_n_cod_prod_key UNIQUE (loja_id, n_cod_prod);


--
-- Name: produto_substituicoes produto_substituicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produto_substituicoes
    ADD CONSTRAINT produto_substituicoes_pkey PRIMARY KEY (id);


--
-- Name: produtos produtos_codigo_produto_loja_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_codigo_produto_loja_id_key UNIQUE (codigo_produto, loja_id);


--
-- Name: produtos produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: sefaz_documentos sefaz_documentos_loja_id_nsu_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sefaz_documentos
    ADD CONSTRAINT sefaz_documentos_loja_id_nsu_key UNIQUE (loja_id, nsu);


--
-- Name: sefaz_documentos sefaz_documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sefaz_documentos
    ADD CONSTRAINT sefaz_documentos_pkey PRIMARY KEY (id);


--
-- Name: sefaz_nsu sefaz_nsu_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sefaz_nsu
    ADD CONSTRAINT sefaz_nsu_pkey PRIMARY KEY (loja_id);


--
-- Name: sync_divergencias sync_divergencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_divergencias
    ADD CONSTRAINT sync_divergencias_pkey PRIMARY KEY (id);


--
-- Name: sync_outbox sync_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_outbox
    ADD CONSTRAINT sync_outbox_pkey PRIMARY KEY (id);


--
-- Name: transferencias transferencias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencias
    ADD CONSTRAINT transferencias_pkey PRIMARY KEY (id);


--
-- Name: clientes uq_clientes_loja_codomie; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT uq_clientes_loja_codomie UNIQUE (loja_id, codigo_omie);


--
-- Name: contas_correntes uq_conta_corrente_omie; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_correntes
    ADD CONSTRAINT uq_conta_corrente_omie UNIQUE (loja_id, codigo_cc);


--
-- Name: contas_pagar uq_conta_pagar_omie; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_pagar
    ADD CONSTRAINT uq_conta_pagar_omie UNIQUE (loja_id, codigo_lancamento_omie);


--
-- Name: contas_receber uq_conta_receber_omie; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_receber
    ADD CONSTRAINT uq_conta_receber_omie UNIQUE (loja_id, codigo_lancamento_omie);


--
-- Name: familias uq_familias_loja_codomie; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.familias
    ADD CONSTRAINT uq_familias_loja_codomie UNIQUE (loja_id, codigo_familia);


--
-- Name: fornecedores uq_fornecedores_loja_codomie; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedores
    ADD CONSTRAINT uq_fornecedores_loja_codomie UNIQUE (loja_id, codigo_omie);


--
-- Name: local_estoques uq_local; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoques
    ADD CONSTRAINT uq_local UNIQUE (loja_id, codigo_local_estoque);


--
-- Name: notas_fiscais uq_nf; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fiscais
    ADD CONSTRAINT uq_nf UNIQUE (loja_id, n_id_receb);


--
-- Name: nota_fiscal_items uq_nfi; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_fiscal_items
    ADD CONSTRAINT uq_nfi UNIQUE (loja_id, n_id_receb, n_sequencia);


--
-- Name: ordens_producao uq_op; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao
    ADD CONSTRAINT uq_op UNIQUE (loja_id, identificacao_n_cod_op);


--
-- Name: vendas_integracao_fila vendas_integracao_fila_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_integracao_fila
    ADD CONSTRAINT vendas_integracao_fila_pkey PRIMARY KEY (id);


--
-- Name: vendas_proprio_itens vendas_proprio_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio_itens
    ADD CONSTRAINT vendas_proprio_itens_pkey PRIMARY KEY (id);


--
-- Name: vendas_proprio_itens vendas_proprio_itens_venda_id_linha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio_itens
    ADD CONSTRAINT vendas_proprio_itens_venda_id_linha_key UNIQUE (venda_id, linha);


--
-- Name: vendas_proprio vendas_proprio_loja_id_n_id_cupom_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio
    ADD CONSTRAINT vendas_proprio_loja_id_n_id_cupom_key UNIQUE (loja_id, n_id_cupom);


--
-- Name: vendas_proprio vendas_proprio_loja_id_pedido_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio
    ADD CONSTRAINT vendas_proprio_loja_id_pedido_ref_key UNIQUE (loja_id, pedido_ref);


--
-- Name: vendas_proprio_pagamentos vendas_proprio_pagamentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio_pagamentos
    ADD CONSTRAINT vendas_proprio_pagamentos_pkey PRIMARY KEY (id);


--
-- Name: vendas_proprio_pagamentos vendas_proprio_pagamentos_venda_id_sequencia_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio_pagamentos
    ADD CONSTRAINT vendas_proprio_pagamentos_venda_id_sequencia_key UNIQUE (venda_id, sequencia);


--
-- Name: vendas_proprio vendas_proprio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio
    ADD CONSTRAINT vendas_proprio_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: audit_log_entidade_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_entidade_idx ON public.audit_log USING btree (loja_id, entidade);


--
-- Name: audit_log_loja_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_loja_created_idx ON public.audit_log USING btree (loja_id, created_at DESC);


--
-- Name: compras_proprio_itens_compra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compras_proprio_itens_compra ON public.compras_proprio_itens USING btree (compra_id);


--
-- Name: compras_proprio_loja; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compras_proprio_loja ON public.compras_proprio USING btree (loja_id, created_at DESC);


--
-- Name: compras_proprio_nota; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compras_proprio_nota ON public.compras_proprio USING btree (loja_id, nota_fiscal_id);


--
-- Name: convites_codigo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convites_codigo_idx ON public.convites USING btree (codigo);


--
-- Name: convites_loja_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX convites_loja_id_idx ON public.convites USING btree (loja_id);


--
-- Name: estoque_lote_movimentos_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_lote_movimentos_lote ON public.estoque_lote_movimentos USING btree (lote_id);


--
-- Name: estoque_lote_movimentos_mov; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_lote_movimentos_mov ON public.estoque_lote_movimentos USING btree (movimento_id);


--
-- Name: estoque_lotes_fefo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_lotes_fefo ON public.estoque_lotes USING btree (loja_id, codigo_local_estoque, codigo_produto, validade, id);


--
-- Name: estoque_lotes_ident_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX estoque_lotes_ident_uk ON public.estoque_lotes USING btree (loja_id, codigo_local_estoque, codigo_produto, COALESCE(lote, ''::text), COALESCE(validade, '0001-01-01'::date)) WHERE (NOT ((lote IS NULL) AND (validade IS NULL)));


--
-- Name: estoque_lotes_sem_lote_uk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX estoque_lotes_sem_lote_uk ON public.estoque_lotes USING btree (loja_id, codigo_local_estoque, codigo_produto) WHERE ((lote IS NULL) AND (validade IS NULL));


--
-- Name: estoque_lotes_vencimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_lotes_vencimento ON public.estoque_lotes USING btree (loja_id, validade) WHERE ((saldo > (0)::numeric) AND (validade IS NOT NULL));


--
-- Name: estoque_movimentos_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_data ON public.estoque_movimentos USING btree (loja_id, data_ref);


--
-- Name: estoque_movimentos_local; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_local ON public.estoque_movimentos USING btree (loja_id, codigo_local_estoque, created_at DESC);


--
-- Name: estoque_movimentos_loja_id_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_loja_id_desc ON public.estoque_movimentos USING btree (loja_id, id DESC);


--
-- Name: estoque_movimentos_obs_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_obs_trgm ON public.estoque_movimentos USING gin (obs extensions.gin_trgm_ops);


--
-- Name: estoque_movimentos_produto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_produto ON public.estoque_movimentos USING btree (loja_id, codigo_produto, created_at DESC);


--
-- Name: estoque_movimentos_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_ref ON public.estoque_movimentos USING btree (loja_id, ref);


--
-- Name: estoque_movimentos_ref_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_ref_trgm ON public.estoque_movimentos USING gin (ref extensions.gin_trgm_ops);


--
-- Name: estoque_movimentos_trf_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_trf_trgm ON public.estoque_movimentos USING gin (transferencia_ref extensions.gin_trgm_ops);


--
-- Name: estoque_movimentos_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_user ON public.estoque_movimentos USING btree (loja_id, user_id);


--
-- Name: estoque_movimentos_user_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_movimentos_user_trgm ON public.estoque_movimentos USING gin (user_id extensions.gin_trgm_ops);


--
-- Name: estoque_receita_consumos_ficha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_receita_consumos_ficha ON public.estoque_receita_consumos USING btree (ficha_id);


--
-- Name: estoque_saldos_produto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estoque_saldos_produto ON public.estoque_saldos USING btree (loja_id, codigo_produto);


--
-- Name: ficha_tecnica_itens_insumo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ficha_tecnica_itens_insumo ON public.ficha_tecnica_itens USING btree (loja_id, codigo_insumo);


--
-- Name: fichas_tecnicas_uma_ativa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fichas_tecnicas_uma_ativa ON public.fichas_tecnicas USING btree (loja_id, codigo_produto) WHERE ativa;


--
-- Name: grupos_produto_nome_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grupos_produto_nome_uq ON public.grupos_produto USING btree (loja_id, COALESCE(pai_id, (0)::bigint), lower(nome));


--
-- Name: grupos_produto_pai; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX grupos_produto_pai ON public.grupos_produto USING btree (loja_id, pai_id);


--
-- Name: grupos_produto_vendas_ref_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grupos_produto_vendas_ref_uq ON public.grupos_produto USING btree (loja_id, vendas_ref) WHERE (vendas_ref IS NOT NULL);


--
-- Name: idx_arquivos_mortos_tabela; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arquivos_mortos_tabela ON public.arquivos_mortos USING btree (tabela, periodo);


--
-- Name: idx_clientes_loja_razao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clientes_loja_razao ON public.clientes USING btree (loja_id, razao_social);


--
-- Name: idx_contas_correntes_loja; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contas_correntes_loja ON public.contas_correntes USING btree (loja_id);


--
-- Name: idx_contas_pagar_fornecedor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contas_pagar_fornecedor ON public.contas_pagar USING btree (codigo_cliente_fornecedor);


--
-- Name: idx_contas_pagar_loja_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contas_pagar_loja_status ON public.contas_pagar USING btree (loja_id, status_titulo);


--
-- Name: idx_contas_pagar_vencimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contas_pagar_vencimento ON public.contas_pagar USING btree (loja_id, data_vencimento);


--
-- Name: idx_contas_receber_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contas_receber_cliente ON public.contas_receber USING btree (codigo_cliente_fornecedor);


--
-- Name: idx_contas_receber_loja_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contas_receber_loja_status ON public.contas_receber USING btree (loja_id, status_titulo);


--
-- Name: idx_contas_receber_vencimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contas_receber_vencimento ON public.contas_receber USING btree (loja_id, data_vencimento);


--
-- Name: idx_estrutura_produto_cache_loja_produto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estrutura_produto_cache_loja_produto ON public.estrutura_produto_cache USING btree (loja_id, codigo_produto);


--
-- Name: idx_familias_loja_nome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_familias_loja_nome ON public.familias USING btree (loja_id, nome);


--
-- Name: idx_fornecedores_loja_razao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fornecedores_loja_razao ON public.fornecedores USING btree (loja_id, razao_social);


--
-- Name: idx_impressao_loja_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impressao_loja_created ON public.impressao_etiquetas USING btree (loja_id, created_at);


--
-- Name: idx_integration_loja_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_loja_created ON public.integration_attempts USING btree (loja_id, created_at);


--
-- Name: idx_inventario_items_inventario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventario_items_inventario_id ON public.inventario_items USING btree (inventario_id);


--
-- Name: idx_inventario_items_produto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventario_items_produto ON public.inventario_items USING btree (produto_codigo_produto);


--
-- Name: idx_inventarios_loja_local; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventarios_loja_local ON public.inventarios USING btree (loja_id, codigo_local_estoque);


--
-- Name: idx_mov_oper_loja; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mov_oper_loja ON public.movimentacao_operacao USING btree (loja_id);


--
-- Name: idx_movhist_loja_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movhist_loja_data ON public.movimentos_historico USING btree (loja_id, data);


--
-- Name: idx_movhist_loja_prod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movhist_loja_prod ON public.movimentos_historico USING btree (loja_id, cod_prod);


--
-- Name: idx_movimentos_locais_loja_produto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimentos_locais_loja_produto ON public.movimentos_locais USING btree (loja_id, codigo_produto, criado_em DESC);


--
-- Name: idx_movimentos_transferencia_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_movimentos_transferencia_id ON public.movimentos USING btree (transferencia_id) WHERE (transferencia_id IS NOT NULL);


--
-- Name: idx_nf_loja_emissao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nf_loja_emissao ON public.notas_fiscais USING btree (loja_id, d_emissao_nfe);


--
-- Name: idx_nfi_loja_nf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nfi_loja_nf ON public.nota_fiscal_items USING btree (loja_id, nota_fiscal_id);


--
-- Name: idx_nfi_loja_prod_preco_cobertura; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nfi_loja_prod_preco_cobertura ON public.nota_fiscal_items USING btree (loja_id, n_id_produto) INCLUDE (n_preco_unit, nota_fiscal_id) WHERE ((n_id_produto IS NOT NULL) AND (n_preco_unit > (0)::numeric));


--
-- Name: idx_op_fantasma_candidatas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_fantasma_candidatas ON public.ordens_producao USING btree (loja_id, identificacao_d_dt_previsao) WHERE ((concluida = false) AND (identificacao_n_cod_op IS NOT NULL));


--
-- Name: idx_op_loja_cod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_loja_cod ON public.ordens_producao USING btree (loja_id, identificacao_n_cod_op, identificacao_c_num_op);


--
-- Name: idx_op_retry_pendente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_retry_pendente ON public.ordens_producao USING btree (loja_id, concluida, conclusao_status) WHERE ((concluida = false) AND (conclusao_status IS NOT NULL));


--
-- Name: idx_op_validade_loja; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_op_validade_loja ON public.ordens_producao USING btree (loja_id, validade) WHERE (validade IS NOT NULL);


--
-- Name: idx_ordens_producao_concluida_por; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ordens_producao_concluida_por ON public.ordens_producao USING btree (loja_id, concluida_por) WHERE (concluida_por IS NOT NULL);


--
-- Name: idx_posicao_cmc_recente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posicao_cmc_recente ON public.posicao_estoques USING btree (loja_id, n_cod_prod, data_posicao DESC);


--
-- Name: idx_posicao_loja_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posicao_loja_data ON public.posicao_estoques USING btree (loja_id, data_posicao DESC);


--
-- Name: idx_previsao_venda_loja_prod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_previsao_venda_loja_prod ON public.previsao_venda USING btree (loja_id, n_cod_prod);


--
-- Name: idx_produtos_ficha_tecnica_pendente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_produtos_ficha_tecnica_pendente ON public.produtos USING btree (loja_id, id) WHERE (ficha_tecnica_checada_em IS NULL);


--
-- Name: idx_produtos_loja_familia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_produtos_loja_familia ON public.produtos USING btree (loja_id, descricao_familia);


--
-- Name: idx_webhooks_loja_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_loja_message ON public.webhooks USING btree (loja_id, message_id);


--
-- Name: inventario_proprio_itens_inv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventario_proprio_itens_inv ON public.inventario_proprio_itens USING btree (inventario_id);


--
-- Name: inventarios_proprio_loja; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventarios_proprio_loja ON public.inventarios_proprio USING btree (loja_id, aberto_em DESC);


--
-- Name: inventarios_proprio_um_aberto; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventarios_proprio_um_aberto ON public.inventarios_proprio USING btree (loja_id, codigo_local_estoque) WHERE (status = 'aberto'::text);


--
-- Name: lojas_codigo_onboarding_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX lojas_codigo_onboarding_key ON public.lojas USING btree (codigo_onboarding) WHERE (codigo_onboarding IS NOT NULL);


--
-- Name: movimentos_loja_id_ajuste_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX movimentos_loja_id_ajuste_unique ON public.movimentos USING btree (loja_id, id_ajuste) WHERE (id_ajuste IS NOT NULL);


--
-- Name: notas_fiscais_loja_chave_nfe_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notas_fiscais_loja_chave_nfe_unique ON public.notas_fiscais USING btree (loja_id, c_chave_nfe) WHERE ((c_chave_nfe IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: op_historico_op; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX op_historico_op ON public.op_historico USING btree (loja_id, n_cod_op, created_at);


--
-- Name: outbox_created_at_idx_n; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_created_at_idx_n ON public.outbox USING btree (created_at);


--
-- Name: produto_substituicoes_loja_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX produto_substituicoes_loja_idx ON public.produto_substituicoes USING btree (loja_id);


--
-- Name: produtos_codigo_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX produtos_codigo_trgm ON public.produtos USING gin (codigo extensions.gin_trgm_ops);


--
-- Name: produtos_descricao_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX produtos_descricao_trgm ON public.produtos USING gin (descricao extensions.gin_trgm_ops);


--
-- Name: produtos_grupo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX produtos_grupo_idx ON public.produtos USING btree (loja_id, grupo_id) WHERE (grupo_id IS NOT NULL);


--
-- Name: produtos_pai_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX produtos_pai_idx ON public.produtos USING btree (loja_id, produto_pai_codigo) WHERE (produto_pai_codigo IS NOT NULL);


--
-- Name: produtos_vendas_ref_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX produtos_vendas_ref_uq ON public.produtos USING btree (loja_id, vendas_ref) WHERE (vendas_ref IS NOT NULL);


--
-- Name: sefaz_documentos_chave; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sefaz_documentos_chave ON public.sefaz_documentos USING btree (loja_id, chave);


--
-- Name: sefaz_documentos_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sefaz_documentos_pendentes ON public.sefaz_documentos USING btree (loja_id) WHERE (NOT processado);


--
-- Name: sync_divergencias_aberta_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sync_divergencias_aberta_uq ON public.sync_divergencias USING btree (loja_id, entidade, ref, tipo) WHERE (resolvido_em IS NULL);


--
-- Name: sync_outbox_fila; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_outbox_fila ON public.sync_outbox USING btree (status, proxima_tentativa);


--
-- Name: sync_outbox_pendente_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sync_outbox_pendente_uq ON public.sync_outbox USING btree (loja_id, entidade, ref) WHERE (status = 'pending'::text);


--
-- Name: vendas_integracao_fila_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendas_integracao_fila_pendentes ON public.vendas_integracao_fila USING btree (loja_id, proximo_em) WHERE (status = 'Pendente'::text);


--
-- Name: vendas_proprio_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendas_proprio_data ON public.vendas_proprio USING btree (loja_id, data);


--
-- Name: vendas_proprio_frio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendas_proprio_frio ON public.vendas_proprio USING btree (loja_id) WHERE (frio_enviado_em IS NULL);


--
-- Name: estoque_custos estoque_custos_projeta_cmc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estoque_custos_projeta_cmc AFTER UPDATE OF cmc ON public.estoque_custos FOR EACH ROW EXECUTE FUNCTION public.trg_estoque_custos_projeta_cmc();


--
-- Name: estoque_movimentos estoque_movimentos_historico; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estoque_movimentos_historico AFTER INSERT ON public.estoque_movimentos FOR EACH ROW EXECUTE FUNCTION public.trg_estoque_movimentos_historico();


--
-- Name: estoque_movimentos estoque_movimentos_imutavel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estoque_movimentos_imutavel BEFORE DELETE OR UPDATE ON public.estoque_movimentos FOR EACH ROW EXECUTE FUNCTION public.trg_estoque_movimentos_imutavel();


--
-- Name: estoque_movimentos estoque_movimentos_lotes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estoque_movimentos_lotes AFTER INSERT ON public.estoque_movimentos FOR EACH ROW EXECUTE FUNCTION public.trg_estoque_movimentos_lotes();


--
-- Name: estoque_movimentos estoque_movimentos_nao_mae; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estoque_movimentos_nao_mae BEFORE INSERT ON public.estoque_movimentos FOR EACH ROW EXECUTE FUNCTION public.trg_movimento_nao_mae();


--
-- Name: ficha_tecnica_itens ficha_itens_ciclo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ficha_itens_ciclo BEFORE INSERT ON public.ficha_tecnica_itens FOR EACH ROW EXECUTE FUNCTION public.trg_ficha_itens_ciclo();


--
-- Name: ficha_tecnica_itens ficha_itens_imutavel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ficha_itens_imutavel BEFORE DELETE OR UPDATE ON public.ficha_tecnica_itens FOR EACH ROW EXECUTE FUNCTION public.trg_ficha_itens_imutavel();


--
-- Name: grupos_produto grupos_produto_arvore; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER grupos_produto_arvore BEFORE INSERT OR UPDATE OF pai_id ON public.grupos_produto FOR EACH ROW EXECUTE FUNCTION public.trg_grupos_produto_arvore();


--
-- Name: grupos_produto grupos_produto_sync_outbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER grupos_produto_sync_outbox AFTER INSERT OR UPDATE ON public.grupos_produto FOR EACH ROW EXECUTE FUNCTION public.trg_sync_outbox_catalogo();


--
-- Name: lojas lojas_modo_estoque; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lojas_modo_estoque BEFORE UPDATE OF modo_estoque ON public.lojas FOR EACH ROW EXECUTE FUNCTION public.trg_lojas_modo_estoque();


--
-- Name: op_historico op_historico_imutavel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER op_historico_imutavel BEFORE DELETE OR UPDATE ON public.op_historico FOR EACH ROW EXECUTE FUNCTION public.trg_op_historico_imutavel();


--
-- Name: arquivos_mortos outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: audit_log outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: categorias_contabeis outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: clientes outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: contas_correntes outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: contas_pagar outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: contas_receber outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: convites outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: etiqueta_config outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: familias outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: faturamento_import_meta outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: fornecedores outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: impressao_etiquetas outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: integration_attempts outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: inventario_items outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: inventarios outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: local_estoque_user outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: local_estoques outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: loja_user outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: lojas outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: margem_import_meta outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: margem_importada outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: movimentacao_import_meta outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: movimentacao_importada outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: movimentacao_operacao outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: movimentacao_operacao_meta outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: movimentos outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: movimentos_historico outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: nota_fiscal_items outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: notas_fiscais outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: ordens_producao outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: permissao_user outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: produto_substituicoes outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: produtos outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: profiles outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: transferencias outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: webhooks outbox_trigger; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: produtos produtos_codigo_proprio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER produtos_codigo_proprio BEFORE INSERT OR UPDATE OF codigo ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.trg_produtos_codigo_proprio();


--
-- Name: produtos produtos_mae_variacao; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER produtos_mae_variacao BEFORE INSERT OR UPDATE OF eh_mae, produto_pai_codigo ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.trg_produtos_mae_variacao();


--
-- Name: produtos produtos_sync_outbox; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER produtos_sync_outbox AFTER INSERT OR DELETE OR UPDATE ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.trg_sync_outbox_catalogo();


--
-- Name: audit_log audit_log_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: cargo_permissao cargo_permissao_cargo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_permissao
    ADD CONSTRAINT cargo_permissao_cargo_id_fkey FOREIGN KEY (cargo_id) REFERENCES public.cargos(id) ON DELETE CASCADE;


--
-- Name: cargo_permissao cargo_permissao_permissao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_permissao
    ADD CONSTRAINT cargo_permissao_permissao_id_fkey FOREIGN KEY (permissao_id) REFERENCES public.permissoes(id) ON DELETE CASCADE;


--
-- Name: categorias_contabeis categorias_contabeis_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias_contabeis
    ADD CONSTRAINT categorias_contabeis_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: clientes clientes_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: compras_proprio_itens compras_proprio_itens_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_proprio_itens
    ADD CONSTRAINT compras_proprio_itens_compra_id_fkey FOREIGN KEY (compra_id) REFERENCES public.compras_proprio(id) ON DELETE CASCADE;


--
-- Name: compras_proprio_itens compras_proprio_itens_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_proprio_itens
    ADD CONSTRAINT compras_proprio_itens_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: compras_proprio compras_proprio_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_proprio
    ADD CONSTRAINT compras_proprio_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: contas_correntes contas_correntes_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_correntes
    ADD CONSTRAINT contas_correntes_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: contas_pagar contas_pagar_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_pagar
    ADD CONSTRAINT contas_pagar_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: contas_receber contas_receber_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contas_receber
    ADD CONSTRAINT contas_receber_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: convites convites_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convites
    ADD CONSTRAINT convites_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: convites convites_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convites
    ADD CONSTRAINT convites_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: convites convites_usado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.convites
    ADD CONSTRAINT convites_usado_por_fkey FOREIGN KEY (usado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: estoque_codigo_seq estoque_codigo_seq_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_codigo_seq
    ADD CONSTRAINT estoque_codigo_seq_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: estoque_config estoque_config_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_config
    ADD CONSTRAINT estoque_config_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: estoque_custos estoque_custos_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_custos
    ADD CONSTRAINT estoque_custos_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: estoque_local_saldos estoque_local_saldos_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_local_saldos
    ADD CONSTRAINT estoque_local_saldos_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: estoque_lote_movimentos estoque_lote_movimentos_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_lote_movimentos
    ADD CONSTRAINT estoque_lote_movimentos_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.estoque_lotes(id);


--
-- Name: estoque_lote_movimentos estoque_lote_movimentos_movimento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_lote_movimentos
    ADD CONSTRAINT estoque_lote_movimentos_movimento_id_fkey FOREIGN KEY (movimento_id) REFERENCES public.estoque_movimentos(id);


--
-- Name: estoque_lotes estoque_lotes_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_lotes
    ADD CONSTRAINT estoque_lotes_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: estoque_movimentos estoque_movimentos_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_movimentos
    ADD CONSTRAINT estoque_movimentos_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: estoque_movimentos estoque_movimentos_reverses_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_movimentos
    ADD CONSTRAINT estoque_movimentos_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES public.estoque_movimentos(id);


--
-- Name: estoque_receita_consumos estoque_receita_consumos_ficha_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_receita_consumos
    ADD CONSTRAINT estoque_receita_consumos_ficha_id_fkey FOREIGN KEY (ficha_id) REFERENCES public.fichas_tecnicas(id);


--
-- Name: estoque_receita_consumos estoque_receita_consumos_movimento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_receita_consumos
    ADD CONSTRAINT estoque_receita_consumos_movimento_id_fkey FOREIGN KEY (movimento_id) REFERENCES public.estoque_movimentos(id);


--
-- Name: estoque_saldos estoque_saldos_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_saldos
    ADD CONSTRAINT estoque_saldos_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: estrutura_produto_cache estrutura_produto_cache_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estrutura_produto_cache
    ADD CONSTRAINT estrutura_produto_cache_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: etiqueta_config etiqueta_config_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etiqueta_config
    ADD CONSTRAINT etiqueta_config_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: familias familias_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.familias
    ADD CONSTRAINT familias_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: faturamento_import_meta faturamento_import_meta_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faturamento_import_meta
    ADD CONSTRAINT faturamento_import_meta_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: faturamento_importado faturamento_importado_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faturamento_importado
    ADD CONSTRAINT faturamento_importado_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: ficha_tecnica_itens ficha_tecnica_itens_codigo_insumo_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_itens
    ADD CONSTRAINT ficha_tecnica_itens_codigo_insumo_loja_id_fkey FOREIGN KEY (codigo_insumo, loja_id) REFERENCES public.produtos(codigo_produto, loja_id);


--
-- Name: ficha_tecnica_itens ficha_tecnica_itens_ficha_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_itens
    ADD CONSTRAINT ficha_tecnica_itens_ficha_id_fkey FOREIGN KEY (ficha_id) REFERENCES public.fichas_tecnicas(id);


--
-- Name: ficha_tecnica_local ficha_tecnica_local_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ficha_tecnica_local
    ADD CONSTRAINT ficha_tecnica_local_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: fichas_tecnicas fichas_tecnicas_codigo_produto_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_tecnicas
    ADD CONSTRAINT fichas_tecnicas_codigo_produto_loja_id_fkey FOREIGN KEY (codigo_produto, loja_id) REFERENCES public.produtos(codigo_produto, loja_id);


--
-- Name: fichas_tecnicas fichas_tecnicas_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fichas_tecnicas
    ADD CONSTRAINT fichas_tecnicas_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: fornecedor_produto_depara fornecedor_produto_depara_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedor_produto_depara
    ADD CONSTRAINT fornecedor_produto_depara_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: fornecedores fornecedores_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedores
    ADD CONSTRAINT fornecedores_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: grupos_produto grupos_produto_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grupos_produto
    ADD CONSTRAINT grupos_produto_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: grupos_produto grupos_produto_pai_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grupos_produto
    ADD CONSTRAINT grupos_produto_pai_id_fkey FOREIGN KEY (pai_id) REFERENCES public.grupos_produto(id) ON DELETE RESTRICT;


--
-- Name: impressao_etiquetas impressao_etiquetas_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impressao_etiquetas
    ADD CONSTRAINT impressao_etiquetas_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: integration_attempts integration_attempts_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_attempts
    ADD CONSTRAINT integration_attempts_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: inventario_items inventario_items_inventario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_items
    ADD CONSTRAINT inventario_items_inventario_id_fkey FOREIGN KEY (inventario_id) REFERENCES public.inventarios(id) ON DELETE CASCADE;


--
-- Name: inventario_items inventario_items_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_items
    ADD CONSTRAINT inventario_items_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: inventario_proprio_itens inventario_proprio_itens_inventario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_proprio_itens
    ADD CONSTRAINT inventario_proprio_itens_inventario_id_fkey FOREIGN KEY (inventario_id) REFERENCES public.inventarios_proprio(id) ON DELETE CASCADE;


--
-- Name: inventario_proprio_itens inventario_proprio_itens_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventario_proprio_itens
    ADD CONSTRAINT inventario_proprio_itens_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: inventarios inventarios_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventarios
    ADD CONSTRAINT inventarios_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: inventarios_proprio inventarios_proprio_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventarios_proprio
    ADD CONSTRAINT inventarios_proprio_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: inventarios inventarios_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventarios
    ADD CONSTRAINT inventarios_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: local_estoque_user local_estoque_user_local_estoque_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoque_user
    ADD CONSTRAINT local_estoque_user_local_estoque_id_fkey FOREIGN KEY (local_estoque_id) REFERENCES public.local_estoques(id) ON DELETE CASCADE;


--
-- Name: local_estoque_user local_estoque_user_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoque_user
    ADD CONSTRAINT local_estoque_user_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: local_estoque_user local_estoque_user_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoque_user
    ADD CONSTRAINT local_estoque_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: local_estoques local_estoques_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_estoques
    ADD CONSTRAINT local_estoques_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: loja_user loja_user_cargo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_user
    ADD CONSTRAINT loja_user_cargo_id_fkey FOREIGN KEY (cargo_id) REFERENCES public.cargos(id) ON DELETE SET NULL;


--
-- Name: loja_user loja_user_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_user
    ADD CONSTRAINT loja_user_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: loja_user loja_user_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loja_user
    ADD CONSTRAINT loja_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: lojas lojas_loja_origem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lojas
    ADD CONSTRAINT lojas_loja_origem_id_fkey FOREIGN KEY (loja_origem_id) REFERENCES public.lojas(id) ON DELETE SET NULL;


--
-- Name: margem_import_meta margem_import_meta_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margem_import_meta
    ADD CONSTRAINT margem_import_meta_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: margem_importada margem_importada_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margem_importada
    ADD CONSTRAINT margem_importada_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: margem_snapshot_diario margem_snapshot_diario_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.margem_snapshot_diario
    ADD CONSTRAINT margem_snapshot_diario_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: metas_faturamento metas_faturamento_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metas_faturamento
    ADD CONSTRAINT metas_faturamento_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: metas_mensais metas_mensais_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metas_mensais
    ADD CONSTRAINT metas_mensais_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: movimentacao_import_meta movimentacao_import_meta_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_import_meta
    ADD CONSTRAINT movimentacao_import_meta_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: movimentacao_importada movimentacao_importada_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_importada
    ADD CONSTRAINT movimentacao_importada_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: movimentacao_operacao movimentacao_operacao_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_operacao
    ADD CONSTRAINT movimentacao_operacao_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: movimentacao_operacao_meta movimentacao_operacao_meta_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentacao_operacao_meta
    ADD CONSTRAINT movimentacao_operacao_meta_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: movimentos_locais movimentos_locais_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos_locais
    ADD CONSTRAINT movimentos_locais_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: movimentos movimentos_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos
    ADD CONSTRAINT movimentos_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: movimentos movimentos_transferencia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimentos
    ADD CONSTRAINT movimentos_transferencia_id_fkey FOREIGN KEY (transferencia_id) REFERENCES public.transferencias(id) ON DELETE CASCADE;


--
-- Name: nota_fiscal_items nota_fiscal_items_categoria_contabil_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_fiscal_items
    ADD CONSTRAINT nota_fiscal_items_categoria_contabil_id_fkey FOREIGN KEY (categoria_contabil_id) REFERENCES public.categorias_contabeis(id) ON DELETE SET NULL;


--
-- Name: nota_fiscal_items nota_fiscal_items_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_fiscal_items
    ADD CONSTRAINT nota_fiscal_items_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: nota_fiscal_items nota_fiscal_items_nota_fiscal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_fiscal_items
    ADD CONSTRAINT nota_fiscal_items_nota_fiscal_id_fkey FOREIGN KEY (nota_fiscal_id) REFERENCES public.notas_fiscais(id) ON DELETE CASCADE;


--
-- Name: notas_fiscais notas_fiscais_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fiscais
    ADD CONSTRAINT notas_fiscais_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: op_historico op_historico_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.op_historico
    ADD CONSTRAINT op_historico_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: op_numeracao op_numeracao_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.op_numeracao
    ADD CONSTRAINT op_numeracao_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: op_qtde_planejada op_qtde_planejada_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.op_qtde_planejada
    ADD CONSTRAINT op_qtde_planejada_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: ordens_producao ordens_producao_concluida_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao
    ADD CONSTRAINT ordens_producao_concluida_por_fkey FOREIGN KEY (concluida_por) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: ordens_producao ordens_producao_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao
    ADD CONSTRAINT ordens_producao_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: ordens_producao_proprio ordens_producao_proprio_ficha_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_proprio
    ADD CONSTRAINT ordens_producao_proprio_ficha_id_fkey FOREIGN KEY (ficha_id) REFERENCES public.fichas_tecnicas(id);


--
-- Name: ordens_producao_proprio_itens ordens_producao_proprio_itens_ordem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_proprio_itens
    ADD CONSTRAINT ordens_producao_proprio_itens_ordem_id_fkey FOREIGN KEY (ordem_id) REFERENCES public.ordens_producao_proprio(id);


--
-- Name: ordens_producao_proprio ordens_producao_proprio_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_proprio
    ADD CONSTRAINT ordens_producao_proprio_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: ordens_producao_teste ordens_producao_teste_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ordens_producao_teste
    ADD CONSTRAINT ordens_producao_teste_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: permissao_user permissao_user_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissao_user
    ADD CONSTRAINT permissao_user_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: permissao_user permissao_user_permissao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissao_user
    ADD CONSTRAINT permissao_user_permissao_id_fkey FOREIGN KEY (permissao_id) REFERENCES public.permissoes(id) ON DELETE CASCADE;


--
-- Name: permissao_user permissao_user_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissao_user
    ADD CONSTRAINT permissao_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: posicao_estoques posicao_estoques_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posicao_estoques
    ADD CONSTRAINT posicao_estoques_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: previsao_venda previsao_venda_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.previsao_venda
    ADD CONSTRAINT previsao_venda_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: produto_sem_estrutura produto_sem_estrutura_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produto_sem_estrutura
    ADD CONSTRAINT produto_sem_estrutura_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: produto_substituicoes produto_substituicoes_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produto_substituicoes
    ADD CONSTRAINT produto_substituicoes_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: produtos produtos_grupo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES public.grupos_produto(id) ON DELETE SET NULL;


--
-- Name: produtos produtos_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: produtos produtos_pai_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_pai_fk FOREIGN KEY (produto_pai_codigo, loja_id) REFERENCES public.produtos(codigo_produto, loja_id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_current_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_current_loja_id_fkey FOREIGN KEY (current_loja_id) REFERENCES public.lojas(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: sefaz_documentos sefaz_documentos_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sefaz_documentos
    ADD CONSTRAINT sefaz_documentos_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: sefaz_nsu sefaz_nsu_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sefaz_nsu
    ADD CONSTRAINT sefaz_nsu_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: sync_divergencias sync_divergencias_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_divergencias
    ADD CONSTRAINT sync_divergencias_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: sync_outbox sync_outbox_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_outbox
    ADD CONSTRAINT sync_outbox_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: transferencias transferencias_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencias
    ADD CONSTRAINT transferencias_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: transferencias transferencias_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transferencias
    ADD CONSTRAINT transferencias_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: vendas_integracao_fila vendas_integracao_fila_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_integracao_fila
    ADD CONSTRAINT vendas_integracao_fila_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: vendas_proprio_itens vendas_proprio_itens_venda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio_itens
    ADD CONSTRAINT vendas_proprio_itens_venda_id_fkey FOREIGN KEY (venda_id) REFERENCES public.vendas_proprio(id) ON DELETE CASCADE;


--
-- Name: vendas_proprio vendas_proprio_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio
    ADD CONSTRAINT vendas_proprio_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id);


--
-- Name: vendas_proprio_pagamentos vendas_proprio_pagamentos_venda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendas_proprio_pagamentos
    ADD CONSTRAINT vendas_proprio_pagamentos_venda_id_fkey FOREIGN KEY (venda_id) REFERENCES public.vendas_proprio(id) ON DELETE CASCADE;


--
-- Name: webhooks webhooks_loja_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.lojas(id) ON DELETE CASCADE;


--
-- Name: arquivos_mortos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.arquivos_mortos ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select_por_loja ON public.audit_log FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: cargo_permissao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_permissao ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_permissao cargo_permissao_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_permissao_select_auth ON public.cargo_permissao FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: cargos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargos ENABLE ROW LEVEL SECURITY;

--
-- Name: cargos cargos_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargos_select_auth ON public.cargos FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: categorias_contabeis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categorias_contabeis ENABLE ROW LEVEL SECURITY;

--
-- Name: categorias_contabeis categorias_contabeis_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_contabeis_select_por_loja ON public.categorias_contabeis FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: clientes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

--
-- Name: clientes clientes_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clientes_select_por_loja ON public.clientes FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: compras_proprio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compras_proprio ENABLE ROW LEVEL SECURITY;

--
-- Name: compras_proprio_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compras_proprio_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: compras_proprio_itens compras_proprio_itens_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compras_proprio_itens_select_por_loja ON public.compras_proprio_itens FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: compras_proprio compras_proprio_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compras_proprio_select_por_loja ON public.compras_proprio FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: contas_correntes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contas_correntes ENABLE ROW LEVEL SECURITY;

--
-- Name: contas_correntes contas_correntes_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contas_correntes_select_por_loja ON public.contas_correntes FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: contas_pagar; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contas_pagar ENABLE ROW LEVEL SECURITY;

--
-- Name: contas_pagar contas_pagar_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contas_pagar_select_por_loja ON public.contas_pagar FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: contas_receber; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contas_receber ENABLE ROW LEVEL SECURITY;

--
-- Name: contas_receber contas_receber_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contas_receber_select_por_loja ON public.contas_receber FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: convites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;

--
-- Name: convites convites_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY convites_select_por_loja ON public.convites FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_codigo_seq; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_codigo_seq ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_config ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_config estoque_config_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_config_select_por_loja ON public.estoque_config FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_custos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_custos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_custos estoque_custos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_custos_select_por_loja ON public.estoque_custos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_local_saldos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_local_saldos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_local_saldos estoque_local_saldos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_local_saldos_select_por_loja ON public.estoque_local_saldos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_lote_movimentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_lote_movimentos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_lote_movimentos estoque_lote_movimentos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_lote_movimentos_select_por_loja ON public.estoque_lote_movimentos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_lotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_lotes ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_lotes estoque_lotes_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_lotes_select_por_loja ON public.estoque_lotes FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_movimentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_movimentos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_movimentos estoque_movimentos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_movimentos_select_por_loja ON public.estoque_movimentos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_receita_consumos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_receita_consumos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_receita_consumos estoque_receita_consumos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_receita_consumos_select_por_loja ON public.estoque_receita_consumos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estoque_saldos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estoque_saldos ENABLE ROW LEVEL SECURITY;

--
-- Name: estoque_saldos estoque_saldos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estoque_saldos_select_por_loja ON public.estoque_saldos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: estrutura_produto_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estrutura_produto_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: estrutura_produto_cache estrutura_produto_cache_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estrutura_produto_cache_select_por_loja ON public.estrutura_produto_cache FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: etiqueta_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.etiqueta_config ENABLE ROW LEVEL SECURITY;

--
-- Name: etiqueta_config etiqueta_config_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY etiqueta_config_select_por_loja ON public.etiqueta_config FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: familias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.familias ENABLE ROW LEVEL SECURITY;

--
-- Name: familias familias_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY familias_select_por_loja ON public.familias FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: faturamento_import_meta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faturamento_import_meta ENABLE ROW LEVEL SECURITY;

--
-- Name: faturamento_import_meta faturamento_import_meta_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY faturamento_import_meta_select_por_loja ON public.faturamento_import_meta FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: faturamento_importado; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faturamento_importado ENABLE ROW LEVEL SECURITY;

--
-- Name: faturamento_importado faturamento_importado_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY faturamento_importado_select_por_loja ON public.faturamento_importado FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: ficha_tecnica_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ficha_tecnica_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: ficha_tecnica_itens ficha_tecnica_itens_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ficha_tecnica_itens_select_por_loja ON public.ficha_tecnica_itens FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: ficha_tecnica_local; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ficha_tecnica_local ENABLE ROW LEVEL SECURITY;

--
-- Name: ficha_tecnica_local ficha_tecnica_local_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ficha_tecnica_local_select_por_loja ON public.ficha_tecnica_local FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: fichas_tecnicas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fichas_tecnicas ENABLE ROW LEVEL SECURITY;

--
-- Name: fichas_tecnicas fichas_tecnicas_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fichas_tecnicas_select_por_loja ON public.fichas_tecnicas FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: fornecedor_produto_depara; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fornecedor_produto_depara ENABLE ROW LEVEL SECURITY;

--
-- Name: fornecedor_produto_depara fornecedor_produto_depara_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fornecedor_produto_depara_select_por_loja ON public.fornecedor_produto_depara FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: fornecedores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

--
-- Name: fornecedores fornecedores_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fornecedores_select_por_loja ON public.fornecedores FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: grupos_produto; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grupos_produto ENABLE ROW LEVEL SECURITY;

--
-- Name: grupos_produto grupos_produto_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY grupos_produto_select_por_loja ON public.grupos_produto FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: impressao_etiquetas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.impressao_etiquetas ENABLE ROW LEVEL SECURITY;

--
-- Name: impressao_etiquetas impressao_etiquetas_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY impressao_etiquetas_select_por_loja ON public.impressao_etiquetas FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: integration_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_attempts integration_attempts_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY integration_attempts_select_por_loja ON public.integration_attempts FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: inventario_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventario_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inventario_items inventario_items_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventario_items_select_por_loja ON public.inventario_items FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: inventario_proprio_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventario_proprio_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: inventario_proprio_itens inventario_proprio_itens_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventario_proprio_itens_select_por_loja ON public.inventario_proprio_itens FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: inventarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;

--
-- Name: inventarios_proprio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventarios_proprio ENABLE ROW LEVEL SECURITY;

--
-- Name: inventarios_proprio inventarios_proprio_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventarios_proprio_select_por_loja ON public.inventarios_proprio FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: inventarios inventarios_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventarios_select_por_loja ON public.inventarios FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: local_estoque_user; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.local_estoque_user ENABLE ROW LEVEL SECURITY;

--
-- Name: local_estoque_user local_estoque_user_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY local_estoque_user_select_por_loja ON public.local_estoque_user FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: local_estoques; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.local_estoques ENABLE ROW LEVEL SECURITY;

--
-- Name: local_estoques local_estoques_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY local_estoques_select_por_loja ON public.local_estoques FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: loja_user; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loja_user ENABLE ROW LEVEL SECURITY;

--
-- Name: loja_user loja_user_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY loja_user_select_por_loja ON public.loja_user FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: lojas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;

--
-- Name: lojas lojas_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lojas_select_por_loja ON public.lojas FOR SELECT USING ((public.usuario_tem_acesso_loja(id) OR public.usuario_e_admin()));


--
-- Name: margem_import_meta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.margem_import_meta ENABLE ROW LEVEL SECURITY;

--
-- Name: margem_import_meta margem_import_meta_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY margem_import_meta_select_por_loja ON public.margem_import_meta FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: margem_importada; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.margem_importada ENABLE ROW LEVEL SECURITY;

--
-- Name: margem_importada margem_importada_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY margem_importada_select_por_loja ON public.margem_importada FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: margem_snapshot_diario; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.margem_snapshot_diario ENABLE ROW LEVEL SECURITY;

--
-- Name: margem_snapshot_diario margem_snapshot_diario_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY margem_snapshot_diario_select_por_loja ON public.margem_snapshot_diario FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: metas_faturamento; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metas_faturamento ENABLE ROW LEVEL SECURITY;

--
-- Name: metas_faturamento metas_faturamento_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY metas_faturamento_select_por_loja ON public.metas_faturamento FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: metas_mensais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metas_mensais ENABLE ROW LEVEL SECURITY;

--
-- Name: metas_mensais metas_mensais_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY metas_mensais_select_por_loja ON public.metas_mensais FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: movimentacao_import_meta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimentacao_import_meta ENABLE ROW LEVEL SECURITY;

--
-- Name: movimentacao_import_meta movimentacao_import_meta_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY movimentacao_import_meta_select_por_loja ON public.movimentacao_import_meta FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: movimentacao_importada; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimentacao_importada ENABLE ROW LEVEL SECURITY;

--
-- Name: movimentacao_importada movimentacao_importada_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY movimentacao_importada_select_por_loja ON public.movimentacao_importada FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: movimentacao_operacao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimentacao_operacao ENABLE ROW LEVEL SECURITY;

--
-- Name: movimentacao_operacao_meta; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimentacao_operacao_meta ENABLE ROW LEVEL SECURITY;

--
-- Name: movimentacao_operacao_meta movimentacao_operacao_meta_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY movimentacao_operacao_meta_select_por_loja ON public.movimentacao_operacao_meta FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: movimentacao_operacao movimentacao_operacao_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY movimentacao_operacao_select_por_loja ON public.movimentacao_operacao FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: movimentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimentos ENABLE ROW LEVEL SECURITY;

--
-- Name: movimentos_historico; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimentos_historico ENABLE ROW LEVEL SECURITY;

--
-- Name: movimentos_historico movimentos_historico_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY movimentos_historico_select_por_loja ON public.movimentos_historico FOR SELECT USING ((public.usuario_tem_acesso_loja((loja_id)::bigint) OR public.usuario_e_admin()));


--
-- Name: movimentos_locais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimentos_locais ENABLE ROW LEVEL SECURITY;

--
-- Name: movimentos_locais movimentos_locais_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY movimentos_locais_select_por_loja ON public.movimentos_locais FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: movimentos movimentos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY movimentos_select_por_loja ON public.movimentos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: nota_fiscal_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nota_fiscal_items ENABLE ROW LEVEL SECURITY;

--
-- Name: nota_fiscal_items nota_fiscal_items_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nota_fiscal_items_select_por_loja ON public.nota_fiscal_items FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: notas_fiscais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;

--
-- Name: notas_fiscais notas_fiscais_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notas_fiscais_select_por_loja ON public.notas_fiscais FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: op_historico; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.op_historico ENABLE ROW LEVEL SECURITY;

--
-- Name: op_historico op_historico_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY op_historico_select_por_loja ON public.op_historico FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: op_numeracao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.op_numeracao ENABLE ROW LEVEL SECURITY;

--
-- Name: op_qtde_planejada; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.op_qtde_planejada ENABLE ROW LEVEL SECURITY;

--
-- Name: op_qtde_planejada op_qtde_planejada_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY op_qtde_planejada_select_por_loja ON public.op_qtde_planejada FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: ordens_producao; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ordens_producao ENABLE ROW LEVEL SECURITY;

--
-- Name: ordens_producao_proprio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ordens_producao_proprio ENABLE ROW LEVEL SECURITY;

--
-- Name: ordens_producao_proprio_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ordens_producao_proprio_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: ordens_producao_proprio_itens ordens_producao_proprio_itens_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordens_producao_proprio_itens_select ON public.ordens_producao_proprio_itens FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.ordens_producao_proprio o
  WHERE ((o.id = ordens_producao_proprio_itens.ordem_id) AND (public.usuario_tem_acesso_loja(o.loja_id) OR public.usuario_e_admin())))));


--
-- Name: ordens_producao_proprio ordens_producao_proprio_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordens_producao_proprio_select_por_loja ON public.ordens_producao_proprio FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: ordens_producao ordens_producao_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordens_producao_select_por_loja ON public.ordens_producao FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: ordens_producao_teste; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ordens_producao_teste ENABLE ROW LEVEL SECURITY;

--
-- Name: ordens_producao_teste ordens_producao_teste_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ordens_producao_teste_select_por_loja ON public.ordens_producao_teste FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: permissao_user; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permissao_user ENABLE ROW LEVEL SECURITY;

--
-- Name: permissao_user permissao_user_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permissao_user_select_por_loja ON public.permissao_user FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: permissoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permissoes ENABLE ROW LEVEL SECURITY;

--
-- Name: permissoes permissoes_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permissoes_select_auth ON public.permissoes FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: posicao_estoques; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.posicao_estoques ENABLE ROW LEVEL SECURITY;

--
-- Name: posicao_estoques posicao_estoques_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY posicao_estoques_select_por_loja ON public.posicao_estoques FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: previsao_venda; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.previsao_venda ENABLE ROW LEVEL SECURITY;

--
-- Name: previsao_venda previsao_venda_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY previsao_venda_select_por_loja ON public.previsao_venda FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: produto_preco_recente; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.produto_preco_recente ENABLE ROW LEVEL SECURITY;

--
-- Name: produto_preco_recente produto_preco_recente_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produto_preco_recente_select_por_loja ON public.produto_preco_recente FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: produto_sem_estrutura; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.produto_sem_estrutura ENABLE ROW LEVEL SECURITY;

--
-- Name: produto_substituicoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.produto_substituicoes ENABLE ROW LEVEL SECURITY;

--
-- Name: produto_substituicoes produto_substituicoes_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produto_substituicoes_select_por_loja ON public.produto_substituicoes FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: produtos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

--
-- Name: produtos produtos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produtos_select_por_loja ON public.produtos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_por_acesso; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_por_acesso ON public.profiles FOR SELECT USING (((id = auth.uid()) OR public.usuario_e_admin() OR public.usuario_compartilha_loja(id) OR (((status)::text = 'pendente'::text) AND public.usuario_pode_aprovar_pendentes())));


--
-- Name: sefaz_documentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sefaz_documentos ENABLE ROW LEVEL SECURITY;

--
-- Name: sefaz_documentos sefaz_documentos_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sefaz_documentos_select_por_loja ON public.sefaz_documentos FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: sefaz_nsu; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sefaz_nsu ENABLE ROW LEVEL SECURITY;

--
-- Name: sefaz_nsu sefaz_nsu_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sefaz_nsu_select_por_loja ON public.sefaz_nsu FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: sync_divergencias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_divergencias ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_divergencias sync_divergencias_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_divergencias_select_por_loja ON public.sync_divergencias FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: sync_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_outbox sync_outbox_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_outbox_select_por_loja ON public.sync_outbox FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: transferencias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transferencias ENABLE ROW LEVEL SECURITY;

--
-- Name: transferencias transferencias_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transferencias_select_por_loja ON public.transferencias FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: vendas_integracao_fila; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendas_integracao_fila ENABLE ROW LEVEL SECURITY;

--
-- Name: vendas_proprio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendas_proprio ENABLE ROW LEVEL SECURITY;

--
-- Name: vendas_proprio_itens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendas_proprio_itens ENABLE ROW LEVEL SECURITY;

--
-- Name: vendas_proprio_itens vendas_proprio_itens_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendas_proprio_itens_select ON public.vendas_proprio_itens FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.vendas_proprio v
  WHERE ((v.id = vendas_proprio_itens.venda_id) AND (public.usuario_tem_acesso_loja(v.loja_id) OR public.usuario_e_admin())))));


--
-- Name: vendas_proprio_pagamentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendas_proprio_pagamentos ENABLE ROW LEVEL SECURITY;

--
-- Name: vendas_proprio_pagamentos vendas_proprio_pagamentos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendas_proprio_pagamentos_select ON public.vendas_proprio_pagamentos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.vendas_proprio v
  WHERE ((v.id = vendas_proprio_pagamentos.venda_id) AND (public.usuario_tem_acesso_loja(v.loja_id) OR public.usuario_e_admin())))));


--
-- Name: vendas_proprio vendas_proprio_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendas_proprio_select_por_loja ON public.vendas_proprio FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: webhooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

--
-- Name: webhooks webhooks_select_por_loja; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhooks_select_por_loja ON public.webhooks FOR SELECT USING ((( SELECT public.usuario_e_admin() AS usuario_e_admin) OR (loja_id IN ( SELECT public.usuario_lojas() AS usuario_lojas))));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_nivel integer, p_caminho bigint[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_nivel integer, p_caminho bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public._expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_nivel integer, p_caminho bigint[]) TO postgres;
GRANT ALL ON FUNCTION public._expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_nivel integer, p_caminho bigint[]) TO service_role;


--
-- Name: TABLE estoque_movimentos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_movimentos TO postgres;
GRANT ALL ON TABLE public.estoque_movimentos TO service_role;
GRANT SELECT ON TABLE public.estoque_movimentos TO authenticated;


--
-- Name: FUNCTION _lote_da_entrada(m public.estoque_movimentos, OUT o_lote text, OUT o_validade date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._lote_da_entrada(m public.estoque_movimentos, OUT o_lote text, OUT o_validade date) FROM PUBLIC;
GRANT ALL ON FUNCTION public._lote_da_entrada(m public.estoque_movimentos, OUT o_lote text, OUT o_validade date) TO postgres;
GRANT ALL ON FUNCTION public._lote_da_entrada(m public.estoque_movimentos, OUT o_lote text, OUT o_validade date) TO service_role;


--
-- Name: FUNCTION _lote_entrar(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_lote text, p_validade date, p_origem text, p_ref text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._lote_entrar(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_lote text, p_validade date, p_origem text, p_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public._lote_entrar(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_lote text, p_validade date, p_origem text, p_ref text) TO postgres;
GRANT ALL ON FUNCTION public._lote_entrar(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_lote text, p_validade date, p_origem text, p_ref text) TO service_role;


--
-- Name: FUNCTION _lote_sair(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_preferido bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._lote_sair(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_preferido bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public._lote_sair(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_preferido bigint) TO postgres;
GRANT ALL ON FUNCTION public._lote_sair(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_preferido bigint) TO service_role;


--
-- Name: FUNCTION _lote_sem_lote(p_loja bigint, p_local bigint, p_produto bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._lote_sem_lote(p_loja bigint, p_local bigint, p_produto bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public._lote_sem_lote(p_loja bigint, p_local bigint, p_produto bigint) TO postgres;
GRANT ALL ON FUNCTION public._lote_sem_lote(p_loja bigint, p_local bigint, p_produto bigint) TO service_role;


--
-- Name: FUNCTION _op_itens_detalhes(p_loja bigint, p_produto bigint, p_qtde numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._op_itens_detalhes(p_loja bigint, p_produto bigint, p_qtde numeric) TO postgres;
GRANT ALL ON FUNCTION public._op_itens_detalhes(p_loja bigint, p_produto bigint, p_qtde numeric) TO anon;
GRANT ALL ON FUNCTION public._op_itens_detalhes(p_loja bigint, p_produto bigint, p_qtde numeric) TO authenticated;
GRANT ALL ON FUNCTION public._op_itens_detalhes(p_loja bigint, p_produto bigint, p_qtde numeric) TO service_role;


--
-- Name: FUNCTION _rotulo_produto(p_loja bigint, p_produto bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._rotulo_produto(p_loja bigint, p_produto bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public._rotulo_produto(p_loja bigint, p_produto bigint) TO postgres;
GRANT ALL ON FUNCTION public._rotulo_produto(p_loja bigint, p_produto bigint) TO service_role;


--
-- Name: FUNCTION _travar_custos(p_loja bigint, p_produtos bigint[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public._travar_custos(p_loja bigint, p_produtos bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public._travar_custos(p_loja bigint, p_produtos bigint[]) TO postgres;
GRANT ALL ON FUNCTION public._travar_custos(p_loja bigint, p_produtos bigint[]) TO service_role;


--
-- Name: FUNCTION abrir_inventario(p_loja bigint, p_local bigint, p_user text, p_tipo text, p_classe text, p_descricao text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.abrir_inventario(p_loja bigint, p_local bigint, p_user text, p_tipo text, p_classe text, p_descricao text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.abrir_inventario(p_loja bigint, p_local bigint, p_user text, p_tipo text, p_classe text, p_descricao text) TO postgres;
GRANT ALL ON FUNCTION public.abrir_inventario(p_loja bigint, p_local bigint, p_user text, p_tipo text, p_classe text, p_descricao text) TO service_role;


--
-- Name: FUNCTION aplicar_catalogo_vendas(p_loja bigint, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.aplicar_catalogo_vendas(p_loja bigint, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.aplicar_catalogo_vendas(p_loja bigint, p_payload jsonb) TO postgres;
GRANT ALL ON FUNCTION public.aplicar_catalogo_vendas(p_loja bigint, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION atualizar_preco_recente(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.atualizar_preco_recente(p_loja_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.atualizar_preco_recente(p_loja_id bigint) TO postgres;
GRANT ALL ON FUNCTION public.atualizar_preco_recente(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION baixar_lote(p_loja bigint, p_lote_id bigint, p_quantidade numeric, p_motivo text, p_ref text, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.baixar_lote(p_loja bigint, p_lote_id bigint, p_quantidade numeric, p_motivo text, p_ref text, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.baixar_lote(p_loja bigint, p_lote_id bigint, p_quantidade numeric, p_motivo text, p_ref text, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.baixar_lote(p_loja bigint, p_lote_id bigint, p_quantidade numeric, p_motivo text, p_ref text, p_user text) TO service_role;


--
-- Name: FUNCTION baixar_saldo_local(p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.baixar_saldo_local(p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.baixar_saldo_local(p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric) TO postgres;
GRANT ALL ON FUNCTION public.baixar_saldo_local(p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric) TO anon;
GRANT ALL ON FUNCTION public.baixar_saldo_local(p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric) TO authenticated;
GRANT ALL ON FUNCTION public.baixar_saldo_local(p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric) TO service_role;


--
-- Name: FUNCTION cancelar_inventario(p_inventario bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancelar_inventario(p_inventario bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancelar_inventario(p_inventario bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.cancelar_inventario(p_inventario bigint, p_user text) TO service_role;


--
-- Name: FUNCTION cancelar_venda_proprio(p_loja bigint, p_ref text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancelar_venda_proprio(p_loja bigint, p_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancelar_venda_proprio(p_loja bigint, p_ref text) TO postgres;
GRANT ALL ON FUNCTION public.cancelar_venda_proprio(p_loja bigint, p_ref text) TO service_role;


--
-- Name: FUNCTION cmc_efetivo_proprio(p_loja bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cmc_efetivo_proprio(p_loja bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cmc_efetivo_proprio(p_loja bigint) TO postgres;
GRANT ALL ON FUNCTION public.cmc_efetivo_proprio(p_loja bigint) TO service_role;


--
-- Name: FUNCTION cmc_recente_da_loja(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cmc_recente_da_loja(p_loja_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cmc_recente_da_loja(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.cmc_recente_da_loja(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION compras_fornecedores(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.compras_fornecedores(p_loja_id bigint) TO anon;
GRANT ALL ON FUNCTION public.compras_fornecedores(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.compras_fornecedores(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION compras_precos_produtos(p_loja_id bigint, p_busca text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.compras_precos_produtos(p_loja_id bigint, p_busca text) TO anon;
GRANT ALL ON FUNCTION public.compras_precos_produtos(p_loja_id bigint, p_busca text) TO authenticated;
GRANT ALL ON FUNCTION public.compras_precos_produtos(p_loja_id bigint, p_busca text) TO service_role;


--
-- Name: FUNCTION compras_produtos_do_fornecedor(p_loja_id bigint, p_fornecedor text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.compras_produtos_do_fornecedor(p_loja_id bigint, p_fornecedor text) TO anon;
GRANT ALL ON FUNCTION public.compras_produtos_do_fornecedor(p_loja_id bigint, p_fornecedor text) TO authenticated;
GRANT ALL ON FUNCTION public.compras_produtos_do_fornecedor(p_loja_id bigint, p_fornecedor text) TO service_role;


--
-- Name: FUNCTION compras_ranking_fornecedores(p_loja_id bigint, p_desde date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.compras_ranking_fornecedores(p_loja_id bigint, p_desde date) TO anon;
GRANT ALL ON FUNCTION public.compras_ranking_fornecedores(p_loja_id bigint, p_desde date) TO authenticated;
GRANT ALL ON FUNCTION public.compras_ranking_fornecedores(p_loja_id bigint, p_desde date) TO service_role;


--
-- Name: FUNCTION consumo_por_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local bigint, p_ref text, p_user text, p_linha_base integer, p_origem text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.consumo_por_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local bigint, p_ref text, p_user text, p_linha_base integer, p_origem text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.consumo_por_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local bigint, p_ref text, p_user text, p_linha_base integer, p_origem text) TO postgres;
GRANT ALL ON FUNCTION public.consumo_por_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local bigint, p_ref text, p_user text, p_linha_base integer, p_origem text) TO service_role;


--
-- Name: FUNCTION contar_item(p_inventario bigint, p_produto bigint, p_contado numeric, p_user text, p_motivo text, p_em timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contar_item(p_inventario bigint, p_produto bigint, p_contado numeric, p_user text, p_motivo text, p_em timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.contar_item(p_inventario bigint, p_produto bigint, p_contado numeric, p_user text, p_motivo text, p_em timestamp with time zone) TO postgres;
GRANT ALL ON FUNCTION public.contar_item(p_inventario bigint, p_produto bigint, p_contado numeric, p_user text, p_motivo text, p_em timestamp with time zone) TO service_role;


--
-- Name: FUNCTION crm_fornecedor_nf(p_loja_id bigint, p_codigo bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crm_fornecedor_nf(p_loja_id bigint, p_codigo bigint) TO anon;
GRANT ALL ON FUNCTION public.crm_fornecedor_nf(p_loja_id bigint, p_codigo bigint) TO authenticated;
GRANT ALL ON FUNCTION public.crm_fornecedor_nf(p_loja_id bigint, p_codigo bigint) TO service_role;


--
-- Name: FUNCTION crm_resumo_contas(p_loja_id bigint, p_codigo bigint, p_tipo text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crm_resumo_contas(p_loja_id bigint, p_codigo bigint, p_tipo text) TO anon;
GRANT ALL ON FUNCTION public.crm_resumo_contas(p_loja_id bigint, p_codigo bigint, p_tipo text) TO authenticated;
GRANT ALL ON FUNCTION public.crm_resumo_contas(p_loja_id bigint, p_codigo bigint, p_tipo text) TO service_role;


--
-- Name: FUNCTION curva_abc(p_loja bigint, p_dias integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.curva_abc(p_loja bigint, p_dias integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.curva_abc(p_loja bigint, p_dias integer) TO postgres;
GRANT ALL ON FUNCTION public.curva_abc(p_loja bigint, p_dias integer) TO service_role;


--
-- Name: FUNCTION custo_unitario_ficha(p_loja bigint, p_produto bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.custo_unitario_ficha(p_loja bigint, p_produto bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.custo_unitario_ficha(p_loja bigint, p_produto bigint) TO postgres;
GRANT ALL ON FUNCTION public.custo_unitario_ficha(p_loja bigint, p_produto bigint) TO service_role;


--
-- Name: FUNCTION desativar_ficha(p_loja bigint, p_produto bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.desativar_ficha(p_loja bigint, p_produto bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.desativar_ficha(p_loja bigint, p_produto bigint) TO postgres;
GRANT ALL ON FUNCTION public.desativar_ficha(p_loja bigint, p_produto bigint) TO service_role;


--
-- Name: FUNCTION estoque_saldo_em(p_loja bigint, p_local bigint, p_produto bigint, p_ate timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estoque_saldo_em(p_loja bigint, p_local bigint, p_produto bigint, p_ate timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estoque_saldo_em(p_loja bigint, p_local bigint, p_produto bigint, p_ate timestamp with time zone) TO postgres;
GRANT ALL ON FUNCTION public.estoque_saldo_em(p_loja bigint, p_local bigint, p_produto bigint, p_ate timestamp with time zone) TO service_role;


--
-- Name: FUNCTION estornar_compra(p_compra_id bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estornar_compra(p_compra_id bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estornar_compra(p_compra_id bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.estornar_compra(p_compra_id bigint, p_user text) TO service_role;


--
-- Name: FUNCTION estornar_movimento(p_id bigint, p_user text, p_obs text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estornar_movimento(p_id bigint, p_user text, p_obs text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estornar_movimento(p_id bigint, p_user text, p_obs text) TO postgres;
GRANT ALL ON FUNCTION public.estornar_movimento(p_id bigint, p_user text, p_obs text) TO service_role;


--
-- Name: FUNCTION estornar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estornar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estornar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.estornar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text) TO service_role;


--
-- Name: FUNCTION evolucao_preco_produtos(p_loja_id bigint, p_codigos bigint[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.evolucao_preco_produtos(p_loja_id bigint, p_codigos bigint[]) TO anon;
GRANT ALL ON FUNCTION public.evolucao_preco_produtos(p_loja_id bigint, p_codigos bigint[]) TO authenticated;
GRANT ALL ON FUNCTION public.evolucao_preco_produtos(p_loja_id bigint, p_codigos bigint[]) TO service_role;


--
-- Name: FUNCTION expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric) TO postgres;
GRANT ALL ON FUNCTION public.expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric) TO service_role;


--
-- Name: FUNCTION familias_da_loja(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.familias_da_loja(p_loja_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.familias_da_loja(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.familias_da_loja(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION fechar_inventario(p_inventario bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fechar_inventario(p_inventario bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fechar_inventario(p_inventario bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.fechar_inventario(p_inventario bigint, p_user text) TO service_role;


--
-- Name: FUNCTION ficha_tem_ciclo(p_loja bigint, p_produto bigint, p_insumo bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ficha_tem_ciclo(p_loja bigint, p_produto bigint, p_insumo bigint) TO postgres;
GRANT ALL ON FUNCTION public.ficha_tem_ciclo(p_loja bigint, p_produto bigint, p_insumo bigint) TO anon;
GRANT ALL ON FUNCTION public.ficha_tem_ciclo(p_loja bigint, p_produto bigint, p_insumo bigint) TO authenticated;
GRANT ALL ON FUNCTION public.ficha_tem_ciclo(p_loja bigint, p_produto bigint, p_insumo bigint) TO service_role;


--
-- Name: FUNCTION financeiro_fluxo_caixa(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.financeiro_fluxo_caixa(p_loja_id bigint) TO anon;
GRANT ALL ON FUNCTION public.financeiro_fluxo_caixa(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.financeiro_fluxo_caixa(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION financeiro_resumo_cr(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.financeiro_resumo_cr(p_loja_id bigint) TO anon;
GRANT ALL ON FUNCTION public.financeiro_resumo_cr(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.financeiro_resumo_cr(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION gravar_nota_sefaz(p_loja bigint, p_cab jsonb, p_itens jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gravar_nota_sefaz(p_loja bigint, p_cab jsonb, p_itens jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gravar_nota_sefaz(p_loja bigint, p_cab jsonb, p_itens jsonb) TO postgres;
GRANT ALL ON FUNCTION public.gravar_nota_sefaz(p_loja bigint, p_cab jsonb, p_itens jsonb) TO service_role;


--
-- Name: FUNCTION inventario_cobertura(p_loja_id bigint, p_ini date, p_fim date, p_periodo text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.inventario_cobertura(p_loja_id bigint, p_ini date, p_fim date, p_periodo text) TO anon;
GRANT ALL ON FUNCTION public.inventario_cobertura(p_loja_id bigint, p_ini date, p_fim date, p_periodo text) TO authenticated;
GRANT ALL ON FUNCTION public.inventario_cobertura(p_loja_id bigint, p_ini date, p_fim date, p_periodo text) TO service_role;


--
-- Name: FUNCTION inventario_nao_contados(p_inventario_id bigint, p_loja_id bigint, p_tipo_item text, p_familia text, p_busca text, p_offset integer, p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.inventario_nao_contados(p_inventario_id bigint, p_loja_id bigint, p_tipo_item text, p_familia text, p_busca text, p_offset integer, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.inventario_nao_contados(p_inventario_id bigint, p_loja_id bigint, p_tipo_item text, p_familia text, p_busca text, p_offset integer, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.inventario_nao_contados(p_inventario_id bigint, p_loja_id bigint, p_tipo_item text, p_familia text, p_busca text, p_offset integer, p_limit integer) TO service_role;


--
-- Name: FUNCTION inventario_variancia(p_inventario bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.inventario_variancia(p_inventario bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.inventario_variancia(p_inventario bigint) TO postgres;
GRANT ALL ON FUNCTION public.inventario_variancia(p_inventario bigint) TO service_role;


--
-- Name: FUNCTION kardex_proprio(p_loja bigint, p_ini date, p_fim date, p_texto text, p_tipo text, p_origem text, p_local bigint, p_familia text, p_usuario text, p_so_negativos boolean, p_so_estornos boolean, p_ord text, p_dir text, p_limite integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kardex_proprio(p_loja bigint, p_ini date, p_fim date, p_texto text, p_tipo text, p_origem text, p_local bigint, p_familia text, p_usuario text, p_so_negativos boolean, p_so_estornos boolean, p_ord text, p_dir text, p_limite integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kardex_proprio(p_loja bigint, p_ini date, p_fim date, p_texto text, p_tipo text, p_origem text, p_local bigint, p_familia text, p_usuario text, p_so_negativos boolean, p_so_estornos boolean, p_ord text, p_dir text, p_limite integer, p_offset integer) TO postgres;
GRANT ALL ON FUNCTION public.kardex_proprio(p_loja bigint, p_ini date, p_fim date, p_texto text, p_tipo text, p_origem text, p_local bigint, p_familia text, p_usuario text, p_so_negativos boolean, p_so_estornos boolean, p_ord text, p_dir text, p_limite integer, p_offset integer) TO service_role;


--
-- Name: FUNCTION lancar_compra(p_compra jsonb, p_local bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lancar_compra(p_compra jsonb, p_local bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lancar_compra(p_compra jsonb, p_local bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.lancar_compra(p_compra jsonb, p_local bigint, p_user text) TO service_role;


--
-- Name: FUNCTION lancar_compra_com_lotes(p_compra jsonb, p_local bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lancar_compra_com_lotes(p_compra jsonb, p_local bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lancar_compra_com_lotes(p_compra jsonb, p_local bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.lancar_compra_com_lotes(p_compra jsonb, p_local bigint, p_user text) TO service_role;


--
-- Name: FUNCTION lancar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text, p_obs text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lancar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text, p_obs text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lancar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text, p_obs text) TO postgres;
GRANT ALL ON FUNCTION public.lancar_transferencia_item(p_loja bigint, p_movimento bigint, p_user text, p_obs text) TO service_role;


--
-- Name: FUNCTION lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text) TO postgres;
GRANT ALL ON FUNCTION public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text) TO service_role;


--
-- Name: FUNCTION meses_arquivaveis(p_tabela text, p_col text, p_corte date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.meses_arquivaveis(p_tabela text, p_col text, p_corte date) TO anon;
GRANT ALL ON FUNCTION public.meses_arquivaveis(p_tabela text, p_col text, p_corte date) TO authenticated;
GRANT ALL ON FUNCTION public.meses_arquivaveis(p_tabela text, p_col text, p_corte date) TO service_role;


--
-- Name: FUNCTION motivo_item_inventario(p_inventario bigint, p_produto bigint, p_motivo text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.motivo_item_inventario(p_inventario bigint, p_produto bigint, p_motivo text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.motivo_item_inventario(p_inventario bigint, p_produto bigint, p_motivo text) TO postgres;
GRANT ALL ON FUNCTION public.motivo_item_inventario(p_inventario bigint, p_produto bigint, p_motivo text) TO service_role;


--
-- Name: FUNCTION nf_bate_status(p_c_etapa text, p_full_object jsonb, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.nf_bate_status(p_c_etapa text, p_full_object jsonb, p_status text) TO anon;
GRANT ALL ON FUNCTION public.nf_bate_status(p_c_etapa text, p_full_object jsonb, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.nf_bate_status(p_c_etapa text, p_full_object jsonb, p_status text) TO service_role;


--
-- Name: FUNCTION novo_id_local_proprio(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.novo_id_local_proprio() FROM PUBLIC;
GRANT ALL ON FUNCTION public.novo_id_local_proprio() TO postgres;
GRANT ALL ON FUNCTION public.novo_id_local_proprio() TO service_role;


--
-- Name: FUNCTION novo_id_produto_proprio(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.novo_id_produto_proprio() FROM PUBLIC;
GRANT ALL ON FUNCTION public.novo_id_produto_proprio() TO postgres;
GRANT ALL ON FUNCTION public.novo_id_produto_proprio() TO service_role;


--
-- Name: FUNCTION op_proprio_alterar(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.op_proprio_alterar(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.op_proprio_alterar(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.op_proprio_alterar(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text) TO service_role;


--
-- Name: FUNCTION op_proprio_concluir(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text, p_user_uuid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.op_proprio_concluir(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text, p_user_uuid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.op_proprio_concluir(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text, p_user_uuid uuid) TO postgres;
GRANT ALL ON FUNCTION public.op_proprio_concluir(p_loja bigint, p_op bigint, p_data date, p_qtde numeric, p_user text, p_user_uuid uuid) TO service_role;


--
-- Name: FUNCTION op_proprio_criar(p_loja bigint, p_produto bigint, p_data date, p_qtde numeric, p_local bigint, p_local_destino bigint, p_validade date, p_obs text, p_user text, p_venda_ref text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.op_proprio_criar(p_loja bigint, p_produto bigint, p_data date, p_qtde numeric, p_local bigint, p_local_destino bigint, p_validade date, p_obs text, p_user text, p_venda_ref text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.op_proprio_criar(p_loja bigint, p_produto bigint, p_data date, p_qtde numeric, p_local bigint, p_local_destino bigint, p_validade date, p_obs text, p_user text, p_venda_ref text) TO postgres;
GRANT ALL ON FUNCTION public.op_proprio_criar(p_loja bigint, p_produto bigint, p_data date, p_qtde numeric, p_local bigint, p_local_destino bigint, p_validade date, p_obs text, p_user text, p_venda_ref text) TO service_role;


--
-- Name: FUNCTION op_proprio_detalhe(p_loja bigint, p_op bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.op_proprio_detalhe(p_loja bigint, p_op bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.op_proprio_detalhe(p_loja bigint, p_op bigint) TO postgres;
GRANT ALL ON FUNCTION public.op_proprio_detalhe(p_loja bigint, p_op bigint) TO service_role;


--
-- Name: FUNCTION op_proprio_excluir(p_loja bigint, p_op bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.op_proprio_excluir(p_loja bigint, p_op bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.op_proprio_excluir(p_loja bigint, p_op bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.op_proprio_excluir(p_loja bigint, p_op bigint, p_user text) TO service_role;


--
-- Name: FUNCTION op_proprio_ids_por_insumo(p_loja bigint, p_codigos bigint[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.op_proprio_ids_por_insumo(p_loja bigint, p_codigos bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.op_proprio_ids_por_insumo(p_loja bigint, p_codigos bigint[]) TO postgres;
GRANT ALL ON FUNCTION public.op_proprio_ids_por_insumo(p_loja bigint, p_codigos bigint[]) TO service_role;


--
-- Name: FUNCTION op_proprio_reverter(p_loja bigint, p_op bigint, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.op_proprio_reverter(p_loja bigint, p_op bigint, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.op_proprio_reverter(p_loja bigint, p_op bigint, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.op_proprio_reverter(p_loja bigint, p_op bigint, p_user text) TO service_role;


--
-- Name: FUNCTION ops_relacionadas_por_produto(p_loja_id bigint, p_produto_codes bigint[], p_data_ini date, p_data_fim date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ops_relacionadas_por_produto(p_loja_id bigint, p_produto_codes bigint[], p_data_ini date, p_data_fim date) TO postgres;
GRANT ALL ON FUNCTION public.ops_relacionadas_por_produto(p_loja_id bigint, p_produto_codes bigint[], p_data_ini date, p_data_fim date) TO anon;
GRANT ALL ON FUNCTION public.ops_relacionadas_por_produto(p_loja_id bigint, p_produto_codes bigint[], p_data_ini date, p_data_fim date) TO authenticated;
GRANT ALL ON FUNCTION public.ops_relacionadas_por_produto(p_loja_id bigint, p_produto_codes bigint[], p_data_ini date, p_data_fim date) TO service_role;


--
-- Name: FUNCTION outbox_capture(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.outbox_capture() TO anon;
GRANT ALL ON FUNCTION public.outbox_capture() TO authenticated;
GRANT ALL ON FUNCTION public.outbox_capture() TO service_role;


--
-- Name: FUNCTION prefixo_codigo_por_tipo(p_tipo_item text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prefixo_codigo_por_tipo(p_tipo_item text) TO postgres;
GRANT ALL ON FUNCTION public.prefixo_codigo_por_tipo(p_tipo_item text) TO anon;
GRANT ALL ON FUNCTION public.prefixo_codigo_por_tipo(p_tipo_item text) TO authenticated;
GRANT ALL ON FUNCTION public.prefixo_codigo_por_tipo(p_tipo_item text) TO service_role;


--
-- Name: FUNCTION produtos_repor(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.produtos_repor(p_loja_id bigint) TO anon;
GRANT ALL ON FUNCTION public.produtos_repor(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.produtos_repor(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text, p_obs text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text, p_obs text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text, p_obs text) TO postgres;
GRANT ALL ON FUNCTION public.produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text, p_obs text) TO service_role;


--
-- Name: FUNCTION projetar_posicao_dia(p_loja bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.projetar_posicao_dia(p_loja bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.projetar_posicao_dia(p_loja bigint) TO postgres;
GRANT ALL ON FUNCTION public.projetar_posicao_dia(p_loja bigint) TO service_role;


--
-- Name: FUNCTION proximo_codigo_produto(p_loja bigint, p_tipo_item text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.proximo_codigo_produto(p_loja bigint, p_tipo_item text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.proximo_codigo_produto(p_loja bigint, p_tipo_item text) TO postgres;
GRANT ALL ON FUNCTION public.proximo_codigo_produto(p_loja bigint, p_tipo_item text) TO service_role;


--
-- Name: FUNCTION recalcular_faturamento_proprio(p_loja bigint, p_mes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.recalcular_faturamento_proprio(p_loja bigint, p_mes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.recalcular_faturamento_proprio(p_loja bigint, p_mes text) TO postgres;
GRANT ALL ON FUNCTION public.recalcular_faturamento_proprio(p_loja bigint, p_mes text) TO service_role;


--
-- Name: FUNCTION reconciliar_lotes(p_loja bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reconciliar_lotes(p_loja bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reconciliar_lotes(p_loja bigint) TO postgres;
GRANT ALL ON FUNCTION public.reconciliar_lotes(p_loja bigint) TO service_role;


--
-- Name: FUNCTION registrar_compra_sefaz(p_compra jsonb, p_local bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_compra_sefaz(p_compra jsonb, p_local bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_compra_sefaz(p_compra jsonb, p_local bigint) TO postgres;
GRANT ALL ON FUNCTION public.registrar_compra_sefaz(p_compra jsonb, p_local bigint) TO service_role;


--
-- Name: FUNCTION registrar_entrada_lote(p_loja bigint, p_local bigint, p_produto bigint, p_quantidade numeric, p_custo numeric, p_origem text, p_ref text, p_lote text, p_validade date, p_user text, p_obs text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_entrada_lote(p_loja bigint, p_local bigint, p_produto bigint, p_quantidade numeric, p_custo numeric, p_origem text, p_ref text, p_lote text, p_validade date, p_user text, p_obs text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_entrada_lote(p_loja bigint, p_local bigint, p_produto bigint, p_quantidade numeric, p_custo numeric, p_origem text, p_ref text, p_lote text, p_validade date, p_user text, p_obs text) TO postgres;
GRANT ALL ON FUNCTION public.registrar_entrada_lote(p_loja bigint, p_local bigint, p_produto bigint, p_quantidade numeric, p_custo numeric, p_origem text, p_ref text, p_lote text, p_validade date, p_user text, p_obs text) TO service_role;


--
-- Name: FUNCTION registrar_mapa_vendas(p_loja bigint, p_mapa jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_mapa_vendas(p_loja bigint, p_mapa jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_mapa_vendas(p_loja bigint, p_mapa jsonb) TO postgres;
GRANT ALL ON FUNCTION public.registrar_mapa_vendas(p_loja bigint, p_mapa jsonb) TO service_role;


--
-- Name: FUNCTION registrar_movimento(p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text, p_quantidade numeric, p_custo numeric, p_user text, p_obs text, p_linha integer, p_reverses bigint, p_transferencia_ref text, p_data date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_movimento(p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text, p_quantidade numeric, p_custo numeric, p_user text, p_obs text, p_linha integer, p_reverses bigint, p_transferencia_ref text, p_data date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_movimento(p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text, p_quantidade numeric, p_custo numeric, p_user text, p_obs text, p_linha integer, p_reverses bigint, p_transferencia_ref text, p_data date) TO postgres;
GRANT ALL ON FUNCTION public.registrar_movimento(p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text, p_quantidade numeric, p_custo numeric, p_user text, p_obs text, p_linha integer, p_reverses bigint, p_transferencia_ref text, p_data date) TO service_role;


--
-- Name: FUNCTION registrar_venda_proprio(p_loja bigint, p_venda jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.registrar_venda_proprio(p_loja bigint, p_venda jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_venda_proprio(p_loja bigint, p_venda jsonb) TO postgres;
GRANT ALL ON FUNCTION public.registrar_venda_proprio(p_loja bigint, p_venda jsonb) TO service_role;


--
-- Name: FUNCTION relatorio_auditoria_fiscal_cfop(p_loja_id bigint, p_ini date, p_fim date, p_produto text, p_familias text[], p_fornecedor text, p_local bigint, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cfop(p_loja_id bigint, p_ini date, p_fim date, p_produto text, p_familias text[], p_fornecedor text, p_local bigint, p_status text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cfop(p_loja_id bigint, p_ini date, p_fim date, p_produto text, p_familias text[], p_fornecedor text, p_local bigint, p_status text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cfop(p_loja_id bigint, p_ini date, p_fim date, p_produto text, p_familias text[], p_fornecedor text, p_local bigint, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cfop(p_loja_id bigint, p_ini date, p_fim date, p_produto text, p_familias text[], p_fornecedor text, p_local bigint, p_status text) TO service_role;


--
-- Name: FUNCTION relatorio_auditoria_fiscal_cst(p_loja_id bigint, p_ini date, p_fim date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cst(p_loja_id bigint, p_ini date, p_fim date) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cst(p_loja_id bigint, p_ini date, p_fim date) TO anon;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cst(p_loja_id bigint, p_ini date, p_fim date) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_cst(p_loja_id bigint, p_ini date, p_fim date) TO service_role;


--
-- Name: FUNCTION relatorio_auditoria_fiscal_itens(p_loja_id bigint, p_ini date, p_fim date, p_cfop_doc text, p_cfop_entrada text, p_fornecedor text, p_produto text, p_familias text[], p_local bigint, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_itens(p_loja_id bigint, p_ini date, p_fim date, p_cfop_doc text, p_cfop_entrada text, p_fornecedor text, p_produto text, p_familias text[], p_local bigint, p_status text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_itens(p_loja_id bigint, p_ini date, p_fim date, p_cfop_doc text, p_cfop_entrada text, p_fornecedor text, p_produto text, p_familias text[], p_local bigint, p_status text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_itens(p_loja_id bigint, p_ini date, p_fim date, p_cfop_doc text, p_cfop_entrada text, p_fornecedor text, p_produto text, p_familias text[], p_local bigint, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_auditoria_fiscal_itens(p_loja_id bigint, p_ini date, p_fim date, p_cfop_doc text, p_cfop_entrada text, p_fornecedor text, p_produto text, p_familias text[], p_local bigint, p_status text) TO service_role;


--
-- Name: FUNCTION relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_compras_detalhe(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO service_role;


--
-- Name: FUNCTION relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO service_role;


--
-- Name: FUNCTION relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_compras_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO service_role;


--
-- Name: FUNCTION relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date, p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint, p_status text) TO service_role;


--
-- Name: FUNCTION relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_estoque_valorizado(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) TO service_role;


--
-- Name: FUNCTION relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text) TO service_role;


--
-- Name: FUNCTION relatorio_faturamento_matriz(p_loja_id bigint, p_dim text, p_mes_ini text, p_mes_fim text, p_rotulos text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_faturamento_matriz(p_loja_id bigint, p_dim text, p_mes_ini text, p_mes_fim text, p_rotulos text[]) TO anon;
GRANT ALL ON FUNCTION public.relatorio_faturamento_matriz(p_loja_id bigint, p_dim text, p_mes_ini text, p_mes_fim text, p_rotulos text[]) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_faturamento_matriz(p_loja_id bigint, p_dim text, p_mes_ini text, p_mes_fim text, p_rotulos text[]) TO service_role;


--
-- Name: FUNCTION relatorio_faturamento_opcoes(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_faturamento_opcoes(p_loja_id bigint) TO anon;
GRANT ALL ON FUNCTION public.relatorio_faturamento_opcoes(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_faturamento_opcoes(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION relatorio_margem_snapshot_matriz(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_margem_snapshot_matriz(p_loja_id bigint) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_margem_snapshot_matriz(p_loja_id bigint) TO anon;
GRANT ALL ON FUNCTION public.relatorio_margem_snapshot_matriz(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_margem_snapshot_matriz(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION relatorio_movimentacao_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text, p_cod_prods bigint[], p_produto text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.relatorio_movimentacao_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text, p_cod_prods bigint[], p_produto text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.relatorio_movimentacao_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text, p_cod_prods bigint[], p_produto text) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_movimentacao_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text, p_cod_prods bigint[], p_produto text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_movimentacao_matriz(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text, p_cod_prods bigint[], p_produto text) TO service_role;


--
-- Name: FUNCTION relatorio_movimentacao_total(p_loja_id bigint, p_ini date, p_fim date, p_sentido text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_movimentacao_total(p_loja_id bigint, p_ini date, p_fim date, p_sentido text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_movimentacao_total(p_loja_id bigint, p_ini date, p_fim date, p_sentido text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_movimentacao_total(p_loja_id bigint, p_ini date, p_fim date, p_sentido text) TO service_role;


--
-- Name: FUNCTION relatorio_movimentacao_valor_matriz(p_loja_id bigint, p_dim text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_movimentacao_valor_matriz(p_loja_id bigint, p_dim text) TO anon;
GRANT ALL ON FUNCTION public.relatorio_movimentacao_valor_matriz(p_loja_id bigint, p_dim text) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_movimentacao_valor_matriz(p_loja_id bigint, p_dim text) TO service_role;


--
-- Name: FUNCTION relatorio_op_previsto_produzido(p_loja_id bigint, p_ini date, p_fim date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_op_previsto_produzido(p_loja_id bigint, p_ini date, p_fim date) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_op_previsto_produzido(p_loja_id bigint, p_ini date, p_fim date) TO anon;
GRANT ALL ON FUNCTION public.relatorio_op_previsto_produzido(p_loja_id bigint, p_ini date, p_fim date) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_op_previsto_produzido(p_loja_id bigint, p_ini date, p_fim date) TO service_role;


--
-- Name: FUNCTION relatorio_rejeitos_por_tipo(p_loja_id bigint, p_data_ini date, p_data_fim date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.relatorio_rejeitos_por_tipo(p_loja_id bigint, p_data_ini date, p_data_fim date) TO postgres;
GRANT ALL ON FUNCTION public.relatorio_rejeitos_por_tipo(p_loja_id bigint, p_data_ini date, p_data_fim date) TO anon;
GRANT ALL ON FUNCTION public.relatorio_rejeitos_por_tipo(p_loja_id bigint, p_data_ini date, p_data_fim date) TO authenticated;
GRANT ALL ON FUNCTION public.relatorio_rejeitos_por_tipo(p_loja_id bigint, p_data_ini date, p_data_fim date) TO service_role;


--
-- Name: FUNCTION rotulo_forma_pgto(p_sigla text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rotulo_forma_pgto(p_sigla text) TO postgres;
GRANT ALL ON FUNCTION public.rotulo_forma_pgto(p_sigla text) TO anon;
GRANT ALL ON FUNCTION public.rotulo_forma_pgto(p_sigla text) TO authenticated;
GRANT ALL ON FUNCTION public.rotulo_forma_pgto(p_sigla text) TO service_role;


--
-- Name: FUNCTION rotulo_tipo_item(p_tipo text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rotulo_tipo_item(p_tipo text) TO postgres;
GRANT ALL ON FUNCTION public.rotulo_tipo_item(p_tipo text) TO anon;
GRANT ALL ON FUNCTION public.rotulo_tipo_item(p_tipo text) TO authenticated;
GRANT ALL ON FUNCTION public.rotulo_tipo_item(p_tipo text) TO service_role;


--
-- Name: FUNCTION salvar_ficha(p_loja bigint, p_produto bigint, p_rendimento numeric, p_itens jsonb, p_expandir_na_venda boolean, p_user text, p_obs text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.salvar_ficha(p_loja bigint, p_produto bigint, p_rendimento numeric, p_itens jsonb, p_expandir_na_venda boolean, p_user text, p_obs text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.salvar_ficha(p_loja bigint, p_produto bigint, p_rendimento numeric, p_itens jsonb, p_expandir_na_venda boolean, p_user text, p_obs text) TO postgres;
GRANT ALL ON FUNCTION public.salvar_ficha(p_loja bigint, p_produto bigint, p_rendimento numeric, p_itens jsonb, p_expandir_na_venda boolean, p_user text, p_obs text) TO service_role;


--
-- Name: FUNCTION saude_banco(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.saude_banco() FROM PUBLIC;
GRANT ALL ON FUNCTION public.saude_banco() TO authenticated;
GRANT ALL ON FUNCTION public.saude_banco() TO service_role;


--
-- Name: FUNCTION sefaz_marcar_cancelada(p_loja bigint, p_chave text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sefaz_marcar_cancelada(p_loja bigint, p_chave text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sefaz_marcar_cancelada(p_loja bigint, p_chave text) TO postgres;
GRANT ALL ON FUNCTION public.sefaz_marcar_cancelada(p_loja bigint, p_chave text) TO service_role;


--
-- Name: FUNCTION sigla_forma_pgto(p_metodo text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sigla_forma_pgto(p_metodo text) TO postgres;
GRANT ALL ON FUNCTION public.sigla_forma_pgto(p_metodo text) TO anon;
GRANT ALL ON FUNCTION public.sigla_forma_pgto(p_metodo text) TO authenticated;
GRANT ALL ON FUNCTION public.sigla_forma_pgto(p_metodo text) TO service_role;


--
-- Name: FUNCTION sincronizar_situacao_nota(p_loja bigint, p_nota bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sincronizar_situacao_nota(p_loja bigint, p_nota bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sincronizar_situacao_nota(p_loja bigint, p_nota bigint) TO postgres;
GRANT ALL ON FUNCTION public.sincronizar_situacao_nota(p_loja bigint, p_nota bigint) TO service_role;


--
-- Name: FUNCTION transferir_estoque(p_loja bigint, p_de bigint, p_para bigint, p_produto bigint, p_quantidade numeric, p_ref text, p_user text, p_obs text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transferir_estoque(p_loja bigint, p_de bigint, p_para bigint, p_produto bigint, p_quantidade numeric, p_ref text, p_user text, p_obs text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transferir_estoque(p_loja bigint, p_de bigint, p_para bigint, p_produto bigint, p_quantidade numeric, p_ref text, p_user text, p_obs text) TO postgres;
GRANT ALL ON FUNCTION public.transferir_estoque(p_loja bigint, p_de bigint, p_para bigint, p_produto bigint, p_quantidade numeric, p_ref text, p_user text, p_obs text) TO service_role;


--
-- Name: FUNCTION trf_desfazer_lancamento(p_loja bigint, p_ref text, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.trf_desfazer_lancamento(p_loja bigint, p_ref text, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.trf_desfazer_lancamento(p_loja bigint, p_ref text, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.trf_desfazer_lancamento(p_loja bigint, p_ref text, p_user text) TO service_role;


--
-- Name: FUNCTION trg_estoque_custos_projeta_cmc(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_estoque_custos_projeta_cmc() TO postgres;
GRANT ALL ON FUNCTION public.trg_estoque_custos_projeta_cmc() TO anon;
GRANT ALL ON FUNCTION public.trg_estoque_custos_projeta_cmc() TO authenticated;
GRANT ALL ON FUNCTION public.trg_estoque_custos_projeta_cmc() TO service_role;


--
-- Name: FUNCTION trg_estoque_movimentos_historico(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_estoque_movimentos_historico() TO postgres;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_historico() TO anon;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_historico() TO authenticated;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_historico() TO service_role;


--
-- Name: FUNCTION trg_estoque_movimentos_imutavel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_estoque_movimentos_imutavel() TO postgres;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_imutavel() TO anon;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_imutavel() TO authenticated;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_imutavel() TO service_role;


--
-- Name: FUNCTION trg_estoque_movimentos_lotes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_estoque_movimentos_lotes() TO postgres;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_lotes() TO anon;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_lotes() TO authenticated;
GRANT ALL ON FUNCTION public.trg_estoque_movimentos_lotes() TO service_role;


--
-- Name: FUNCTION trg_ficha_itens_ciclo(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_ficha_itens_ciclo() TO postgres;
GRANT ALL ON FUNCTION public.trg_ficha_itens_ciclo() TO anon;
GRANT ALL ON FUNCTION public.trg_ficha_itens_ciclo() TO authenticated;
GRANT ALL ON FUNCTION public.trg_ficha_itens_ciclo() TO service_role;


--
-- Name: FUNCTION trg_ficha_itens_imutavel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_ficha_itens_imutavel() TO postgres;
GRANT ALL ON FUNCTION public.trg_ficha_itens_imutavel() TO anon;
GRANT ALL ON FUNCTION public.trg_ficha_itens_imutavel() TO authenticated;
GRANT ALL ON FUNCTION public.trg_ficha_itens_imutavel() TO service_role;


--
-- Name: FUNCTION trg_grupos_produto_arvore(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_grupos_produto_arvore() TO postgres;
GRANT ALL ON FUNCTION public.trg_grupos_produto_arvore() TO anon;
GRANT ALL ON FUNCTION public.trg_grupos_produto_arvore() TO authenticated;
GRANT ALL ON FUNCTION public.trg_grupos_produto_arvore() TO service_role;


--
-- Name: FUNCTION trg_lojas_modo_estoque(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_lojas_modo_estoque() TO postgres;
GRANT ALL ON FUNCTION public.trg_lojas_modo_estoque() TO anon;
GRANT ALL ON FUNCTION public.trg_lojas_modo_estoque() TO authenticated;
GRANT ALL ON FUNCTION public.trg_lojas_modo_estoque() TO service_role;


--
-- Name: FUNCTION trg_movimento_nao_mae(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_movimento_nao_mae() TO postgres;
GRANT ALL ON FUNCTION public.trg_movimento_nao_mae() TO anon;
GRANT ALL ON FUNCTION public.trg_movimento_nao_mae() TO authenticated;
GRANT ALL ON FUNCTION public.trg_movimento_nao_mae() TO service_role;


--
-- Name: FUNCTION trg_op_historico_imutavel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_op_historico_imutavel() TO postgres;
GRANT ALL ON FUNCTION public.trg_op_historico_imutavel() TO anon;
GRANT ALL ON FUNCTION public.trg_op_historico_imutavel() TO authenticated;
GRANT ALL ON FUNCTION public.trg_op_historico_imutavel() TO service_role;


--
-- Name: FUNCTION trg_produtos_codigo_proprio(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_produtos_codigo_proprio() TO postgres;
GRANT ALL ON FUNCTION public.trg_produtos_codigo_proprio() TO anon;
GRANT ALL ON FUNCTION public.trg_produtos_codigo_proprio() TO authenticated;
GRANT ALL ON FUNCTION public.trg_produtos_codigo_proprio() TO service_role;


--
-- Name: FUNCTION trg_produtos_mae_variacao(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_produtos_mae_variacao() TO postgres;
GRANT ALL ON FUNCTION public.trg_produtos_mae_variacao() TO anon;
GRANT ALL ON FUNCTION public.trg_produtos_mae_variacao() TO authenticated;
GRANT ALL ON FUNCTION public.trg_produtos_mae_variacao() TO service_role;


--
-- Name: FUNCTION trg_sync_outbox_catalogo(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_sync_outbox_catalogo() TO postgres;
GRANT ALL ON FUNCTION public.trg_sync_outbox_catalogo() TO anon;
GRANT ALL ON FUNCTION public.trg_sync_outbox_catalogo() TO authenticated;
GRANT ALL ON FUNCTION public.trg_sync_outbox_catalogo() TO service_role;


--
-- Name: FUNCTION upsert_movimentos_ajuste(p_rows jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_movimentos_ajuste(p_rows jsonb) TO anon;
GRANT ALL ON FUNCTION public.upsert_movimentos_ajuste(p_rows jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_movimentos_ajuste(p_rows jsonb) TO service_role;


--
-- Name: FUNCTION usuario_compartilha_loja(p_outro_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.usuario_compartilha_loja(p_outro_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.usuario_compartilha_loja(p_outro_user_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.usuario_compartilha_loja(p_outro_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.usuario_compartilha_loja(p_outro_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.usuario_compartilha_loja(p_outro_user_id uuid) TO service_role;


--
-- Name: FUNCTION usuario_e_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.usuario_e_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.usuario_e_admin() TO postgres;
GRANT ALL ON FUNCTION public.usuario_e_admin() TO anon;
GRANT ALL ON FUNCTION public.usuario_e_admin() TO authenticated;
GRANT ALL ON FUNCTION public.usuario_e_admin() TO service_role;


--
-- Name: FUNCTION usuario_lojas(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.usuario_lojas() TO postgres;
GRANT ALL ON FUNCTION public.usuario_lojas() TO anon;
GRANT ALL ON FUNCTION public.usuario_lojas() TO authenticated;
GRANT ALL ON FUNCTION public.usuario_lojas() TO service_role;


--
-- Name: FUNCTION usuario_pode_aprovar_pendentes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.usuario_pode_aprovar_pendentes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.usuario_pode_aprovar_pendentes() TO postgres;
GRANT ALL ON FUNCTION public.usuario_pode_aprovar_pendentes() TO anon;
GRANT ALL ON FUNCTION public.usuario_pode_aprovar_pendentes() TO authenticated;
GRANT ALL ON FUNCTION public.usuario_pode_aprovar_pendentes() TO service_role;


--
-- Name: FUNCTION usuario_tem_acesso_loja(p_loja_id bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.usuario_tem_acesso_loja(p_loja_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.usuario_tem_acesso_loja(p_loja_id bigint) TO postgres;
GRANT ALL ON FUNCTION public.usuario_tem_acesso_loja(p_loja_id bigint) TO anon;
GRANT ALL ON FUNCTION public.usuario_tem_acesso_loja(p_loja_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.usuario_tem_acesso_loja(p_loja_id bigint) TO service_role;


--
-- Name: FUNCTION vincular_item_compra(p_loja bigint, p_compra_item bigint, p_produto bigint, p_fator numeric, p_user text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.vincular_item_compra(p_loja bigint, p_compra_item bigint, p_produto bigint, p_fator numeric, p_user text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.vincular_item_compra(p_loja bigint, p_compra_item bigint, p_produto bigint, p_fator numeric, p_user text) TO postgres;
GRANT ALL ON FUNCTION public.vincular_item_compra(p_loja bigint, p_compra_item bigint, p_produto bigint, p_fator numeric, p_user text) TO service_role;


--
-- Name: TABLE arquivos_mortos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.arquivos_mortos TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.arquivos_mortos TO authenticated;
GRANT ALL ON TABLE public.arquivos_mortos TO service_role;


--
-- Name: SEQUENCE arquivos_mortos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.arquivos_mortos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.arquivos_mortos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.arquivos_mortos_id_seq TO service_role;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.audit_log TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;


--
-- Name: TABLE cargo_permissao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_permissao TO anon;
GRANT ALL ON TABLE public.cargo_permissao TO authenticated;
GRANT ALL ON TABLE public.cargo_permissao TO service_role;


--
-- Name: TABLE cargos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargos TO anon;
GRANT ALL ON TABLE public.cargos TO authenticated;
GRANT ALL ON TABLE public.cargos TO service_role;


--
-- Name: SEQUENCE cargos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.cargos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.cargos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.cargos_id_seq TO service_role;


--
-- Name: TABLE categorias_contabeis; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.categorias_contabeis TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.categorias_contabeis TO authenticated;
GRANT ALL ON TABLE public.categorias_contabeis TO service_role;


--
-- Name: SEQUENCE categorias_contabeis_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.categorias_contabeis_id_seq TO anon;
GRANT ALL ON SEQUENCE public.categorias_contabeis_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.categorias_contabeis_id_seq TO service_role;


--
-- Name: TABLE clientes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.clientes TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.clientes TO authenticated;
GRANT ALL ON TABLE public.clientes TO service_role;


--
-- Name: SEQUENCE clientes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.clientes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.clientes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.clientes_id_seq TO service_role;


--
-- Name: TABLE compras_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.compras_proprio TO postgres;
GRANT ALL ON TABLE public.compras_proprio TO service_role;
GRANT SELECT ON TABLE public.compras_proprio TO authenticated;


--
-- Name: SEQUENCE compras_proprio_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.compras_proprio_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.compras_proprio_id_seq TO anon;
GRANT ALL ON SEQUENCE public.compras_proprio_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.compras_proprio_id_seq TO service_role;


--
-- Name: TABLE compras_proprio_itens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.compras_proprio_itens TO postgres;
GRANT ALL ON TABLE public.compras_proprio_itens TO service_role;
GRANT SELECT ON TABLE public.compras_proprio_itens TO authenticated;


--
-- Name: SEQUENCE compras_proprio_itens_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.compras_proprio_itens_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.compras_proprio_itens_id_seq TO anon;
GRANT ALL ON SEQUENCE public.compras_proprio_itens_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.compras_proprio_itens_id_seq TO service_role;


--
-- Name: TABLE contas_correntes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.contas_correntes TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.contas_correntes TO authenticated;
GRANT ALL ON TABLE public.contas_correntes TO service_role;


--
-- Name: SEQUENCE contas_correntes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.contas_correntes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.contas_correntes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.contas_correntes_id_seq TO service_role;


--
-- Name: TABLE contas_pagar; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.contas_pagar TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.contas_pagar TO authenticated;
GRANT ALL ON TABLE public.contas_pagar TO service_role;


--
-- Name: SEQUENCE contas_pagar_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.contas_pagar_id_seq TO anon;
GRANT ALL ON SEQUENCE public.contas_pagar_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.contas_pagar_id_seq TO service_role;


--
-- Name: TABLE contas_receber; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.contas_receber TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.contas_receber TO authenticated;
GRANT ALL ON TABLE public.contas_receber TO service_role;


--
-- Name: SEQUENCE contas_receber_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.contas_receber_id_seq TO anon;
GRANT ALL ON SEQUENCE public.contas_receber_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.contas_receber_id_seq TO service_role;


--
-- Name: TABLE convites; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.convites TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.convites TO authenticated;
GRANT ALL ON TABLE public.convites TO service_role;


--
-- Name: SEQUENCE convites_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.convites_id_seq TO anon;
GRANT ALL ON SEQUENCE public.convites_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.convites_id_seq TO service_role;


--
-- Name: TABLE estoque_codigo_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_codigo_seq TO postgres;
GRANT ALL ON TABLE public.estoque_codigo_seq TO service_role;


--
-- Name: TABLE estoque_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_config TO postgres;
GRANT ALL ON TABLE public.estoque_config TO service_role;
GRANT SELECT ON TABLE public.estoque_config TO authenticated;


--
-- Name: TABLE estoque_custos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_custos TO postgres;
GRANT ALL ON TABLE public.estoque_custos TO service_role;
GRANT SELECT ON TABLE public.estoque_custos TO authenticated;


--
-- Name: TABLE estoque_local_saldos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_local_saldos TO postgres;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.estoque_local_saldos TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.estoque_local_saldos TO authenticated;
GRANT ALL ON TABLE public.estoque_local_saldos TO service_role;


--
-- Name: SEQUENCE estoque_local_saldos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.estoque_local_saldos_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.estoque_local_saldos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.estoque_local_saldos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.estoque_local_saldos_id_seq TO service_role;


--
-- Name: TABLE estoque_lote_movimentos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_lote_movimentos TO postgres;
GRANT ALL ON TABLE public.estoque_lote_movimentos TO service_role;
GRANT SELECT ON TABLE public.estoque_lote_movimentos TO authenticated;


--
-- Name: SEQUENCE estoque_lote_movimentos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.estoque_lote_movimentos_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.estoque_lote_movimentos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.estoque_lote_movimentos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.estoque_lote_movimentos_id_seq TO service_role;


--
-- Name: TABLE estoque_lotes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_lotes TO postgres;
GRANT ALL ON TABLE public.estoque_lotes TO service_role;
GRANT SELECT ON TABLE public.estoque_lotes TO authenticated;


--
-- Name: TABLE estoque_saldos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_saldos TO postgres;
GRANT ALL ON TABLE public.estoque_saldos TO service_role;
GRANT SELECT ON TABLE public.estoque_saldos TO authenticated;


--
-- Name: TABLE estoque_lotes_divergencia; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_lotes_divergencia TO postgres;
GRANT ALL ON TABLE public.estoque_lotes_divergencia TO anon;
GRANT ALL ON TABLE public.estoque_lotes_divergencia TO authenticated;
GRANT ALL ON TABLE public.estoque_lotes_divergencia TO service_role;


--
-- Name: SEQUENCE estoque_lotes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.estoque_lotes_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.estoque_lotes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.estoque_lotes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.estoque_lotes_id_seq TO service_role;


--
-- Name: SEQUENCE estoque_movimentos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.estoque_movimentos_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.estoque_movimentos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.estoque_movimentos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.estoque_movimentos_id_seq TO service_role;


--
-- Name: TABLE produtos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.produtos TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.produtos TO authenticated;
GRANT ALL ON TABLE public.produtos TO service_role;


--
-- Name: TABLE estoque_negativos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_negativos TO postgres;
GRANT ALL ON TABLE public.estoque_negativos TO anon;
GRANT ALL ON TABLE public.estoque_negativos TO authenticated;
GRANT ALL ON TABLE public.estoque_negativos TO service_role;


--
-- Name: TABLE estoque_receita_consumos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estoque_receita_consumos TO postgres;
GRANT ALL ON TABLE public.estoque_receita_consumos TO service_role;
GRANT SELECT ON TABLE public.estoque_receita_consumos TO authenticated;


--
-- Name: TABLE estrutura_produto_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estrutura_produto_cache TO postgres;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.estrutura_produto_cache TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.estrutura_produto_cache TO authenticated;
GRANT ALL ON TABLE public.estrutura_produto_cache TO service_role;


--
-- Name: SEQUENCE estrutura_produto_cache_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.estrutura_produto_cache_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.estrutura_produto_cache_id_seq TO anon;
GRANT ALL ON SEQUENCE public.estrutura_produto_cache_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.estrutura_produto_cache_id_seq TO service_role;


--
-- Name: TABLE etiqueta_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.etiqueta_config TO anon;
GRANT ALL ON TABLE public.etiqueta_config TO authenticated;
GRANT ALL ON TABLE public.etiqueta_config TO service_role;


--
-- Name: TABLE familias; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.familias TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.familias TO authenticated;
GRANT ALL ON TABLE public.familias TO service_role;


--
-- Name: SEQUENCE familias_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.familias_id_seq TO anon;
GRANT ALL ON SEQUENCE public.familias_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.familias_id_seq TO service_role;


--
-- Name: TABLE faturamento_import_meta; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.faturamento_import_meta TO anon;
GRANT ALL ON TABLE public.faturamento_import_meta TO authenticated;
GRANT ALL ON TABLE public.faturamento_import_meta TO service_role;


--
-- Name: TABLE faturamento_importado; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.faturamento_importado TO anon;
GRANT ALL ON TABLE public.faturamento_importado TO authenticated;
GRANT ALL ON TABLE public.faturamento_importado TO service_role;


--
-- Name: TABLE ficha_tecnica_itens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ficha_tecnica_itens TO postgres;
GRANT ALL ON TABLE public.ficha_tecnica_itens TO service_role;
GRANT SELECT ON TABLE public.ficha_tecnica_itens TO authenticated;


--
-- Name: SEQUENCE ficha_tecnica_itens_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ficha_tecnica_itens_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.ficha_tecnica_itens_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ficha_tecnica_itens_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ficha_tecnica_itens_id_seq TO service_role;


--
-- Name: TABLE ficha_tecnica_local; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ficha_tecnica_local TO postgres;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ficha_tecnica_local TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ficha_tecnica_local TO authenticated;
GRANT ALL ON TABLE public.ficha_tecnica_local TO service_role;


--
-- Name: SEQUENCE ficha_tecnica_local_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ficha_tecnica_local_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.ficha_tecnica_local_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ficha_tecnica_local_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ficha_tecnica_local_id_seq TO service_role;


--
-- Name: TABLE fichas_tecnicas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fichas_tecnicas TO postgres;
GRANT ALL ON TABLE public.fichas_tecnicas TO service_role;
GRANT SELECT ON TABLE public.fichas_tecnicas TO authenticated;


--
-- Name: SEQUENCE fichas_tecnicas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.fichas_tecnicas_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.fichas_tecnicas_id_seq TO anon;
GRANT ALL ON SEQUENCE public.fichas_tecnicas_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.fichas_tecnicas_id_seq TO service_role;


--
-- Name: TABLE fornecedor_produto_depara; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fornecedor_produto_depara TO postgres;
GRANT ALL ON TABLE public.fornecedor_produto_depara TO service_role;
GRANT SELECT ON TABLE public.fornecedor_produto_depara TO authenticated;


--
-- Name: TABLE fornecedores; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.fornecedores TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.fornecedores TO authenticated;
GRANT ALL ON TABLE public.fornecedores TO service_role;


--
-- Name: SEQUENCE fornecedores_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.fornecedores_id_seq TO anon;
GRANT ALL ON SEQUENCE public.fornecedores_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.fornecedores_id_seq TO service_role;


--
-- Name: TABLE grupos_produto; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.grupos_produto TO postgres;
GRANT ALL ON TABLE public.grupos_produto TO service_role;
GRANT SELECT ON TABLE public.grupos_produto TO authenticated;


--
-- Name: SEQUENCE grupos_produto_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.grupos_produto_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.grupos_produto_id_seq TO anon;
GRANT ALL ON SEQUENCE public.grupos_produto_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.grupos_produto_id_seq TO service_role;


--
-- Name: TABLE impressao_etiquetas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.impressao_etiquetas TO anon;
GRANT ALL ON TABLE public.impressao_etiquetas TO authenticated;
GRANT ALL ON TABLE public.impressao_etiquetas TO service_role;


--
-- Name: SEQUENCE impressao_etiquetas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.impressao_etiquetas_id_seq TO anon;
GRANT ALL ON SEQUENCE public.impressao_etiquetas_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.impressao_etiquetas_id_seq TO service_role;


--
-- Name: TABLE integration_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.integration_attempts TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.integration_attempts TO authenticated;
GRANT ALL ON TABLE public.integration_attempts TO service_role;


--
-- Name: SEQUENCE integration_attempts_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.integration_attempts_id_seq TO anon;
GRANT ALL ON SEQUENCE public.integration_attempts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.integration_attempts_id_seq TO service_role;


--
-- Name: TABLE inventario_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.inventario_items TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.inventario_items TO authenticated;
GRANT ALL ON TABLE public.inventario_items TO service_role;


--
-- Name: SEQUENCE inventario_items_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.inventario_items_id_seq TO anon;
GRANT ALL ON SEQUENCE public.inventario_items_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.inventario_items_id_seq TO service_role;


--
-- Name: TABLE inventario_proprio_itens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventario_proprio_itens TO postgres;
GRANT ALL ON TABLE public.inventario_proprio_itens TO service_role;


--
-- Name: COLUMN inventario_proprio_itens.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.inventario_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(inventario_id) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.loja_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(loja_id) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.codigo_produto; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(codigo_produto) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.contado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(contado) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.contado_em; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(contado_em) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.contado_por; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(contado_por) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.motivo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(motivo) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.delta_aplicado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(delta_aplicado) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: COLUMN inventario_proprio_itens.movimento_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(movimento_id) ON TABLE public.inventario_proprio_itens TO authenticated;


--
-- Name: SEQUENCE inventario_proprio_itens_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.inventario_proprio_itens_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.inventario_proprio_itens_id_seq TO anon;
GRANT ALL ON SEQUENCE public.inventario_proprio_itens_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.inventario_proprio_itens_id_seq TO service_role;


--
-- Name: TABLE inventarios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.inventarios TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.inventarios TO authenticated;
GRANT ALL ON TABLE public.inventarios TO service_role;


--
-- Name: SEQUENCE inventarios_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.inventarios_id_seq TO anon;
GRANT ALL ON SEQUENCE public.inventarios_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.inventarios_id_seq TO service_role;


--
-- Name: TABLE inventarios_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventarios_proprio TO postgres;
GRANT ALL ON TABLE public.inventarios_proprio TO service_role;
GRANT SELECT ON TABLE public.inventarios_proprio TO authenticated;


--
-- Name: SEQUENCE inventarios_proprio_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.inventarios_proprio_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.inventarios_proprio_id_seq TO anon;
GRANT ALL ON SEQUENCE public.inventarios_proprio_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.inventarios_proprio_id_seq TO service_role;


--
-- Name: TABLE local_estoque_user; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.local_estoque_user TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.local_estoque_user TO authenticated;
GRANT ALL ON TABLE public.local_estoque_user TO service_role;


--
-- Name: SEQUENCE local_estoque_user_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.local_estoque_user_id_seq TO anon;
GRANT ALL ON SEQUENCE public.local_estoque_user_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.local_estoque_user_id_seq TO service_role;


--
-- Name: TABLE local_estoques; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.local_estoques TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.local_estoques TO authenticated;
GRANT ALL ON TABLE public.local_estoques TO service_role;


--
-- Name: SEQUENCE local_estoques_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.local_estoques_id_seq TO anon;
GRANT ALL ON SEQUENCE public.local_estoques_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.local_estoques_id_seq TO service_role;


--
-- Name: TABLE loja_user; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.loja_user TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.loja_user TO authenticated;
GRANT ALL ON TABLE public.loja_user TO service_role;


--
-- Name: SEQUENCE loja_user_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.loja_user_id_seq TO anon;
GRANT ALL ON SEQUENCE public.loja_user_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.loja_user_id_seq TO service_role;


--
-- Name: TABLE lojas; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE public.lojas TO anon;
GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE public.lojas TO authenticated;
GRANT ALL ON TABLE public.lojas TO service_role;


--
-- Name: COLUMN lojas.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.lojas TO anon;
GRANT SELECT(id) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.cnpj; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cnpj) ON TABLE public.lojas TO anon;
GRANT SELECT(cnpj) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.nome; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(nome) ON TABLE public.lojas TO anon;
GRANT SELECT(nome) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.nome_fantasia; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(nome_fantasia) ON TABLE public.lojas TO anon;
GRANT SELECT(nome_fantasia) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.cep; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cep) ON TABLE public.lojas TO anon;
GRANT SELECT(cep) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.uf; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(uf) ON TABLE public.lojas TO anon;
GRANT SELECT(uf) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.cidade; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cidade) ON TABLE public.lojas TO anon;
GRANT SELECT(cidade) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.bairro; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(bairro) ON TABLE public.lojas TO anon;
GRANT SELECT(bairro) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.logradouro; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(logradouro) ON TABLE public.lojas TO anon;
GRANT SELECT(logradouro) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.numero; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(numero) ON TABLE public.lojas TO anon;
GRANT SELECT(numero) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.ativo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ativo) ON TABLE public.lojas TO anon;
GRANT SELECT(ativo) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.local_estoque_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(local_estoque_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(local_estoque_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.local_estoque_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(local_estoque_status) ON TABLE public.lojas TO anon;
GRANT SELECT(local_estoque_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.produto_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(produto_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(produto_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.produto_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(produto_status) ON TABLE public.lojas TO anon;
GRANT SELECT(produto_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.posicao_estoque_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(posicao_estoque_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(posicao_estoque_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.posicao_estoque_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(posicao_estoque_status) ON TABLE public.lojas TO anon;
GRANT SELECT(posicao_estoque_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.nota_fiscal_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(nota_fiscal_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(nota_fiscal_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.nota_fiscal_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(nota_fiscal_status) ON TABLE public.lojas TO anon;
GRANT SELECT(nota_fiscal_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.ordem_producao_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ordem_producao_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(ordem_producao_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.ordem_producao_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ordem_producao_status) ON TABLE public.lojas TO anon;
GRANT SELECT(ordem_producao_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.lojas TO anon;
GRANT SELECT(created_at) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.lojas TO anon;
GRANT SELECT(updated_at) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.razao_social; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(razao_social) ON TABLE public.lojas TO anon;
GRANT SELECT(razao_social) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.inscricao_estadual; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(inscricao_estadual) ON TABLE public.lojas TO anon;
GRANT SELECT(inscricao_estadual) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.inscricao_municipal; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(inscricao_municipal) ON TABLE public.lojas TO anon;
GRANT SELECT(inscricao_municipal) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.cnae; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cnae) ON TABLE public.lojas TO anon;
GRANT SELECT(cnae) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.cnae_municipal; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cnae_municipal) ON TABLE public.lojas TO anon;
GRANT SELECT(cnae_municipal) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.regime_tributario; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(regime_tributario) ON TABLE public.lojas TO anon;
GRANT SELECT(regime_tributario) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.optante_simples_nacional; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(optante_simples_nacional) ON TABLE public.lojas TO anon;
GRANT SELECT(optante_simples_nacional) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.codigo_empresa; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(codigo_empresa) ON TABLE public.lojas TO anon;
GRANT SELECT(codigo_empresa) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.complemento; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(complemento) ON TABLE public.lojas TO anon;
GRANT SELECT(complemento) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(email) ON TABLE public.lojas TO anon;
GRANT SELECT(email) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.website; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(website) ON TABLE public.lojas TO anon;
GRANT SELECT(website) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.telefone1; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(telefone1) ON TABLE public.lojas TO anon;
GRANT SELECT(telefone1) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.telefone2; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(telefone2) ON TABLE public.lojas TO anon;
GRANT SELECT(telefone2) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.sped_nome_contador; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(sped_nome_contador) ON TABLE public.lojas TO anon;
GRANT SELECT(sped_nome_contador) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.sped_cpf_contador; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(sped_cpf_contador) ON TABLE public.lojas TO anon;
GRANT SELECT(sped_cpf_contador) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.sped_email_contador; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(sped_email_contador) ON TABLE public.lojas TO anon;
GRANT SELECT(sped_email_contador) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.empresa_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(empresa_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(empresa_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.empresa_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(empresa_status) ON TABLE public.lojas TO anon;
GRANT SELECT(empresa_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.full_object_empresa; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(full_object_empresa) ON TABLE public.lojas TO anon;
GRANT SELECT(full_object_empresa) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.certificado_path; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(certificado_path) ON TABLE public.lojas TO anon;
GRANT SELECT(certificado_path) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.certificado_nome; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(certificado_nome) ON TABLE public.lojas TO anon;
GRANT SELECT(certificado_nome) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.certificado_validade; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(certificado_validade) ON TABLE public.lojas TO anon;
GRANT SELECT(certificado_validade) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.certificado_atualizado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(certificado_atualizado) ON TABLE public.lojas TO anon;
GRANT SELECT(certificado_atualizado) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.familia_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(familia_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(familia_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.familia_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(familia_status) ON TABLE public.lojas TO anon;
GRANT SELECT(familia_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.fornecedor_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(fornecedor_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(fornecedor_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.fornecedor_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(fornecedor_status) ON TABLE public.lojas TO anon;
GRANT SELECT(fornecedor_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.cliente_ultima_atualizacao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cliente_ultima_atualizacao) ON TABLE public.lojas TO anon;
GRANT SELECT(cliente_ultima_atualizacao) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.cliente_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cliente_status) ON TABLE public.lojas TO anon;
GRANT SELECT(cliente_status) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.meta_compras_pct; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(meta_compras_pct) ON TABLE public.lojas TO anon;
GRANT SELECT(meta_compras_pct) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.is_test; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(is_test) ON TABLE public.lojas TO anon;
GRANT SELECT(is_test) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.loja_origem_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(loja_origem_id) ON TABLE public.lojas TO anon;
GRANT SELECT(loja_origem_id) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.modo_estoque; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(modo_estoque) ON TABLE public.lojas TO anon;
GRANT SELECT(modo_estoque) ON TABLE public.lojas TO authenticated;


--
-- Name: COLUMN lojas.vendas_store_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(vendas_store_id) ON TABLE public.lojas TO authenticated;


--
-- Name: SEQUENCE lojas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.lojas_id_seq TO anon;
GRANT ALL ON SEQUENCE public.lojas_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.lojas_id_seq TO service_role;


--
-- Name: TABLE margem_import_meta; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.margem_import_meta TO anon;
GRANT ALL ON TABLE public.margem_import_meta TO authenticated;
GRANT ALL ON TABLE public.margem_import_meta TO service_role;


--
-- Name: TABLE margem_importada; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.margem_importada TO anon;
GRANT ALL ON TABLE public.margem_importada TO authenticated;
GRANT ALL ON TABLE public.margem_importada TO service_role;


--
-- Name: TABLE margem_snapshot_diario; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.margem_snapshot_diario TO postgres;
GRANT ALL ON TABLE public.margem_snapshot_diario TO anon;
GRANT ALL ON TABLE public.margem_snapshot_diario TO authenticated;
GRANT ALL ON TABLE public.margem_snapshot_diario TO service_role;


--
-- Name: TABLE metas_faturamento; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.metas_faturamento TO postgres;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.metas_faturamento TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.metas_faturamento TO authenticated;
GRANT ALL ON TABLE public.metas_faturamento TO service_role;


--
-- Name: TABLE metas_mensais; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.metas_mensais TO postgres;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.metas_mensais TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.metas_mensais TO authenticated;
GRANT ALL ON TABLE public.metas_mensais TO service_role;


--
-- Name: TABLE movimentacao_import_meta; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.movimentacao_import_meta TO anon;
GRANT ALL ON TABLE public.movimentacao_import_meta TO authenticated;
GRANT ALL ON TABLE public.movimentacao_import_meta TO service_role;


--
-- Name: TABLE movimentacao_importada; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.movimentacao_importada TO anon;
GRANT ALL ON TABLE public.movimentacao_importada TO authenticated;
GRANT ALL ON TABLE public.movimentacao_importada TO service_role;


--
-- Name: TABLE movimentacao_operacao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.movimentacao_operacao TO anon;
GRANT ALL ON TABLE public.movimentacao_operacao TO authenticated;
GRANT ALL ON TABLE public.movimentacao_operacao TO service_role;


--
-- Name: TABLE movimentacao_operacao_meta; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.movimentacao_operacao_meta TO anon;
GRANT ALL ON TABLE public.movimentacao_operacao_meta TO authenticated;
GRANT ALL ON TABLE public.movimentacao_operacao_meta TO service_role;


--
-- Name: TABLE movimentos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.movimentos TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.movimentos TO authenticated;
GRANT ALL ON TABLE public.movimentos TO service_role;


--
-- Name: TABLE movimentos_historico; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.movimentos_historico TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.movimentos_historico TO authenticated;
GRANT ALL ON TABLE public.movimentos_historico TO service_role;


--
-- Name: SEQUENCE movimentos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.movimentos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.movimentos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.movimentos_id_seq TO service_role;


--
-- Name: TABLE movimentos_locais; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.movimentos_locais TO postgres;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.movimentos_locais TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.movimentos_locais TO authenticated;
GRANT ALL ON TABLE public.movimentos_locais TO service_role;


--
-- Name: SEQUENCE movimentos_locais_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.movimentos_locais_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.movimentos_locais_id_seq TO anon;
GRANT ALL ON SEQUENCE public.movimentos_locais_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.movimentos_locais_id_seq TO service_role;


--
-- Name: TABLE nota_fiscal_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.nota_fiscal_items TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.nota_fiscal_items TO authenticated;
GRANT ALL ON TABLE public.nota_fiscal_items TO service_role;


--
-- Name: SEQUENCE nota_fiscal_items_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.nota_fiscal_items_id_seq TO anon;
GRANT ALL ON SEQUENCE public.nota_fiscal_items_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.nota_fiscal_items_id_seq TO service_role;


--
-- Name: TABLE notas_fiscais; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.notas_fiscais TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.notas_fiscais TO authenticated;
GRANT ALL ON TABLE public.notas_fiscais TO service_role;


--
-- Name: SEQUENCE notas_fiscais_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.notas_fiscais_id_seq TO anon;
GRANT ALL ON SEQUENCE public.notas_fiscais_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.notas_fiscais_id_seq TO service_role;


--
-- Name: TABLE op_historico; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.op_historico TO postgres;
GRANT ALL ON TABLE public.op_historico TO service_role;
GRANT SELECT ON TABLE public.op_historico TO authenticated;


--
-- Name: SEQUENCE op_historico_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.op_historico_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.op_historico_id_seq TO anon;
GRANT ALL ON SEQUENCE public.op_historico_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.op_historico_id_seq TO service_role;


--
-- Name: TABLE op_numeracao; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.op_numeracao TO postgres;
GRANT ALL ON TABLE public.op_numeracao TO service_role;


--
-- Name: TABLE op_qtde_planejada; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.op_qtde_planejada TO postgres;
GRANT ALL ON TABLE public.op_qtde_planejada TO anon;
GRANT ALL ON TABLE public.op_qtde_planejada TO authenticated;
GRANT ALL ON TABLE public.op_qtde_planejada TO service_role;


--
-- Name: TABLE ordens_producao; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ordens_producao TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ordens_producao TO authenticated;
GRANT ALL ON TABLE public.ordens_producao TO service_role;


--
-- Name: SEQUENCE ordens_producao_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ordens_producao_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ordens_producao_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ordens_producao_id_seq TO service_role;


--
-- Name: TABLE ordens_producao_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ordens_producao_proprio TO postgres;
GRANT ALL ON TABLE public.ordens_producao_proprio TO service_role;
GRANT SELECT ON TABLE public.ordens_producao_proprio TO authenticated;


--
-- Name: SEQUENCE ordens_producao_proprio_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ordens_producao_proprio_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.ordens_producao_proprio_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ordens_producao_proprio_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ordens_producao_proprio_id_seq TO service_role;


--
-- Name: TABLE ordens_producao_proprio_itens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ordens_producao_proprio_itens TO postgres;
GRANT ALL ON TABLE public.ordens_producao_proprio_itens TO service_role;
GRANT SELECT ON TABLE public.ordens_producao_proprio_itens TO authenticated;


--
-- Name: SEQUENCE ordens_producao_proprio_itens_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ordens_producao_proprio_itens_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.ordens_producao_proprio_itens_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ordens_producao_proprio_itens_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ordens_producao_proprio_itens_id_seq TO service_role;


--
-- Name: TABLE ordens_producao_teste; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ordens_producao_teste TO postgres;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ordens_producao_teste TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.ordens_producao_teste TO authenticated;
GRANT ALL ON TABLE public.ordens_producao_teste TO service_role;


--
-- Name: SEQUENCE ordens_producao_teste_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.ordens_producao_teste_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.ordens_producao_teste_id_seq TO anon;
GRANT ALL ON SEQUENCE public.ordens_producao_teste_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.ordens_producao_teste_id_seq TO service_role;


--
-- Name: SEQUENCE outbox_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.outbox_id_seq TO anon;
GRANT ALL ON SEQUENCE public.outbox_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.outbox_id_seq TO service_role;


--
-- Name: TABLE outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.outbox TO postgres;
GRANT ALL ON TABLE public.outbox TO anon;
GRANT ALL ON TABLE public.outbox TO authenticated;
GRANT ALL ON TABLE public.outbox TO service_role;


--
-- Name: TABLE permissao_user; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.permissao_user TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.permissao_user TO authenticated;
GRANT ALL ON TABLE public.permissao_user TO service_role;


--
-- Name: SEQUENCE permissao_user_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.permissao_user_id_seq TO anon;
GRANT ALL ON SEQUENCE public.permissao_user_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.permissao_user_id_seq TO service_role;


--
-- Name: TABLE permissoes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.permissoes TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.permissoes TO authenticated;
GRANT ALL ON TABLE public.permissoes TO service_role;


--
-- Name: SEQUENCE permissoes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.permissoes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.permissoes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.permissoes_id_seq TO service_role;


--
-- Name: TABLE posicao_estoques; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.posicao_estoques TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.posicao_estoques TO authenticated;
GRANT ALL ON TABLE public.posicao_estoques TO service_role;


--
-- Name: SEQUENCE posicao_estoques_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.posicao_estoques_id_seq TO anon;
GRANT ALL ON SEQUENCE public.posicao_estoques_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.posicao_estoques_id_seq TO service_role;


--
-- Name: TABLE previsao_venda; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.previsao_venda TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.previsao_venda TO authenticated;
GRANT ALL ON TABLE public.previsao_venda TO service_role;


--
-- Name: SEQUENCE previsao_venda_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.previsao_venda_id_seq TO anon;
GRANT ALL ON SEQUENCE public.previsao_venda_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.previsao_venda_id_seq TO service_role;


--
-- Name: TABLE produto_preco_recente; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.produto_preco_recente TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.produto_preco_recente TO authenticated;
GRANT ALL ON TABLE public.produto_preco_recente TO service_role;


--
-- Name: TABLE produto_sem_estrutura; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.produto_sem_estrutura TO postgres;
GRANT ALL ON TABLE public.produto_sem_estrutura TO service_role;


--
-- Name: TABLE produto_substituicoes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.produto_substituicoes TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.produto_substituicoes TO authenticated;
GRANT ALL ON TABLE public.produto_substituicoes TO service_role;


--
-- Name: SEQUENCE produto_substituicoes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.produto_substituicoes_id_seq TO anon;
GRANT ALL ON SEQUENCE public.produto_substituicoes_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.produto_substituicoes_id_seq TO service_role;


--
-- Name: SEQUENCE produtos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.produtos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.produtos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.produtos_id_seq TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.profiles TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE sefaz_documentos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sefaz_documentos TO postgres;
GRANT ALL ON TABLE public.sefaz_documentos TO service_role;
GRANT SELECT ON TABLE public.sefaz_documentos TO authenticated;


--
-- Name: SEQUENCE sefaz_documentos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.sefaz_documentos_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.sefaz_documentos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.sefaz_documentos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sefaz_documentos_id_seq TO service_role;


--
-- Name: TABLE sefaz_nsu; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sefaz_nsu TO postgres;
GRANT ALL ON TABLE public.sefaz_nsu TO service_role;
GRANT SELECT ON TABLE public.sefaz_nsu TO authenticated;


--
-- Name: SEQUENCE seq_cupom_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.seq_cupom_proprio TO postgres;
GRANT ALL ON SEQUENCE public.seq_cupom_proprio TO anon;
GRANT ALL ON SEQUENCE public.seq_cupom_proprio TO authenticated;
GRANT ALL ON SEQUENCE public.seq_cupom_proprio TO service_role;


--
-- Name: SEQUENCE seq_id_local_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.seq_id_local_proprio TO postgres;
GRANT ALL ON SEQUENCE public.seq_id_local_proprio TO anon;
GRANT ALL ON SEQUENCE public.seq_id_local_proprio TO authenticated;
GRANT ALL ON SEQUENCE public.seq_id_local_proprio TO service_role;


--
-- Name: SEQUENCE seq_id_produto_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.seq_id_produto_proprio TO postgres;
GRANT ALL ON SEQUENCE public.seq_id_produto_proprio TO anon;
GRANT ALL ON SEQUENCE public.seq_id_produto_proprio TO authenticated;
GRANT ALL ON SEQUENCE public.seq_id_produto_proprio TO service_role;


--
-- Name: SEQUENCE seq_nf_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.seq_nf_proprio TO postgres;
GRANT ALL ON SEQUENCE public.seq_nf_proprio TO anon;
GRANT ALL ON SEQUENCE public.seq_nf_proprio TO authenticated;
GRANT ALL ON SEQUENCE public.seq_nf_proprio TO service_role;


--
-- Name: SEQUENCE seq_op_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.seq_op_proprio TO postgres;
GRANT ALL ON SEQUENCE public.seq_op_proprio TO anon;
GRANT ALL ON SEQUENCE public.seq_op_proprio TO authenticated;
GRANT ALL ON SEQUENCE public.seq_op_proprio TO service_role;


--
-- Name: TABLE sugestao_compra; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sugestao_compra TO postgres;
GRANT ALL ON TABLE public.sugestao_compra TO anon;
GRANT ALL ON TABLE public.sugestao_compra TO authenticated;
GRANT ALL ON TABLE public.sugestao_compra TO service_role;


--
-- Name: TABLE sync_divergencias; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sync_divergencias TO postgres;
GRANT ALL ON TABLE public.sync_divergencias TO service_role;
GRANT SELECT ON TABLE public.sync_divergencias TO authenticated;


--
-- Name: SEQUENCE sync_divergencias_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.sync_divergencias_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.sync_divergencias_id_seq TO anon;
GRANT ALL ON SEQUENCE public.sync_divergencias_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sync_divergencias_id_seq TO service_role;


--
-- Name: TABLE sync_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sync_outbox TO postgres;
GRANT ALL ON TABLE public.sync_outbox TO service_role;
GRANT SELECT ON TABLE public.sync_outbox TO authenticated;


--
-- Name: SEQUENCE sync_outbox_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.sync_outbox_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.sync_outbox_id_seq TO anon;
GRANT ALL ON SEQUENCE public.sync_outbox_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sync_outbox_id_seq TO service_role;


--
-- Name: TABLE transferencias; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.transferencias TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.transferencias TO authenticated;
GRANT ALL ON TABLE public.transferencias TO service_role;


--
-- Name: SEQUENCE transferencias_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.transferencias_id_seq TO anon;
GRANT ALL ON SEQUENCE public.transferencias_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.transferencias_id_seq TO service_role;


--
-- Name: TABLE vendas_integracao_fila; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendas_integracao_fila TO postgres;
GRANT ALL ON TABLE public.vendas_integracao_fila TO service_role;


--
-- Name: SEQUENCE vendas_integracao_fila_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.vendas_integracao_fila_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.vendas_integracao_fila_id_seq TO service_role;


--
-- Name: TABLE vendas_proprio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendas_proprio TO postgres;
GRANT ALL ON TABLE public.vendas_proprio TO service_role;
GRANT SELECT ON TABLE public.vendas_proprio TO authenticated;


--
-- Name: TABLE vendas_proprio_cmv; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendas_proprio_cmv TO postgres;
GRANT ALL ON TABLE public.vendas_proprio_cmv TO anon;
GRANT ALL ON TABLE public.vendas_proprio_cmv TO authenticated;
GRANT ALL ON TABLE public.vendas_proprio_cmv TO service_role;


--
-- Name: SEQUENCE vendas_proprio_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.vendas_proprio_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.vendas_proprio_id_seq TO anon;
GRANT ALL ON SEQUENCE public.vendas_proprio_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.vendas_proprio_id_seq TO service_role;


--
-- Name: TABLE vendas_proprio_itens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendas_proprio_itens TO postgres;
GRANT ALL ON TABLE public.vendas_proprio_itens TO service_role;
GRANT SELECT ON TABLE public.vendas_proprio_itens TO authenticated;


--
-- Name: SEQUENCE vendas_proprio_itens_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.vendas_proprio_itens_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.vendas_proprio_itens_id_seq TO anon;
GRANT ALL ON SEQUENCE public.vendas_proprio_itens_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.vendas_proprio_itens_id_seq TO service_role;


--
-- Name: TABLE vendas_proprio_pagamentos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendas_proprio_pagamentos TO postgres;
GRANT ALL ON TABLE public.vendas_proprio_pagamentos TO service_role;
GRANT SELECT ON TABLE public.vendas_proprio_pagamentos TO authenticated;


--
-- Name: SEQUENCE vendas_proprio_pagamentos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.vendas_proprio_pagamentos_id_seq TO postgres;
GRANT ALL ON SEQUENCE public.vendas_proprio_pagamentos_id_seq TO anon;
GRANT ALL ON SEQUENCE public.vendas_proprio_pagamentos_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.vendas_proprio_pagamentos_id_seq TO service_role;


--
-- Name: TABLE webhooks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.webhooks TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.webhooks TO authenticated;
GRANT ALL ON TABLE public.webhooks TO service_role;


--
-- Name: SEQUENCE webhooks_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.webhooks_id_seq TO anon;
GRANT ALL ON SEQUENCE public.webhooks_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.webhooks_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


