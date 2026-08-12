-- Fase 2a (2026-08-12) -- ver docs/superpowers/specs/
-- 2026-08-12-rls-fase2a-linha-loja-design.md. Corrige um bug
-- pré-existente: a policy de SELECT destas 14 tabelas checava só
-- loja_user, sem considerar Admin global/super_admin -- contas com
-- perfil='Admin' ou is_super_admin=true e ZERO vínculos em loja_user
-- (ex: Claude QA) já ficavam sem acesso, silenciosamente (RLS nega sem
-- erro). ALTER POLICY troca só a expressão USING, sem janela sem policy.

alter policy etiqueta_config_select_por_loja on etiqueta_config using (
  exists (select 1 from loja_user lu where lu.loja_id = etiqueta_config.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy faturamento_import_meta_select_por_loja on faturamento_import_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = faturamento_import_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy faturamento_importado_select_por_loja on faturamento_importado using (
  exists (select 1 from loja_user lu where lu.loja_id = faturamento_importado.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy impressao_etiquetas_select_por_loja on impressao_etiquetas using (
  exists (select 1 from loja_user lu where lu.loja_id = impressao_etiquetas.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy margem_import_meta_select_por_loja on margem_import_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = margem_import_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy margem_importada_select_por_loja on margem_importada using (
  exists (select 1 from loja_user lu where lu.loja_id = margem_importada.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy margem_snapshot_diario_select_por_loja on margem_snapshot_diario using (
  exists (select 1 from loja_user lu where lu.loja_id = margem_snapshot_diario.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_import_meta_select_por_loja on movimentacao_import_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_import_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_importada_select_por_loja on movimentacao_importada using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_importada.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_operacao_select_por_loja on movimentacao_operacao using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_operacao.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_operacao_meta_select_por_loja on movimentacao_operacao_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_operacao_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy op_qtde_planejada_select_por_loja on op_qtde_planejada using (
  exists (select 1 from loja_user lu where lu.loja_id = op_qtde_planejada.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table audit_log enable row level security;
create policy audit_log_select_por_loja on audit_log for select using (
  exists (select 1 from loja_user lu where lu.loja_id = audit_log.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table categorias_contabeis enable row level security;
create policy categorias_contabeis_select_por_loja on categorias_contabeis for select using (
  exists (select 1 from loja_user lu where lu.loja_id = categorias_contabeis.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table clientes enable row level security;
create policy clientes_select_por_loja on clientes for select using (
  exists (select 1 from loja_user lu where lu.loja_id = clientes.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table contas_correntes enable row level security;
create policy contas_correntes_select_por_loja on contas_correntes for select using (
  exists (select 1 from loja_user lu where lu.loja_id = contas_correntes.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table contas_pagar enable row level security;
create policy contas_pagar_select_por_loja on contas_pagar for select using (
  exists (select 1 from loja_user lu where lu.loja_id = contas_pagar.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table contas_receber enable row level security;
create policy contas_receber_select_por_loja on contas_receber for select using (
  exists (select 1 from loja_user lu where lu.loja_id = contas_receber.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table convites enable row level security;
create policy convites_select_por_loja on convites for select using (
  exists (select 1 from loja_user lu where lu.loja_id = convites.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table familias enable row level security;
create policy familias_select_por_loja on familias for select using (
  exists (select 1 from loja_user lu where lu.loja_id = familias.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table fornecedores enable row level security;
create policy fornecedores_select_por_loja on fornecedores for select using (
  exists (select 1 from loja_user lu where lu.loja_id = fornecedores.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table integration_attempts enable row level security;
create policy integration_attempts_select_por_loja on integration_attempts for select using (
  exists (select 1 from loja_user lu where lu.loja_id = integration_attempts.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table inventario_items enable row level security;
create policy inventario_items_select_por_loja on inventario_items for select using (
  exists (select 1 from loja_user lu where lu.loja_id = inventario_items.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table inventarios enable row level security;
create policy inventarios_select_por_loja on inventarios for select using (
  exists (select 1 from loja_user lu where lu.loja_id = inventarios.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table local_estoque_user enable row level security;
create policy local_estoque_user_select_por_loja on local_estoque_user for select using (
  exists (select 1 from loja_user lu where lu.loja_id = local_estoque_user.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table local_estoques enable row level security;
create policy local_estoques_select_por_loja on local_estoques for select using (
  exists (select 1 from loja_user lu where lu.loja_id = local_estoques.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table loja_user enable row level security;
create policy loja_user_select_por_loja on loja_user for select using (
  exists (select 1 from loja_user lu where lu.loja_id = loja_user.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table movimentos enable row level security;
create policy movimentos_select_por_loja on movimentos for select using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentos.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table movimentos_historico enable row level security;
create policy movimentos_historico_select_por_loja on movimentos_historico for select using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentos_historico.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table nota_fiscal_items enable row level security;
create policy nota_fiscal_items_select_por_loja on nota_fiscal_items for select using (
  exists (select 1 from loja_user lu where lu.loja_id = nota_fiscal_items.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table notas_fiscais enable row level security;
create policy notas_fiscais_select_por_loja on notas_fiscais for select using (
  exists (select 1 from loja_user lu where lu.loja_id = notas_fiscais.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table ordens_producao enable row level security;
create policy ordens_producao_select_por_loja on ordens_producao for select using (
  exists (select 1 from loja_user lu where lu.loja_id = ordens_producao.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table ordens_producao_teste enable row level security;
create policy ordens_producao_teste_select_por_loja on ordens_producao_teste for select using (
  exists (select 1 from loja_user lu where lu.loja_id = ordens_producao_teste.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table permissao_user enable row level security;
create policy permissao_user_select_por_loja on permissao_user for select using (
  exists (select 1 from loja_user lu where lu.loja_id = permissao_user.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table posicao_estoques enable row level security;
create policy posicao_estoques_select_por_loja on posicao_estoques for select using (
  exists (select 1 from loja_user lu where lu.loja_id = posicao_estoques.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table previsao_venda enable row level security;
create policy previsao_venda_select_por_loja on previsao_venda for select using (
  exists (select 1 from loja_user lu where lu.loja_id = previsao_venda.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table produto_preco_recente enable row level security;
create policy produto_preco_recente_select_por_loja on produto_preco_recente for select using (
  exists (select 1 from loja_user lu where lu.loja_id = produto_preco_recente.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table produto_substituicoes enable row level security;
create policy produto_substituicoes_select_por_loja on produto_substituicoes for select using (
  exists (select 1 from loja_user lu where lu.loja_id = produto_substituicoes.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table produtos enable row level security;
create policy produtos_select_por_loja on produtos for select using (
  exists (select 1 from loja_user lu where lu.loja_id = produtos.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table transferencias enable row level security;
create policy transferencias_select_por_loja on transferencias for select using (
  exists (select 1 from loja_user lu where lu.loja_id = transferencias.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table webhooks enable row level security;
create policy webhooks_select_por_loja on webhooks for select using (
  exists (select 1 from loja_user lu where lu.loja_id = webhooks.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);
