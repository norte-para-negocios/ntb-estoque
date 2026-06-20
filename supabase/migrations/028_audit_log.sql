-- Fase 2: trilha de auditoria. Registra QUEM fez O QUE (criar/editar/excluir) e
-- QUANDO, por loja. Um ERP precisa disso para operacao multi-usuario.
--
-- Escrita: helper registrarAuditoria (service role) chamado nas server actions de
-- mutacao. Leitura: pagina /auditoria, gateada por permissao/admin no RSC (como o
-- resto do sistema, a seguranca fica na server action + na pagina, nao em RLS).
--
-- entidade_id e text (cobre id inteiro do banco e uuid de usuario). descricao guarda
-- um rotulo legivel (ex.: "Acucar Cristal (80095)") para a tela nao precisar de join.

create table if not exists audit_log (
  id           bigint generated always as identity primary key,
  loja_id      bigint references lojas(id) on delete cascade,
  user_id      uuid references profiles(id) on delete set null,
  user_nome    text,
  acao         varchar(16) not null,   -- 'criar' | 'editar' | 'excluir'
  entidade     varchar(40) not null,   -- 'produto' | 'transferencia' | 'inventario' | ...
  entidade_id  text,
  descricao    text,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_loja_created_idx on audit_log (loja_id, created_at desc);
create index if not exists audit_log_entidade_idx on audit_log (loja_id, entidade);
