# Reduzir Lentidão da NTB Estoque — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ou superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Reduzir o tempo de carregamento das páginas mais pesadas da NTB Estoque (`/home` em especial), atacando as causas que sobraram depois da rodada de mitigação de infraestrutura já feita ao vivo em produção em 2026-07-30/31 (ver "Contexto" abaixo).

**Architecture:** Nenhuma mudança estrutural — são 5 correções pontuais e independentes: 1 índice novo no Postgres, 1 troca de modo de contagem numa query cara, 1 paralelização de chamadas sequenciais, 1 cache em memória de curta duração pro dashboard gerencial, e 1 script de automação pra ligar/desligar sozinho a stack de failover do Supabase conforme necessidade real.

**Tech Stack:** Next.js 16 (App Router, Server Components) + TypeScript, Supabase (Postgres via supabase-js), bash (crontab no servidor Contabo), Docker (stack de failover self-hosted).

## Contexto (já feito ao vivo, não é tarefa deste plano)

Numa sessão de investigação ao vivo em 2026-07-30/31 (usuário reportou "sistema muito lento"), medido e corrigido:
- Stack de failover do Supabase (9 containers Docker) rodando 24h consumindo ~2GB RAM + CPU à toa — **pausada manualmente** (`docker stop`). Tarefa 5 deste plano automatiza isso.
- 7 crons "1x/hora" caindo todos no mesmo bloco de 10min, empilhados em cima dos 4 que já rodam sempre — **já espalhados** em `scripts/sync-cron.sh` (commit `ecbad0c`, já deployado).
- Prioridade de CPU (`Nice=-5`) já adicionada ao systemd do `ntb-estoque.service`.
- Uma versão Laravel abandonada do mesmo sistema (`estoque.norteparanegocios.com.br`, banco MariaDB `ntb_estoque` separado) ainda recebia webhook da Omie e escrevia num banco de ~950 mil linhas à toa — **já redirecionada** (301) pro domínio atual via `v-add-web-domain-redirect`.

Essas 4 ações já cortaram o tempo de carregamento pela metade (de 13-26s pra 5-11s em várias páginas). O que sobrou, medido com o servidor já calmo (load average ~1, não mais ~5), é **lentidão de verdade no código/banco da página `/home`** — 16-27s mesmo sem contenção de CPU. Esse plano ataca isso.

## Global Constraints

- **Este projeto NÃO é o Next.js padrão que você conhece.** `AGENTS.md` avisa: "APIs, conventions, and file structure may all differ from your training data." Antes de escrever qualquer código de cache, **leia `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md`** — essa versão usa a diretiva `"use cache"` + `cacheComponents: true` no `next.config.ts`, que **NÃO está habilitada neste projeto** (confirmado: `next.config.ts` não tem essa flag). **NÃO habilite `cacheComponents`** como parte deste plano — é uma mudança experimental e ampla demais pra uma correção de performance pontual. A Tarefa 4 usa cache manual em memória (`Map` + timestamp), não a API nativa do framework.
- **O app roda como 1 processo systemd único** (`ntb-estoque.service`, não serverless/múltiplas instâncias) — cache em memória de módulo (`Map` no topo do arquivo) é válido e persiste entre requisições, sem precisar de Redis/cache externo.
- **Migrations aplicam direto no Supabase cloud** via `node scripts/aplicar-migration.mjs <arquivo>.sql` (não existe `supabase db push` configurado neste projeto — script customizado que acha o pooler certo e roda o SQL direto).
- **Deploy é manual via SSH**, não é automático no `git push`: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, depois confirmar com `curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login` (esperado: `HTTP 200`).
- **Conta de teste (QA)**: `claude.qa@ntb-estoque.dev` / `claudeqa123456`, loja atual = loja id 3 (DONANA RIO VERMELHO). Usar Playwright pra medir tempo de carregamento real (login → `/home`), não confiar só em `curl` sem sessão.
- **Trocar `count: 'exact'` por `'estimated'` muda o número exibido** (deixa de ser exato, vira estimativa do planner do Postgres, que atualiza via `ANALYZE`/autovacuum, não instantaneamente). Isso é uma troca deliberada e aceitável pro card "Ordens de produção" da home (não é usado em paginação nem em lógica crítica, só exibição), mas **não generalizar esse padrão pra outros lugares do sistema sem avaliar caso a caso**.

