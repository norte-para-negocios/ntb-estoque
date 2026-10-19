# Fase G — Recursos transversais: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** histórico campo a campo [O3], anexos [O2], notificações no app, importação por planilha [K10/O6] e EAN/CEST/origem editáveis + duplicar produto/OP [K1/K9/M6], sem mudar o comportamento do modo Omie (lá só leitura/visualização).

**Architecture:** tudo novo é aditivo. Histórico = gatilho genérico em SQL (`historico_registrar`) com a lista de campos por tabela nos argumentos do gatilho; o autor vem de `auth.uid()` ou do cabeçalho `x-ntb-autor` (só aceito quando o JWT é `service_role`), que `createServiceClient()` passa a mandar nas escritas feitas dentro de uma requisição com usuário logado. Ficha técnica não precisa de gatilho: as versões já estão gravadas (`fichas_tecnicas` + `ficha_tecnica_itens`, imutáveis) e o histórico é o diff entre versões. Anexos = bucket privado `anexos` + tabela `anexos`, upload/download por rota (`/api/anexos`), nunca URL do Storage no navegador (o Supabase só escuta em 127.0.0.1). Notificações = cron `/api/cron/gerar-notificacoes` (só leitura do banco, nenhuma chamada ao Omie) que calcula contagens por loja, regras puras montam as notificações e a RPC `notificacoes_sincronizar` grava/resolve; leitura por usuário em `notificacoes_leituras`. Importação = prévia gravada em `importacoes_planilha` (linha a linha validada) e aplicação atômica e idempotente pela RPC `importacao_aplicar`.

**Tech Stack:** Next 16 (App Router, server actions, route handlers), Supabase self-hosted (Postgres 17, PostgREST, Storage), exceljs, node:test.

**Spec:** pedido do dono (Fase G do `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md`), matriz `~/Projects/omie-rea/gaps/matriz-compras-estoque-producao.md` (O2, O3, O6, K1, K9, K10, M6).

## Global Constraints

- Migrations a partir de **220**, cada uma numa transação, aplicadas à mão (nenhuma aplicada aqui). Teste SQL só no container local `ntb-teste-sql` (banco `g1` = `fb` + 187, 188, 190–195, 200, 201).
- RLS no padrão initplan da 156: `((select usuario_e_admin()) or loja_id in (select usuario_lojas()))`; `anon` sem nada (195); funções `security definer` com `set search_path = public, pg_temp`, `revoke ... from public, anon, authenticated` e checagem de loja; permissões novas no catálogo `permissoes` (padrão 162) e em `lib/permissoes-catalogo.ts`.
- Modo Omie: nenhuma escrita nova no Omie, nenhuma mudança de fluxo; só histórico (gravado pelo gatilho), notificações e telas de leitura. Anexos, importação, duplicar e K1 só no estoque próprio. Loja 4 nunca recebe escrita (nada aqui escreve no Omie).
- Não mexer em `/estoque/correcoes` nem `lib/correcoes/*`. Sem WhatsApp/e-mail.
- Regras puras sem `@/` e testadas com `node --test`; `npx tsc --noEmit -p .` limpo; server action nova → `node scripts/inserir-via-desktop.mjs` + decisão em `lib/offline/politica.ts`.
- O gatilho de histórico NUNCA derruba a escrita principal (bloco `exception when others` → `raise warning`).

## Review Focus

- Sync do Omie (`sync-produtos`, `sync-ops`) regrava milhares de linhas sem mudança: o gatilho não pode gravar nada quando nenhum campo rastreado mudou, e `ordens_producao` sem autor (sync) não grava → teste SQL `historico sem mudança não grava` e `op sem autor não grava`.
- Usuário logado tentando forjar o cabeçalho `x-ntb-autor` direto no PostgREST: só vale com JWT `service_role` → teste SQL `cabeçalho ignorado para authenticated`.
- Pedido de compra editado em rascunho apaga e recria os itens (`pc_salvar`): a tela não pode mostrar "removido/incluído" para itens iguais → teste puro `consolidar: delete+insert iguais somem`.
- Planilha com cabeçalho em maiúsculas/acentos/espaços, números com vírgula, CNPJ com máscara, linha em branco no meio e a mesma planilha confirmada duas vezes → testes puros de leitura e teste SQL `importacao_aplicar 2x = mesma resposta, sem duplicar`.
- Arquivo renomeado (`.exe` como `.pdf`) ou maior que o limite → teste puro `tipoPorConteudo` e `validarAnexo`.

---

### Task 1: Histórico de alterações (migration 220 + autor nas escritas)

**Files:** Create `supabase/migrations/220_historico_alteracoes.sql`, `scripts/testes-sql/220_historico_alteracoes.sql`; Modify `lib/supabase/server.ts`.

