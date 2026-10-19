# Fase H — auditoria de cibersegurança do Norte Estoque (19/10/2026)

Branch `fase-h-seguranca` (base `paridade-omie`). Escopo do plano-mestre, seção "Fase H". Tudo em produção foi
**só leitura** (`begin read only … rollback`, `ss`, `cat`/`grep` de config, `curl -I`, 1 conexão `nc` por porta).
Escrita foi provada só no banco local (`ntb-teste-sql`, cópia `fb_base`). Nenhum segredo neste arquivo: só
"existe / onde / tamanho" ou os 4 primeiros caracteres. Instruções de servidor (não aplicadas):
`2026-10-19-fase-h-instrucoes-servidor.md`.

Legenda de status: **corrigido na branch** (commit) · **migration 195** (pronta e testada, não aplicada) ·
**proposta** (texto pronto, não aplicado) · **precisa do dono** (decisão de produto/custo).

## Resumo

| # | Grav. | Achado | Status |
|---|---|---|---|
| C1 | Crítico | Next.js 16.2.9 com 17 avisos (3 críticos: RCE na otimização de imagem AVIF, RCE em next/og, RCE em Windows; bypass do proxy/middleware com Turbopack) | proposta (atualizar para ≥ 16.4.2 + build + QA) |
| A1 | Alto | 6 funções SECURITY DEFINER sem checagem de loja (financeiro, compras, CRM) executáveis por anon/authenticated: usuário da loja 5 lê dado financeiro da loja 3 | migration 195 |
| A2 | Alto | `upsert_movimentos_ajuste` e `baixar_saldo_local` (SECURITY DEFINER, gravam de qualquer loja) executáveis por anon/authenticated | migration 195 |
| A3 | Alto | Tabela `bkp_op_sertao_inativo_20261019` sem RLS e com todos os grants: OPs da loja 4 visíveis/apagáveis por qualquer usuário | migration 195 |
| A4 | Alto | Canal do desktop (`/api/offline/acao`) executa os crons `retry*Pendentes` com a lista de lojas (chaves do Omie, `is_test`) vinda do chamador | corrigido (70f9a896) |
| A5 | Alto | `ntb_frio` (histórico "pra sempre", 1,5 GB) sem backup; todos os backups no mesmo disco do servidor | proposta (servidor §1) |
| A6 | Alto | Chaves do Omie (key+secret) de todas as lojas, CSC e senha cifrada/caminho do certificado enviadas ao navegador em `/loja` | corrigido (a4e8ac04) |
| M1 | Médio | Login web sem limite de tentativas (GoTrue vê todos como 127.0.0.1) | corrigido (9e04b054) + nginx proposta |
| M2 | Médio | Limite de login do desktop furável: IP lido do 1º item do `X-Forwarded-For` (o cliente controla) | corrigido (70f9a896) |
| M3 | Médio | Injeção de fórmula nos 6 geradores de CSV | corrigido (49dc16e6) |
| M4 | Médio | HTTP sem redirecionar para HTTPS, sem HSTS, sem anti-clickjacking/nosniff, `X-Powered-By` exposto | código corrigido (3fedcbc9) + nginx proposta |
| M5 | Médio | Postgres nativo escutando no IP público; firewall/pg_hba liberam 2 IPs da AWS (sobra do cloud) | proposta (servidor §2) |
| M6 | Médio | Webhook do Omie sem assinatura nem token; corpo sem limite gravado inteiro | corrigido parcialmente (531640e8: token opcional + 1 MB) + proposta (§6) |
| M7 | Médio | AdminLoja de uma loja edita/exclui cargos GLOBAIS (afeta permissões de todas as lojas) | precisa do dono |
| M8 | Médio | Desktop: Electron 33 (fora de suporte; avisos altos até 41.x), instalador e auto-update sem assinatura de código | precisa do dono |
| M9 | Médio | anon com todos os privilégios em toda tabela/sequência/função do `public` (padrão Supabase) | migration 195 |
| B1 | Baixo | `assertCronAuth` aceitava "Bearer undefined" se `CRON_SECRET` sumisse; comparação não constante | corrigido (856a8d75) |
| B2 | Baixo | Desktop entregava qualquer esquema de URL ao `shell.openExternal` | corrigido (871ec037) |
| B3 | Baixo | `ntb-frio-api` passa sem chave se a env sumir | corrigido na cópia do desktop (04c10ab1) + servidor §5 |
| B4 | Baixo | Senha do pooler em texto no crontab do root (`1eef…`); chave de integração em `/root/backups/*.txt` | proposta (§4) |
| B5 | Baixo | Painel Hestia 8083, FTP 21 e SSH com senha (não-root) abertos para a internet | proposta (§7, §8) |
| B6 | Baixo | `authenticated` com TRUNCATE em todas as tabelas (RLS não barra TRUNCATE; PostgREST não expõe) | migration 195 |
| B7 | Baixo | `/api/integracao/lojas` acha loja por CNPJ sem `is_test=false` (pode devolver a gêmea de teste) | proposta |
| B8 | Baixo | XML importado com assinatura que não confere só gera aviso; `integracao_api_key` guardada em texto (compara por igualdade no banco) | proposta |
| B9 | Baixo | `npm audit`: `shadcn` (CLI) em `dependencies` puxa express/proxy-addr/MCP SDK para produção; `node-forge` ≤1.4.0 (aviso de verificação PKCS#1, não usado para verificar assinatura) | proposta |

Verificado e **sem achado**: das 110 relações do `public`, 105 tabelas com RLS ligada; as 5 sem RLS são a tabela de
backup (A3) e 4 views `security_invoker`; todas as políticas são só SELECT no padrão `usuario_lojas()`/`usuario_e_admin()` (sem
recursão); usuário comum da loja 5 vê 0 linhas de outras lojas em todas as tabelas com `loja_id` (inclusive as
novas 173–186: `venda_op_vinculo`, `sefaz_chaves_canceladas`, tabelas de entrada de NF/CT-e); colunas secretas de
`lojas` sem grant de coluna para anon/authenticated; bucket `certificados` privado e sem política; Kong/PostgREST
do Estoque só em 127.0.0.1 (nenhum vhost público aponta para ele); nenhuma chave Supabase/JWT no JS público da tela
de login; `integration_attempts` não guarda `app_key`/`app_secret` (0 de 215.086 linhas); senha do certificado
cifrada (AES-256-GCM); `/api/cron/*` (29 rotas) todas com `assertCronAuth`; `/api/sync/*`, `/api/nota-fiscal/*`,
`/api/estoque/*` com sessão + permissão; `/api/integracao/*` e `/api/correcoes/ingest` com chave de 64 hex por loja
(ingest com teto de 2 MB); upload de XML com teto de 900 KB e parser próprio sem DOCTYPE/entidades (sem XXE);
planilhas `.xlsx` (exceljs) gravam texto como texto; DNS não é resolvedor aberto; TLS 1.0/1.1 recusados,
certificado Let's Encrypt válido até 11/12/2026; portas do Docker só em 127.0.0.1; backups diários do Postgres do
Docker existem (estoque ~93 MB/dia, vendas ~3,8 MB, 8 dias + 14 dias no timer); desktop com `contextIsolation`,
`sandbox`, `nodeIntegration:false`, build que falha se segredo do `.env.local` aparecer.

## Provas

### A1/A2/A3/M9 — banco (produção, só leitura)

Usuário comum real (perfil `Usuario`, vinculado só à loja 5, uuid `3f1e…`), em transação `read only`:
`set_config('request.jwt.claims', {sub, role:'authenticated'})`, `set local role authenticated`,
`set local search_path = "$user", public`:

```
usuario_lojas()                                  -> {5}
todas as tabelas com loja_id: linhas de outra loja -> 0   (exceto bkp_op_sertao_inativo_20261019: 16)
financeiro_resumo_cr(3)            -> 12 linhas      financeiro_fluxo_caixa(3)          -> 23
compras_ranking_fornecedores(3)    -> 100            compras_precos_produtos(3, null)   -> 300
crm_fornecedor_nf(3, 0)            -> 1
```
Como `anon` (sem login): as mesmas 4 funções devolvem as mesmas contagens; `bkp_op_sertao…` 16 linhas;
`lojas`/`movimentos` 0 linhas (RLS). Lista das SECURITY DEFINER (`pg_proc.prosecdef`): as 6 acima com dono
`postgres` e **sem** `search_path`; `upsert_movimentos_ajuste` e `baixar_saldo_local` executáveis por anon e
authenticated. `pg_default_acl`: `supabase_admin` e `postgres` dão `arwdDxtm` em tabela nova, `rwU` em sequência e
`X` em função para anon e authenticated.

Exploração real hoje: o PostgREST/Kong do Estoque escuta só em `127.0.0.1:8100` (sem vhost público; o PostgREST do
Vendas usa outro banco, `ntb_vendas`), então quem chega nele é processo do servidor ou da rede Docker
`supabase_default` (onde também rodam os containers do Vendas). Por isso "Alto" e não "Crítico": é uma porta aberta
atrás de uma só parede.

Escrita (banco local, `scripts/testes-sql/195_fase_h_seguranca.sql`, com os grants de produção reproduzidos):
`set role anon; select upsert_movimentos_ajuste('[{"loja_id":4, …}]')` grava 1 linha em `movimentos` da loja 4.
Depois da 195: `insufficient_privilege` para anon e authenticated nas 8 funções; service_role continua; leitura
por RLS de authenticated mantida; `bkp_*` com RLS e sem grant; tabela `bkp_*` nova já nasce fechada (gatilho de
eventos); reaplicar a 195 é idempotente.

### A4 — canal do desktop
`lib/offline/registro-acoes.ts` registra `movimentacoes#retryMovimentosManuaisPendentes`,
`ordem-producao#retryOPsPendentes`, `inventario#retryAjustesInventarioPendentes`,
`transferencia#retryMovimentosTransferenciaPendentes`. `/api/offline/acao` só exigia token de usuário válido
(qualquer usuário aprovado) e chamava `fn(...args)`. Essas funções recebem `lojas: LojaOmie[]` e usam
`loja.id`/`loja.is_test`/chaves do argumento (`reenviarMovimentoManual(..., loja, loja.id)`, lido em
`lib/actions/movimentacoes.ts`): qualquer usuário podia reenviar ao Omie pendências de qualquer loja (inclusive a 4)
ou mandar `is_test:true` para uma loja real e marcar ajustes pendentes como "enviados" com resposta simulada.
Correção: 403 para `#retry*` (`acaoSoDoServidor`, testado). Os crons (`/api/cron/retry-*`) não mudam.

### A5 — backups
`systemctl list-timers` + `/var/log/backup-bancos.log`: `OK estoque 93M`, `OK vendas 3.8M` diários;
`/root/backups-ntb-estoque` 2,6 GB (`ntb-estoque-AAAAMMDD.sql.gz` ~106 MB). `grep -rl ntb_frio` em cron, systemd,
`/usr/local/bin`: nenhum job de backup. `pg_database_size('ntb_frio')` = 1518 MB. Tudo em `/dev/sda1` do mesmo
servidor. Restauração não testada nesta fase (proposta §1c).

### A6 — `/loja`
`app/(app)/loja/page.tsx` fazia `from('lojas').select('*')` com service role e passava o objeto (sem só a
`integracao_api_key`) para `LojaCard`/`LojaForm` (`'use client'`); `fromLoja()` preenchia o formulário com
`omie_app_key`/`omie_app_secret` inteiros. Página só para Admin global, mas o segredo ia no payload RSC do
navegador. Agora: só `****` + 4 últimos; campo em branco ao salvar = manter (`camposChavesOmie`, testado); CSC vira
"definido"; `certificado_path`, `certificado_senha_enc`, `csc_id_producao`, `integracao_teste_api_key` não descem.

### M1/M2/M4 — HTTP
```
curl -sI https://app-estoque.norteparanegocios.com.br/login  -> 200, x-powered-by: Next.js, sem HSTS/X-Frame-Options/nosniff
curl -sI http://app-estoque.norteparanegocios.com.br/login   -> 200 (sem redirecionar)
nginx: proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; X-Real-IP $remote_addr; sem limit_req; client_max_body_size 1024m
GoTrue: nenhuma env GOTRUE_RATE_LIMIT_*; GOTRUE_DISABLE_SIGNUP=false (cadastro gera perfil "pendente")
```

### M3 — CSV
`lib/csv.ts`, `lib/estoque/kardex-loja-puro.ts`, `lib/estoque/inventario-regras.ts`, `movimentacoes/export`,
`validade/export`, `pendencias-classificacao/export`: escapavam só `"`/`;`/quebra. Texto vindo da NF do fornecedor
(`c_descricao_produto`) começando com `=`/`+`/`-`/`@` vira fórmula. Agora `celulaCsv` (apóstrofo; número
negativo intacto), com testes nos 3 módulos puros.

### M5 — portas
De fora (1 `nc -z` por porta): abertas 21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, **8083**; fechadas
3001–3010, 3306, 4000, 4190, **5432**, 54322, 55432, 6379, 6543, 8000, 8080–8084, 8095, 8100, 8101, 8143, 8443,
9000. No servidor (`ss -ltnp`): `postgres` nativo em `185.193.66.240:5432`; `iptables -S INPUT`: `-P INPUT DROP`,
5432 aceito de `52.67.188.92` e `54.232.77.43`; `pg_hba`: `hostssl ntb_frio ntb_frio_app` para os mesmos 2 IPs,
`scram-sha-256`. `pg_stat_activity`: nenhuma conexão remota.

### M6 — webhook
`app/api/webhook/route.ts` identifica a loja só por `appKey` (que vem no corpo de todo aviso e fica gravada em
`webhooks.message`: 164.785 linhas). Aviso forjado dispara `ConsultarNF`/`ConsultarOrdemProducao`/sync de locais com
a chave da loja (consome cota; risco de `MISUSE_API_PROCESS`) e grava o JSON inteiro aqui e no Contabo. Tamanho
real: p99 1,5 KB, maior 175 KB → teto de 1 MB. Token opcional `?t=` (desligado até trocar o endereço no Omie).
Não testado contra produção.

### M7 — cargos
`lib/actions/cargo.ts`: `criarCargo`/`editarCargo`/`excluirCargo` só exigem `getAtorGestao().podeGerir`
(Admin global **ou** AdminLoja com ≥ 1 loja). `cargos` não tem `loja_id` (catálogo global) e `excluirCargo` limpa
`loja_user.cargo_id` de todas as lojas. Proposta: criar/editar/excluir cargo só para Admin global (AdminLoja só
atribui cargo), ou cargos por loja. Não aplicado: muda o que o AdminLoja faz hoje.

### M8 — desktop
`desktop/package-lock.json`: electron 33.4.11, electron-builder 26.17.0, electron-updater 6.8.9. `npm audit`
(com dev): electron com avisos altos até 41.10.6 (isolamento de contexto, sandbox de popups, leitura cross-origin
por protocolo de arquivo). `package.json` sem `certificateFile`/assinatura: instalador e atualização automática
sem assinatura de código; quem controlar `updates.norteparanegocios.com.br` distribui executável para todos os PCs.
Proposta: Electron ≥ 41.10.6 (testar no workflow `desktop-windows-smoke`) e certificado de code signing (custo).
`npm audit --omit=dev` do desktop: 0.

### C1 — dependências do web
`npm audit --omit=dev`: 29 (2 críticos, 19 altos). `next` 16.2.9 → 17 avisos, os mais graves corrigidos em 16.3.3
(RCE AVIF / Windows), 16.3.6 (next/og) e 16.3.8 (SSRF na otimização de imagem, cache poisoning de SSG/ISR); o
bypass de proxy com Turbopack e o DoS em Server Actions em 16.2.11. Proposta:
`npm install next@16.4.2 eslint-config-next@16.4.2`, `npm run build`, QA das telas principais e do desktop
(`build-web.sh`). Mover `shadcn` para `devDependencies` (é CLI; tira express/proxy-addr/MCP SDK da produção).
`exceljs` (uuid moderado) e `pptxgenjs` (image-size alto, DoS) sem correção sem quebrar versão: aceitar.
Não aplicado nesta fase porque exige `npm install` + build (o `node_modules` deste worktree é emprestado de outro
checkout).

### B1–B9
- B1: `lib/omie/sync-all.ts` `auth === \`Bearer ${process.env.CRON_SECRET}\`` → `cronAutorizado` (segredo vazio ou
  < 16 recusa; tempo constante). `CRON_SECRET` de produção tem 29 caracteres (só o tamanho foi lido).
- B2: `desktop/electron/main.js` `will-navigate`/`setWindowOpenHandler` → `shell.openExternal(url)` sem olhar o
  esquema; agora só http/https/mailto.
- B3: `checkAuth` da frio-api (`key !== process.env.API_KEY`); envs existem (64 caracteres) no servidor e no desktop.
- B4: `crontab -l` do root tem `STANDBY_PG_PASSWORD=` em texto (32 caracteres, `1eef…`);
  `/root/backups/sertao_chave_integracao_loja12_2026-09-28.txt` (65 bytes).
- B5: `sshd -T`: `permitrootlogin without-password`, `passwordauthentication yes`; `vsftpd` ativo; 8083 aberto.
- B6: `has_table_privilege('authenticated', …, 'TRUNCATE')` = t em todas as tabelas.
- B7: `app/api/integracao/lojas/route.ts` busca `lojas` por CNPJ sem `.eq('is_test', false)` (lição do incidente de
  12/08). Não aplicado: mexe na ligação Vendas ↔ Estoque em uso (Sertão teste ligado à loja 12).
- B8: `lib/estoque/nfe-validacao.ts` trata assinatura que não confere como aviso; `integracao_api_key` (9 lojas,
  64 hex) em texto. Proposta: assinatura inválida = erro (com "importar mesmo assim" para Admin); guardar só o
  sha256 da chave (migration + troca nas ~12 rotas, mostrar a chave só na geração — já é assim na tela).
- B9: ver C1.

Também observado (sem ação): usuário removido de todas as lojas mantém `profiles.current_loja_id` antigo
(`lib/actions/usuario.ts` só ajusta quando sobra alguma loja); as ações conferem permissão nessa loja, então o
efeito depende de `permissao_user` ter sido limpo. `app/(app)/saude-banco` chama `saude_banco()` (SECURITY
DEFINER, só metadado de tamanho de tabela).

## Permissões por ação (amostra)

Varredura das 178 server actions (`'use server'`): 58 sem helper de autorização direto; lidas uma a uma, todas
usam um `contexto()`/`lojaProprio()`/`gerirOuErro()` local com `getCurrentLojaId` + `requirePermissao`, exceto
`login`, `logout`, `cadastrar` (públicas por desenho) e os 4 `retry*` (A4). Heurística de IDOR (update/delete por
`id` sem `loja_id` na mesma cadeia): os casos apontados (inventário, transferência, movimentos, NF própria,
correção de custo) filtram `loja_id` na leitura anterior ou na própria escrita; `cargo` é o M7. `current_loja_id`
só muda por `setCurrentLoja`, que confere `loja_user`.

## Correções na branch (commits)

| Commit | O quê | Teste |
|---|---|---|
| 856a8d75 | `lib/seguranca/regras.ts` + cron sem segredo nunca autoriza | `node --test lib/seguranca/regras.test.ts` |
| 70f9a896 | canal do desktop recusa `#retry*`; IP real; limitador sem "zerar tudo" | idem |
| 9e04b054 | limite de tentativas no login web | idem (`criarLimitador`, `ipDoCliente`) |
| a4e8ac04 | `/loja` sem segredos no navegador; em branco = manter | idem (`camposChavesOmie`, `finalSegredo`) |
| 49dc16e6 | CSV sem injeção de fórmula | `inventario-regras`, `kardex-loja-puro`, `regras` |
| 3fedcbc9 | cabeçalhos de segurança, sem `X-Powered-By` | `cabecalhosSeguranca` |
| 531640e8 | webhook: token opcional + teto 1 MB | `webhookTokenOk` |
| 871ec037 | desktop: link externo só http/https/mailto | `node --test desktop/electron/link-externo.test.js` |
| 8ff1e036, 0600b690 | migration 195 + teste SQL (antes/depois, escrita forjada provada no local) | `scripts/testes-sql/195_fase_h_seguranca.sql` |
| 04c10ab1 | frio-api do desktop recusa sem env | `node --check` |

`npx tsc --noEmit -p .` limpo. Migration: só a **195** (depende de nada novo; `begin … commit` próprio + `notify
pgrst`). Deploy: 195 antes ou junto do código (o código não depende dela), depois versão nova do desktop.
