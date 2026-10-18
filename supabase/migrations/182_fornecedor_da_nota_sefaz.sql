-- 182: o fornecedor da nota da SEFAZ/XML vira cadastro (Fase A, Task 14; matriz B1/J1). Até aqui gravar_nota_sefaz
-- gravava n_id_fornecedor = null, e as telas/relatórios que juntam nota × fornecedor (f.codigo_omie = nf.n_id_fornecedor)
-- perdiam essas notas (ranking "(sem nome)"). Só lojas de estoque próprio (gravar_nota_sefaz recusa as outras).
-- fornecedor_da_nota_sefaz: acha o fornecedor da loja pelo CNPJ/CPF (só dígitos) ou cria (origem 'sefaz'); quem não
-- tem codigo_omie recebe um da faixa própria (seq_fornecedor_proprio, a partir de 8000000000001, como seq_nf_proprio).
-- gravar_nota_sefaz = corpo de produção em 18/10/2026 (pg_get_functiondef) + n_id_fornecedor. Mesma assinatura.
-- A carga das notas antigas é um script à parte (scripts/backfill/182_fornecedor_notas_sefaz.sql): escreve em dado de
-- produção, roda só com OK.
-- Tudo numa transação: se algo falhar, nada fica pela metade (os drop/create de função não se aplicam sozinhos).

begin;

create sequence if not exists public.seq_fornecedor_proprio start 8000000000001;

create or replace function public.fornecedor_da_nota_sefaz(p_loja bigint, p_cnpj text, p_razao text, p_fantasia text, p_ie text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_doc text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'); f fornecedores%rowtype;
begin
  if length(v_doc) not in (11, 14) then return null; end if;
  perform pg_advisory_xact_lock(hashtext(p_loja::text || ':' || v_doc));
  select * into f from fornecedores
   where loja_id = p_loja and regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g') = v_doc
   order by id limit 1;
  if found then
    if f.codigo_omie is null then
      update fornecedores set codigo_omie = nextval('public.seq_fornecedor_proprio'), updated_at = now() where id = f.id returning * into f;
    end if;
    return f.codigo_omie;
  end if;
  insert into fornecedores (loja_id, codigo_omie, razao_social, nome_fantasia, cnpj_cpf, pessoa_fisica, inscricao_estadual, origem)
  values (p_loja, nextval('public.seq_fornecedor_proprio'), coalesce(nullif(btrim(p_razao), ''), v_doc), nullif(btrim(p_fantasia), ''),
          v_doc, length(v_doc) = 11, nullif(btrim(p_ie), ''), 'sefaz')
  returning * into f;
  return f.codigo_omie;
end $function$;

revoke all on function public.fornecedor_da_nota_sefaz(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fornecedor_da_nota_sefaz(bigint, text, text, text, text) to service_role;

create or replace function public.gravar_nota_sefaz(p_loja bigint, p_cab jsonb, p_itens jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modo text; v_chave text := nullif(btrim(coalesce(p_cab->>'chave', '')), '');
  n notas_fiscais%rowtype; v_idr text; v_criada boolean := false; v_nitens int := 0; it jsonb; v_fo jsonb := coalesce(p_cab->'full_object', '{}'::jsonb);
  v_forn bigint;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;

  if v_chave is not null then
    select * into n from notas_fiscais where loja_id = p_loja and c_chave_nfe = v_chave and deleted_at is null for update;
  end if;

  -- 182: o fornecedor da nota vira cadastro (n_id_fornecedor), para as telas e relatórios que juntam por fornecedor.
  v_forn := fornecedor_da_nota_sefaz(p_loja, p_cab->>'fornecedor_cnpj', p_cab->>'fornecedor_nome', p_cab->>'fornecedor_fantasia', p_cab->>'ie');

  if n.id is null then
    v_idr := nextval('public.seq_nf_proprio')::text;
    insert into notas_fiscais (loja_id, n_id_receb, n_id_fornecedor, c_pessoa_fisica, c_nome, c_razao_social, c_inscricao, c_cnpj_cpf, c_chave_nfe,
        c_etapa, c_numero_nfe, c_serie_nfe, c_modelo_nfe, d_emissao_nfe, n_valor_nfe, c_ambiente_nfe, c_natureza_operacao, full_object, origem)
    values (p_loja, v_idr, v_forn, case when length(regexp_replace(coalesce(p_cab->>'fornecedor_cnpj', ''), '\D', '', 'g')) = 11 then 'S' else 'N' end,
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
        n_id_fornecedor = coalesce(n_id_fornecedor, v_forn),
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
end $function$;

commit;

notify pgrst, 'reload schema';
