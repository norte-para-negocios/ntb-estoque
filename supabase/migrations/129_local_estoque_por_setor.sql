-- Local de baixa por setor de produção do ntb-vendas (2026-09-30, pedido do Ramon:
-- pizza e embalagem de pizza consomem no local da pizzaria). Formato:
-- { "<nome do setor no ntb-vendas>": <codigo_local_estoque do Omie> }.
-- Lido só por rotas com service role (integração com o ntb-vendas).
alter table lojas add column if not exists local_estoque_por_setor jsonb;
