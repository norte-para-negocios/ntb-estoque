# Inventário travando / Omie bloqueado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela de contagem de inventário para de carregar infinitamente/dar erro, eliminando o loop de retry que faz o Omie bloquear a chave das lojas.

**Architecture:** Causa raiz (investigada 2026-09-24, dados do Postgres do Contabo): o cron `retry-ajustes-inventario` (10/10 min) reenvia itens `Erro` sem teto. Itens cujo ajuste JÁ existe no Omie (id perdido por timeout) recebem "Já existe um ajuste ... com o ID [X]" e voltam pra fila eternamente (item 8962: 4.629 tentativas); "cálculo do saldo/CMC ainda não foi concluído" (16k em 30d) idem. Isso gera ~1.500 chamadas repetidas/dia → Omie responde "API bloqueada por consumo indevido. Tente novamente em N segundos" (~500x/dia, até 28 min). Chamar durante o bloqueio reinicia a contagem. A tela chama o Omie a cada blur, sem timeout, e desabilita TODOS os inputs enquanto qualquer item processa → nginx corta em 60s (logs: timeouts em `POST /inventario/N/contagem`). Correção: (1) disjuntor por app_key + timeout no `omieRequest`; (2) `processarItemInventario` adota ajuste existente, trata CMC pendente como `Sem CMC`, não conta bloqueio como tentativa; (3) teto+throttle no retry de `Erro`; (4) UI com pending por item e sem reenvio de valor igual; (5) saneamento único dos itens em loop no banco de produção.

**Tech Stack:** Next.js 16 (Server Actions), Supabase/Postgres self-hosted no Contabo, API Omie. Testes: `node --test` (Node 26, strip-types nativo) em módulos puros sem imports com alias `@/`.

**Spec:** diagnóstico nesta conversa (2026-09-24) — resumido em Architecture acima.

## Global Constraints

- Nunca reprocessar item com `id_ajuste` preenchido (duplicaria ajuste no Omie).
- Lojas reais: nenhuma escrita NOVA no Omie é introduzida por este plano (adoção de ajuste existente é só escrita local).
- Deploy é manual: `ssh root@185.193.66.240` → `/opt/ntb-estoque/deploy.sh` (git push NÃO atualiza produção).
- Banco de produção = Postgres do Contabo (`docker exec supabase-db psql -U postgres -d postgres`), não o Supabase Cloud.
- Mensagens ao usuário em pt-BR.

## Review Focus

- Bloqueio do Omie durante contagem: usuário salva item → deve voltar em <2s com erro claro "Omie bloqueado por mais N min", item fica `Erro` sem queimar tentativa.
- Timeout no meio de `IncluirAjusteEstoque`: próximo envio recebe "Já existe ... ID [X]" → item vira `Concluido` com `id_ajuste=X`, sem duplicar.
- Blur sem mudar valor num item `Concluido`: não pode chamar o servidor.
- Clicar `+` várias vezes rápido: só aquele item fica desabilitado enquanto processa; demais inputs livres.
- Item `Erro` com tentativas no teto: cron para de reenviar; botão "Reenviar pendentes" (forceSync) continua reenviando.

---

### Task 1: Helpers puros de classificação de erro do Omie + disjuntor

**Files:**
- Create: `lib/omie/erros-omie.ts`
- Create: `lib/omie/erros-omie.test.ts`

**Interfaces:**
- Produces:
  - `segundosBloqueio(msg: string): number | null`
  - `idAjusteExistente(msg: string): number | null`
  - `ehCmcPendente(msg: string): boolean`
  - `registrarBloqueio(appKey: string, segundos: number, agoraMs?: number): void`
  - `msRestantesBloqueio(appKey: string, agoraMs?: number): number` (0 = livre)

