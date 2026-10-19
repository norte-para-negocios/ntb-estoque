-- 223 — Fase G [K10/O6]: importação de produtos e fornecedores por planilha, SÓ loja de estoque próprio (no modo Omie o
-- cadastro é do Omie). SÓ ADITIVA: uma tabela nova, uma função e duas permissões.
-- Aplicar (manual, com backup e OK do dono): docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 223_importacao_planilha.sql
-- Depois: NOTIFY pgrst (no fim); desktop/scripts/gerar-schema.sh + versão nova do app desktop.
-- Teste: scripts/testes-sql/223_importacao_planilha.sql.
--
-- Fluxo: o servidor lê a planilha, valida linha a linha (lib/importacao/planilha-puro.ts) e grava a PRÉVIA aqui
-- (status 'previa', linhas com acao novo|atualizar|sem_mudanca|erro). Confirmar = importacao_aplicar(id): tudo numa
-- transação, só as linhas novo/atualizar; a 2ª chamada devolve o mesmo resultado (nada duplica). Na hora de aplicar a
-- chave é conferida de novo (produto: código → EAN; fornecedor: CNPJ/CPF): se alguém criou o mesmo produto entre a
-- prévia e a confirmação, ele é atualizado em vez de duplicado. Prévia com mais de 1 dia não aplica (o cadastro pode ter mudado).
-- Célula vazia nunca apaga dado (coalesce). CEST/origem vão para produtos.full_object.extras (mesmo lugar da tela).

begin;

insert into permissoes (nome) values ('Produtos - Importar planilha'), ('Fornecedores - Importar planilha') on conflict (nome) do nothing;

create table if not exists public.importacoes_planilha (
  id                 bigint generated always as identity primary key,
  loja_id            bigint not null references public.lojas(id),
  tipo               text not null check (tipo in ('produtos', 'fornecedores')),
  nome_arquivo       text,
  hash               text not null,
  linhas             jsonb not null check (jsonb_typeof(linhas) = 'array' and jsonb_array_length(linhas) <= 2000),
  resumo             jsonb not null default '{}'::jsonb,
  status             text not null default 'previa' check (status in ('previa', 'aplicada')),
  resultado          jsonb,
  criado_por         uuid,
  criado_por_nome    text,
  created_at         timestamptz not null default now(),
  aplicada_em        timestamptz,
  aplicada_por       uuid,
  aplicada_por_nome  text
);
create index if not exists importacoes_planilha_loja on public.importacoes_planilha (loja_id, tipo, id desc);
create index if not exists importacoes_planilha_hash on public.importacoes_planilha (loja_id, tipo, hash) where status = 'aplicada';

alter table public.importacoes_planilha enable row level security;
drop policy if exists importacoes_planilha_select_por_loja on public.importacoes_planilha;
create policy importacoes_planilha_select_por_loja on public.importacoes_planilha for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.importacoes_planilha from public, anon, authenticated;
grant select on public.importacoes_planilha to authenticated;
grant select, insert, update on public.importacoes_planilha to service_role;

