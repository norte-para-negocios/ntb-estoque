-- Super admin total: acesso ao area VTBstock Beta (copia do Omie, modulos experimentais).
-- Distinto do Admin global (gere lojas): super admin ve os modulos beta, nao e uma
-- escalada de permissao de gestao, e um flag separado.
alter table profiles add column if not exists is_super_admin boolean not null default false;
