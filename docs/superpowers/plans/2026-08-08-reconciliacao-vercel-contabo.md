# Reconciliação Vercel/Supabase-cloud × Contabo — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans ou
> superpowers:subagent-driven-development pra executar este plano
> task-by-task.

**Goal:** Trazer pro Contabo (o banco oficial) todo o histórico real de
`inventarios`, `inventario_items` e `transferencias` que existe só no
Supabase cloud (ou diverge dele por colisão de id), sem duplicar,
sobrescrever ou perder nada dos dois lados, e documentar o incidente de
forma durável.

**Architecture:** Dump de segurança primeiro → verificação completa
contra a Omie (fonte de verdade externa) → reconciliação por INSERT-only
com remapeamento de id, pai antes de filho → verificação final na UI real
→ documentação. Nunca UPDATE/DELETE em linha que já existe no Contabo.

**Tech Stack:** Postgres (Contabo self-hosted + Supabase cloud), SQL via
`psql`/SSH, REST API do Supabase cloud (`.env.local`), API da Omie.

**Spec:** `docs/superpowers/specs/2026-08-08-reconciliacao-vercel-contabo-design.md`

---

## Global Constraints

1. **Produção real, sem staging.** Toda verificação usa SQL/API real
   contra os dois bancos e a Omie.
2. **REGRA DE OURO: nunca UPDATE nem DELETE em nenhuma linha que já
   existe no Contabo.** Só INSERT de linha nova, com id remapeado
   (acima do maior id já existente na tabela, no Contabo), preservando
   conteúdo/timestamp/usuário original. Se qualquer task concluir que
   precisa de UPDATE/DELETE em dado já existente no Contabo pra terminar
   — PARE e escale pro usuário. Isso significa que a premissa do plano
   está errada pra aquele caso, não é uma decisão de implementação.
3. **Testar com 1-2 registros antes de rodar em lote**, em qualquer
   script de escrita.
4. **Achado incidental já levantado neste planejamento, para as 3
   tabelas** (`inventarios`, `inventario_items`, `transferencias`): todas
   têm um `outbox_trigger AFTER INSERT OR DELETE OR UPDATE ... EXECUTE
   FUNCTION outbox_capture()`, que grava uma cópia JSON de cada linha
   inserida/alterada/apagada na tabela `outbox` (32,5 MILHÕES de linhas
   hoje, crescendo continuamente — claramente já é o comportamento normal
   de escrita neste banco, não algo exclusivo deste plano). Não foi
   encontrado, nesta sessão, nenhum código no repositório que LEIA da
   tabela `outbox` — pode ser consumida por um processo fora do repo
   (mesmo padrão de outros serviços deste projeto, como `ntb-frio-api`,
   que vivem só no servidor). **Antes de rodar qualquer INSERT em lote
   nas 3 tabelas, confirme no servidor (`ps aux`, `systemctl
   list-units`, `crontab -l`, procurar por qualquer processo consumindo
   `outbox`) se existe um consumidor ativo, e o que ele faz com o dado.**
   Se não achar nenhum consumidor, documente isso explicitamente e
   prossiga (a tabela provavelmente é só um log de auditoria/CDC
   histórico, sem efeito colateral) — mas não presuma sem checar.
5. **`transferencias` tem uma tabela filha própria**: `movimentos`
   referencia `transferencias(id)` via `transferencia_id_fkey`. Ao
   reconciliar `transferencias`, verifique se existem linhas de
   `movimentos` no Supabase cloud apontando pras transferências
   reconciliadas — se existirem, elas também precisam ser inseridas no
   Contabo com a FK remapeada pro novo id da transferência (mesmo padrão
   do par `inventarios`/`inventario_items`).
6. **Nenhum script temporário de teste/investigação fica commitado no
   repo.** Criar em `scripts/` só se necessário, apagar ao final (mesmo
   padrão já usado a sessão inteira).
7. **Se qualquer task encontrar dado que contradiga o escopo já
   confirmado no Bloco 0/spec** (ex.: mais uma tabela divergente não
   listada, um padrão diferente do esperado nos dados), reportar
   claramente e não prosseguir com suposição.

## Acesso a produção

