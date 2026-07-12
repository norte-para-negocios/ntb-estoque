# Backfill de histórico completo (1 ano) para o Contabo + poda no Supabase

Data: 2026-07-12
Status: aprovado ("se você acha que tá ok, pode ir")

## Contexto

O dual-write de `webhooks` (spec `2026-07-12-dual-write-historico-contabo-design.md`) já está em produção — daqui pra frente nada mais se perde. Mas isso só cobre escrita nova. O pedido agora é maior: **ter o histórico completo de tudo que o Omie tem, pelo menos 1 ano, guardado no Contabo pra sempre**, e usar essa migração para finalmente aliviar o Supabase, que está em **482MB/500MB (96,4%)** do free tier.

Levantamento do estado real de cada tabela candidata (medido em 2026-07-12):

| Tabela | Linhas | Tamanho | Cobertura hoje no Supabase | Situação |
|---|---:|---:|---|---|
| `movimentos` (ajustes) | 404.074 | 159 MB | 2025-06-30 → hoje | já cobre ~1 ano |
| `movimentos_historico` | 421.504 | 73 MB | 2025-07-01 → hoje | já cobre ~1 ano |
| `notas_fiscais` + `nota_fiscal_items` | 10.156 + 54.986 | 8,3 MB + 61 MB | 2025-07-01 → hoje | já cobre ~1 ano |
| `ordens_producao` | 53.625 (recente) | 41 MB | **2026-04-01 → hoje (só 3 meses)** | **buraco real de ~9 meses (2025-07 a 2026-04)** |
| `webhooks` | 30.135 | 38 MB | só últimos 7 dias (prune de 7 dias já ativo via `app/api/cron/prune/route.ts`) | **dado anterior a 7 dias já foi perdido — Omie não tem endpoint pra "listar webhooks antigos", não é recuperável** |

Ou seja: a maior parte do trabalho é **copiar o que já existe no Supabase pro Contabo** (sem tocar no Omie). Só `ordens_producao` precisa de um backfill de verdade contra a API do Omie. `webhooks` não tem como ser completado retroativamente — só garante que não perde mais nada a partir de agora (já garantido pelo dual-write).

Fora de escopo (cadastro/estado atual, não histórico transacional por data, não crescem de forma descontrolada): `produtos`, `clientes`, `fornecedores`, `lojas`, `familias`, `local_estoques`, `posicao_estoques` (é sempre "foto do dia", Omie não guarda série histórica disso), `faturamento_importado`, `margem_importada`, `movimentacao_importada`, `movimentacao_operacao` (vêm de import manual de planilha MOV_DRV, não da API Omie).

## Decisão de arquitetura

Três fases, **todas executadas rodando no próprio servidor Contabo via SSH** (evita depender do IP dinâmico da máquina Windows local e reaproveita o acesso já configurado):

### Fase A — Cópia direta Supabase → Contabo

Mesmo padrão já validado no piloto (`clientes`, 2585/2585 linhas batendo): script Node conecta como leitura no Supabase (via pooler) e como escrita no Postgres local do Contabo (`ntb_frio`), recria o schema de cada tabela e copia todas as linhas atuais, uma vez. Tabelas: `movimentos`, `movimentos_historico`, `notas_fiscais`, `nota_fiscal_items`, `webhooks` (as 30k linhas de hoje). Não toca no Omie — é só leitura no Supabase, sem risco pra produção.

### Fase B — Backfill via Omie, só para `ordens_producao`

Reaproveita a lógica já madura e testada em produção de `backfill-fase2.mjs`/`backfill-full-object.mjs` (mês a mês, `ListarOrdemProducao` com `dDtConclusaoDe`/`dDtConclusaoAte`, sleep entre páginas, retry/backoff em erro de rede ou rate limit do Omie) — mas escrevendo direto no Postgres do Contabo em vez do Supabase. Cobre 2025-07 até 2026-04 (o buraco), para as 6 lojas ativas, sequencial (não paralelo, mesma razão dos scripts originais: Omie trata chamadas concorrentes da mesma `app_key` como "consumo redundante").

### Fase C — Poda no Supabase

Só depois que A e B confirmarem (contagem de linhas no Contabo bate com o esperado, sem erro) — remove do Supabase tudo mais antigo que **90 dias** nas tabelas com data (`movimentos.data`, `movimentos_historico.data`, `notas_fiscais.d_emissao_nfe` + `nota_fiscal_items` via join, `ordens_producao.dt_conclusao_real`). `webhooks` já tem prune de 7 dias próprio — não mexe nesse cron, ele já faz o trabalho.

Antes de rodar a poda: confirmar que as leituras existentes que usam essas tabelas (`lib/resumo-dia.ts` linhas 171 e 389 usam `movimentos_historico`, mais qualquer relatório em `app/relatorio-*`) só consultam janelas recentes (dias, não meses) — se alguma depender de dado além de 90 dias, ajusta a janela ou reescreve a leitura antes de podar, nunca depois.

## Segurança

- Cada fase só avança se a anterior for validada por contagem (Contabo == esperado). Nenhuma linha é apagada do Supabase antes disso.
- Poda sempre com **dry-run primeiro** (mostra quantas linhas seriam apagadas, por tabela e por loja, sem apagar nada) — só roda de verdade com flag explícita `--commit`.
- Script de poda inclui a mesma trava de sanidade que `sync-ajustes-omie.mjs` já usa: aborta se a contagem no Contabo para o período a ser apagado não bater com a contagem correspondente no Supabase.
- Scripts de backfill via Omie rodam sequencial por loja (nunca paralelo), reaproveitando o backoff/retry já testado em produção — não introduz padrão novo de chamada à API.
- Nada disso mexe no Laravel legado nem no MariaDB do Contabo.
- Todos os scripts novos são cópias adaptadas dos scripts existentes (que continuam intocados, seguem funcionando exatamente como hoje) — não há edição de scripts de produção já em uso.

## Riscos

- `ordens_producao` histórica reconstruída via `ListarOrdemProducao` traz só o resumo listado pela API, não o `full_object` completo (que exige `ConsultarOrdemProducao` individual, 1 chamada por OP) — para ~9 meses de histórico isso pode ser um volume grande de chamadas individuais. Decisão: Fase B traz o que `ListarOrdemProducao` oferece; se o `full_object` completo for necessário depois, é uma iteração futura (mesmo padrão incremental já usado no projeto).
- Perda de `webhooks` anteriores a 7 dias é definitiva e não faz parte do escopo corrigir (não há como, o dado não existe mais em lugar nenhum) — só é documentada aqui para deixar claro que "1 ano de histórico" não vai incluir webhooks antigos.
- Se a poda no Supabase remover dado que alguma leitura ainda não identificada dependia, isso quebraria uma funcionalidade em produção — mitigado pelo passo explícito de revisão das leituras antes do `--commit` da poda.
