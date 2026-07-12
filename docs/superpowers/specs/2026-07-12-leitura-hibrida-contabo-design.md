# Leitura híbrida Supabase + Contabo (para podar com segurança)

Data: 2026-07-12
Status: aprovado ("você acha que tá bom" → sim, seguir)

## Contexto

A cópia de histórico pro Contabo (spec `2026-07-12-backfill-historico-1ano-contabo-design.md`) terminou com sucesso — `movimentos`, `movimentos_historico`, `notas_fiscais`, `nota_fiscal_items` e `ordens_producao` estão replicadas no Postgres do Contabo. Mas antes de podar o Supabase (a etapa que realmente libera espaço), uma investigação de todas as leituras dessas 5 tabelas encontrou **13 arquivos onde a poda quebraria algo real em produção** — de "número fica errado silenciosamente" a "página deixa de mostrar dado que devia mostrar". Lista completa na seção "Arquivos afetados".

Proposta do usuário, que muda a arquitetura: em vez de só aumentar a janela de retenção do Supabase (o que adia o problema sem resolvê-lo), **o Supabase vira só o banco operacional** (dado recente, rápido, sempre disponível) e **o Contabo vira a fonte de leitura para tudo que é histórico** — o app busca automaticamente no lugar certo, sem o usuário perceber diferença.

## Decisão de arquitetura

### Janela quente: 90 dias

Qualquer leitura cujo período pedido esteja inteiramente dentro dos últimos 90 dias consulta só o Supabase (comportamento de hoje, sem mudança de performance). Fora disso, também consulta o Contabo.

### Módulo central: `lib/historico-contabo.ts`

Um único módulo concentra a decisão "onde buscar" — nenhum dos 14 arquivos afetados reimplementa essa lógica sozinho. Expõe uma função por tabela (`buscarMovimentos`, `buscarMovimentosHistorico`, `buscarNotasFiscais`, `buscarNotaFiscalItems`, `buscarOrdensProducao`), cada uma seguindo o mesmo contrato:

1. Consulta o Supabase normalmente (código já existente, comportamento inalterado).
2. Decide se consulta também o Contabo: **sempre** quando a chamada não tem filtro de data (busca global, relatórios "tudo"), ou **só quando** o período pedido cruza a fronteira dos 90 dias.
3. Se for consultar o Contabo, chama o endpoint correspondente na `ntb-frio-api` com timeout de 5s.
4. Mescla os dois conjuntos de linhas (sem duplicar — os `id` são preservados exatamente iguais entre Supabase e Contabo desde a cópia, então dedupe por `id` é confiável) e devolve um array único.
5. **Nunca lança erro por causa do Contabo.** Se a chamada falhar ou estourar o timeout, loga (`console.error`) e devolve só o que o Supabase tem — a página carrega igual, só que sem a parte histórica daquela consulta específica.

### Endpoints novos na `ntb-frio-api` (GET, autenticados por `X-Api-Key`, iguais ao padrão já usado em `POST /webhooks`)

Um endpoint por tabela, com os filtros que os call sites realmente usam — não um endpoint genérico de SQL livre:

- `GET /movimentos` — `loja_id` (obrigatório), `data_inicio`/`data_final` (opcionais — ausentes = sem filtro, usado pelo cruzamento de transferências), `id_prod`, `transferencia_id`
- `GET /movimentos_historico` — `loja_id`, `cod_prod` (opcional), `data_inicio`/`data_final`
- `GET /notas_fiscais` — `loja_id`, `data_inicio`/`data_final`, `busca` (texto, aplica `ilike` em `c_numero_nfe`/`c_razao_social`/`c_nome`), `id` (busca pontual, usado pela página de detalhe)
- `GET /nota_fiscal_items` — `nota_fiscal_id` (um ou vários) ou `loja_id` + `data_inicio`/`data_final` (faz o join com `notas_fiscais` do lado do Contabo, já que as duas tabelas moram no mesmo banco `ntb_frio`)
- `GET /ordens_producao` — `loja_id`, `data_inicio`/`data_final` (sobre `dt_conclusao_real`), `validade_inicio`/`validade_final` (sobre a coluna `validade`, filtro independente), `busca` (ilike em `num_ordem`/`identificacao_c_num_op`), `id`

### Caso especial: relatório de movimentação (`relatorio_movimentacao_matriz`)

`app/(app)/relatorio-movimentacao/page.tsx` e `.../export/route.ts` não leem a tabela direto — chamam uma função SQL (`relatorio_movimentacao_matriz`, migration `066`) que já agrega dentro do Postgres. Essa função faz `join` com `produtos` (pra pegar tipo/família) e com `nota_fiscal_items`/`notas_fiscais` (pra pegar o preço mais recente).

