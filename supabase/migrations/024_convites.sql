-- Fase 4.5+ (bloco de permissoes, parte 2): convites por codigo COM permissoes embutidas.
--
-- Hoje o codigo da loja (lojas.codigo_onboarding, migration 022) faz a pessoa entrar
-- "sem permissoes" (o chefe ajusta depois). O fundador quer evoluir: ao GERAR um
-- convite, o admin escolhe o PERFIL e as PERMISSOES que aquele convite concede; manda
-- o codigo; a pessoa usa e entra JA com aquelas permissoes + vinculada a loja.
--
-- Decisao de modelagem (documentada):
--  - NAO removemos lojas.codigo_onboarding. Ele continua valido como atalho "entrar
--    vinculado a loja, sem permissoes" (compatibilidade). O cadastro publico aceita
--    AMBOS: um codigo de convite (rico, desta tabela) OU o codigo_onboarding da loja
--    (simples). Convite tem prioridade no casamento (busca primeiro nesta tabela).
--  - Varios convites por loja, cada um com perfil/permissoes proprias. Convite e
--    de uso UNICO (usado_em != null marca como consumido) e pode expirar (expira_em).
--
-- Perfil do convite: 'Usuario' (com as permissoes do jsonb) ou 'AdminLoja' (acesso
-- total a loja). Nunca 'Admin' global por convite: isso so o admin promove a mao.
-- As permissoes ficam em jsonb como lista de NOMES (permissoes.nome), pra casar com
-- o catalogo (permissoes-catalogo.ts) sem depender de ids que podem variar por ambiente.

create table if not exists convites (
  id          bigint generated always as identity primary key,
  codigo      varchar(16) not null unique,
  loja_id     bigint not null references lojas(id) on delete cascade,
  perfil      varchar(16) not null default 'Usuario'
                check (perfil in ('Usuario', 'AdminLoja')),
  -- Lista de NOMES de permissao (permissoes.nome). Vazio = sem permissoes (so vinculo).
  -- Ignorado quando perfil = 'AdminLoja' (esse tem acesso total por definicao).
  permissoes  jsonb not null default '[]'::jsonb,
  criado_por  uuid references profiles(id) on delete set null,
  criado_em   timestamptz not null default now(),
  -- Consumo: quando e por quem o convite foi usado (uso unico).
  usado_em    timestamptz,
  usado_por   uuid references profiles(id) on delete set null,
  -- Expiracao opcional: null = nao expira.
  expira_em   timestamptz
);

-- Busca por codigo (no cadastro publico) e por loja (na listagem do admin/AdminLoja).
create index if not exists convites_loja_id_idx on convites (loja_id);
create index if not exists convites_codigo_idx on convites (codigo);
