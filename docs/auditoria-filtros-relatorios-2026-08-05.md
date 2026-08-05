# Auditoria de filtros e completude de dados nos relatórios — 2026-08-04/05

Plano: `docs/superpowers/plans/2026-08-04-auditoria-filtros-relatorios.md`
Spec: `docs/superpowers/specs/2026-08-04-auditoria-filtros-relatorios-design.md`

Gatilho: queixa verbal ("Compras faltando os meses atuais, faturamento,
filtros de produção") + itens abertos da reunião de 03/08 com o Ramon
(`docs/reuniao-2026-08-03-ramon-pedidos.md`, itens #8/#9/#10/#11/#15).

26 commits, 10 tasks + 3 rodadas de revisão final ampla. Executado via
subagent-driven-development, com investigação e teste sempre contra dado
real de produção (este projeto não tem staging).

## Bugs reais confirmados e corrigidos

1. **Migration `097_filtro_status_compras_auditoria.sql` nunca aplicada em
   produção** (achado da Task 2) — as RPCs de Compras/Auditoria Fiscal
   falhavam com `function ... does not exist`, erro nunca checado pelo
   código, zerando silenciosamente o total dos últimos ~90 dias em **todas
   as 6 lojas**. Bate exatamente com a queixa original. Corrigido aplicando
   097+098 em produção.
2. **Mais 5 migrations no mesmo estado** (achado da revisão final, C1):
   `087`, `089`, `091`, `095`, `096` — nenhuma tinha sido aplicada. A `091`
   quebrava AO VIVO o toggle "por local" do Estoque Valorizado
   (`R$0,00` silencioso). Todas aplicadas; overloads duplicados/obsoletos
   de `relatorio_auditoria_fiscal_cfop/itens` removidos.
3. **`tipo='SLD'` (ajuste de inventário) tratado como movimento de estoque**
   em vez de saldo contado (Task 6) — chegou a ir pro ar uma vez tratando
   contagens de inventário como "entrada" em R$, produzindo números
   absurdos (um erro de digitação de contagem virou R$67,7 milhões de
   "entrada manual"). Corrigido: SLD saiu do total em R$, virou seção
   própria ("saldo contado no inventário", só contagem de eventos).
4. **Filtro de tipo/família/produto/local em Nota Fiscal zerava
   silenciosamente com erro 414 (URI Too Long)** quando a lista de ids/
   códigos ficava grande (Task 10) — nada a ver com o fix de cross-90-dias
   de 26/07 que estava sendo investigado (esse continua funcionando).
   Corrigido com paginação em lotes (`buscarTodosPorIds`).
5. **"Imprimir atrasadas"/"Necessidade de MP"** (Produção, item #3 da
   reunião) — causa raiz era o filtro de MÊS restringindo a busca mesmo no
   modo "atraso", escondendo OPs atrasadas de meses anteriores (não o
   filtro de local, como se pensava).
6. **Nota Fiscal: tela e export/PDF aplicavam filtros diferentes**
   (achado da revisão final, I3) — família/local/natureza não chegavam no
   export/relatório; fornecedor com vírgula/parênteses quebrava o filtro
   `.or()`. Divergência medida de até 4,4x entre tela e Excel/PDF.
   Corrigido nos 3 arquivos.

## Confirmado como "não é bug" (sem código desnecessário)

- **Faturamento** (#8): filtro processado/cancelado já existe dentro de
  "Ver cupons" — era descoberta, não bug. Adicionado só um texto discreto
  apontando o caminho.
- **Indicadores**: `status: 'CONCLUIDA'` hardcoded é decisão deliberada de
  reunião anterior, não bug. Quantificado o impacto (R$185.806,42 / 2,66%
  agregado) e deixado como pendente de confirmar com o Ramon.
- **Margem**: filtro de local é um proxy correto (só filtra quais produtos
  aparecem, não recalcula margem por local) — testado com produto real.
- **Auditoria Fiscal**: filtro de status não perde dado (chips fora da
  gaveta é só inconsistência de UX, não corrigida por não ter sido pedida).
- **Estoque Valorizado**: paginação correta, sem cap de 1000 linhas.

## Riscos sistêmicos documentados em `AGENTS.md` (seção nova)

- Migrations chegam em produção só à mão (`psql` direto), sem nenhum
  tracking — já causou bug real 2x (6 migrations no total nesta auditoria).
- `deploy.sh` (no servidor, não versionado) não limpa `.next` entre builds
  — já causou 1 build stale confirmado durante a Task 10.
- `components/movimentacoes/MovimentosTab.tsx:78` e
  `lib/movimentacao-operacao-auto.ts` (~236-246) têm o MESMO erro conceitual
  do item 3 acima (SLD tratado como movimento assinado / valor unitário sem
  multiplicar por quantidade) — **não corrigidos**, só marcados com
  comentário `SUPERSEDED` apontando pro código corrigido. Afetam os cards
  "Perdas reais"/"Ajuste por inventário" no modo "Por operação", 5 das 6
  lojas.
- `transferencia` e `inventario` (`page.tsx`/`export/route.ts`/
  `relatorio/route.ts`) usam o mesmo padrão `.in(idsFiltrados)` sem quebrar
  em lotes que causou o bug #4 acima em Nota Fiscal — não auditado.
- `lib/supabase/rpc-todos.ts` foi hardened (loga erro real em vez de tratar
  qualquer falha como "fim das páginas"), mas 3 cópias locais do mesmo
  padrão continuam sem o fix: `relatorio-compras/export/route.ts`,
  `relatorio-compras/export-completo/route.ts`,
  `relatorio-movimentacao/export/route.ts`.
- `.env.local` local (dev) ainda aponta pro Supabase cloud descontinuado.

## Itens pendentes de confirmação com o Ramon

- **Indicadores**: se ele quer o filtro de status Pendente/Manifestada/
  Cancelada também nessa tela (hoje só em Compras/Faturamento/Auditoria).
- **Movimentações, item #15**: dimensão "situação" — pedido cortado na
  transcrição da reunião, não dá pra inferir o que significa.

## Achado incidental fora do escopo original

- Divergências pré-existentes de `webhooks` entre Supabase e o espelho
  Contabo nos dias 25-31/07 (até 11/dia faltando; 31/07 com 174 a mais no
  frio) — artefato do corte de failover daquela data, não investigado a
  fundo aqui.

## Achado fora do plano original, resolvido em 2026-08-06

Queixa do usuário: "concluir todas as OPs" às vezes deixava OP parecendo
com problema. Investigado com dado real (25 OPs concluídas recentes,
cruzadas ao vivo contra a Omie) — **não achei nenhum mismatch ativo**
(`concluida=true` sempre bateu com a Omie de verdade). Achei, em vez disso,
a causa provável da confusão: `conclusao_status`/`conclusao_erro_msg`
ficavam presos em "Erro" numa OP que na verdade já tinha concluído certo,
porque o sync (`syncOrdensProducao`/`fetchOrdemProducao` →
`mapOutrasInf`) nunca limpava esses campos ao descobrir `concluida=true`
— só o caminho direto de conclusão fazia isso. Corrigido (`mapOutrasInf`
agora limpa os 3 campos quando `cConcluida='S'`); também melhorado o toast
de erro do "concluir selecionadas" pra mostrar o número de cada OP que
falhou, não só uma mensagem genérica. 54 OPs com esse estado sujo
pré-existente (lojas 3/4/6) foram corrigidas via UPDATE direto no banco.
Não corrigido (fora de escopo desta rodada, registrado como follow-up): a
integração ntb-vendas (`app/api/integracao/ordem-producao/route.ts`) tem
um gap de robustez onde, se o sync pós-conclusão falhar, a Omie fica
concluída mas o NTB Estoque mostra pendente.

## Como isso foi verificado

Cada task seguiu: investigar com SQL real (Postgres de produção via SSH
+ API `ntb-frio-api`) → classificar (bug/feature/pendente) → corrigir se
aplicável → deploy síncrono → revalidar com a mesma query/conta QA. A
revisão final passou por 3 rodadas (revisão ampla → fix wave → re-revisão
escopada, repetido até achado zero pendência real) — pegou, entre outras
coisas, as 5 migrations extras não aplicadas e a divergência de filtro de
fornecedor, que uma revisão só por task não teria capturado.