**Não dá pra simplesmente instalar a mesma função no Contabo**: `produtos` é cadastro vivo (preço, descrição, tipo mudam toda hora), não histórico — duplicá-lo no Contabo significa mantê-lo sincronizado pra sempre, o que é um problema novo e desnecessário (essa tabela não tem motivo pra sair do Supabase, é pequena e sempre precisa estar atualizada).

**Decisão**: quando o período pedido cruzar os 90 dias, o módulo central busca as linhas cruas de `movimentos_historico` no Contabo (via `GET /movimentos_historico`) para a parte antiga, busca os metadados de produto e o preço mais recente **sempre no Supabase** (fonte única de verdade pra cadastro), e refaz a agregação (somar por rótulo+mês, mesmo agrupamento da função SQL) em código — só para a fração da consulta que caiu fora da janela quente. A parte dentro dos 90 dias continua chamando a RPC normalmente, sem mudança.

### Fallback na página de detalhe

Achado durante o brainstorming: como os `id` são preservados entre Supabase e Contabo, um link gerado pela busca global (ex: `/nota-fiscal/123`) continua "correto" mesmo se o registro já tiver sido podado — mas só se `app/(app)/nota-fiscal/[id]/page.tsx` também tentar o Contabo quando não achar no Supabase (usando `buscarNotasFiscais({ id })` do módulo central). Sem isso, a busca acha mas o clique dá 404. Esse arquivo entra no escopo, elevando de 13 para **14 arquivos**.

## Arquivos afetados (14), por prioridade

**Tier 1 — sem filtro de data nenhum hoje (risco mais alto, silencioso):**
- `lib/actions/busca-global.ts`
- `app/(app)/ordem-producao/relatorio/route.ts`
- `app/(app)/transferencia/relatorio/route.ts`
- `app/(app)/transferencia/page.tsx`
- `app/(app)/home/page.tsx` (card de contagem de OPs)

**Tier 2 — filtro de data controlado pelo usuário, sem teto:**
- `lib/resumo-dia.ts`
- `app/(app)/relatorio-movimentacao/page.tsx` + `.../export/route.ts`
- `app/(app)/nota-fiscal/relatorio/route.ts`
- `app/(app)/nota-fiscal/export/route.ts`
- `app/(app)/nota-fiscal/page.tsx`
- `app/(app)/ordem-producao/export/route.ts`
- `components/movimentacoes/MovimentosTab.tsx`
- `components/movimentacoes/HistoricoTab.tsx`
- `app/(app)/validade/page.tsx`

**Tier 3 — seguro por padrão, risco só se o usuário customizar o período:**
- `app/(app)/ordem-producao/page.tsx`

**Novo (fallback de link):**
- `app/(app)/nota-fiscal/[id]/page.tsx`

## Ordem de execução

1. Endpoints `GET` na `ntb-frio-api` (base pra tudo).
2. Módulo central `lib/historico-contabo.ts`.
3. Adaptar os 14 arquivos, Tier 1 primeiro.
4. Só depois de **todos** adaptados e testados: rodar a poda de 90 dias (reaproveitando o script `podar-supabase.mjs` já escrito na spec anterior, sem mudança).

Rodar a poda antes de terminar os 14 arquivos não tem vantagem prática (o espaço só é liberado quando as 5 tabelas forem podadas juntas) e aumenta a janela de risco.

## Segurança

- Nenhuma leitura muda de comportamento dentro dos 90 dias — é sempre Supabase puro, idêntico a hoje.
- Falha na API do Contabo nunca quebra uma página — só reduz o resultado ao que o Supabase tem.
- `produtos` nunca sai do Supabase nem é duplicado — evita um problema de sincronização novo.
- A poda (Task já definida na spec anterior) só roda depois que os 14 arquivos estiverem em produção e validados.

## Riscos

- Latência: consultas sem filtro de data (Tier 1) agora sempre fazem uma chamada HTTP extra pro Contabo — aceitável dado o volume de uso (não são listagens de milhares de linhas, são buscas pontuais/relatórios), mas vale medir depois de implementado.
- O caso do relatório de movimentação reimplementa em TypeScript uma agregação que hoje é só SQL — duplicação de lógica que pode divergir se a função SQL mudar de novo no futuro (já mudou 3 vezes: migrations 037, 038, 066). Mitigação: comentário cruzado nos dois lugares apontando um pro outro.
