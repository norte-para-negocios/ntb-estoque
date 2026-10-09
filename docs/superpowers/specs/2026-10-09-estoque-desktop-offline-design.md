# Norte Estoque desktop (Windows) que funciona sem internet

Data: 2026-10-09 · Origem: pedido do dono ("transformar o Norte Estoque em aplicativo que rode sem internet totalmente, igual o Norte Vendas") · Classificação: arquitetural

## Decisões do dono

- Tudo funciona offline, inclusive relatórios.
- Aparelhos: desktop Windows (Electron) e Android (Capacitor).
- Ordem aprovada: **Fase 1 = desktop Windows completo** (esta spec). **Fase 2 = Android** com telas de operação e fila (spec própria depois; o celular não comporta Postgres + servidor Next).

## Visão geral

O app desktop leva dentro uma cópia do sistema inteiro, rodando só em `127.0.0.1`:

```
Janela Electron ──► Gateway (processo principal, porta 54398)
                     ├─ /rest/v1/*  ──► PostgREST local ──► Postgres local (dados das lojas do usuário)
                     ├─ /auth/v1/*  ──► shim de autenticação (no próprio gateway)
                     ├─ /__ntb/*    ──► motor de sincronização (só com token interno)
                     ├─ rotas "só online" (DANFE/XML) ──► servidor de produção com o token do usuário
                     └─ resto       ──► Next.js local (mesmo código do servidor, build desktop)
Next.js local ──► frio-api local (mesmo server.js do Contabo) ──► banco `ntb_frio` local
```

- O Next local é o **mesmo código** do servidor, compilado com `NTB_DESKTOP=1` (`output: 'standalone'`, `distDir: .next-desktop`) e `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54398`. As telas, RPCs SQL e políticas RLS são as mesmas, então os relatórios saem iguais sem reescrever nada.
- Postgres 17 embutido (`embedded-postgres`), PostgREST v12 (binário oficial), frio-api (cópia do `server.js` do Contabo). Portas fixas 54394–54398; se alguma estiver ocupada, o app avisa e não sobe pela metade.

## Leitura: banco local sincronizado

### Primeira carga (snapshot)
Depois do primeiro login online, o app baixa as tabelas permitidas filtradas pelas lojas do usuário, em páginas de 5.000 linhas (gzip), com barra de progresso numa tela própria. O cursor de mudanças é gravado **antes** do snapshot; o que mudar durante a carga chega depois pelo pull (upsert é idempotente).

### Pull contínuo (a cada 20 s com internet)
- O servidor já tem `outbox` (trigger `outbox_capture` grava toda mudança com `row_data`), mas só guarda 1 dia e ~1,5 mi linhas/dia.
- Novo: tabela compactada `offline_versoes (tabela, pk, loja_id, versao, apagado, outbox_id)`: uma linha por registro mudado, com a versão mais recente. Função `offline_compactar()` lê a outbox (com janela de reprocessamento de 50 mil ids para cobrir transações que commitam fora de ordem; reprocessar é no-op porque só atualiza quando `outbox_id` é maior) e roda a cada minuto pelo crontab do servidor e no começo de cada pull, sob advisory lock (versões ficam em ordem de commit).
- O pull pede `versao > cursor`, o servidor devolve a linha **atual** de cada registro (ou "apagado"). Lápides com mais de 60 dias são podadas; aparelho com cursor abaixo do piso refaz o snapshot.
- Tabelas sem `outbox_trigger` que entram na sincronização ganham o trigger.
- Banco frio (`fat_cupons`, `fat_cupom_itens`, `fat_cupom_pagamentos`, `movimentos`): sem outbox. Carga inteira na primeira vez e, a cada 15 min, substituição dos últimos 40 dias por loja (o sync de faturamento só reescreve dias recentes). Endpoint novo `/export` na frio-api com paginação por chave.
- Aplicação local com `session_replication_role = replica` (sem triggers de negócio nem checagem de FK, porque o servidor já aplicou tudo), só nas colunas que existem localmente (app mais antigo que o servidor não quebra com coluna nova).

### O que **nunca** sai do servidor
- Tabelas: `outbox`, `webhooks`, `integration_attempts`, `convites`, `arquivos_mortos`, `sync_outbox`, `vendas_integracao_fila`, `audit_log`, `sefaz_nsu`, `sefaz_documentos`.
- Colunas de `lojas`: `omie_app_key`, `omie_app_secret`, `certificado_*`, `csc_producao`, `csc_id_producao`, `integracao_api_key`, `integracao_teste_api_key`.
- `profiles`: só os usuários que compartilham loja com quem está logado, colunas `id, name, perfil, status, current_loja_id, is_super_admin` e as de loja. `lojas`: só as do usuário.
- A lista é **de permissão** (allowlist) em `offline_tabelas`, aplicada em SQL no servidor; tabela nova não vaza por padrão.

## Escrita: toda ação passa pelo servidor quando há internet

As 156 server actions (`lib/actions/*.ts`) ganham uma linha no início:

```ts
const __d = viaDesktop('produto#criarProduto', criarProduto, arguments); if (__d) return __d as never
```

- Fora do desktop (`NTB_MODO_LOCAL` ausente) a função retorna `undefined` na hora e nada muda no servidor de produção.
- No desktop, conforme a política da ação (`lib/offline/politica.ts`):
  - `leitura` (buscas, detalhes, login/logout): roda local sempre.
  - padrão (com internet): o gateway envia a ação ao servidor (`POST /api/offline/acao` com o token do usuário), espera o resultado, puxa as mudanças e devolve o mesmo valor/erro/redirect que a ação daria. Com internet o comportamento é igual ao site.
  - sem internet: `local` = roda no banco local e entra na fila; `fila` = entra na fila sem efeito local (ações que falam com o Omie) e a tela mostra o aviso de pendente; não listada = erro "Esta ação precisa de internet".
