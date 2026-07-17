<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Arquitetura de histórico: Supabase (operacional) + Contabo (histórico completo)

O Supabase é o banco free tier (500MB) e guarda só os **últimos 90 dias** de dados
transacionais. O histórico completo (desde 2025-07, "pra sempre" a partir de agora)
mora num Postgres próprio no servidor Contabo (`185.193.66.240`), fora do Supabase,
sem limite de espaço.

**Tabelas cobertas:** `movimentos`, `movimentos_historico`, `notas_fiscais`,
`nota_fiscal_items`, `ordens_producao`, `webhooks`. Fora disso (cadastro, não
histórico): `produtos`, `clientes`, `fornecedores`, `lojas` — só no Supabase, nunca
duplicados no Contabo.

### Como o dado chega no Contabo

1. **Dual-write em tempo real** — `app/api/webhook/route.ts` grava cada webhook
   também no Contabo, fire-and-forget, logo após o insert no Supabase (nunca
   bloqueia nem quebra a resposta se o Contabo falhar).
2. **Backfill histórico** (já executado, não precisa rodar de novo) — copiou o que
   já existia no Supabase e completou via API do Omie o que faltava
   (`docs/superpowers/plans/2026-07-12-backfill-historico-1ano-contabo.md`).

### Como o app lê o histórico

`lib/historico-contabo.ts` é o módulo central — nenhuma tela fala direto com o
Contabo. Expõe uma função por tabela (`complementarNotasFiscais`,
`complementarOrdensProducao`, `complementarMovimentos`,
`complementarMovimentosHistorico`, `complementarNotaFiscalItems`) com o mesmo
contrato: recebe as linhas já lidas do Supabase, decide se precisa completar com o
Contabo (sempre que não há filtro de data, ou quando o período pedido cruza os
90 dias), mescla por `id` (dedupe automático) e devolve um array único — a tela
nem sabe que existem duas fontes. Se a API do Contabo falhar ou demorar mais que
5s, devolve só o que o Supabase tem; nunca quebra a página.

Para contagens que não podem ser truncadas por LIMIT (ex: card "total de OPs" na
home), usa `contarOrdensProducaoAntigas` — chama o endpoint com `count=true`
(faz `count(*)` no Postgres, não busca linhas).

Caso especial: `app/(app)/relatorio-movimentacao/` não lê tabela direto, chama a
RPC `relatorio_movimentacao_matriz` (SQL, faz join com `produtos`). Como `produtos`
não pode ser duplicado no Contabo, quando o período cruza os 90 dias a parte antiga
é buscada como linhas cruas (`buscarMovimentosHistoricoBrutos`) e reagregada em JS
(`agregarMovimentacaoJS`) usando metadados de produto/preço sempre do Supabase.

**17 arquivos adaptados** (busca global, relatórios de OP/NF/movimentação,
telas de OP/NF/movimentações/histórico/validade, home, transferências) — ver
`docs/superpowers/plans/2026-07-12-leitura-hibrida-contabo.md` para a lista completa
e o código de cada adaptação.

### A API do Contabo (`ntb-frio-api`)

Roda em `/opt/ntb-frio-api/server.js` no servidor Contabo (fora deste repo git —
não existe cópia local do arquivo, só no servidor), systemd service `ntb-frio-api`,
exposta em `https://frio-api.norteparanegocios.com.br`, autenticada por
`X-Api-Key` (`NTB_FRIO_API_URL`/`NTB_FRIO_API_KEY` no `.env.local` e na Vercel).
Endpoints: `POST /webhooks` (dual-write) e `GET /movimentos`,
`GET /movimentos_historico`, `GET /notas_fiscais`, `GET /nota_fiscal_items`,
`GET /ordens_producao` (leitura, aceitam `count=true` para contagem sem LIMIT).