**Interfaces — Produces:** tabela `historico_alteracoes (id, loja_id, entidade, entidade_id text, tabela, linha text, operacao 'insert'|'update'|'delete', campo text|null, valor_de text, valor_para text, autor_id uuid, autor_nome text, origem 'app'|'sistema', txid bigint, created_at)`; gatilho `historico_registrar()` com `TG_ARGV = [entidade, coluna_ou_sql_do_id, coluna_da_linha|'' , 'gravar'|'ignorar' (sem autor), campos...]` (campo `col` ou `jsonb_col.chave.*`). Entidades: `produto` (produtos, id = codigo_produto), `fornecedor` (fornecedores.id), `nota_entrada` (compras_proprio.id; itens por compra_id, linha = linha), `pedido_compra` (pedidos_compra.id; itens por pedido_id, linha = linha; só se a 200 existir), `op` (ordens_producao.id, sem autor = ignorar).

- [ ] Teste SQL (falha antes da migration): update de `descricao` em produto com cabeçalho de autor grava 1 linha `campo='descricao'`, `valor_de/para`; update sem mudança não grava; update em `ordens_producao` sem autor não grava; `authenticated` com cabeçalho forjado grava `autor_id = auth.uid()`; insert de item de pedido grava uma linha por campo não nulo; gatilho com erro interno não aborta o update; `authenticated` só lê linhas da própria loja.
- [ ] Migration 220; rodar o teste em `g1`.
- [ ] `createServiceClient()` ganha `global.fetch` que, em POST/PATCH/PUT/DELETE, acrescenta `x-ntb-autor: <uuid>` quando há usuário logado na requisição (memoizado por requisição; sem cookies/sem usuário = sem cabeçalho; nunca lança).
- [ ] tsc; commit.

### Task 2: Histórico na tela

**Files:** Create `lib/historico/historico-puro.ts` (+ `.test.ts`), `lib/historico/ficha-versoes-puro.test.ts` (o código fica em `historico-puro.ts`: módulo puro não importa outro com `.ts`), `lib/historico/carregar.ts`, `components/historico/HistoricoAlteracoes.tsx`, `app/(app)/fornecedor/[id]/page.tsx`; Modify páginas de OP, nota, pedido, produto (próprio e `/estoque/produto/[codigo]`), `components/fornecedor/FornecedorAcoes.tsx`.

**Interfaces:** `consolidarHistorico(linhas: LinhaHistorico[], rotulos: RotulosEntidade): MomentoHistorico[]` (agrupa por txid/autor; pares delete+insert da mesma linha viram alteração ou somem); `formatarValor(campo, valor)`; `diffVersoesFicha(versoes: VersaoFicha[]): MomentoHistorico[]`; `carregarHistorico(lojaId, entidade, ids: string[]): Promise<{ linhas: LinhaHistorico[]; erro: string|null }>`.

- [ ] Testes puros (consolidação, pares iguais somem, insert vira "Criou", formatação booleana/número/data, diff de versões da ficha: insumo incluído/removido/quantidade mudou/rendimento mudou).
- [ ] Implementar, componente servidor com `<details>`; links nas telas. tsc; commit.

### Task 3: Anexos (migration 221 + rota + tela)

**Files:** Create `supabase/migrations/221_anexos.sql`, `scripts/testes-sql/221_anexos.sql`, `lib/anexos/anexos-puro.ts` (+ test), `app/api/anexos/route.ts` (POST), `app/api/anexos/[id]/route.ts` (GET), `lib/actions/anexos.ts` (`excluirAnexo`), `components/anexos/AnexosRegistro.tsx` (+ cliente `AnexosUpload.tsx`).

**Interfaces:** `ENTIDADES_ANEXO = ['produto','nota_entrada','pedido_compra','op']`; `LIMITE_ANEXO_BYTES = 8 * 1024 * 1024`; `MAX_ANEXOS_POR_REGISTRO = 20`; `tipoPorConteudo(bytes: Uint8Array, nome: string): TipoAnexo | null`; `validarAnexo({nome, tamanho, bytes, existentes}): {ok:true, tipo} | {ok:false, erro}`; `caminhoAnexo(lojaId, entidade, entidadeId, uuid, nome)` = `loja-<id>/<entidade>/<entidadeId>/<uuid>-<nome limpo>`; `anexosPermitidos(modo)` = só `'proprio'` nesta fase. Permissões `Anexos - Enviar`, `Anexos - Excluir`.

- [ ] Testes puros (PDF/PNG/JPEG/WEBP/XML/CSV/XLSX aceitos pelo conteúdo; `.exe` renomeado recusado; limite; 21º recusado; nome com `../` limpo).
- [ ] Migration (bucket privado com `file_size_limit` e `allowed_mime_types`, tabela com RLS, políticas em `storage.objects` por pasta `loja-<id>`), teste SQL com stub de `storage` no `g1`.
- [ ] Rotas (sessão + permissão + registro existe na loja + modo próprio), excluir = remove o objeto e marca `excluido_em`. Componente nas 4 telas. Script do desktop + política (fora: só com internet). tsc; commit.

### Task 4: Notificações (migration 222 + cron + sininho)

