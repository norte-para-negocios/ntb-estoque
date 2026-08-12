-- Fix de emergência (2026-08-12): a policy de loja_user (criada na
-- migration 111, Parte B) referencia loja_user dentro da própria condição
-- USING -- e como as OUTRAS 40 tabelas também fazem EXISTS(loja_user)
-- dentro da própria policy, TODA leitura via authenticated (a maioria do
-- app) quebrou com "infinite recursion detected in policy for relation
-- loja_user" assim que a migration 111 foi aplicada. Corrigido com 2
-- functions security definer -- rodam com privilégio do dono (ignoram RLS
-- na leitura interna de loja_user/profiles), quebrando a recursão. Padrão
-- recomendado pela documentação oficial do Supabase pra esse problema
-- (subquery em RLS referenciando a própria tabela, ou tabela com sua
-- própria policy recursiva).

create or replace function usuario_tem_acesso_loja(p_loja_id bigint)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from loja_user lu
    where lu.loja_id = p_loja_id and lu.user_id = auth.uid()
  );
$$;

create or replace function usuario_e_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles pr
    where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true)
  );
$$;

revoke all on function usuario_tem_acesso_loja(bigint) from public;
revoke all on function usuario_e_admin() from public;
grant execute on function usuario_tem_acesso_loja(bigint) to anon, authenticated;
grant execute on function usuario_e_admin() to anon, authenticated;

alter policy etiqueta_config_select_por_loja on etiqueta_config using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy faturamento_import_meta_select_por_loja on faturamento_import_meta using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy faturamento_importado_select_por_loja on faturamento_importado using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy impressao_etiquetas_select_por_loja on impressao_etiquetas using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy margem_import_meta_select_por_loja on margem_import_meta using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy margem_importada_select_por_loja on margem_importada using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy margem_snapshot_diario_select_por_loja on margem_snapshot_diario using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy movimentacao_import_meta_select_por_loja on movimentacao_import_meta using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy movimentacao_importada_select_por_loja on movimentacao_importada using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy movimentacao_operacao_select_por_loja on movimentacao_operacao using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy movimentacao_operacao_meta_select_por_loja on movimentacao_operacao_meta using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy op_qtde_planejada_select_por_loja on op_qtde_planejada using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());

alter policy audit_log_select_por_loja on audit_log using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy categorias_contabeis_select_por_loja on categorias_contabeis using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy clientes_select_por_loja on clientes using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy contas_correntes_select_por_loja on contas_correntes using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy contas_pagar_select_por_loja on contas_pagar using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy contas_receber_select_por_loja on contas_receber using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy convites_select_por_loja on convites using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy familias_select_por_loja on familias using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy fornecedores_select_por_loja on fornecedores using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy integration_attempts_select_por_loja on integration_attempts using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy inventario_items_select_por_loja on inventario_items using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy inventarios_select_por_loja on inventarios using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy local_estoque_user_select_por_loja on local_estoque_user using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy local_estoques_select_por_loja on local_estoques using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy loja_user_select_por_loja on loja_user using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy movimentos_select_por_loja on movimentos using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy movimentos_historico_select_por_loja on movimentos_historico using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy nota_fiscal_items_select_por_loja on nota_fiscal_items using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy notas_fiscais_select_por_loja on notas_fiscais using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy ordens_producao_select_por_loja on ordens_producao using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy ordens_producao_teste_select_por_loja on ordens_producao_teste using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy permissao_user_select_por_loja on permissao_user using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy posicao_estoques_select_por_loja on posicao_estoques using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy previsao_venda_select_por_loja on previsao_venda using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy produto_preco_recente_select_por_loja on produto_preco_recente using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy produto_substituicoes_select_por_loja on produto_substituicoes using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy produtos_select_por_loja on produtos using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy transferencias_select_por_loja on transferencias using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
alter policy webhooks_select_por_loja on webhooks using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