---

### Task 1: Índice pro filtro de "produtos vencidos" em `ordens_producao`

**Files:**
- Create: `supabase/migrations/096_ordens_producao_validade_index.sql`

**Contexto do problema:** `app/(app)/home/page.tsx` (linhas ~132-139) roda esta query pra achar produtos já vencidos:
```ts
const SALDO_OR = 'quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)'
const { data: vencidasQuentesRaw } = await supabase
  .from('ordens_producao')
  .select('id, identificacao_n_cod_op, identificacao_n_cod_produto, quantidade, identificacao_n_qtde')
  .eq('loja_id', lojaId)
  .not('validade', 'is', null)
  .or(SALDO_OR)
  .lt('validade', hojeLocal)
```
Medido ao vivo (loja 3, 2026-07-30): **3.1 segundos pra devolver só 21 linhas** — sem índice cobrindo `validade`, o Postgres tem que varrer muito mais linha que o necessário antes de filtrar.

- [ ] **Step 1: Escrever a migration**

```sql
-- home/page.tsx filtra ordens_producao por loja_id + validade (nao nula,
-- range) + condicao de saldo -- sem indice cobrindo validade, a query fazia
-- scan caro demais: medido 3.1s pra devolver so 21 linhas (loja 3,
-- 2026-07-30). Indice parcial cobre a parte cara (achar as linhas com
-- validade no intervalo certo); o filtro de saldo (OR complexo) fica pra
-- depois, sobre um conjunto ja pequeno.
create index if not exists idx_op_validade_loja
  on ordens_producao(loja_id, validade)
  where validade is not null;
```

- [ ] **Step 2: Aplicar a migration**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && node scripts/aplicar-migration.mjs 096_ordens_producao_validade_index.sql`
Expected: `MIGRATION APLICADA.`

- [ ] **Step 3: Confirmar a melhora com dado real**

Run (a partir da raiz do repo, substitua o timeout se a rede estiver lenta):
```bash
node --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^\"|\"\$/g,'')]}));
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const t0 = Date.now();
const { data } = await s.from('ordens_producao').select('id').eq('loja_id', 3).not('validade','is',null).or('quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)').lt('validade', '2026-07-31');
console.log('tempo:', Date.now()-t0, 'ms | linhas:', data?.length);
"
```
Expected: tempo bem abaixo dos 3100ms medidos antes (o alvo é sub-500ms, mas qualquer melhora significativa confirma que o índice está sendo usado).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/096_ordens_producao_validade_index.sql
git commit -m "perf: indice pra filtro de produtos vencidos em ordens_producao"
```

---

### Task 2: Trocar contagem exata por estimada no card "Ordens de produção"

**Files:**
- Modify: `app/(app)/home/page.tsx:80-115` (bloco do `Promise.all` de contagens)

**Contexto do problema:** medido ao vivo — `ordens_producao` count (`count:'exact'`) leva **~1.9s** sozinho (loja 3 tem 74.441 linhas na janela quente de 90 dias), contra 576-911ms das outras contagens da mesma página. É a mais cara do bloco.

**Interfaces:**
- Consome: nada de outra tarefa (independente).
- Produz: nada que outra tarefa consuma — mudança isolada nesse arquivo.

- [ ] **Step 1: Ler o trecho atual pra confirmar que não mudou desde este plano**

Run: `sed -n '76,116p' "app/(app)/home/page.tsx"`
Expected: ver a linha `const head = { count: 'exact' as const, head: true }` e, dentro do array do `Promise.all`, a linha `supabase.from('ordens_producao').select('id', head).eq('loja_id', lojaId),`. Se o conteúdo mudou muito, parar e reavaliar antes de aplicar o Step 2 às cegas.

- [ ] **Step 2: Adicionar um segundo modo de contagem e usá-lo só pra `ordens_producao`**

Editar `app/(app)/home/page.tsx`, logo abaixo da linha `const head = { count: 'exact' as const, head: true }`:

```ts
  const head = { count: 'exact' as const, head: true }
  // Achado real (2026-07-30): count('exact') em ordens_producao sozinho leva
  // ~1.9s (74 mil linhas na janela quente de 90 dias) -- bem mais caro que as
  // outras contagens da mesma tela. 'estimated' usa a estatistica do
  // planner do Postgres (pg_class.reltuples via EXPLAIN), quase instantaneo.
  // Troca deliberada: o numero deixa de ser exato ao segundo, pode ficar
  // levemente desatualizado ate o proximo ANALYZE/autovacuum -- aceitavel
  // pra um card de exibicao que nao alimenta paginacao nem logica critica.
  const headEstimado = { count: 'estimated' as const, head: true }
```

Depois, na chamada dentro do array do `Promise.all` (troca só o `head` por `headEstimado` nesta linha específica, as outras `.select('id', head)` continuam iguais):

```ts
      supabase.from('ordens_producao').select('id', headEstimado).eq('loja_id', lojaId),
```

- [ ] **Step 2: Rodar o lint**

Run: `npx eslint "app/(app)/home/page.tsx"`
Expected: sem erros novos.

- [ ] **Step 3: Rodar o build**

Run: `npm run build`
Expected: `✓ Compiled successfully`, sem erro de tipo (o literal `'estimated' as const` precisa bater com o tipo aceito pelo supabase-js — se o build reclamar de tipo, checar a versão do `@supabase/supabase-js` instalada pra confirmar que `'estimated'` é um valor válido de `count`).

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/home/page.tsx"
git commit -m "perf: troca contagem exata por estimada no card Ordens de producao da home"
```

---

### Task 3: Paralelizar chamadas sequenciais na home

**Files:**
- Modify: `app/(app)/home/page.tsx:121-144`

**Contexto do problema:** depois do `Promise.all` inicial (Fase 1), a página faz 3 chamadas em sequência antes de continuar: `contarOrdensProducaoAntigas` (Fase extra), depois a query de `vencidasQuentesRaw`, depois `complementarOrdensProducao`. As duas primeiras **não dependem uma da outra** — só `complementarOrdensProducao` depende do resultado de `vencidasQuentesRaw`. Rodar as duas primeiras em paralelo economiza uma rodada inteira de latência de rede (~500ms-2s, dependendo da rede até o Supabase/Contabo naquele momento).

**Interfaces:**
- Consome: nada de outra tarefa.
- Produz: nada que outra tarefa consuma.

- [ ] **Step 1: Ler o trecho atual**

Run: `sed -n '119,144p' "app/(app)/home/page.tsx"`
Expected: confirmar que o código ainda é:
```ts
  const opsAntigasCount = await contarOrdensProducaoAntigas({ lojaId, dataFinal: limiteJanelaQuente() })
  const opsTotalCount = (ops.count ?? 0) + opsAntigasCount

  const SALDO_OR = 'quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)'
  const { data: vencidasQuentesRaw } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_n_cod_op, identificacao_n_cod_produto, quantidade, identificacao_n_qtde')
    .eq('loja_id', lojaId)
    .not('validade', 'is', null)
    .or(SALDO_OR)
    .lt('validade', hojeLocal)
  const vencidasCompletas = await complementarOrdensProducao(vencidasQuentesRaw ?? [], {
    lojaId,
    validadeInicio: '0001-01-01',
    validadeFinal: localISO(-1),
  })
```
Se o Task 1 e Task 2 já foram aplicados, o `SALDO_OR` continua igual (Task 1 só mexeu no banco, Task 2 mexeu numa linha diferente) — só ajustar se a linha exata tiver se movido.

- [ ] **Step 2: Reescrever pra rodar `contarOrdensProducaoAntigas` e a query de vencidas em paralelo**

Substituir o trecho acima por:

```ts
  // Paraleliza contarOrdensProducaoAntigas com a query de vencidas -- as
  // duas nao dependem uma da outra (so complementarOrdensProducao depende
  // do resultado de vencidasQuentesRaw). Achado real (2026-07-30): rodavam
  // em sequencia sem necessidade, cada uma custando uma rodada inteira de
  // rede ate Supabase/Contabo.
  const SALDO_OR = 'quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)'
  const [opsAntigasCount, { data: vencidasQuentesRaw }] = await Promise.all([
    contarOrdensProducaoAntigas({ lojaId, dataFinal: limiteJanelaQuente() }),
    supabase
      .from('ordens_producao')
      .select('id, identificacao_n_cod_op, identificacao_n_cod_produto, quantidade, identificacao_n_qtde')
      .eq('loja_id', lojaId)
      .not('validade', 'is', null)
      .or(SALDO_OR)
      .lt('validade', hojeLocal),
  ])
  const opsTotalCount = (ops.count ?? 0) + opsAntigasCount
  const vencidasCompletas = await complementarOrdensProducao(vencidasQuentesRaw ?? [], {
    lojaId,
    validadeInicio: '0001-01-01',
    validadeFinal: localISO(-1),
  })
