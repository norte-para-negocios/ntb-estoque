-- Checkpoint pro sync de ficha_tecnica_local (rota
-- app/api/sync/ficha-tecnica-local/route.ts). Sem isso, toda tentativa nova
-- recomeça do produto 1 -- se travar cedo em MISUSE_API_PROCESS (comum,
-- ver AGENTS.md), fica sempre re-checando os mesmos primeiros produtos e
-- nunca alcança os novos. Marca a tentativa (achou ou não achou estrutura),
-- não só o sucesso, pra próxima rodada pular tudo que já foi checado.
alter table produtos
  add column if not exists ficha_tecnica_checada_em timestamptz;

create index if not exists idx_produtos_ficha_tecnica_pendente
  on produtos(loja_id, id)
  where ficha_tecnica_checada_em is null;
