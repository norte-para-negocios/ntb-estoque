-- Integracao ntb-vendas -> ntb-estoque (2026-07-07): chave de API por loja pra
-- autenticar a rota nova app/api/integracao/ordem-producao (fora de sessao,
-- diferente do resto do sistema que e todo Server Action presa a sessao logada).
-- O ntb-vendas guarda essa chave e manda no header Authorization: Bearer <chave>.

create extension if not exists pgcrypto;

alter table lojas add column if not exists integracao_api_key text unique;

-- Gera uma chave real pra Vieras e Vinhos (loja piloto da integracao — ver
-- AGENTS.md/memoria "integracao_ntb_vendas_estoque_omie"). Idempotente: so
-- gera se ainda nao tiver chave. Ajustar o filtro se o nome exato na tabela
-- for diferente (nao foi possivel confirmar via banco antes de escrever isso).
update lojas
set integracao_api_key = encode(gen_random_bytes(32), 'hex')
where (nome ilike '%vieras%' or nome ilike '%vinhos%' or nome_fantasia ilike '%vieras%' or nome_fantasia ilike '%vinhos%')
  and integracao_api_key is null;