```

- [ ] **Step 3: Rodar o lint**

Run: `npx eslint "app/(app)/home/page.tsx"`
Expected: sem erros novos.

- [ ] **Step 4: Rodar o build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/home/page.tsx"
git commit -m "perf: paraleliza contagem de OPs antigas com busca de vencidas na home"
```

---

### Task 4: Cache em memória de curta duração pro dashboard gerencial

**Files:**
- Modify: `lib/dashboard-gerencial.ts`

**Contexto do problema:** `carregarDashboardGerencial` (usada por `PainelGerencial`, renderizada dentro de `/home`) faz **10 queries em paralelo** toda vez que a home carrega, recalculando os mesmos agregados (rejeitos, top faturados, ratio compras/faturamento, produtos parados) mesmo que ninguém tenha mudado nada nos últimos segundos. Cachear por um tempo curto (90s) corta isso pra zero em visitas repetidas dentro da janela, sem deixar o dado "velho" o suficiente pra importar.

**Interfaces:**
- Consome: nada de outra tarefa.
- Produz: `carregarDashboardGerencial` continua com a mesma assinatura pública (`lojaId, dataIni, dataFim, topN) => Promise<DashboardGerencial>`) — nenhum outro arquivo precisa mudar.

- [ ] **Step 1: Ler o início do arquivo atual**

Run: `sed -n '1,20p' lib/dashboard-gerencial.ts`
Expected: confirmar os imports atuais (`createServiceClient`, `rpcTodos`) e a linha `export async function carregarDashboardGerencial(`.

- [ ] **Step 2: Adicionar o cache em memória**

No topo do arquivo, logo depois dos imports existentes (`import { createServiceClient } ...` e `import { rpcTodos } ...`), adicionar:

```ts
// Cache em memoria de curta duracao -- home/PainelGerencial recalculava os
// mesmos 10 agregados toda vez que a pagina carregava, mesmo em visitas
// repetidas segundos depois (achado real 2026-07-30, investigando lentidao
// da home). Valido: o app roda como processo systemd unico (nao serverless,
// nao multiplas instancias) -- um Map no topo do modulo persiste entre
// requisicoes com seguranca, sem precisar de Redis/cache externo.
const CACHE_TTL_MS = 90_000
const cacheDashboard = new Map<string, { dados: DashboardGerencial; expiraEm: number }>()
```

Depois, no início do corpo de `carregarDashboardGerencial` (logo após a linha `export async function carregarDashboardGerencial(...): Promise<DashboardGerencial> {`), adicionar a checagem de cache:

```ts
export async function carregarDashboardGerencial(
  lojaId: number,
  dataIni: string,
  dataFim: string,
  topN: number
): Promise<DashboardGerencial> {
  const chaveCache = JSON.stringify([lojaId, dataIni, dataFim, topN])
  const emCache = cacheDashboard.get(chaveCache)
  if (emCache && emCache.expiraEm > Date.now()) return emCache.dados

  const supabase = createServiceClient()
  // ... resto do corpo da funcao continua igual daqui pra baixo ...
```

E, logo antes do `return { ... }` final da função (o objeto `DashboardGerencial` completo), gravar no cache antes de devolver:

```ts
  const resultado: DashboardGerencial = {
    rejeitos,
    topFaturadosAcabado: topNDoMapa(faturamentoAcabadoMapa, topN),
    topFaturadosRevenda: topNDoMapa(faturamentoRevendaMapa, topN),
    topComprados: topNDoMapa(somarPorRotulo(comprasPorProduto), topN),
    maiorFornecedor: fornecedorTop[0] ?? null,
    produtosParados,
    ratioCompraFaturamento: [
      {
        categoria: 'Produto acabado (vs. compra de matéria-prima)',
        compras: comprasMP,
        faturamento: faturamentoAcabado,
        pct: faturamentoAcabado > 0 ? Math.round((comprasMP / faturamentoAcabado) * 1000) / 10 : null,
      },
      {
        categoria: 'Revenda (vs. compra de revenda)',
        compras: comprasRev,
        faturamento: faturamentoRevenda,
        pct: faturamentoRevenda > 0 ? Math.round((comprasRev / faturamentoRevenda) * 1000) / 10 : null,
      },
    ],
  }
  cacheDashboard.set(chaveCache, { dados: resultado, expiraEm: Date.now() + CACHE_TTL_MS })
  return resultado
}
```