**Contabo (Postgres self-hosted, o banco oficial):**
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c \"<SQL>\""
```

**Supabase cloud (REST API, service role):**
```js
// credenciais em .env.local deste repo: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
fetch(`${url}/rest/v1/<tabela>?select=*&...`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
```

**Conta QA (verificação final na UI):** `claude.qa@ntb-estoque.dev` /
`claudeqa123456` contra `https://app-estoque.norteparanegocios.com.br`.

## Schemas confirmados (não precisa reler, já verificado nesta sessão)

```
inventarios: id (bigint, PK, seq), loja_id (bigint, FK lojas), codigo_local_estoque (bigint),
  data (timestamptz), tipo (varchar3, default 'SLD'), origem (varchar3, default 'AJU'),
  motivo (varchar3, default 'INV'), finalizado (timestamptz, nullable), status (varchar30),
  created_at, updated_at (timestamptz), user_id (uuid, FK profiles, ON DELETE SET NULL)

inventario_items: id (bigint, PK, seq), loja_id (bigint, FK lojas), inventario_id (bigint,
  FK inventarios ON DELETE CASCADE), produto_codigo_produto (bigint), produto_codigo (varchar60),
  produto_descricao (varchar120), produto_familia (varchar50), quan (numeric20,6),
  valor (numeric20,6), response (text), codigo_status (varchar20), descricao_status (text),
  id_movest (bigint), id_ajuste (bigint), status (varchar30), created_at, updated_at

transferencias: id (bigint, PK, seq), loja_id (bigint, FK lojas), codigo_local_origem (bigint),
  codigo_local_destino (bigint), motivo (varchar50), data (timestamptz), status (varchar30),
  created_at, updated_at, user_id (uuid, FK profiles, ON DELETE SET NULL)
  -- referenciada por: movimentos.transferencia_id_fkey
```

---

## Task 1 (Bloco 0): Dump de segurança

**Files:**
- Create: `docs/incidente-divergencia-vercel-contabo-2026-08-08-dump-bruto.json`
  (ou dividido em 3 arquivos por tabela, se ficar grande demais — usar
  julgamento; se passar de uns 20MB, considerar comprimir/`gzip` e ainda
  assim versionar, não deixar só em `.superpowers/`)

**Step 1:** Buscar, via REST API do Supabase cloud, TODAS as linhas de
`inventarios` com `id >= 203`, todas as `inventario_items` com
`inventario_id >= 203` (ou `created_at` após 2026-07-31 16:39 UTC, o que
capturar mais completamente — confirme qual filtro é mais preciso antes
de rodar em lote), e todas as `transferencias` com `id >= 558`.

**Step 2:** Buscar, via SSH/psql no Contabo, as MESMAS faixas de id nas 3
tabelas (o que já existe lá, pra registrar o "antes" e permitir comparação
posterior).

**Step 3:** Salvar tudo (cloud + Contabo, lado a lado, com metadado de
origem e timestamp de quando o dump foi feito) no(s) arquivo(s) acima.

**Step 4:** Commit.
```bash
git add docs/incidente-divergencia-vercel-contabo-2026-08-08-dump-bruto*.json
git commit -m "docs: dump de seguranca pre-reconciliacao Vercel x Contabo"
git push origin main
```

**Step 5:** Relatório da task deve incluir: quantas linhas foram
capturadas por tabela/origem, e confirmação de que o arquivo foi commitado
e pushado (rede de segurança fora dos dois bancos).

---

## Task 2 (Bloco 1): Verificação completa contra a Omie

**Contexto:** já foi confirmado, numa amostra de 13/46 inventários
divergentes (57 itens com `id_ajuste` não-nulo), que **57/57 ajustes
batem exatos na Omie** via `ListarAjusteEstoque` filtrando por
`cod_int_ajuste = "ITEM${item.id}"` (ver `lib/actions/inventario.ts`
deste repo pro código exato do vínculo — `id_ajuste` pode vir `0` quando
a Omie recusa por já bater o saldo, isso é esperado e não é gap).

**Step 1:** Estender essa verificação pros 46 inventários divergentes
completos (todos os ids do Task 1/dump, tanto os só-cloud quanto os que
colidem com conteúdo diferente no Contabo).

**Step 2:** Pra cada inventário, listar os `inventario_items` filhos
(cloud e/ou Contabo, conforme onde o inventário existe) com `id_ajuste`
não-nulo e não-zero, e confirmar via `ListarAjusteEstoque` que cada um
existe de verdade na Omie com a mesma quantidade.

**Step 3:** Documentar o resultado completo. Se algum item aparecer como
"ajuste fantasma" (marcado como concluído localmente mas não encontrado
na Omie) — **isso NÃO bloqueia as Tasks 3/4**, é um achado à parte:
documente claramente no relatório desta task (qual inventário/item, qual
loja, evidência de que não foi encontrado) e sinalize como pendência de
investigação separada. Itens com `status = 'Sem CMC'` são esperados
como sem ajuste real (limitação já conhecida, fora de escopo).

**Step 4:** Escrever um resumo dessa verificação (não precisa ser um doc
separado — pode ser uma seção que a Task 5 vai incorporar no doc final).

---

## Task 3 (Bloco 2): Reconciliar `inventarios` + `inventario_items`

**Contexto:** pai e filho andam juntos nesta task porque a FK de item
depende do id (novo) do inventário reconciliado.

**Step 1 — Confirmar o consumidor do outbox (Global Constraint 4):** antes
de qualquer INSERT, investigue no servidor Contabo se algo consome a
tabela `outbox`. Documente o achado (existe ou não, o que faz).

**Step 2 — Levantar o maior id atual em cada tabela no Contabo:**
```sql
select max(id) from inventarios;      -- base pro remapeamento do pai
select max(id) from inventario_items; -- base pro remapeamento do filho
```

**Step 3 — Identificar as linhas a reconciliar:** usando o dump da Task 1
+ o resultado da Task 2, monte a lista final de `inventarios` que
precisam ser inseridos no Contabo (existem só no cloud, OU existem com
conteúdo diferente do que já está no Contabo pro mesmo id — nesse
segundo caso, a linha do CLOUD é a que falta, a do Contabo já está lá e
não se mexe). Para cada um desses inventários, pegue os `inventario_items`
filhos correspondentes no cloud.

**Step 4 — Testar com 1-2 inventários primeiro:** monte o INSERT (id novo
= maior id do Contabo + N, mantendo todas as outras colunas idênticas ao
original do cloud) pra 1-2 casos, rode, confirme visualmente (SQL de
conferência: contagem de itens do inventário reconciliado bate com a
origem? soma de `quan`/`valor` por produto bate?).

**Step 5 — Rodar em lote pros demais**, com o mesmo padrão validado no
Step 4. Cada `inventario_items` inserido deve apontar pro NOVO id do seu
inventário pai (não o id original do cloud).

**Step 6 — Validação pós-inserção:**
```sql
-- contagem de inventarios reconciliados bate com o esperado?
select count(*) from inventarios where id > <maior_id_original_do_contabo>;

-- cada inventario reconciliado tem a mesma contagem de itens que tinha no cloud?
-- (comparar item a item usando o dump da Task 1)
```

**Step 7:** Relatório da task: quantos inventários e itens foram
inseridos, os comandos/SQL exatos usados (reproduzíveis), resultado da
validação, e o achado do Step 1 (outbox).

---

## Task 4 (Bloco 3): Reconciliar `transferencias`

**Step 1 — Investigar rastro na Omie:** leia
`lib/actions/transferencia.ts` (ou equivalente neste repo — confirme o
nome exato do arquivo) pra descobrir se uma transferência gera algum
registro rastreável na Omie (ex. outro tipo de ajuste de estoque). Se
existir, use o mesmo padrão de verificação da Task 2 pra validar contra a
Omie. Se não existir, documente isso como limitação — a verificação
dessas linhas será só por concordância entre os dois bancos + revisão
manual das duplicatas descartadas no Step 3.

**Step 2 — Levantar o maior id atual e checar `movimentos` filhos**
(Global Constraint 5): confirme se existe alguma linha de `movimentos` no
Supabase cloud com `transferencia_id` apontando pras transferências
divergentes — se existir, ela entra no escopo desta task também (mesmo
padrão de remapeamento de FK que `inventario_items`).

**Step 3 — Aplicar a regra de deduplicação da spec:** para cada
transferência que existe só no cloud OU colide em id com conteúdo
diferente no Contabo, comparar contra as transferências do Contabo na
MESMA loja: mesma loja + produto + quantidade + local origem/destino +
data (tolerância de mesmo dia) = mesmo evento → é duplicata, NÃO inserir
a cópia do cloud, mas REGISTRAR no relatório da task (id do cloud, id do
Contabo que já cobre o mesmo evento). Sem esse casamento = evento real
diferente → inserir remapeado, mesmo padrão da Task 3 (id novo acima do
maior id do Contabo, preservando conteúdo/timestamp/usuário original, e
remapeando `movimentos` filhos se houver).

**Step 4 — Testar com 1-2 casos antes de rodar em lote**, mesmo padrão
das tasks anteriores.

**Step 5 — Validação pós-inserção:** contagem final bate com
(contagem original do Contabo + inseridas − duplicatas descartadas)?

**Step 6:** Relatório da task: quantas transferências inseridas, quantas
descartadas por duplicata (com a lista de pares id-cloud/id-contabo),
resultado da investigação do Step 1, comandos/SQL exatos usados.

---

## Task 5 (Bloco 4): Verificação final + documentação

**Step 1 — Conferência final nas 3 tabelas:**
```sql
-- pra cada tabela: contagem final Contabo = contagem original + inseridos (sem duplicar)
select count(*) from inventarios;
select count(*) from inventario_items;
select count(*) from transferencias;
```
Compare com os números documentados nas Tasks 3/4.

**Step 2 — Checagem na UI real** (conta QA, produção): abra a tela de
Inventários e a de Transferências pra pelo menos 2-3 lojas afetadas
(lojas 2, 4, 6 — as mais envolvidas), confirme visualmente que os
registros reconciliados aparecem corretamente (data certa, produto certo,
quantidade certa) e que nada duplicou.

**Step 3 — Escrever o doc final:**
`docs/incidente-divergencia-vercel-contabo-2026-08-08.md` — cobrindo:
causa raiz (Contabo nasceu como réplica lógica do Supabase cloud, mesma
auth, 4 usuários usando os dois sistemas sem perceber), escopo exato
(tabela por tabela, números confirmados), resultado completo do
cruzamento contra a Omie (Task 2 + Task 4 Step 1), o que foi reconciliado
e como (Tasks 3/4), duplicatas descartadas, achados fora de escopo (9
itens de inventário sem CMC válido — bug pré-existente; metadado local de
`ordens_producao` que não volta do sync da Omie), e uma seção final de
"próximos passos" mencionando que aposentar o Vercel/Supabase cloud é uma
FASE SEPARADA, não incluída neste plano, que precisa de confirmação
explícita do usuário antes de executar.

**Step 4:** Commit e push.
```bash
git add docs/incidente-divergencia-vercel-contabo-2026-08-08.md
git commit -m "docs: incidente de divergencia Vercel/Supabase-cloud x Contabo - reconciliado"
git push origin main
```

---

## Execution Handoff

Dado o risco real de escrita em produção sem possibilidade de desfazer
(REGRA DE OURO: só INSERT, nunca UPDATE/DELETE em dado existente — mas
mesmo um INSERT errado, com id/FK trocados, é difícil de reverter
limpo), as Tasks 3 e 4 (as únicas que escrevem em produção) precisam de
revisão extra rigorosa antes de serem consideradas concluídas — mesmo
padrão da auditoria de relatórios anterior desta sessão, que só pegou 2
incidentes reais de produção porque as revisões foram céticas e
verificaram com dado real em vez de aceitar o relatório do implementador
de cara.

**Duas opções de execução:**

1. **Subagent-Driven (nesta sessão)** — despacho um subagent implementador
   por task, revisão cética entre tasks (com verificação independente via
   SQL real, não só aceitar o relatório), iteração rápida.
2. **Sessão paralela** — nova sessão com `executing-plans`, execução em
   lote com checkpoints.

Qual abordagem?