- `/api/offline/acao` chama a **mesma** função do servidor (registro explícito `lib/offline/registro-acoes.ts`), então permissões, validações e chamadas ao Omie são as de sempre. Não abre superfície nova: server actions já são endpoints POST para qualquer sessão; aqui exige `Authorization: Bearer` (não sofre CSRF).
- O `proxy.ts` do servidor transforma `Authorization` + `x-ntb-refresh` (com `x-ntb-desktop: 1`) em cookies de sessão validados pelo GoTrue (`setSession`), então `createClient()` e `getProfile()` funcionam sem mudança.
- Idempotência: cada execução tem `intent_id` (uuid). Tabela `offline_execucoes` grava `em_andamento` antes de rodar e o resultado depois. Reenvio do mesmo id devolve o resultado gravado; `em_andamento` antigo vira "verificar manualmente" e nunca roda de novo (evita ajuste duplicado no Omie).

### Fila offline e ids provisórios
- Linhas criadas offline usam ids provisórios: cada tabela tem sua faixa (`int4`: 2.000.000.000 + i×1.000.000; `int8`: 5×10¹⁵ + i×10¹⁰), então um número provisório identifica a tabela.
- Ao reenviar uma ação `local`, o servidor devolve as linhas que ela criou (outbox ganha coluna `intent_id`, preenchida pelo header `x-ntb-intent` que o PostgREST expõe em `request.headers`). O app pareia com as linhas locais da mesma intenção (trigger local `ntb_local.alteracoes`, mesma ordem por tabela) e monta o mapa provisório→real. As ações seguintes da fila têm os ids reescritos antes do envio. Se a contagem não bater, as dependentes falham com explicação, nunca chutam.
- Depois da fila, a reconciliação apaga as linhas provisórias e pede ao servidor a versão real das linhas alteradas offline (`/api/offline/linhas`).
- Falha de negócio no reenvio (ex.: saldo insuficiente) aparece na tela **Sincronização** com a mensagem do servidor e botão Descartar. Rede/5xx: tenta de novo com espera crescente.
- Banner fixo no app: "Sem internet · N ações aguardando" / "Sincronizando…".

## Autenticação e segurança

- O GoTrue de produção não é público. Login passa por `/api/offline/sessao` (entrar/renovar) no servidor, com limite de 5 tentativas por minuto por IP+e-mail.
- Tokens reais ficam só no processo principal, cifrados com `safeStorage` (DPAPI no Windows). O Next local nunca vê o token de produção.
- Shim local de `/auth/v1`: emite JWT local (HS256, segredo aleatório por instalação, 1 h) com o `sub` real; PostgREST local valida com esse segredo. Chave anon do build é só um marcador que o gateway troca pelo JWT anon local.
- Login offline: só o último usuário que entrou online neste PC, até 30 dias desde a última validação online, senha conferida com scrypt (sal aleatório). Se o servidor recusar a renovação (usuário bloqueado, senha trocada), a sessão local é encerrada.
- Um usuário por instalação: se outro usuário entrar, os dados locais são apagados (bloqueado enquanto houver fila pendente do anterior). "Sair e apagar dados deste computador" disponível.
- Tudo escuta só em `127.0.0.1`; gateway confere `Host` (contra DNS rebinding) e `Origin`; `/__ntb/*` exige token interno (header customizado) e as escritas exigem `X-NTB` (bloqueia CSRF de outros sites); senha do Postgres e do `authenticator` aleatórias por instalação.
- Janela: `contextIsolation`, sem `nodeIntegration`, navegação travada na origem local, links externos no navegador.
- Versão mínima: o servidor recusa ações de app abaixo de `OFFLINE_VERSAO_MINIMA` com "Atualize o app"; atualização automática (electron-updater, feed `updates.norteparanegocios.com.br/ntb-estoque-desktop/`, igual ao Vendas).
- Risco aceito e documentado: o banco local fica sem criptografia em disco (Postgres não cifra). Mitigação: pasta do perfil do usuário do Windows; recomendação de BitLocker.

## Esquema local

- `desktop/schema/estoque.sql` e `frio.sql` gerados por `pg_dump --schema-only --no-owner --no-privileges` da produção (script `gerar-schema.sh`), versionados no repo.
- `base.sql`: papéis `anon`, `authenticated`, `service_role` (BYPASSRLS), `authenticator`; `auth.uid()/role()/jwt()` iguais aos do Supabase; extensões `uuid-ossp`, `pgcrypto`, `pg_trgm` no schema `extensions`; grants padrão do Supabase; schema `ntb_local` (rastreio e controle).
- Mudou o hash do esquema na atualização: espera a fila esvaziar, recria o banco e refaz o snapshot.

## Fora de escopo (Fase 1)

Android; cron jobs de sync com o Omie no desktop (continuam só no servidor); DANFE/XML e importação de planilhas offline (precisam de internet, com mensagem clara); macOS como produto (usado só para desenvolvimento e teste).

## Verificação

- Funções puras (`node --test`): política, serialização de FormData/redirect, reescrita de ids, pareamento, filtro de colunas.
- SQL: snapshot e pull devolvem só lojas do usuário e nunca as colunas proibidas (teste com 2 usuários); compactação não perde mudança com commit fora de ordem.
- Ponta a ponta no Mac contra produção, com usuário de QA em loja de teste: carga inicial, relatórios iguais ao site, ação online, ação offline (Wi-Fi desligado) → fila → reenvio → ids reais, login offline.
- Build Windows (`electron-builder --win`) gerado e publicado no feed; o teste no PC Windows real fica com o dono (não há Windows aqui).