(Isso substitui o `return { ... }` que já existe no fim da função — mesmo conteúdo do objeto, só nomeado `resultado` e com a linha de `cacheDashboard.set` antes do `return`.)

- [ ] **Step 3: Rodar o lint**

Run: `npx eslint lib/dashboard-gerencial.ts`
Expected: sem erros novos.

- [ ] **Step 4: Rodar o build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Testar o cache manualmente (sem infra de teste automatizado neste projeto)**

Run:
```bash
node --input-type=module -e "
process.chdir('.');
const mod = await import('./lib/dashboard-gerencial.ts');
" 2>&1 || echo "nota: TypeScript direto no node pode falhar sem loader -- validar via QA visual no Step 6 em vez disso"
```
Como este projeto não roda TypeScript direto no Node sem build, o teste real é via QA visual (Step 6) comparando os tempos de duas cargas seguidas da `/home`.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard-gerencial.ts
git commit -m "perf: cache em memoria de 90s pro dashboard gerencial da home"
```

---

### Task 5: Automatizar liga/desliga da stack de failover do Supabase

**Files:**
- Create: `scripts/failover-supabase-watch.sh`

**Contexto do problema:** a stack de failover (9 containers Docker, réplica self-hosted do Supabase pra quando o plano gratuito cair) foi pausada manualmente em 2026-07-30 pra liberar ~2GB de RAM. Sem automação, alguém precisa lembrar de religar na próxima queda real do Supabase cloud — e esquecer isso anula o propósito da réplica. Este script liga sozinho quando detecta queda de verdade (3 checagens seguidas ruins, evita reagir a um blip de rede transitório) e desliga sozinho quando o serviço principal volta a ficar saudável (3 checagens seguidas boas).

**Interfaces:**
- Consome: nada de outra tarefa.
- Produz: nada que outra tarefa consuma — script standalone, chamado via cron no servidor.

- [ ] **Step 1: Escrever o script**

```bash
#!/usr/bin/env bash
# Liga a stack de failover do Supabase self-hosted (Docker) so quando o
# Supabase cloud (plano gratuito) estiver de verdade fora do ar, desliga
# sozinho quando ele volta -- sem isso, a stack fica sempre ligada
# consumindo ~2GB RAM + CPU a toa (achado real 2026-07-30, investigando
# lentidao do sistema). Roda via cron a cada 5min (ver Step 4).
set -euo pipefail

SUPABASE_URL="https://waubqgkftwrufepwhctc.supabase.co"
STATE_FILE=/opt/ntb-estoque/.failover-state   # "up" ou "down": estado atual do failover local
COUNT_FILE=/opt/ntb-estoque/.failover-count   # checagens seguidas discordantes do estado atual
LOG=/opt/ntb-estoque/failover-watch.log
CONTAINERS="supabase-kong supabase-pooler supabase-storage supabase-edge-functions realtime-dev.supabase-realtime supabase-meta supabase-auth supabase-rest supabase-db supabase-studio supabase-imgproxy"
LIMIAR=3   # 3 checagens seguidas (cron de 5min = 15min) pra trocar de estado -- evita flapping num blip transitorio

estado=$(cat "$STATE_FILE" 2>/dev/null || echo "up")
contagem=$(cat "$COUNT_FILE" 2>/dev/null || echo "0")

codigo=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$SUPABASE_URL/auth/v1/health" || echo "000")
saudavel="nao"
[ "$codigo" = "200" ] && saudavel="sim"

if { [ "$estado" = "up" ] && [ "$saudavel" = "nao" ]; } || { [ "$estado" = "down" ] && [ "$saudavel" = "sim" ]; }; then
  contagem=$((contagem + 1))
else
  contagem=0
fi
echo "$contagem" > "$COUNT_FILE"