- [ ] **Step 1: Teste falhando** (`lib/omie/erros-omie.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segundosBloqueio, idAjusteExistente, ehCmcPendente, registrarBloqueio, msRestantesBloqueio } from './erros-omie.ts'

test('segundosBloqueio extrai N de consumo indevido', () => {
  assert.equal(segundosBloqueio('ERROR: API bloqueada por consumo indevido. Tente novamente em 1678 segundos.'), 1678)
  assert.equal(segundosBloqueio('ERROR: Consumo redundante detectado. Aguarde 5 segundos'), null)
  assert.equal(segundosBloqueio('qualquer outra'), null)
})

test('idAjusteExistente extrai o ID do ajuste já lançado', () => {
  const msg = 'ERROR: Já existe um ajuste de estoque para o código de integração [ITEM8962] com o ID [8995630051] para o produto de código [123]'
  assert.equal(idAjusteExistente(msg), 8995630051)
  assert.equal(idAjusteExistente('ERROR: outra coisa'), null)
})

test('ehCmcPendente reconhece cálculo de CMC não concluído', () => {
  assert.equal(ehCmcPendente('ERROR: O cálculo do saldo de estoque e CMC do produto ainda não foi concluído para o local X'), true)
  assert.equal(ehCmcPendente('ERROR: outra'), false)
})

test('disjuntor: bloqueia por app_key até expirar', () => {
  registrarBloqueio('k1', 100, 1_000_000)
  assert.equal(msRestantesBloqueio('k1', 1_000_000), 100_000)
  assert.equal(msRestantesBloqueio('k2', 1_000_000), 0)
  assert.equal(msRestantesBloqueio('k1', 1_000_000 + 100_001), 0)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test lib/omie/erros-omie.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** (`lib/omie/erros-omie.ts`, sem imports)

```ts
// Classificação das faultstrings do Omie + disjuntor por app_key (2026-09-24).
// Módulo puro (sem @/ imports) pra rodar em `node --test`.

export function segundosBloqueio(msg: string): number | null {
  const m = msg.match(/bloqueada por consumo indevido.*?(\d+)\s*segundos/i)
  return m ? Number(m[1]) : null
}

export function idAjusteExistente(msg: string): number | null {
  const m = msg.match(/j. existe um ajuste de estoque.*?com o ID \[(\d+)\]/i)
  return m ? Number(m[1]) : null
}

export function ehCmcPendente(msg: string): boolean {
  return /c.lculo do saldo de estoque e CMC .*ainda n.o foi conclu/i.test(msg)
}

// Estado de processo: o ntb-estoque roda como UM `next start` no Contabo e os
// crons batem nele via localhost, então um Map em memória cobre tudo. Chamar o
// Omie durante o bloqueio reinicia a contagem dele -- por isso falhar rápido.
const bloqueadoAte = new Map<string, number>()

export function registrarBloqueio(appKey: string, segundos: number, agoraMs: number = Date.now()): void {
  const ate = agoraMs + segundos * 1000
  if ((bloqueadoAte.get(appKey) ?? 0) < ate) bloqueadoAte.set(appKey, ate)
}

export function msRestantesBloqueio(appKey: string, agoraMs: number = Date.now()): number {
  const ate = bloqueadoAte.get(appKey)
  if (!ate) return 0
  if (ate <= agoraMs) {
    bloqueadoAte.delete(appKey)
    return 0
  }
  return ate - agoraMs
}
```

- [ ] **Step 4: Rodar** — `node --test lib/omie/erros-omie.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add lib/omie/erros-omie.ts lib/omie/erros-omie.test.ts && git commit -m "feat(omie): classificação de faultstring + disjuntor por app_key"`

### Task 2: Disjuntor e timeout no `omieRequest`

**Files:** Modify `lib/omie/client.ts` (função `omieRequest`, ~linhas 83-170)

**Interfaces:** Consumes `segundosBloqueio`, `registrarBloqueio`, `msRestantesBloqueio` (Task 1).

- [ ] **Step 1:** Importar `import { msRestantesBloqueio, registrarBloqueio, segundosBloqueio } from './erros-omie'`.
- [ ] **Step 2:** Logo após o bloco de loja de teste simulada, antes de montar `body`:

```ts
  // Disjuntor (2026-09-24): Omie bloqueou esta chave por consumo indevido --
  // chamar de novo reinicia a contagem do bloqueio. Falha rápido em vez de bater.
  const restante = msRestantesBloqueio(omie_app_key)
  if (restante > 0) {
    throw new OmieError(
      `API do Omie bloqueada para esta loja por consumo indevido (libera em ~${Math.ceil(restante / 60000)} min). Tente novamente depois.`,
      'BLOQUEIO_LOCAL'
    )
  }
```

- [ ] **Step 3:** No `fetch`, adicionar `signal: AbortSignal.timeout(30_000)`.
- [ ] **Step 4:** Dentro do `if (!res.ok || faultstring)`, antes do teste de "consumo redundante":

```ts
        const seg = segundosBloqueio(msg)
        if (seg != null) {
          registrarBloqueio(omie_app_key, seg)
          throw new OmieError(msg, faultCode, res.status)
        }
```

- [ ] **Step 5:** `npx tsc --noEmit -p .` → sem erros novos em `client.ts`.
- [ ] **Step 6: Commit** — `git commit -am "fix(omie): disjuntor de bloqueio por consumo indevido + timeout 30s no fetch"`

### Task 3: `processarItemInventario` — adota ajuste existente, CMC pendente, bloqueio não conta

**Files:** Modify `lib/actions/inventario.ts` (`processarItemInventario`, bloco `catch` e o ponto onde `res.id_ajuste` é avaliado)

**Interfaces:** Consumes `idAjusteExistente`, `ehCmcPendente` (Task 1); `OmieError.faultCode === 'BLOQUEIO_LOCAL'` e `segundosBloqueio` (Task 2).

- [ ] **Step 1:** Import `import { ehCmcPendente, idAjusteExistente, segundosBloqueio } from '@/lib/omie/erros-omie'` e `OmieError` de `@/lib/omie/client`.
- [ ] **Step 2:** Substituir o `catch (e)` por:

```ts
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)

    // Ajuste JÁ lançado no Omie com este cod_int_ajuste (id perdido num timeout
    // anterior): adota o ID em vez de reenviar pra sempre (achado 2026-09-24:
    // item 8962 com 4.629 tentativas batendo nesse erro a cada 10 min).
    const idExistente = idAjusteExistente(msg)
    if (idExistente) {
      await supabase
        .from('inventario_items')
        .update({
          status: 'Concluido',
          id_ajuste: idExistente,
          descricao_status: 'Ajuste já existia no Omie (ID recuperado)',
          response: msg,
          tentativas: 0,
          ultima_tentativa_em: new Date().toISOString(),
        })
        .eq('id', item.id)
      return
    }

    // CMC ainda em cálculo no Omie: mesma natureza de 'Sem CMC' (throttle 1h + teto),
    // não 'Erro' (que o cron reenviava a cada 10 min).
    const cmcPendente = ehCmcPendente(msg)
    // Bloqueio do Omie não é culpa do item: não queima tentativa.
    const bloqueio = (e instanceof OmieError && e.faultCode === 'BLOQUEIO_LOCAL') || segundosBloqueio(msg) != null

    await supabase
      .from('inventario_items')
      .update({
        status: cmcPendente ? 'Sem CMC' : 'Erro',
        descricao_status: msg.slice(0, 500),
        response: msg,
        tentativas: bloqueio ? (item.tentativas ?? 0) : (item.tentativas ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq('id', item.id)
    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'InventarioItem',
      request: `item ${item.id}`,
      error: true,
      error_message: msg,
    })
  }
