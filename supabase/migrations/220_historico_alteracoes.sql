-- 220 — Fase G [O3]: histórico de alterações campo a campo (quem, quando, campo, de → para).
-- SÓ ADITIVA: uma tabela nova, uma função de gatilho e gatilhos AFTER em produtos, fornecedores, compras_proprio(+itens),
-- pedidos_compra(+itens, só se a 200 já estiver aplicada) e ordens_producao. Nenhum dado existente muda.
-- Aplicar (manual, com backup e OK do dono): docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 220_historico_alteracoes.sql
-- Depois: NOTIFY pgrst (no fim do arquivo); desktop/scripts/gerar-schema.sh + versão nova do app desktop.
-- Teste: scripts/testes-sql/220_historico_alteracoes.sql (cópia local, nunca em produção).
--
-- Autor: auth.uid() (sessão do usuário) ou o cabeçalho x-ntb-autor que createServiceClient() manda nas escritas feitas
-- dentro de uma requisição com usuário logado (lib/supabase/server.ts). O cabeçalho SÓ vale quando o JWT é service_role:
-- um usuário comum não consegue se passar por outro mandando o cabeçalho direto ao PostgREST.
-- Sem autor (cron, sync do Omie, SEFAZ automática): origem 'sistema'. Por tabela (argumento 4 do gatilho):
--   'gravar'  = grava mesmo sem autor (cadastro: produto/fornecedor mudados no Omie aparecem como "Sistema");
--   'ignorar' = só grava mudança feita por alguém (ordens_producao: o sync regrava OPs o tempo todo).
-- O que é gravado: uma linha por campo rastreado que mudou (update); insert/delete com autor = uma linha por campo não
-- nulo (a tela junta "apagou e recriou igual" do pc_salvar); insert/delete sem autor = uma linha só (campo nulo).
-- Update sem mudança em campo rastreado não grava nada (o sync que regrava a mesma coisa não enche a tabela).
-- O cálculo roda dentro de um bloco de exceção SEM escrita (erro vira WARNING e a escrita principal segue); o insert é um
-- comando só, fora do bloco (não abre subtransação com xid por linha).
-- Argumentos do gatilho: [entidade, coluna do id da entidade, coluna da linha ('' na tabela principal), gravar|ignorar,
-- campos...]; campo 'a.b.*' = cada chave do objeto jsonb a->b (ex.: full_object.extras.* = CEST, origem, marca...).

-- Retenção (revisão I2): 400 dias. historico_podar(400, 5000) apaga em lotes; o cron /api/cron/podar-historico roda 1x por
-- dia (scripts/sync-cron.sh) e chama até 20 lotes. Só o servidor (service role) chama.
--
-- Gatilhos novos pegam lock em produtos/ordens_producao/...: se algum sync estiver segurando a tabela, desiste em 5 s em vez
-- de enfileirar as escritas do app atrás do ALTER (é só rodar de novo).
set lock_timeout = '5s';

begin;

create table if not exists public.historico_alteracoes (
  id          bigint generated always as identity primary key,
  loja_id     bigint not null,
  entidade    text not null,               -- produto | fornecedor | nota_entrada | pedido_compra | op
  entidade_id text not null,               -- produto = codigo_produto; demais = id da tabela principal
  tabela      text not null,
  linha       text,                        -- item (linha da nota/pedido); nulo na tabela principal
  operacao    text not null check (operacao in ('insert', 'update', 'delete')),
  campo       text,
  valor_de    text,
  valor_para  text,
  autor_id    uuid,
  autor_nome  text,
  origem      text not null check (origem in ('app', 'sistema')),
  txid        bigint not null,
  created_at  timestamptz not null default now()
);
create index if not exists historico_alteracoes_registro on public.historico_alteracoes (loja_id, entidade, entidade_id, id desc);
create index if not exists historico_alteracoes_criado on public.historico_alteracoes (created_at);

alter table public.historico_alteracoes enable row level security;
drop policy if exists historico_alteracoes_select_por_loja on public.historico_alteracoes;
create policy historico_alteracoes_select_por_loja on public.historico_alteracoes for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.historico_alteracoes from public, anon, authenticated;
grant select on public.historico_alteracoes to authenticated;
-- append-only: nem o service role apaga ou altera (só o gatilho insere, como dono)
revoke all on public.historico_alteracoes from service_role;
grant select on public.historico_alteracoes to service_role;