**Files:** Create `supabase/migrations/222_notificacoes.sql`, `scripts/testes-sql/222_notificacoes.sql`, `lib/notificacoes/regras-puro.ts` (+ test), `lib/notificacoes/coletar.ts`, `app/api/cron/gerar-notificacoes/route.ts`, `lib/actions/notificacoes.ts`, `components/shell/Sininho.tsx`; Modify `components/shell/AppShell.tsx`, `scripts/sync-cron.sh`.

**Interfaces:** `montarNotificacoes(d: DadosNotificacao): { avaliados: TipoNotificacao[]; itens: NotificacaoNova[] }`; `PERMISSAO_DO_TIPO: Record<TipoNotificacao, string>`; RPC `notificacoes_sincronizar(p_loja bigint, p_tipos text[], p_itens jsonb) returns jsonb` (service_role; upsert por `(loja_id, chave)`; volta a "não lida" só quando `nivel` aumenta; resolve as de `p_tipos` que não vieram); actions `minhasNotificacoes()`, `marcarNotificacaoLida(id)`, `marcarTodasLidas()`.

- [ ] Testes puros por tipo (validade vencida/próxima, abaixo do mínimo, nota parada há ≥ 3 dias, OP "Precisa corrigir no Omie", movimento no teto, `[BLOQUEIO OMIE]`, fila do Vendas em erro, pedido aguardando aprovação; consulta que falhou = tipo fora de `avaliados`; modo Omie não gera pedido; modo próprio não gera erro de Omie).
- [ ] Migration + teste SQL (sincronizar 2x igual não reabre; nível maior reabre; tipo avaliado sem item resolve; leitura só da própria loja e do próprio usuário).
- [ ] Cron (auth `assertCronAuth`, 502 se todas as lojas falharem), agendado nos blocos 1 e 4 do `sync-cron.sh`. Sininho (contador, lista, marcar lida, abrir link; consulta a cada 5 min e ao voltar à aba). tsc; commit.

### Task 5: Importação por planilha (migration 223)

**Files:** Create `supabase/migrations/223_importacao_planilha.sql`, `scripts/testes-sql/223_importacao_planilha.sql`, `lib/cadastro/validacao-fiscal-puro.ts` (+ test), `lib/importacao/planilha-puro.ts` (+ test), `lib/importacao/ler-arquivo.ts`, `lib/actions/importacao.ts`, `app/(app)/produto/importar/page.tsx`, `app/(app)/fornecedor/importar/page.tsx`, `app/(app)/produto/importar/modelo/route.ts`, `app/(app)/fornecedor/importar/modelo/route.ts`, `components/importacao/ImportarPlanilha.tsx`.

**Interfaces:** `validarEan`, `validarCnpjCpf`, `validarNcm`, `validarCest`, `validarOrigem`; `prepararProdutos(linhas: Record<string,string>[], ctx: CtxProdutos): LinhaPrevia[]`; `prepararFornecedores(...)`; `LinhaPrevia = { n, acao: 'novo'|'atualizar'|'sem_mudanca'|'erro', chave, dados, erros: string[] }`; actions `previaImportacao(formData)` → `{ id, linhas, resumo, jaAplicada }`, `confirmarImportacao(id)`; RPC `importacao_aplicar(p_id bigint) returns jsonb` (service_role; trava a linha; 2ª chamada devolve o mesmo resultado; reconfere a chave no banco). Permissões `Produtos - Importar planilha`, `Fornecedores - Importar planilha`. Só loja `proprio`.

- [ ] Testes puros (cabeçalho normalizado, vírgula decimal, CNPJ com máscara/dígito errado, EAN com dígito errado, família desconhecida, código repetido na planilha, linha vazia ignorada, existente sem mudança).
- [ ] Migration + teste SQL (aplica, 2ª vez igual, loja Omie recusada, código já existente vira atualização).
- [ ] Telas (enviar → prévia com erro por linha → confirmar), modelos `.xlsx`. Script do desktop + política. tsc; commit.

### Task 6: EAN/CEST/origem e duplicar

**Files:** Modify `lib/actions/catalogo-proprio.ts` (`salvarProdutoCatalogo`/`criarProdutoCatalogo` validam EAN/CEST/origem com `validacao-fiscal-puro`), `app/(app)/produto/novo/page.tsx` (`?duplicar=<codigo>` preenche o formulário, sem EAN e com "(cópia)"), `app/(app)/produto/[codigo]/page.tsx` (botão Duplicar), `app/(app)/ordem-producao/[id]/page.tsx` (Duplicar só no próprio), `app/(app)/ordem-producao/nova/page.tsx` + `components/ordem-producao/CriarOPProdutos.tsx` (`itensIniciais`).

- [ ] Testes puros do formulário duplicado (`dadosParaDuplicar(produto)`), validações já cobertas na Task 5.
- [ ] Implementar; Omie: EAN/CEST/origem não editáveis (o caminho de escrita aprovado no Omie não manda esses campos) e sem Duplicar OP. tsc; commit.

### Task 7: Documentação

- [ ] AGENTS.md: seção "Fase G" (migrations 220–223 em ordem, permissões, cron, decisões e o que ficou de fora). Commit.
