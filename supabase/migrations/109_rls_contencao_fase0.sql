-- Contenção de RLS (Fase 0), 2026-08-12 — ver docs/superpowers/specs/
-- 2026-08-12-rls-contencao-fase0-design.md. Elimina o risco de
-- destruição em cascata: estas 34 tabelas tinham INSERT/UPDATE/DELETE/
-- TRUNCATE liberados pra anon/authenticated sem nenhuma policy de RLS.
-- service_role/postgres não são afetados (grants próprios, roles
-- separadas). SELECT continua liberado por enquanto -- RLS de linha
-- fica pra uma Fase 2 separada.

revoke insert, update, delete, truncate on arquivos_mortos from anon, authenticated;
revoke insert, update, delete, truncate on audit_log from anon, authenticated;
revoke insert, update, delete, truncate on categorias_contabeis from anon, authenticated;
revoke insert, update, delete, truncate on clientes from anon, authenticated;
revoke insert, update, delete, truncate on contas_correntes from anon, authenticated;
revoke insert, update, delete, truncate on contas_pagar from anon, authenticated;
revoke insert, update, delete, truncate on contas_receber from anon, authenticated;
revoke insert, update, delete, truncate on convites from anon, authenticated;
revoke insert, update, delete, truncate on familias from anon, authenticated;
revoke insert, update, delete, truncate on fornecedores from anon, authenticated;
revoke insert, update, delete, truncate on integration_attempts from anon, authenticated;
revoke insert, update, delete, truncate on inventario_items from anon, authenticated;
revoke insert, update, delete, truncate on inventarios from anon, authenticated;
revoke insert, update, delete, truncate on local_estoque_user from anon, authenticated;
revoke insert, update, delete, truncate on local_estoques from anon, authenticated;
revoke insert, update, delete, truncate on loja_user from anon, authenticated;
revoke insert, update, delete, truncate on lojas from anon, authenticated;
revoke insert, update, delete, truncate on movimentos from anon, authenticated;
revoke insert, update, delete, truncate on movimentos_historico from anon, authenticated;
revoke insert, update, delete, truncate on nota_fiscal_items from anon, authenticated;
revoke insert, update, delete, truncate on notas_fiscais from anon, authenticated;
revoke insert, update, delete, truncate on ordens_producao from anon, authenticated;
revoke insert, update, delete, truncate on ordens_producao_teste from anon, authenticated;
revoke insert, update, delete, truncate on outbox from anon, authenticated;
revoke insert, update, delete, truncate on permissao_user from anon, authenticated;
revoke insert, update, delete, truncate on permissoes from anon, authenticated;
revoke insert, update, delete, truncate on posicao_estoques from anon, authenticated;
revoke insert, update, delete, truncate on previsao_venda from anon, authenticated;
revoke insert, update, delete, truncate on produto_preco_recente from anon, authenticated;
revoke insert, update, delete, truncate on produto_substituicoes from anon, authenticated;
revoke insert, update, delete, truncate on produtos from anon, authenticated;
revoke insert, update, delete, truncate on profiles from anon, authenticated;
revoke insert, update, delete, truncate on transferencias from anon, authenticated;
revoke insert, update, delete, truncate on webhooks from anon, authenticated;

-- Parte B: lojas perde SELECT geral e ganha de volta só nas colunas nao
-- sensiveis. As 7 colunas abaixo (chaves/segredos) NUNCA aparecem nesta
-- lista -- se uma coluna nova for adicionada a lojas no futuro, ela cai
-- automaticamente no grant permitido (é dinâmico via information_schema),
-- entao qualquer coluna sensível nova precisa ser adicionada nesta lista
-- de exclusão em uma migration própria, não fica protegida por padrão.

revoke select on lojas from anon, authenticated;

do $$
declare
  colunas_permitidas text;
begin
  select string_agg(quote_ident(column_name), ', ')
  into colunas_permitidas
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'lojas'
    and column_name not in (
      'omie_app_key',
      'omie_app_secret',
      'integracao_api_key',
      'integracao_teste_api_key',
      'csc_producao',
      'csc_id_producao',
      'certificado_senha_enc'
    );

  execute format('grant select (%s) on lojas to anon, authenticated', colunas_permitidas);
end $$;