```

(`descricao_status` passa a carregar a mensagem para o toast da tela mostrar o motivo real.)

- [ ] **Step 3:** `npx tsc --noEmit -p .` → ok.
- [ ] **Step 4: Commit** — `git commit -am "fix(inventario): adota ajuste existente, CMC pendente vira Sem CMC, bloqueio não queima tentativa"`

### Task 4: Teto + throttle no retry de `Erro`

**Files:** Modify `lib/actions/inventario.ts` (constantes ~linha 503 e query `errosGenericos` em `retryAjustesInventarioPendentes`)

- [ ] **Step 1:** Constantes:

```ts
// Teto/throttle p/ 'Erro' (2026-09-24): sem isso itens com erro permanente eram
// reenviados a cada 10 min pra sempre (até 4.850 tentativas), queimando a cota
// e fazendo o Omie bloquear a chave da loja. Botão manual (forceSync) ignora o teto.
const ERRO_MAX_TENTATIVAS = 30
const ERRO_STALE_MIN = 30
```

- [ ] **Step 2:** Na query `errosGenericos` adicionar:

```ts
      .lt('tentativas', ERRO_MAX_TENTATIVAS)
      .or(`ultima_tentativa_em.is.null,ultima_tentativa_em.lt.${new Date(Date.now() - ERRO_STALE_MIN * 60_000).toISOString()}`)
