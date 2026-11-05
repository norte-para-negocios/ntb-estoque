# Fase 3 — Ligar o que já existe e nunca rodou (05/11/2026)

Plano mestre: `docs/superpowers/plans/2026-11-03-norte-erp-plano-mestre.md` (Fase 3). Tudo na **loja 19 "ZZ NORTE ERP LAB"** (proprio, is_test, Vendas lab `3774fb33…`), nunca na ODARA (15) nem em outra loja. Tudo continua só para desenvolvedor (`ROTAS_SO_DEV` / layout novo): liberar para a equipe é decisão do dono.

## Regras de cada frente
- Testar pela tela de produção (`https://app-estoque.norteparanegocios.com.br`, conta QA `claude.qa@ntb-estoque.dev`, Playwright **headless**), loja atual = 19. Nunca trocar a loja da conta QA para outra.
- Conferir no banco (só leitura, `docker exec supabase-db psql -U postgres -d postgres`) que cada passo gravou o que devia (ledger `estoque_movimentos`, saldo, custo).
- Bug achado → teste que falha → correção no worktree da frente (`node --test`, `npx tsc --noEmit`) → commit. **Sem deploy e sem migration aplicada**: migration nova só como arquivo + teste em `BEGIN … ROLLBACK`; o deploy é feito de madrugada pelo controlador.
- Fiscal só homologação; nada no Omie; nenhuma mensagem para ninguém.

## Frentes
- **A — Compras:** sugestão de compra → tarefas → requisição → aprovação → pedido → nota × pedido × recebido (três vias) → recebimento parcial; devolução ao fornecedor (registro).
- **B — Estoque:** estoque inicial (entrada), inventário cego por local, validade/FEFO na entrada e na produção, transferência entre locais, ajustes manuais com motivo, OP.
- **C — Fechamento e documentos:** fechamento de mês e pacote do contador, anexos, CT-e com rateio de frete, manifestação do destinatário, NF-e de saída em homologação.

## Entrega de cada frente
Relatório: o que rodou ponta a ponta (com prova), bugs achados e corrigidos (commit), o que ficou quebrado e por quê, e o que precisa de decisão do dono.
