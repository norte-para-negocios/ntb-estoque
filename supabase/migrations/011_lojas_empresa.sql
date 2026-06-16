-- Dados completos da empresa por loja, vindos do ListarEmpresas do Omie (Bloco 1.2).
-- Base para o cadastro completo da loja, NFC-e e Sefaz (blocos 5/6). Tudo leitura
-- do Omie; CSC e dado sensivel. add column if not exists = idempotente.

alter table lojas add column if not exists razao_social varchar(150);
alter table lojas add column if not exists inscricao_estadual varchar(20);
alter table lojas add column if not exists inscricao_municipal varchar(20);
alter table lojas add column if not exists cnae varchar(10);
alter table lojas add column if not exists cnae_municipal varchar(10);
alter table lojas add column if not exists regime_tributario varchar(5);
alter table lojas add column if not exists optante_simples_nacional varchar(1);
alter table lojas add column if not exists csc_producao text;
alter table lojas add column if not exists csc_id_producao varchar(10);
alter table lojas add column if not exists codigo_empresa bigint;
alter table lojas add column if not exists complemento varchar(100);
alter table lojas add column if not exists email varchar(120);
alter table lojas add column if not exists website varchar(200);
alter table lojas add column if not exists telefone1 varchar(20);
alter table lojas add column if not exists telefone2 varchar(20);
alter table lojas add column if not exists sped_nome_contador varchar(150);
alter table lojas add column if not exists sped_cpf_contador varchar(14);
alter table lojas add column if not exists sped_email_contador varchar(120);
alter table lojas add column if not exists empresa_ultima_atualizacao timestamptz;
alter table lojas add column if not exists empresa_status varchar(20);
alter table lojas add column if not exists full_object_empresa jsonb;
