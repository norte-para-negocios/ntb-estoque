-- Auto-cadastro com aprovacao do admin.
-- status: 'pendente' (recem-cadastrado, sem acesso) ou 'aprovado' (liberado).
-- Default 'aprovado' para que os usuarios EXISTENTES continuem com acesso normal;
-- o fluxo de cadastro publico grava 'pendente' explicitamente.

alter table profiles add column if not exists status varchar(20) not null default 'aprovado';

-- E-mail no profile: necessario para o admin identificar quem se cadastrou na fila
-- de aprovacao (o e-mail "oficial" vive em auth.users). Backfill dos existentes.
alter table profiles add column if not exists email varchar(255);
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;