create or replace function public.historico_registrar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_entidade  text := tg_argv[0];
  v_col_id    text := tg_argv[1];
  v_col_linha text := nullif(tg_argv[2], '');
  v_sem_autor text := tg_argv[3];
  v_op        text := lower(tg_op);
  v_autor     uuid;
  v_nome      text;
  v_txt       text;
  v_novo      jsonb;
  v_velho     jsonb;
  v_ref       jsonb;
  v_rows      jsonb := '[]'::jsonb;
  v_campo     text;
  v_partes    text[];
  v_de        text;
  v_para      text;
  k           text;
  i           int;
  v_por_campo boolean;
begin
  begin
    v_autor := auth.uid();
    if v_autor is null then
      v_txt := nullif(current_setting('request.jwt.claims', true), '');
      if v_txt is not null and (v_txt::jsonb ->> 'role') = 'service_role' then
        v_txt := nullif(current_setting('request.headers', true), '');
        v_txt := case when v_txt is null then null else v_txt::jsonb ->> 'x-ntb-autor' end;
        if v_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_autor := v_txt::uuid; end if;
      end if;
    end if;
    if v_autor is null and v_sem_autor = 'ignorar' then return null; end if;

    v_novo  := case when tg_op <> 'DELETE' then to_jsonb(new) end;
    v_velho := case when tg_op <> 'INSERT' then to_jsonb(old) end;
    v_ref   := coalesce(v_novo, v_velho);
    v_por_campo := v_op = 'update' or v_autor is not null;

    if v_por_campo then
      for i in 4 .. tg_nargs - 1 loop
        v_campo := tg_argv[i];
        if v_campo like '%.*' then
          v_partes := string_to_array(left(v_campo, -2), '.');
          for k in
            select distinct x from (
              select jsonb_object_keys(case when jsonb_typeof(v_velho #> v_partes) = 'object' then v_velho #> v_partes else '{}'::jsonb end) as x
              union
              select jsonb_object_keys(case when jsonb_typeof(v_novo #> v_partes) = 'object' then v_novo #> v_partes else '{}'::jsonb end)
            ) s order by 1
          loop
            v_de := nullif((v_velho #> v_partes) ->> k, '');
            v_para := nullif((v_novo #> v_partes) ->> k, '');
            if v_de is distinct from v_para then
              v_rows := v_rows || jsonb_build_object('campo', array_to_string(v_partes, '.') || '.' || k, 'de', left(v_de, 500), 'para', left(v_para, 500));
            end if;
          end loop;
        else
          v_de := v_velho ->> v_campo;
          v_para := v_novo ->> v_campo;
          if v_de is distinct from v_para then
            v_rows := v_rows || jsonb_build_object('campo', v_campo, 'de', left(v_de, 500), 'para', left(v_para, 500));
          end if;
        end if;
      end loop;
      if v_op = 'update' and jsonb_array_length(v_rows) = 0 then return null; end if;
    end if;
    if jsonb_array_length(v_rows) = 0 then
      v_rows := jsonb_build_array(jsonb_build_object('campo', null, 'de', null, 'para', null));
    end if;
    if v_autor is not null then select name into v_nome from profiles where id = v_autor; end if;
  exception when others then
    raise warning 'historico_registrar(% %): %', tg_table_name, tg_op, sqlerrm;
    return null;
  end;

  insert into historico_alteracoes (loja_id, entidade, entidade_id, tabela, linha, operacao, campo, valor_de, valor_para, autor_id, autor_nome, origem, txid)
  select (v_ref ->> 'loja_id')::bigint, v_entidade, v_ref ->> v_col_id, tg_table_name,
         case when v_col_linha is null then null else v_ref ->> v_col_linha end,
         v_op, r.campo, r.de, r.para, v_autor, v_nome, case when v_autor is null then 'sistema' else 'app' end, txid_current()
    from jsonb_to_recordset(v_rows) as r(campo text, de text, para text)
   where v_ref ->> 'loja_id' is not null and v_ref ->> v_col_id is not null;
  return null;
end $$;
revoke all on function public.historico_registrar() from public, anon, authenticated;

-- Retenção: apaga um lote do que passou de p_dias (mínimo 90). Devolve quantas linhas saíram (o cron repete enquanto vier cheio).
create or replace function public.historico_podar(p_dias int default 400, p_lote int default 5000)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if p_dias is null or p_dias < 90 then raise exception 'Retenção do histórico: mínimo de 90 dias' using errcode = '22023'; end if;
  delete from historico_alteracoes
   where id in (select id from historico_alteracoes where created_at < now() - make_interval(days => p_dias)
                 order by created_at limit greatest(1, least(coalesce(p_lote, 5000), 50000)));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.historico_podar(int, int) from public, anon, authenticated;
grant execute on function public.historico_podar(int, int) to service_role;

-- Gatilhos -----------------------------------------------------------------------------------------------------------
drop trigger if exists historico on public.produtos;
create trigger historico after insert or update or delete on public.produtos for each row execute function public.historico_registrar(
  'produto', 'codigo_produto', '', 'gravar',
  'codigo', 'descricao', 'unidade', 'ncm', 'ean', 'valor_unitario', 'estoque_minimo', 'inativo', 'bloqueado', 'pdv', 'tipo_item',
  'codigo_familia', 'descricao_familia', 'grupo_id', 'validade_dias', 'produto_pai_codigo', 'eh_mae', 'atributos', 'full_object.extras.*');

drop trigger if exists historico on public.fornecedores;
create trigger historico after insert or update or delete on public.fornecedores for each row execute function public.historico_registrar(
  'fornecedor', 'id', '', 'gravar',
  'razao_social', 'nome_fantasia', 'cnpj_cpf', 'pessoa_fisica', 'inscricao_estadual', 'inscricao_municipal', 'email', 'telefone',
  'cep', 'uf', 'cidade', 'bairro', 'logradouro', 'numero', 'complemento', 'inativo');

drop trigger if exists historico on public.compras_proprio;
create trigger historico after insert or update or delete on public.compras_proprio for each row execute function public.historico_registrar(
  'nota_entrada', 'id', '', 'gravar',
  'status', 'numero', 'serie', 'fornecedor_cnpj', 'fornecedor_nome', 'emissao', 'valor_produtos', 'valor_frete', 'valor_desconto',
  'valor_total', 'icms_recuperavel', 'codigo_local_estoque', 'obs', 'lancada_em', 'conferida_em', 'conferida_por', 'estornos');

drop trigger if exists historico on public.compras_proprio_itens;
create trigger historico after insert or update or delete on public.compras_proprio_itens for each row execute function public.historico_registrar(
  'nota_entrada', 'compra_id', 'linha', 'gravar',
  'codigo_produto', 'fator', 'unidade_estoque', 'quantidade', 'quantidade_recebida', 'valor_unitario', 'lancado', 'lote', 'validade',
  'codigo_local_estoque', 'cfop_entrada', 'movimenta_estoque', 'gera_conta_pagar', 'custo_icms', 'custo_icms_st', 'custo_ipi',
  'custo_pis', 'custo_cofins', 'custo_frete', 'custo_seguro', 'custo_outras');

drop trigger if exists historico on public.ordens_producao;
create trigger historico after insert or update or delete on public.ordens_producao for each row execute function public.historico_registrar(
  'op', 'id', '', 'ignorar',
  'identificacao_n_qtde', 'identificacao_d_dt_previsao', 'identificacao_codigo_local_estoque', 'local_destino', 'validade', 'quantidade',
  'concluida', 'dt_conclusao_real', 'observacao', 'conclusao_status', 'revertida_em', 'ficha_versao', 'custo_total');

-- Pedido de compra (migration 200): só se a 200 já estiver aplicada.
do $$
begin
  if to_regclass('public.pedidos_compra') is null then
    raise notice '220: pedidos_compra não existe (migration 200 não aplicada): gatilhos de pedido pulados; reaplique esta migration depois da 200';
    return;
  end if;
  execute 'drop trigger if exists historico on public.pedidos_compra';
  execute $t$create trigger historico after insert or update or delete on public.pedidos_compra for each row execute function public.historico_registrar(
    'pedido_compra', 'id', '', 'gravar',
    'etapa', 'fornecedor_nome', 'fornecedor_cnpj', 'previsao_entrega', 'frete', 'outras_despesas', 'parcelas', 'numero_fornecedor',
    'contato', 'obs', 'obs_interna', 'motivo_cancelamento')$t$;
  execute 'drop trigger if exists historico on public.pedidos_compra_itens';
  execute $t$create trigger historico after insert or update or delete on public.pedidos_compra_itens for each row execute function public.historico_registrar(
    'pedido_compra', 'pedido_id', 'linha', 'gravar',
    'codigo_produto', 'descricao', 'unidade', 'fator', 'quantidade', 'preco_unitario', 'codigo_local_estoque', 'obs')$t$;
end $$;

commit;

notify pgrst, 'reload schema';

-- Reverter: drop function public.historico_podar(int, int); drop trigger historico on public.produtos; (idem fornecedores, compras_proprio, compras_proprio_itens,
-- ordens_producao, pedidos_compra, pedidos_compra_itens); drop function public.historico_registrar();
-- drop table public.historico_alteracoes;