```

- [ ] **Step 3:** `npx tsc --noEmit -p .` → ok.
- [ ] **Step 4: Commit** — `git commit -am "fix(inventario): teto e throttle de 30 min no retry automático de itens com Erro"`

### Task 5: UI — pending por item, sem reenvio de valor igual

**Files:** Modify `components/inventario/ContagemInventario.tsx`

- [ ] **Step 1:** Adicionar `const [enviando, setEnviando] = useState<Set<number>>(() => new Set())`.
- [ ] **Step 2:** Em `salvarQtd`, após validar:

```ts
    const atual = itens.find((i) => i.id === itemId)
    // Blur sem mudança não reenvia (antes excluía e relançava o ajuste no Omie).
    if (atual && atual.quan === num && (atual.status === 'Concluido' || (num === null && atual.status === 'Vazio'))) return
    if (enviando.has(itemId)) return
    setEnviando((s) => new Set(s).add(itemId))
```

e trocar `startTransition(async () => { const res = await enviarInventarioItem(...) ... })` por uma chamada async sem transition, com `try/finally` removendo o id de `enviando`, e `catch` que marca o item `Erro` + `toast.error('Falha ao integrar item', { description: 'Sem resposta do servidor. Tente reenviar.' })`.
- [ ] **Step 3:** Nos controles de quantidade (−, input, +) trocar `disabled={pending}` por `disabled={enviando.has(item.id)}`. Remover (`Trash2`) e os botões globais continuam em `pending`.
- [ ] **Step 4:** `npx tsc --noEmit -p . && npm run lint -- components/inventario/ContagemInventario.tsx` → ok.
- [ ] **Step 5: Commit** — `git commit -am "fix(inventario): trava só o item que está enviando e não reenvia quantidade inalterada"`

### Task 6: Saneamento dos itens em loop + deploy + verificação

- [ ] **Step 1 (dados, produção):** backup e adoção dos itens cujo último erro é "Já existe ... ID [X]":

```sql
create table if not exists _bkp_inventario_items_20260924 as
  select * from inventario_items where status in ('Erro','Processando','Sem CMC') and id_ajuste is null;
update inventario_items
   set status='Concluido',
       id_ajuste = (regexp_match(response, 'com o ID \[(\d+)\]'))[1]::bigint,
       descricao_status='Ajuste já existia no Omie (ID recuperado)', tentativas=0
 where id_ajuste is null and status in ('Erro','Processando')
   and response ~ 'xiste um ajuste de estoque.*com o ID \[\d+\]';
```

Itens restantes em `Erro` com tentativas ≥ 30 saem do cron automaticamente (Task 4); ficam visíveis na tela para reenvio manual.
- [ ] **Step 2:** `git push`, depois `ssh ... "cd /opt/ntb-estoque && ./deploy.sh"`; conferir `systemctl status ntb-estoque`.
- [ ] **Step 3 (verificação):** após 1-2 ciclos do cron, `select count(*) from integration_attempts where model='InventarioItem' and created_at > now()-interval '30 min'` deve cair de ~30/10min para perto de 0; `error_message ilike '%consumo indevido%'` na última hora deve cair; abrir `/inventario/<id>/contagem` e salvar um item em loja de teste → responde rápido.
