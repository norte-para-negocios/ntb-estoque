# Estoque local independente da Omie — lojas de teste — Design

**Data:** 2026-08-18

**Pedido do usuário:** o NTB Estoque deve ficar capaz de dar baixa de
estoque via Ordem de Produção **sem depender da Omie**, ligado ao NTB
Vendas — mas só nas **lojas de teste** (as 6 gêmeas `is_test=true` de
migration 117), nunca nas lojas reais. Pedido explícito de plano +
execução imediata ("já executa").

## Contexto já investigado (não re-investigar)

**Duas bases de dados, achado real desta sessão (ver
`reference_ntb_dual_databases` na memória):** `NEXT_PUBLIC_SUPABASE_URL`
do `.env.local` deste repo aponta pro Supabase Cloud **descontinuado**
(`waubqgkftwrufepwhctc.supabase.co`). O banco real por trás de
`app-estoque.norteparanegocios.com.br` é o Postgres self-hosted no
Contabo (`185.193.66.240`, container `supabase-db`, banco `postgres`,
usuário `supabase_admin`). Toda mudança de schema deste plano vai só
nesse banco — o Cloud project é irrelevante/congelado.

**Mecanismo `is_test` já existe e já funciona (migration 117 +
`lib/omie/client.ts`):** cada uma das 6 lojas ativas tem uma gêmea
`is_test=true` (mesma `omie_app_key`/`omie_app_secret`, só pra
LEITURA). `omieRequest()` intercepta toda call de ESCRITA (regex
`/^(Incluir|Alterar|Excluir|Concluir|Reverter)/`) quando `is_test=true`
e devolve `respostaSimulada()` — um objeto fake com IDs negativos
únicos, sem nenhuma chamada HTTP real à Omie. Loga em
`integration_attempts` com `model` prefixado `[SIMULADO]`.

**`app/api/integracao/ordem-producao/route.ts` (a rota REAL, que o
`ntb-vendas` já chama via `triggerOrdemProducao()`) já trata
`loja.is_test` no bloco `finally`**: em vez de `fetchOrdemProducao`
(que reconsultaria a Omie real e nunca acharia nada), grava direto na
tabela real `ordens_producao` com `loja_id` da loja de TESTE — como é
um `loja_id` distinto da loja real, já fica isolado de qualquer
relatório por loja sem trabalho extra. **O que falta: nenhuma baixa de
estoque de verdade acontece** — `respostaSimulada()` só finge sucesso,
nenhuma tabela de saldo é tocada. Essa é a lacuna documentada em
AGENTS.md ("Limitação conhecida... lojas de teste também não têm
produto/local sincronizado localmente").

**Existe uma tentativa anterior (2026-08-12), mais estreita, e está
ABANDONADA — confirmado nesta sessão, não reaproveitar:**
`app/api/integracao/ordem-producao-teste/route.ts` +
`ordens_producao_teste` (migration 108) + `lojas.integracao_teste_api_key`
— rota separada, só pra Sertão, nunca ligada de verdade no lado
`ntb-vendas` (`ordens_producao_teste` tem exatamente 1 linha, um probe
manual). O mecanismo `is_test` genérico (acima) veio depois e é o que
está realmente em produção hoje — confirmado via `integration_attempts`
(lojas 9/12 = gêmeas teste de Vinhas/Sertão, entradas `[SIMULADO]`
recentes; lojas 4/7 = reais, zero `Incluir/ConcluirOrdemProducao` nos
últimos dias, só leitura). Este plano constrói em cima do mecanismo
`is_test` genérico, não da rota `-teste` antiga (fora de escopo tocar
nela — nem apagar, nem estender).

**Confirmado nos dois bancos do `ntb-vendas` (Cloud + self-hosted
`testvendase`): só "Vieras e Vinhos" e "O Sertão Vai Virar Mar" têm
`store_ntb_estoque_secrets` configurado** — as 4 lojas Donana reais não
têm a integração ligada ainda. `testvendase` (onde o usuário testa) já
autentica como as gêmeas de TESTE no `ntb-estoque` (loja 12 = [TESTE]
Sertão, loja 9 = [TESTE] Vinhas) — confirmado via
`integration_attempts`, nenhuma chamada real recente pras lojas reais
4/7 a partir daí. **`testvendase` não é loja real — é seguro estender.**

**Receita de produto ("ficha técnica") não existe localmente hoje —
vive inteira dentro da Omie**, lida via `consultarEstrutura(loja,
codigoProduto)` (`lib/omie/malha.ts`, `v1/geral/malha` /
`ConsultarEstrutura`, só leitura, nunca escreve — regra crítica
documentada: "a malha mexe nos itens reais do produto e só deve ser
editada com o Ramon"). Devolve `{ ident, itens: [{ idProdMalha,
codProdMalha, quantProdMalha, percPerdaProdMalha, ... }] }` ou `null`
se o produto não tem estrutura cadastrada. Já é chamada com sucesso
(inclusive pra loja de teste, porque LEITURA nunca é bloqueada pelo
gate) em `lib/actions/ordem-producao.ts`/`lib/actions/estrutura.ts`.

**`produtos.codigo_produto`** (bigint, sincronizado via `/api/sync/produtos`)
é o mesmo valor usado como `idProduto`/`nCodProduto` em toda chamada Omie
— é o identificador a usar em toda tabela nova deste plano.

## Decisão de arquitetura

**Onde ligar a baixa de estoque local: dentro do bloco `is_test` já
existente em `app/api/integracao/ordem-producao/route.ts`, logo após
`concluirOrdemProducao` "suceder"** (a chamada simulada sempre sucede,
nunca lança) — aditivo, não uma reescrita. A rota real continua sem
NENHUMA mudança de comportamento pra `is_test=false`.

**Receita: continua lida da Omie (`consultarEstrutura`, só leitura),
nunca escrita — mas agora sincronizada pra uma tabela local
(`ficha_tecnica_local`) que passa a ser a fonte usada em tempo de
execução.** Isso resolve os dois lados do pedido do usuário: hoje ganha
independência de verdade no caminho caro/arriscado (escrita: rate
limit, "sem estrutura", latência de rede — o que efetivamente trava um
teste), e já fica pronto pro dia em que a leitura também precisar
parar de depender da Omie (só trocar a fonte do sync, o resto do
sistema não muda).

**Saldo inicial: espelhado de `posicao_estoques` da própria loja de
teste** (que já é sincronizável hoje via `/api/sync/posicao`
disparado manualmente — mecanismo documentado, não é novo) — copiado
pra uma tabela PRÓPRIA (`estoque_local_saldos`), não mutado direto em
`posicao_estoques`, porque essa tabela é resincronizada por leitura a
qualquer momento e sobrescreveria qualquer baixa local feita depois.

## Tabelas novas (schema)

Todas com `loja_id references lojas(id)`, zero índice/FK/menção em
`ordens_producao`, `movimentos`, `posicao_estoques` reais ou em
qualquer relatório existente — mesmo princípio de isolamento já usado
em `ordens_producao_teste` (migration 108), só que ligadas ao mecanismo
`is_test` que está realmente em uso.

```sql
create table ficha_tecnica_local (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,       -- produto final (o que a venda pede)
  codigo_produto_insumo bigint not null, -- ingrediente consumido
  descricao_insumo text,
  quantidade numeric(20,6) not null,
  percentual_perda numeric(6,2) not null default 0,
  unidade varchar(10),
  sincronizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto, codigo_produto_insumo)
);

