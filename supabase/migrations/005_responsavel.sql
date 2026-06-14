-- Responsavel (quem criou) em inventarios e transferencias.
-- Permite exibir o usuario que fez a operacao, espelhando o que o Omie mostra.

alter table inventarios add column if not exists user_id uuid references profiles(id) on delete set null;
alter table transferencias add column if not exists user_id uuid references profiles(id) on delete set null;
