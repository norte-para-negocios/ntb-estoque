# Plano — Histórico de 2026 do Omie + gestão de espaço (17/06/2026)

## Decisões travadas (fundador)
- Trazer **só o histórico de 2026** (01/01/2026 → hoje). NÃO os 8 anos (193k OPs/loja).
- Tudo no **Supabase free (500 MB)** — cabe. Sem Contabo (complexidade/perde backup gerenciado).
- **Drive/OneDrive = plano C** (arquivo morto, só se um dia quiser os anos antigos em CSV).
- **Supabase Pro ($25/mês) = plano D** (só se precisar do antigo navegável).

## Situação de espaço (hoje)
- Banco: **230 MB / 500 MB**. Maiores: `posicao_estoques` 65 MB · `produtos` 57 MB · **`integration_attempts` (logs) 53 MB** · `ordens_producao` 30 MB.
- **Passo 0 (libera de cara): podar `integration_attempts`** (logs antigos, ex.: > 30 dias) → ~−53 MB → volta a ~177 MB. Já existe `/api/cron/prune`; reforçar a regra.

## Esclarecimento importante (o que é "histórico de inventário/transferência")
No Omie **não existem** as entidades "inventário" e "transferência" separadas — elas viram **movimentações de estoque (ajustes)**. Então o histórico de inventários/transferências de 2026 = os **movimentos de ajuste de 2026** (`ListarMovimentos`). As entidades "Inventário"/"Transferência" do NTB são criações do próprio sistema (daqui pra frente). Por isso o histórico antigo aparece como **movimentações**, não como inventários/transferências numerados.

## O que importar (2026, todas as lojas que não estão bloqueadas no recurso)
1. **Movimentos de estoque** (`v1/estoque/movestoque` / ListarMovimentos) — entradas, saídas, ajustes, rejeito. É a espinha do histórico.
2. **Notas fiscais** (`nfconsultar` / ListarNF) — completar 2026 (hoje só 287, provável 30 dias).
3. **OPs** — já temos 2026 (12k loja 3); confirmar cobertura de todas as lojas no ano.
4. **Posição de estoque** — já sincroniza (a foto mais recente; não precisa histórico diário).

## Como importar (sem quebrar nada)
- **Backfill 1x por loja**: paginado (`registros_por_pagina` 500), filtro `data_inicial=01/01/2026`/`data_final=hoje`.
- **Idempotência**: upsert por chave natural (id do movimento / chave da NF / nCodOP) — rodar de novo não duplica.
- **Anti-rajada**: respeitar o limite Omie (240/min por método); espaçar páginas e lojas; tratar REDUNDANT com backoff (já existe no `omieRequest`).
- **Lock por loja+modelo**: não rodar o mesmo backfill 2x em paralelo (evita o "consumo redundante" que deu na OP da Brotas).
- **Incremental depois**: o cron diário já mantém o novo; o backfill é só a carga inicial de 2026.
- **Lojas 5/6**: o bloqueio é só do `ListarEmpresas`; movimentos/NF/OP dessas lojas devem funcionar — confirmar no 1º backfill.

## Onde o usuário vê (UI)
- Movimentos: tela/aba de **Movimentações** por produto (ou no histórico do produto) — entrada/saída/ajuste com data e origem.
- NFs e OPs de 2026: já têm tela (Notas Fiscais / Ordens de Produção) — passam a mostrar o ano todo.

## Estimativa de espaço
2026 ≈ 1/16 dos 8 anos. Após podar logs (~177 MB), + movimentos/NFs de 2026 (estimativa ~50–120 MB). Deve ficar **bem abaixo de 500 MB**. **Monitorar `pg_database_size` durante o backfill**; se um dataset (movimentos) crescer demais, agregar os meses mais antigos.

## Etapas de execução (ordem)
1. Podar `integration_attempts` (libera ~53 MB) + medir espaço.
2. Backfill de **movimentos 2026** (loja a loja, paginado) + medir espaço a cada loja.
3. Backfill/completar **NFs 2026**.
4. Conferir **OPs 2026** de todas as lojas.
5. UI de **Movimentações** (se não existir) pra consultar o histórico.
6. Validar volume final vs 500 MB; agregar se necessário.

## Riscos
- Volume de movimentos maior que o estimado → agregar meses antigos ou limitar.
- Rate limit / REDUNDANT do Omie → backfill espaçado + lock + backoff.
- Espaço: monitorar a cada etapa; parar e reavaliar se passar de ~400 MB.