create table estoque_local_saldos (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  saldo numeric(20,6) not null default 0,
  atualizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto)
);

create table movimentos_locais (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  tipo varchar(3) not null check (tipo in ('SAI','ENT')),
  quantidade numeric(20,6) not null,
  saldo_apos numeric(20,6) not null,
  origem_n_cod_op bigint,   -- nCodOP simulado da OP que gerou este movimento
  pedido_ref text,
  criado_em timestamptz not null default now()
);
create index on movimentos_locais(loja_id, codigo_produto, criado_em desc);
```

Só lojas `is_test=true` devem ter linhas nessas 3 tabelas — não é
enforced por constraint (simplicidade), é uma invariante de quem
escreve (só o código deste plano escreve aqui, e só depois de checar
`loja.is_test`).

## Fluxo: baixa de estoque na venda (`ordem-producao/route.ts`)

Dentro do `if (loja.is_test)` já existente no `finally`, depois de
gravar a `ordens_producao` simulada, para o item da vez
(`produto.codigo_produto`, `item.quantidade`):

1. `select * from ficha_tecnica_local where loja_id = $1 and codigo_produto = $2`.
2. Se vazio: sem receita cadastrada localmente ainda — não é erro fatal
   (mesmo princípio de `consultarEstrutura` devolvendo `null` hoje),
   só não baixa nada, loga um aviso (não usa `logIntegrationAttempt`,
   é sobre erro de integração Omie — usar `console.warn` é suficiente,
   mesmo padrão de outros avisos não-fatais no repo).
3. Se encontrado, pra cada linha da ficha técnica: quantidade a baixar
   = `item.quantidade * linha.quantidade * (1 + linha.percentual_perda/100)`.
   Upsert em `estoque_local_saldos` (`saldo = saldo - quantidade_a_baixar`,
   pode ficar negativo — não bloquear a venda por falta de estoque
   local, é ambiente de teste, negativo é sinal útil pro Ramon ver "não
   dava pra vender isso", não um erro a esconder). Insert em
   `movimentos_locais` (`tipo='SAI'`, `saldo_apos` = o novo saldo,
   `origem_n_cod_op` = o `nCodOP` simulado desta OP).
4. Mesmo princípio pro PRÓPRIO produto vendido? Não — produto final
   vendido (ex: uma pizza pronta) normalmente não tem saldo de estoque
   dele mesmo, só os insumos que a compõem. `ficha_tecnica_local` já
   modela isso: as linhas SÃO os insumos, não o produto final. Não há
   baixa separada do produto final.

Tudo dentro do `try/catch` já existente da rota — falha ao baixar
estoque local NUNCA deve derrubar a resposta HTTP pro `ntb-vendas`
(mesmo princípio "fire-and-forget tolerante a falha" já usado em toda
a integração) — `catch` genérico ao redor do bloco novo, só loga.

## Sync (popular as tabelas novas)

Duas rotas novas, mesma convenção de `app/api/sync/*` (autenticadas do
mesmo jeito que as existentes — sessão de admin, não API key pública;
são ações de configuração, não parte do fluxo de venda):

- **`POST /api/sync/ficha-tecnica-local?lojaId=X`**: lê `produtos` da
  loja (`is_test=true` obrigatório — 400 se não for), pra cada
  `codigo_produto` chama `consultarEstrutura(loja, codigo_produto)`
  (loja de teste = sempre permitido, é leitura), upsert em
  `ficha_tecnica_local`. Roda sequencial (mesmo motivo de sempre:
  evitar chamada concorrente na mesma conta Omie), pode demorar
  (produto por produto) — aceitável, é ação manual admin-only, não
  fluxo de usuário final.
- **`POST /api/sync/estoque-local?lojaId=X`**: exige que
  `/api/sync/posicao` já tenha rodado antes pra essa loja (lê
  `posicao_estoques` existente, não chama Omie de novo) — copia
  `n_saldo` pra `estoque_local_saldos` (upsert, sobrescreve o saldo
  atual — ação explícita de "resetar pro espelho real", documentado na
  UI como tal, não automática).

## UI nova — só admin

Página nova `app/(app)/estoque-local-teste/page.tsx`, gate `isAdmin()`
(mesmo padrão de outras páginas admin-only já existentes), **sem link
na navegação principal** (mesmo princípio do que já existia pra
`ordem-producao/teste`, mantido aqui pela mesma razão: não é fluxo de
uso normal). Seletor de loja (só lojas `is_test=true`), e por loja
selecionada:
- Botões "Sincronizar ficha técnica" / "Sincronizar saldo inicial"
  (chamam as 2 rotas acima).
- Tabela de saldo atual (`estoque_local_saldos`, ordenado por
  `codigo_produto`).
- Tabela de movimentos recentes (`movimentos_locais`, mais recentes
  primeiro, com `origem_n_cod_op` visível pra rastrear qual venda
  gerou qual baixa).

## Ligar as 4 lojas Donana reais (config, não código)

Pra "as 6 lojas teste" funcionarem de ponta a ponta a partir de vendas
reais no `ntb-vendas` (não só via chamada manual), as 4 lojas Donana
REAIS no `ntb-vendas` (que hoje não têm `store_ntb_estoque_secrets`)
precisam ganhar essa configuração, apontando pra chave da respectiva
loja `[TESTE]` no `ntb-estoque` (gerada do mesmo jeito que
`gerarChaveIntegracaoNtbVendas` já gera — 32 bytes aleatórios em hex,
salvos em `lojas.integracao_api_key`). **Isso é só dado, feito nos dois
bancos do `ntb-vendas`** (Cloud + self-hosted `testvendase`, lição da
sessão de hoje: sempre os dois) — nenhuma mudança de código em nenhum
dos dois repos pra essa parte, `triggerOrdemProducao()` já lê
`store_ntb_estoque_secrets` genericamente.

## Invariante de segurança (não negociável)

Em nenhum ponto deste plano uma loja `is_test=false` é lida ou escrita
por código NOVO. O `finally` que já existe na rota real só entra no
branch novo quando `loja.is_test === true` — a branch `is_test=false`
(loja real, ~717/222 chamadas históricas, escrita de verdade na Omie)
não é tocada em nenhuma linha. As 3 tabelas novas só recebem `insert`/
`upsert` de dentro desse branch.

## Fora de escopo (explícito)

- Rota/tabela antigas de "Sertão Teste" (`ordem-producao-teste`,
  `ordens_producao_teste`, `integracao_teste_api_key`) — não
  reaproveitar, não apagar, não estender. Scaffolding morto,
  irrelevante pro mecanismo `is_test` que está em produção.
- Qualquer mudança na loja REAL "O Sertão Vai Virar Mar" ou "Vieras e
  Vinhos" (nem cadastro, nem config, nem comportamento de venda real).
- Editar a malha/estrutura na Omie (escrita) — regra crítica do
  projeto, não muda aqui.
- Autoconsumo do PRÓPRIO produto vendido em `estoque_local_saldos`
  (só os insumos da ficha técnica baixam) — se o usuário quiser depois
  que o produto final também tenha saldo próprio rastreado, é pedido
  separado.
- UI de edição manual da ficha técnica local (só sync automático da
  Omie por enquanto) — cadastro 100% local editável é evolução futura,
  não pedida agora.
