-- Bloco 5.2: certificado digital A1 (.pfx/.p12) por loja. O arquivo vai para o
-- Storage privado (bucket 'certificados', acesso so via service role); a senha
-- e gravada criptografada (AES-256-GCM, lib/cripto.ts). Dado SENSIVEL: o arquivo
-- e a senha nunca podem ir para log/git.
alter table lojas add column if not exists certificado_path text;
alter table lojas add column if not exists certificado_nome text;
alter table lojas add column if not exists certificado_senha_enc text;
alter table lojas add column if not exists certificado_validade date;
alter table lojas add column if not exists certificado_atualizado timestamptz;

-- Bucket privado para os .pfx. Sem policies publicas: so o service role acessa.
insert into storage.buckets (id, name, public)
values ('certificados', 'certificados', false)
on conflict (id) do nothing;
