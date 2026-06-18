-- Fase 4.5 - Onboarding por codigo de loja.
-- Cada loja ganha um codigo curto e unico. No cadastro publico, a pessoa informa
-- esse codigo e ja entra vinculada aquela loja (fluxo exato a confirmar com o Andre).
-- O codigo e gerado/regenerado pelo admin na tela da loja.

alter table lojas
  add column if not exists codigo_onboarding varchar(12);

-- Indice unico parcial: dois codigos iguais nao podem coexistir, mas varias lojas
-- podem ficar com NULL (sem codigo gerado ainda).
create unique index if not exists lojas_codigo_onboarding_key
  on lojas (codigo_onboarding)
  where codigo_onboarding is not null;