**Detalhe de driver importante:** o `pg` do Node retorna `bigint` como string e
`date` como objeto `Date` completo por padrão — o `server.js` configura
`types.setTypeParser` pros OIDs 20 (bigint) e 1082 (date) pra normalizar isso
(number puro e string `YYYY-MM-DD` respectivamente). Sem isso, o dedup por `id`
no cliente falha silenciosamente (string `"123"` ≠ number `123`) e datas quebram
na formatação. Se algum endpoint novo for adicionado à API, checar se ele também
precisa dessa normalização.

## Reunião com o Ramon de 2026-07-14 (transcrita via `/etl-audio`) e priorização pós-reunião

Reunião de ~55min testando ao vivo o app com o Ramon (opera o sistema nas
lojas reais Donana Rio Vermelho e Vinhas & Vinhetos). Lista completa de
achados, priorização combinada com o usuário (relatórios financeiros —
Margem/Faturamento/Auditoria Fiscal/Compras — viram fase própria, deixada
pro final) e o spec da primeira fase (renomeações, previsão editável,
triangulação de produto substituto, clareza visual de Transferências,
link produto→Movimentos): ver
`docs/superpowers/specs/2026-07-15-fase-a-melhorias-pos-reuniao-design.md`.

Achado relevante da pesquisa pré-spec: os 4 relatórios financeiros acima
**nunca foram migrados** pro padrão híbrido Supabase+Contabo já descrito
no topo deste arquivo (só leem Supabase, perdem dado silenciosamente além
dos 90 dias) — isso é o essencial da fase final, não um backfill novo do
zero.

## Leitura híbrida dos relatórios de NF (Compras, Auditoria Fiscal, Indicadores) — 2026-07-17

Esses 3 relatórios liam só o Supabase (janela de 90 dias) e perdiam
silenciosamente jan–abril. Agora usam leitura híbrida via
`lib/relatorio-frio-nf.ts`: quando o período pedido começa antes do corte
de 90 dias, a fatia antiga vem do Contabo (endpoints `/nota_fiscal_items`
+ `/notas_fiscais`) e é reagregada em JS, espelhando fielmente o
WHERE/GROUP BY das RPCs `relatorio_compras_*` (migration 075) e
`relatorio_auditoria_fiscal_*` (076). Mesmo padrão do precedente
`agregarMovimentacaoJS`. **Se essas RPCs mudarem, replicar a mudança em
`relatorio-frio-nf.ts` também.** Validado: a agregação JS bateu exato com
o SQL equivalente (R$173.463,56 / 135 notas, loja 2, jan–abr).

**Pré-requisito de dado resolvido nesta data:** os itens de NF antigos no
Contabo tinham `full_object` **vazio** (a cópia inicial de 07-12 trouxe as
linhas sem o JSONB, e é dele que saem CFOP de entrada, crédito de ICMS e
`codigo_local_estoque`). Backfill retroativo puxou tudo de novo do Omie
(`ListarRecebimentos`, `cExibirDetalhes=S`, desde 01/07/2025) e fez
`update` só nas linhas existentes (nunca insert/delete). O
`prune` cron **não apaga NF** (só webhooks + integration_attempts), então
não há risco de o buraco voltar por poda. Se `full_object` voltar a faltar
no Contabo no futuro (ex.: nova cópia de histórico que não traga o JSONB),
rodar de novo um backfill no mesmo molde (script foi ad-hoc, fora do repo).

### Limitações conhecidas

- `webhooks` anteriores a 2026-07-05 foram perdidos pelo prune de 7 dias que já
  existia antes do dual-write — não são recuperáveis (Omie não tem endpoint pra
  "listar webhooks antigos"). Dual-write garante que não se perde mais nada dali
  pra frente.
- Filtro de tipo/família/produto em `nota-fiscal/page.tsx` quando o período cruza
  os 90 dias só enxerga notas que já tinham itens correspondentes no Supabase — o
  cruzamento com o Contabo não foi implementado para esse caso específico.