if [ "$contagem" -ge "$LIMIAR" ]; then
  if [ "$estado" = "up" ]; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Supabase cloud fora do ar ha $LIMIAR checagens seguidas (HTTP $codigo) -- ligando failover local" >> "$LOG"
    docker start $CONTAINERS >> "$LOG" 2>&1
    echo "down" > "$STATE_FILE"
  else
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Supabase cloud saudavel ha $LIMIAR checagens seguidas -- desligando failover local" >> "$LOG"
    docker stop $CONTAINERS >> "$LOG" 2>&1
    echo "up" > "$STATE_FILE"
  fi
  echo "0" > "$COUNT_FILE"
fi
```

- [ ] **Step 2: Dar permissão de execução e commitar**

```bash
chmod +x scripts/failover-supabase-watch.sh
git add scripts/failover-supabase-watch.sh
git commit -m "feat: automatiza liga/desliga da stack de failover do Supabase por health check"
```

- [ ] **Step 3: Deploy (pull do código no servidor)**

Run: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && git pull --ff-only && chmod +x scripts/failover-supabase-watch.sh"`
Expected: `Fast-forward`, sem erro.

- [ ] **Step 4: Testar manualmente antes de agendar**

Run: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "bash /opt/ntb-estoque/scripts/failover-supabase-watch.sh && cat /opt/ntb-estoque/.failover-state /opt/ntb-estoque/.failover-count"`
Expected: `up` e `0` (Supabase cloud está saudável agora, contagem reseta pra 0, nada é ligado/desligado).

- [ ] **Step 5: Simular queda pra confirmar que liga sozinho**

Run 3 vezes seguidas (simula 3 checagens ruins editando a URL pra uma inválida só neste teste manual, sem editar o script de verdade):
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && for i in 1 2 3; do SUPABASE_URL='https://url-invalida-de-teste.invalid' bash -c 'source scripts/failover-supabase-watch.sh' 2>&1 || sed -i 's|SUPABASE_URL=\"https://waubqgkftwrufepwhctc.supabase.co\"|SUPABASE_URL=\"https://url-invalida.invalid\"|' /tmp/fw-test.sh; done"
```
**Nota pro executor**: esse teste é delicado de simular sem editar o arquivo de verdade — a forma mais simples e segura é: copiar o script pra `/tmp/fw-test.sh`, trocar a URL nessa cópia pra uma inválida, rodar `bash /tmp/fw-test.sh` 3 vezes seguidas (ajustando `STATE_FILE`/`COUNT_FILE`/`LOG` pra caminhos em `/tmp` também, pra não mexer no estado real), e confirmar que na 3ª rodada ele chama `docker start`. Depois `docker ps` deve mostrar os 11 containers rodando de novo — **lembrar de `docker stop` esses containers de teste manualmente no final**, já que o teste usou uma URL falsa e o script de produção (com a URL real) vai continuar achando que está tudo bem.

- [ ] **Step 6: Adicionar ao crontab do servidor**

Run: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "(crontab -l 2>/dev/null; echo '*/5 * * * * /bin/bash /opt/ntb-estoque/scripts/failover-supabase-watch.sh') | crontab -"`
Expected: sem erro. Confirmar com `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "crontab -l"` mostrando a nova linha junto com as 2 já existentes (`sync-cron.sh` e `sync-auth-standby.mjs`).

---

## Verificação final (depois de todas as tarefas)

- [ ] **Deploy de tudo**

Run: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`
Expected: build sem erro, `systemctl restart` bem sucedido.

- [ ] **Confirmar produção no ar**

Run: `curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login`
Expected: `HTTP 200`

- [ ] **Medir a melhora real (Playwright, sessão QA)**

Usar o mesmo script de medição já usado durante a investigação (login com `claude.qa@ntb-estoque.dev`/`claudeqa123456`, medir `/home` duas vezes seguidas — a 2ª carga deve vir MUITO mais rápida que a 1ª, graças ao cache do Task 4). Comparar contra a baseline medida em 2026-07-30 (login→home: 16-27s, `/home` isolado: 9.6s pós-mitigação-de-infra).
Expected: `/home` bem abaixo de 5s na 2ª carga.

- [ ] **Atualizar `docs/reuniao-2026-07-27-pedidos.md`** (se esse trabalho tiver relação com algum item aberto do catálogo da reunião) ou registrar como achado novo, seguindo o mesmo padrão já usado nesta sessão pra outros bugs/perf fixes.