create or replace function public.importacao_aplicar(p_id bigint, p_loja bigint, p_user uuid default null, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v importacoes_planilha%rowtype; l jsonb; d jsonb; v_alvo bigint; v_criados int := 0; v_atualizados int := 0; v_res jsonb;
  v_extras jsonb; v_cp bigint; v_cod text; v_doc text;
begin
  select * into v from importacoes_planilha where id = p_id and loja_id = p_loja for update;
  if not found then raise exception 'Importação não encontrada nesta loja' using errcode = '22023'; end if;
  if v.status = 'aplicada' then return coalesce(v.resultado, '{}'::jsonb) || jsonb_build_object('duplicado', true); end if;
  if v.created_at < now() - interval '1 day' then raise exception 'Prévia vencida: envie a planilha de novo' using errcode = '22023'; end if;
  if (select modo_estoque from lojas where id = p_loja) is distinct from 'proprio' then
    raise exception 'Importação por planilha só existe no estoque próprio (no modo Omie o cadastro é do Omie)' using errcode = '22023';
  end if;

  for l in select value from jsonb_array_elements(v.linhas) where value->>'acao' in ('novo', 'atualizar') loop
    d := coalesce(l->'dados', '{}'::jsonb);
    begin
      if v.tipo = 'produtos' then
        v_alvo := nullif(l->>'alvo', '')::bigint;
        if v_alvo is not null and not exists (select 1 from produtos where loja_id = p_loja and codigo_produto = v_alvo) then v_alvo := null; end if;
        if v_alvo is null and nullif(btrim(d->>'codigo'), '') is not null then
          select codigo_produto into v_alvo from produtos where loja_id = p_loja and lower(btrim(codigo)) = lower(btrim(d->>'codigo')) limit 1;
        end if;
        if v_alvo is null and nullif(d->>'ean', '') is not null then
          select codigo_produto into v_alvo from produtos where loja_id = p_loja and ean = d->>'ean' limit 1;
        end if;
        v_extras := jsonb_strip_nulls(jsonb_build_object('cest', d->>'cest', 'origem', d->>'origem'));
        if v_alvo is null then
          if nullif(btrim(d->>'descricao'), '') is null or nullif(btrim(d->>'unidade'), '') is null then
            raise exception 'produto novo sem descrição ou unidade' using errcode = '22023';
          end if;
          v_cp := novo_id_produto_proprio();
          v_cod := coalesce(nullif(btrim(d->>'codigo'), ''), proximo_codigo_produto(p_loja, coalesce(d->>'tipo_item', '04')));
          insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, ean, valor_unitario, estoque_minimo, pdv, tipo_item,
                                codigo_familia, descricao_familia, inativo, validade_dias, full_object, updated_at)
          values (p_loja, v_cp, v_cod, btrim(d->>'descricao'), btrim(d->>'unidade'), d->>'ncm', d->>'ean', coalesce((d->>'valor_unitario')::numeric, 0),
                  (d->>'estoque_minimo')::numeric, coalesce((d->>'pdv')::boolean, false), coalesce(d->>'tipo_item', '04'),
                  (d->>'codigo_familia')::bigint, d->>'descricao_familia', coalesce((d->>'inativo')::boolean, false), (d->>'validade_dias')::int,
                  jsonb_build_object('extras', v_extras), now());
          v_criados := v_criados + 1;
        else
          update produtos set
            descricao = coalesce(nullif(btrim(d->>'descricao'), ''), descricao), unidade = coalesce(nullif(btrim(d->>'unidade'), ''), unidade),
            ncm = coalesce(d->>'ncm', ncm), ean = coalesce(d->>'ean', ean), valor_unitario = coalesce((d->>'valor_unitario')::numeric, valor_unitario),
            estoque_minimo = coalesce((d->>'estoque_minimo')::numeric, estoque_minimo), pdv = coalesce((d->>'pdv')::boolean, pdv),
            tipo_item = coalesce(d->>'tipo_item', tipo_item), codigo_familia = coalesce((d->>'codigo_familia')::bigint, codigo_familia),
            descricao_familia = coalesce(d->>'descricao_familia', descricao_familia), inativo = coalesce((d->>'inativo')::boolean, inativo),
            validade_dias = coalesce((d->>'validade_dias')::int, validade_dias),
            full_object = case when v_extras = '{}'::jsonb then full_object
                               else jsonb_set(coalesce(full_object, '{}'::jsonb), '{extras}', coalesce(full_object->'extras', '{}'::jsonb) || v_extras) end,
            updated_at = now()
           where loja_id = p_loja and codigo_produto = v_alvo;
          v_atualizados := v_atualizados + 1;
        end if;
      else
        v_alvo := nullif(l->>'alvo', '')::bigint;
        if v_alvo is not null and not exists (select 1 from fornecedores where loja_id = p_loja and id = v_alvo) then v_alvo := null; end if;
        v_doc := nullif(regexp_replace(coalesce(d->>'cnpj_cpf', ''), '\D', '', 'g'), '');
        if v_alvo is null and v_doc is not null then
          select id into v_alvo from fornecedores where loja_id = p_loja and regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g') = v_doc order by id limit 1;
        end if;
        if v_alvo is null then
          if nullif(btrim(d->>'razao_social'), '') is null then raise exception 'fornecedor novo sem razão social' using errcode = '22023'; end if;
          insert into fornecedores (loja_id, razao_social, nome_fantasia, cnpj_cpf, pessoa_fisica, inscricao_estadual, email, telefone, cep, uf, cidade,
                                    bairro, logradouro, numero, complemento, inativo, origem)
          values (p_loja, btrim(d->>'razao_social'), d->>'nome_fantasia', v_doc, coalesce((d->>'pessoa_fisica')::boolean, false), d->>'inscricao_estadual',
                  d->>'email', d->>'telefone', d->>'cep', d->>'uf', d->>'cidade', d->>'bairro', d->>'logradouro', d->>'numero', d->>'complemento', false, 'planilha');
          v_criados := v_criados + 1;
        else
          update fornecedores set
            razao_social = coalesce(nullif(btrim(d->>'razao_social'), ''), razao_social), nome_fantasia = coalesce(d->>'nome_fantasia', nome_fantasia),
            inscricao_estadual = coalesce(d->>'inscricao_estadual', inscricao_estadual), email = coalesce(d->>'email', email),
            telefone = coalesce(d->>'telefone', telefone), cep = coalesce(d->>'cep', cep), uf = coalesce(d->>'uf', uf), cidade = coalesce(d->>'cidade', cidade),
            bairro = coalesce(d->>'bairro', bairro), logradouro = coalesce(d->>'logradouro', logradouro), numero = coalesce(d->>'numero', numero),
            complemento = coalesce(d->>'complemento', complemento), updated_at = now()
           where loja_id = p_loja and id = v_alvo;
          v_atualizados := v_atualizados + 1;
        end if;
      end if;
    exception when others then
      raise exception 'Linha % da planilha: %', l->>'n', sqlerrm using errcode = '22023';
    end;
  end loop;

  v_res := jsonb_build_object('criados', v_criados, 'atualizados', v_atualizados);
  update importacoes_planilha set status = 'aplicada', resultado = v_res, aplicada_em = now(), aplicada_por = p_user, aplicada_por_nome = p_nome
   where id = p_id;
  return v_res;
end $$;
revoke all on function public.importacao_aplicar(bigint, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.importacao_aplicar(bigint, bigint, uuid, text) to service_role;

commit;

notify pgrst, 'reload schema';

-- Reverter: drop function public.importacao_aplicar(bigint, bigint, uuid, text); drop table public.importacoes_planilha;
-- delete from permissoes where nome in ('Produtos - Importar planilha', 'Fornecedores - Importar planilha').
