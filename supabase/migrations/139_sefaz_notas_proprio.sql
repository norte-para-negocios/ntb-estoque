-- 139 — Notas de entrada puxadas da SEFAZ, em loja de estoque próprio (06/10/2026)
-- Aditiva. As notas entram nas MESMAS tabelas do Omie (notas_fiscais / nota_fiscal_items, origem = 'sefaz'), então a tela
-- 'Notas Fiscais' e todos os relatórios (compras, auditoria fiscal, indicadores) funcionam sem mudança.
-- A conferência com o cadastro e a entrada no ledger usam compras_proprio / lancar_compra (migration 135).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 139_sefaz_notas_proprio.sql

-- 1) Controle de NSU por loja (nunca consultar em loop: bloqueado_ate guarda a espera de 1 h) ----------------------------------
create table if not exists public.sefaz_nsu (
  loja_id         bigint primary key references public.lojas(id),
  cnpj            text,
  ambiente        smallint not null default 1 check (ambiente in (1, 2)),   -- 1 = produção (consulta é só leitura), 2 = homologação
  ult_nsu         text not null default '0',
  max_nsu         text,
  bloqueado_ate   timestamptz,
  ultima_consulta timestamptz,
  ultimo_cstat    text,
  ultimo_motivo   text,
  ultimo_erro     text,
  auto_lancar     boolean not null default true,    -- lança a entrada sozinho quando TODOS os itens casam por de-para/EAN
  auto_ciencia    boolean not null default true,    -- manifesta ciência da operação (210210) para liberar o XML completo
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2) Documentos recebidos (guarda o XML cru: auditoria e reprocessamento) -------------------------------------------------------
create table if not exists public.sefaz_documentos (
  id               bigint generated always as identity primary key,
  loja_id          bigint not null references public.lojas(id),
  nsu              text not null,
  schema           text,
  tipo             text not null default 'outro' check (tipo in ('resNFe', 'procNFe', 'resEvento', 'procEventoNFe', 'outro')),
  chave            text,
  completo         boolean not null default false,
  xml              text,
  nota_fiscal_id   bigint,
  processado       boolean not null default false,
  ignorado         text,                              -- motivo, quando não vira nota (ex.: nota emitida pela própria loja)
  erro             text,
  ciencia_em       timestamptz,
  ciencia_cstat    text,
  recebido_em      timestamptz not null default now(),
  unique (loja_id, nsu)
);
create index if not exists sefaz_documentos_chave on public.sefaz_documentos (loja_id, chave);
create index if not exists sefaz_documentos_pendentes on public.sefaz_documentos (loja_id) where not processado;

-- 3) compras_proprio passa a aceitar a origem 'sefaz' e a apontar para a nota; itens guardam como casaram -----------------------
alter table public.compras_proprio drop constraint if exists compras_proprio_origem_check;
alter table public.compras_proprio add constraint compras_proprio_origem_check check (origem in ('manual', 'xml', 'sefaz'));
alter table public.compras_proprio add column if not exists nota_fiscal_id bigint;
create index if not exists compras_proprio_nota on public.compras_proprio (loja_id, nota_fiscal_id);

alter table public.compras_proprio_itens add column if not exists match_origem text;
alter table public.compras_proprio_itens add column if not exists match_score numeric(5,4);
alter table public.compras_proprio_itens add column if not exists sugestao_codigo_produto bigint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'compras_proprio_itens_match_origem_chk') then
    alter table public.compras_proprio_itens add constraint compras_proprio_itens_match_origem_chk
      check (match_origem is null or match_origem in ('depara', 'ean', 'descricao', 'manual'));
  end if;
end $$;

-- 4) RLS e grants ---------------------------------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['sefaz_nsu', 'sefaz_documentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin())', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 5) Identificador de recebimento próprio (n_id_receb é texto numérico no Omie; aqui vem de uma sequência longe dos ids do Omie) --
create sequence if not exists public.seq_nf_proprio start 8000000000001;

-- 6) Grava a nota no formato do Omie. Idempotente pela chave de acesso: o resumo (resNFe) vira nota completa (procNFe) no mesmo registro.
-- p_cab:   {chave, numero, serie, modelo, emissao, valor, fornecedor_nome, fornecedor_cnpj, ie, natureza, ambiente, full_object}
-- p_itens: [{seq, c_prod, descricao, ncm, ean, cfop, qtde, unidade, preco_unit, desconto, frete, total, n_id_produto, full_object}]
create or replace function public.gravar_nota_sefaz(p_loja bigint, p_cab jsonb, p_itens jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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

-- 7) Compra para conferência: cria/atualiza a compra e as sugestões de produto SEM lançar nada no ledger ----------------------
-- p_compra: {loja_id, chave_acesso, nota_fiscal_id, numero, serie, fornecedor_cnpj, fornecedor_nome, emissao, valor_frete,
--            valor_desconto, itens:[{linha, c_prod, ean, descricao, ncm, cfop, unidade_compra, quantidade, valor_unitario, valor_total,
--            desconto, icms_valor, fator, codigo_produto, match_origem, match_score, sugestao_codigo_produto}]}
create or replace function public.registrar_compra_sefaz(p_compra jsonb, p_local bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
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

-- 8) Vincula um item da nota a um produto (aprende o de-para) --------------------------------------------------------------------
create or replace function public.vincular_item_compra(p_loja bigint, p_compra_item bigint, p_produto bigint, p_fator numeric default 1, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
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

-- 9) Deriva a situação da nota (etapa 60 = lançada no estoque, 40 = pendente) a partir da compra -----------------------------------
create or replace function public.sincronizar_situacao_nota(p_loja bigint, p_nota bigint) returns text
language plpgsql security definer set search_path = public as $$
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

-- 10) Evento de cancelamento recebido da SEFAZ: marca a nota e, se ainda não entrou no estoque, cancela a compra -------------------
create or replace function public.sefaz_marcar_cancelada(p_loja bigint, p_chave text) returns jsonb
language plpgsql security definer set search_path = public as $$
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

do $$ declare f text; begin
  foreach f in array array[
    'gravar_nota_sefaz(bigint,jsonb,jsonb)', 'registrar_compra_sefaz(jsonb,bigint)',
    'vincular_item_compra(bigint,bigint,bigint,numeric,text)', 'sincronizar_situacao_nota(bigint,bigint)',
    'sefaz_marcar_cancelada(bigint,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
