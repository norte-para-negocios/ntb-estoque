# Melhorias Operacionais NTB Estoque, Fase 2 — Plano de Implementação

> **Para quem vai implementar:** use `superpowers:executing-plans` (ou `superpowers:subagent-driven-development`) para executar tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para rastreamento.

## Skills a usar (obrigatório)

Invocar a skill ANTES de começar o tipo de trabalho correspondente. Não pular.

**Processo (em toda tarefa):**
- `superpowers:executing-plans` — executar este plano passo a passo, com checkpoint entre tarefas.
- `superpowers:verification-before-completion` — antes de marcar qualquer tarefa como pronta.
- `superpowers:systematic-debugging` — se algo quebrar (build, query, envio de e-mail). Não chutar correção.
- `superpowers:requesting-code-review` — antes de cada merge na main.

**Quando mexer em UI / componentes (T5, T6, T7, T8, T9 têm telas/componentes):**
- `design-taste-frontend` (ou `impeccable`) — SEMPRE antes de escrever qualquer JSX/Tailwind. Regra da casa: nada de UI sem passar por uma skill de taste primeiro. Os componentes novos (AlertasForm, AvisoSyncTravado, ExportarSugestaoBtn, página de relatório) devem respeitar o design system que JÁ existe (`app/globals.css`: tokens bg/surface/brand/err/warn, Plus Jakarta Sans, raios e sombras escalonados). Não introduzir cor/fonte/estilo novo.

**Quando mexer no banco / Supabase (T1 e queries de T8, T9):**
- `supabase:supabase-postgres-best-practices` — para a migration `016_alertas_config.sql` e para revisar as queries novas (índices, filtro por loja_id, evitar N+1).
- `nextjs-typescript-supabase` — padrão de Server Actions + client SSR vs service-role.

**Quando mexer em rotas de API / cron / PDF (T4, T6, T9):**
- `vercel:vercel-functions` — route handlers, `maxDuration`, headers de resposta.
- `vercel:nextjs` — convenções do App Router (lembrar do `AGENTS.md`: este Next tem breaking changes, ler `node_modules/next/dist/docs/` antes).

**Regra de prioridade entre skills:** processo primeiro (executing-plans), depois a skill de domínio (design-taste-frontend / supabase / vercel) conforme a tarefa. Se o pedido envolver UI, a skill de taste vem antes de tocar no código.


**Goal:** Adicionar as features de maior valor operacional que ainda NÃO existem no sistema (alertas proativos por e-mail, sugestão de compra exportável, aviso visível de loja com sync travado, validade com saldo real, relatório de gestão mensal), sem tocar no stack, no design system ou na arquitetura.

**Architecture:** Tudo construído em cima do que já existe. Server Actions + Server Components (App Router), Supabase Postgres via pooler, integração Omie só de leitura (zero escrita nova no Omie). Alertas usam um novo endpoint de cron no mesmo padrão dos existentes (`/api/cron/*` com `Authorization: Bearer CRON_SECRET`). E-mail via Resend free tier.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, shadcn/ui + ui-kit próprio, Supabase (`@supabase/supabase-js`), `@react-pdf/renderer` (já instalado), Resend (novo, free tier).

## Por que este plano e não o anterior

A varredura de 17/06 confirmou que MUITA coisa que parecia faltar JÁ ESTÁ PRONTA e não deve ser refeita:

- Chips de filtros ativos: feito (`components/ui-kit/ChipsFiltrosAtivos`).
- Presets de data (Hoje/7d/Este mês/Mês passado/Este ano): feito (`FiltrosGaveta`).
- Totais no topo das tabelas (soma R$ NF, entra/sai movimentações, pendentes/concluídas OP): feito.
- Home operacional com fila "Precisa de atenção" (repor, erro de sync, vencendo, inventário/transferência em aberto): feito (`app/(app)/home/page.tsx`).
- Validade com semáforo de cor por urgência + filtro tipo/família/produto + períodos 3/7/15/30/60 + "vencidos": feito.

**Logo, este plano cobre só o que falta de verdade.** Nada aqui duplica o que já existe.

## Global Constraints

- **Custo zero obrigatório.** Só free tier. Resend free tier (3.000 e-mails/mês, 100/dia) atende com folga. Nenhuma dependência paga nova sem aprovação explícita do fundador.
- **Next.js com breaking changes:** ler o guia em `node_modules/next/dist/docs/` antes de escrever código novo de rota/API. Respeitar avisos de depreciação (ver `AGENTS.md`).
- **Multi-tenancy:** TODA query filtra por `loja_id`. Toda página checa `requirePermissao(lojaId, '<Permissão>')`.
- **Banco via pooler:** nunca conexão direta `db.` (IPv6-only, falha). Usar `node scripts/db.mjs "<SQL>"` ou `node scripts/aplicar-migration.mjs <arquivo>`.
- **SQL com acento:** nunca via PowerShell (corrompe UTF-8). Sempre Node/`db.mjs`.
- **Proibido travessão (—)** em qualquer texto visível ou copy.
- **Assinar trabalhos como "Joaquim Salles".**
- **Sem suite de testes automatizada no projeto.** "Teste" aqui = `npm run build` passa + verificação visual no deploy de preview da Vercel. Onde o passo pede verificação, é manual/visual. Não inventar Jest/Playwright sem o fundador pedir.
- **Git:** branch de trabalho `joaquim/plano-omie-15-06`. Commit no branch, depois `git checkout main && git merge --ff-only && git push origin main`, voltar ao branch.
- **Banco perto do teto:** ~320 MB / 500 MB. Tabelas novas devem ser pequenas (config, não dados de volume). Nenhuma tabela nova de histórico aqui.

---

## File Structure

Mapa do que cada tarefa cria ou altera. Cada arquivo tem uma responsabilidade.

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `supabase/migrations/016_alertas_config.sql` | Tabela `alertas_config` (1 linha por loja) + seed | T1 |
| `lib/email/resend.ts` | Wrapper fino do Resend (1 função `enviarEmail`) | T2 |
| `lib/alertas/coletar.ts` | Monta o payload de alertas de uma loja (repor, vencendo, erro sync, OP vencida) | T3 |
| `app/api/cron/alertas/route.ts` | Cron diário: varre lojas, coleta, envia e-mail | T4 |
| `vercel.json` | Adiciona o agendamento do cron de alertas | T4 |
| `app/(app)/loja/alertas/page.tsx` | Tela de configuração de alertas por loja | T5 |
| `lib/actions/alertas.ts` | Server action `salvarAlertasConfig` | T5 |
| `components/loja/AlertasForm.tsx` | Formulário de config (client) | T5 |
| `app/(app)/produto/sugestao-compra/route.ts` | Export da sugestão de compra (CSV + texto WhatsApp) | T6 |
| `components/produtos/ExportarSugestaoBtn.tsx` | Botão de export na tela de compras | T6 |
| `components/shell/AvisoSyncTravado.tsx` | Banner de loja com sync parado há muito tempo | T7 |
| `app/(app)/layout.tsx` | Monta o banner de aviso no shell | T7 |
| `lib/actions/sync-status.ts` | Função `lojasComSyncTravado` (reusa dados existentes) | T7 |
| `app/(app)/validade/page.tsx` | Adiciona saldo real de estoque + filtro por local | T8 |
| `components/relatorio/RelatorioGestaoPDF.tsx` | PDF de gestão mensal (entradas, saídas, OPs, NFs) | T9 |
| `app/(app)/relatorio-gestao/page.tsx` | Tela do relatório de gestão (seletor de mês) | T9 |
| `app/(app)/relatorio-gestao/pdf/route.ts` | Gera o PDF do relatório de gestão | T9 |
| `components/shell/NavItems.ts` | Adiciona itens de nav (alertas, relatório gestão) | T5, T9 |

---

## Ordem e priorização

Por impacto x esforço. Cada bloco é independente e entrega software funcionando sozinho. Podem ir em PRs separados.

| # | Tarefa | Impacto | Esforço | Quem sente |
|---|---|---|---|---|
| T1-T5 | Alertas proativos por e-mail | Alto | Médio | Ramon/Andrey (donos) |
| T6 | Sugestão de compra exportável (WhatsApp/CSV) | Alto | Baixo | Comprador |
| T7 | Aviso de loja com sync travado | Médio | Baixo | Todos (evita dado velho silencioso) |
| T8 | Validade com saldo real + filtro de local | Alto | Médio | Cozinha/operação |
| T9 | Relatório de gestão mensal (PDF) | Alto comercial | Médio | Ramon/Andrey |

**Sugestão de sequência de entrega:** comece por T6 e T7 (rápidos, alto retorno), depois T1-T5 (alertas), depois T8, fechando com T9.

---

## Decisões a confirmar antes de começar (perguntar ao fundador)

Estes pontos mudam detalhe de implementação. Confirmar antes de T1 e T9:

1. **Resend:** o domínio de envio. Sem domínio verificado, o Resend só envia de `onboarding@resend.dev` (cai em spam fácil). Ideal: verificar um domínio (ex.: `ntb.com.br` ou subdomínio). Decisão: usar `onboarding@resend.dev` no MVP e trocar quando o domínio for verificado.
2. **Destinatários dos alertas:** e-mail fixo por loja na config (T5) OU os e-mails dos usuários admin daquela loja. MVP: campo de e-mail livre na config.
3. **Validade (T8):** confirmar de qual fonte vem o "saldo em estoque" do produto. A tela hoje usa `ordens_producao.validade` (validade de lotes produzidos). O saldo real está em `posicao_estoques` (campos `n_saldo`/`fisico`). Confirmar com o Ramon se a validade que importa é a da OP (lote produzido) e se o saldo a exibir é a posição atual do produto.

---

## Task T1: Tabela `alertas_config`

**Files:**
- Create: `supabase/migrations/016_alertas_config.sql`

**Interfaces:**
- Produz a tabela `alertas_config` com colunas: `loja_id` (PK, FK lojas), `ativo` (bool), `email_destino` (text), `repor_ativo` (bool), `vencendo_ativo` (bool), `vencendo_dias` (int), `erro_sync_ativo` (bool), `op_vencida_ativo` (bool), `updated_at` (timestamptz).
- Consumido por: T3 (`coletar.ts`), T5 (`salvarAlertasConfig`).

- [ ] **Step 1: Escrever a migration**

Create `supabase/migrations/016_alertas_config.sql`:

```sql
-- Config de alertas proativos por loja. 1 linha por loja (loja_id e PK).
-- Tabela de configuracao (nao de volume): impacto de espaco desprezivel.
create table if not exists alertas_config (
  loja_id integer primary key references lojas(id) on delete cascade,
  ativo boolean not null default false,
  email_destino text,
  repor_ativo boolean not null default true,
  vencendo_ativo boolean not null default true,
  vencendo_dias integer not null default 7,
  erro_sync_ativo boolean not null default true,
  op_vencida_ativo boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Seed: cria uma linha (desligada) para cada loja ativa que ainda nao tem.
insert into alertas_config (loja_id, ativo)
select id, false from lojas
on conflict (loja_id) do nothing;
```

- [ ] **Step 2: Aplicar a migration**

Run: `node scripts/aplicar-migration.mjs supabase/migrations/016_alertas_config.sql`
Expected: cria a tabela e o seed sem erro.

- [ ] **Step 3: Verificar**

Run: `node scripts/db.mjs "select loja_id, ativo, vencendo_dias from alertas_config order by loja_id"`
Expected: uma linha por loja, `ativo=false`, `vencendo_dias=7`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_alertas_config.sql
git commit -m "feat: tabela alertas_config (config de alertas por loja)"
```

---

## Task T2: Wrapper do Resend

**Files:**
- Create: `lib/email/resend.ts`

**Interfaces:**
- Produz: `enviarEmail({ para, assunto, html }: { para: string; assunto: string; html: string }): Promise<{ ok: boolean; erro?: string }>`.
- Consome env: `RESEND_API_KEY`, `RESEND_FROM` (com fallback `onboarding@resend.dev`).
- Consumido por: T4 (`/api/cron/alertas`).

- [ ] **Step 1: Adicionar a dependência**

Run: `npm install resend`
Expected: `resend` aparece em `dependencies` no `package.json`.

- [ ] **Step 2: Adicionar as env vars**

No `.env.local` e nas Environment Variables da Vercel:

```
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=NTB Estoque <onboarding@resend.dev>
```

(A `RESEND_API_KEY` vem do painel resend.com, conta free. Trocar `RESEND_FROM` quando houver domínio verificado.)

- [ ] **Step 3: Escrever o wrapper**

Create `lib/email/resend.ts`:

```ts
import { Resend } from 'resend'

// Wrapper fino: isola o Resend e nunca lanca (alerta nao pode derrubar o cron).
export async function enviarEmail({
  para,
  assunto,
  html,
}: {
  para: string
  assunto: string
  html: string
}): Promise<{ ok: boolean; erro?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, erro: 'RESEND_API_KEY ausente' }
  const from = process.env.RESEND_FROM || 'NTB Estoque <onboarding@resend.dev>'
  try {
    const resend = new Resend(key)
    const { error } = await resend.emails.send({ from, to: para, subject: assunto, html })
    if (error) return { ok: false, erro: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'erro desconhecido' }
  }
}
```

- [ ] **Step 4: Verificar o build**

Run: `npm run build`
Expected: compila sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/email/resend.ts
git commit -m "feat: wrapper do Resend para envio de e-mail (free tier)"
```

---

## Task T3: Coletor de alertas de uma loja

**Files:**
- Create: `lib/alertas/coletar.ts`

**Interfaces:**
- Consome: cliente service-role do Supabase, RPC `produtos_repor(p_loja_id)` (já existe), tabelas `ordens_producao`, `integration_attempts`, `alertas_config`.
- Produz: `coletarAlertasLoja(lojaId: number): Promise<AlertaLoja | null>` onde
  `type AlertaLoja = { lojaId: number; lojaNome: string; emailDestino: string; itens: { titulo: string; detalhe: string }[] }`.
  Retorna `null` quando a loja não tem alerta ativo, sem e-mail, ou sem nenhum item para reportar.

- [ ] **Step 1: Escrever o coletor**

Create `lib/alertas/coletar.ts`:

```ts
import { createServiceClient } from '@/lib/supabase/server'

export type ItemAlerta = { titulo: string; detalhe: string }
export type AlertaLoja = {
  lojaId: number
  lojaNome: string
  emailDestino: string
  itens: ItemAlerta[]
}

// Monta os itens de alerta de UMA loja conforme a config. Tudo leitura.
// Retorna null se: alerta desligado, sem e-mail, ou nada a reportar.
export async function coletarAlertasLoja(lojaId: number): Promise<AlertaLoja | null> {
  const supabase = createServiceClient()

  const { data: cfg } = await supabase
    .from('alertas_config')
    .select('ativo, email_destino, repor_ativo, vencendo_ativo, vencendo_dias, erro_sync_ativo, op_vencida_ativo')
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (!cfg || !cfg.ativo || !cfg.email_destino) return null

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome_fantasia, nome')
    .eq('id', lojaId)
    .single()
  const lojaNome = loja?.nome_fantasia || loja?.nome || `Loja ${lojaId}`

  const head = { count: 'exact' as const, head: true }
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const limiteVencendo = new Date(Date.now() + (cfg.vencendo_dias ?? 7) * 86400000)
    .toISOString()
    .slice(0, 10)
  const desde24h = new Date(Date.now() - 24 * 3600000).toISOString()

  const itens: ItemAlerta[] = []

  // Repor (abaixo do minimo) — RPC ja existente.
  if (cfg.repor_ativo) {
    const { data: repor } = await supabase.rpc('produtos_repor', { p_loja_id: lojaId })
    const qtd = (repor ?? []).length
    if (qtd > 0) itens.push({ titulo: 'Repor estoque', detalhe: `${qtd} produto(s) abaixo do minimo.` })
  }

  // Vencendo nos proximos N dias (OPs com validade).
  if (cfg.vencendo_ativo) {
    const { count } = await supabase
      .from('ordens_producao')
      .select('id', head)
      .eq('loja_id', lojaId)
      .not('validade', 'is', null)
      .gte('validade', hojeISO)
      .lte('validade', limiteVencendo)
    if ((count ?? 0) > 0)
      itens.push({ titulo: 'Validade proxima', detalhe: `${count} item(ns) vencem em ${cfg.vencendo_dias} dias.` })
  }

  // OPs ja vencidas e nao concluidas.
  if (cfg.op_vencida_ativo) {
    const { count } = await supabase
      .from('ordens_producao')
      .select('id', head)
      .eq('loja_id', lojaId)
      .eq('concluida', false)
      .not('validade', 'is', null)
      .lt('validade', hojeISO)
    if ((count ?? 0) > 0)
      itens.push({ titulo: 'OP vencida em aberto', detalhe: `${count} ordem(ns) vencida(s) sem conclusao.` })
  }

  // Erros de sync nas ultimas 24h.
  if (cfg.erro_sync_ativo) {
    const { count } = await supabase
      .from('integration_attempts')
      .select('id', head)
      .eq('loja_id', lojaId)
      .eq('error', true)
      .gte('created_at', desde24h)
    if ((count ?? 0) > 0)
      itens.push({ titulo: 'Erro de sincronizacao', detalhe: `${count} erro(s) com o Omie nas ultimas 24h.` })
  }

  if (itens.length === 0) return null
  return { lojaId, lojaNome, emailDestino: cfg.email_destino, itens }
}
```

> Nota de verificação: confirmar o nome exato do cliente service-role em `lib/supabase/server.ts` (a varredura indica `createServiceClient`). Se for outro nome, ajustar o import.

- [ ] **Step 2: Verificar o build**

Run: `npm run build`
Expected: compila sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add lib/alertas/coletar.ts
git commit -m "feat: coletor de alertas por loja (repor, validade, OP vencida, erro sync)"
```

---

## Task T4: Cron de alertas (envio diário)

**Files:**
- Create: `app/api/cron/alertas/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consome: `assertCronAuth` (de `lib/omie/sync-all.ts`, já existe), `getLojasAtivas` (idem), `coletarAlertasLoja` (T3), `enviarEmail` (T2).
- Produz: endpoint `GET /api/cron/alertas` com header `Authorization: Bearer <CRON_SECRET>`.

- [ ] **Step 1: Escrever a rota do cron**

Create `app/api/cron/alertas/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { assertCronAuth, getLojasAtivas } from '@/lib/omie/sync-all'
import { coletarAlertasLoja, type AlertaLoja } from '@/lib/alertas/coletar'
import { enviarEmail } from '@/lib/email/resend'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// HTML simples do e-mail. Sem travessao, sem dependencia de template engine.
function montarHtml(a: AlertaLoja): string {
  const linhas = a.itens
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;font-weight:600">${i.titulo}</td>` +
        `<td style="padding:8px 0;color:#475569">${i.detalhe}</td></tr>`,
    )
    .join('')
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px">
    <h2 style="margin:0 0 4px">NTB Estoque, ${a.lojaNome}</h2>
    <p style="color:#64748b;margin:0 0 16px">Resumo de alertas de hoje.</p>
    <table style="width:100%;border-collapse:collapse">${linhas}</table>
    <p style="color:#94a3b8;font-size:12px;margin-top:20px">Enviado automaticamente. Acesse o sistema para detalhes.</p>
  </div>`
}

export async function GET(req: NextRequest) {
  if (!assertCronAuth(req)) {
    return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 })
  }

  const lojas = await getLojasAtivas()
  const resultado: { loja: number; enviado: boolean; erro?: string }[] = []

  for (const loja of lojas) {
    const alerta = await coletarAlertasLoja(loja.id)
    if (!alerta) {
      resultado.push({ loja: loja.id, enviado: false })
      continue
    }
    const r = await enviarEmail({
      para: alerta.emailDestino,
      assunto: `NTB Estoque, ${alerta.lojaNome}: ${alerta.itens.length} alerta(s)`,
      html: montarHtml(alerta),
    })
    resultado.push({ loja: loja.id, enviado: r.ok, erro: r.erro })
  }

  return NextResponse.json({ ok: true, resultado })
}
```

> Nota de verificação: confirmar a assinatura de `assertCronAuth` (recebe `NextRequest`? ou a string do header?) e o shape de `getLojasAtivas()` (tem `.id`?) em `lib/omie/sync-all.ts`. Ajustar conforme o existente.

- [ ] **Step 2: Agendar no vercel.json**

Abrir `vercel.json` e adicionar ao array `crons` (uma vez por dia, 11:00 UTC = 08:00 BR):

```json
{ "path": "/api/cron/alertas", "schedule": "0 11 * * *" }
```

- [ ] **Step 3: Testar local com a chave de cron**

Run (com o dev server rodando e `CRON_SECRET` no `.env.local`):

```bash
curl -s -H "Authorization: Bearer SEU_CRON_SECRET" http://localhost:3000/api/cron/alertas
```

Expected: JSON `{ "ok": true, "resultado": [...] }`. Como nenhuma loja tem `ativo=true` ainda (seed da T1), todos `enviado:false`. Sem erro 500.

- [ ] **Step 4: Verificar o build**

Run: `npm run build`
Expected: a rota `/api/cron/alertas` aparece na listagem de build, sem erro.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/alertas/route.ts vercel.json
git commit -m "feat: cron diario de alertas por e-mail"
```

---

## Task T5: Tela de configuração de alertas

**Files:**
- Create: `app/(app)/loja/alertas/page.tsx`
- Create: `lib/actions/alertas.ts`
- Create: `components/loja/AlertasForm.tsx`
- Modify: `components/shell/NavItems.ts`

**Interfaces:**
- Consome: `getCurrentLojaId`, `requirePermissao` (de `lib/auth`), tabela `alertas_config`.
- Produz: server action `salvarAlertasConfig(prev, formData: FormData)` que retorna `{ ok?: true; error?: string }`.

- [ ] **Step 1: Escrever a server action**

Create `lib/actions/alertas.ts`:

```ts
'use server'

import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function salvarAlertasConfig(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Local de Estoque'))) {
    return { error: 'Sem permissao para configurar alertas.' }
  }

  const email = String(formData.get('email_destino') ?? '').trim()
  const ativo = formData.get('ativo') === 'on'
  if (ativo && !email) return { error: 'Informe um e-mail de destino para ativar.' }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'E-mail invalido.' }

  const diasRaw = Number(formData.get('vencendo_dias'))
  const vencendoDias = diasRaw >= 1 && diasRaw <= 60 ? diasRaw : 7

  const supabase = createServiceClient()
  const { error } = await supabase.from('alertas_config').upsert(
    {
      loja_id: lojaId,
      ativo,
      email_destino: email || null,
      repor_ativo: formData.get('repor_ativo') === 'on',
      vencendo_ativo: formData.get('vencendo_ativo') === 'on',
      vencendo_dias: vencendoDias,
      erro_sync_ativo: formData.get('erro_sync_ativo') === 'on',
      op_vencida_ativo: formData.get('op_vencida_ativo') === 'on',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'loja_id' },
  )
  if (error) return { error: error.message }

  revalidatePath('/loja/alertas')
  return { ok: true }
}
```

> Nota: a permissão usada (`'Local de Estoque'`) é um placeholder de "config da loja". Confirmar na tabela `permissoes` qual permissão representa "admin/config da loja" e usar a correta.

- [ ] **Step 2: Escrever o formulário (client)**

Create `components/loja/AlertasForm.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { salvarAlertasConfig } from '@/lib/actions/alertas'
import { btnClass } from '@/components/ui-kit/Button'

type Cfg = {
  ativo: boolean
  email_destino: string | null
  repor_ativo: boolean
  vencendo_ativo: boolean
  vencendo_dias: number
  erro_sync_ativo: boolean
  op_vencida_ativo: boolean
}

const row = 'flex items-center justify-between gap-3 py-3 border-b border-border last:border-0'
const lab = 'text-sm text-text'
const hint = 'text-[12px] text-text-muted'

export function AlertasForm({ cfg }: { cfg: Cfg }) {
  const [state, action, pending] = useActionState(salvarAlertasConfig, null)

  return (
    <form action={action} className="max-w-lg space-y-5">
      <div>
        <label htmlFor="email_destino" className="mb-1 block text-[12px] font-medium text-text-muted">
          E-mail de destino
        </label>
        <input
          id="email_destino"
          name="email_destino"
          type="email"
          defaultValue={cfg.email_destino ?? ''}
          placeholder="gestor@exemplo.com"
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-brand"
        />
      </div>

      <div className="rounded-xl border border-border bg-surface px-4">
        <label className={row}>
          <span>
            <span className={lab}>Ativar alertas diarios</span>
            <span className={`block ${hint}`}>Resumo enviado uma vez por dia, de manha.</span>
          </span>
          <input type="checkbox" name="ativo" defaultChecked={cfg.ativo} className="size-4 accent-[var(--brand)]" />
        </label>
        <label className={row}>
          <span className={lab}>Produtos a repor</span>
          <input type="checkbox" name="repor_ativo" defaultChecked={cfg.repor_ativo} className="size-4 accent-[var(--brand)]" />
        </label>
        <label className={row}>
          <span className={lab}>Validade proxima</span>
          <input type="checkbox" name="vencendo_ativo" defaultChecked={cfg.vencendo_ativo} className="size-4 accent-[var(--brand)]" />
        </label>
        <label className={row}>
          <span>
            <span className={lab}>Dias de antecedencia</span>
            <span className={`block ${hint}`}>Quantos dias antes de vencer entram no alerta.</span>
          </span>
          <input
            type="number"
            name="vencendo_dias"
            min={1}
            max={60}
            defaultValue={cfg.vencendo_dias}
            className="w-20 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-brand"
          />
        </label>
        <label className={row}>
          <span className={lab}>OP vencida em aberto</span>
          <input type="checkbox" name="op_vencida_ativo" defaultChecked={cfg.op_vencida_ativo} className="size-4 accent-[var(--brand)]" />
        </label>
        <label className={row}>
          <span className={lab}>Erro de sincronizacao</span>
          <input type="checkbox" name="erro_sync_ativo" defaultChecked={cfg.erro_sync_ativo} className="size-4 accent-[var(--brand)]" />
        </label>
      </div>

      {state?.error && <p className="text-sm text-[var(--err)]">{state.error}</p>}
      {state?.ok && <p className="text-sm text-[#10b981]">Configuracao salva.</p>}

      <button type="submit" disabled={pending} className={btnClass('primary')}>
        {pending ? 'Salvando...' : 'Salvar'}
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Escrever a página**

Create `app/(app)/loja/alertas/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { AlertasForm } from '@/components/loja/AlertasForm'
import { BellRing } from 'lucide-react'

export default async function AlertasPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Local de Estoque'))) notFound()

  const supabase = await createClient()
  const { data } = await supabase
    .from('alertas_config')
    .select('ativo, email_destino, repor_ativo, vencendo_ativo, vencendo_dias, erro_sync_ativo, op_vencida_ativo')
    .eq('loja_id', lojaId)
    .maybeSingle()

  const cfg = data ?? {
    ativo: false,
    email_destino: '',
    repor_ativo: true,
    vencendo_ativo: true,
    vencendo_dias: 7,
    erro_sync_ativo: true,
    op_vencida_ativo: true,
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alertas"
        icon={BellRing}
        description="Resumo diario por e-mail com o que precisa de atencao na loja"
      />
      <AlertasForm cfg={cfg} />
    </div>
  )
}
```

- [ ] **Step 4: Adicionar ao menu de navegação**

Em `components/shell/NavItems.ts`, adicionar um item (na seção de admin/config, perto de "loja"):

```ts
{ href: '/loja/alertas', label: 'Alertas', icon: BellRing, permissao: 'Local de Estoque' },
```

(importar `BellRing` de `lucide-react` no topo do arquivo; seguir o shape exato dos itens já existentes no arquivo.)

- [ ] **Step 5: Verificar o build + visual**

Run: `npm run build`
Expected: compila. Depois, no preview: acessar `/loja/alertas`, preencher e-mail, marcar "Ativar", salvar, ver "Configuracao salva.".

- [ ] **Step 6: Verificar o disparo real**

Com a config ativa de uma loja de teste, chamar de novo:

```bash
curl -s -H "Authorization: Bearer SEU_CRON_SECRET" http://localhost:3000/api/cron/alertas
```

Expected: a loja ativa retorna `enviado:true` (se houver itens) e o e-mail chega.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/alertas.ts components/loja/AlertasForm.tsx app/(app)/loja/alertas/page.tsx components/shell/NavItems.ts
git commit -m "feat: tela de configuracao de alertas por loja"
```

---

## Task T6: Sugestão de compra exportável (CSV + texto WhatsApp)

**Files:**
- Create: `app/(app)/produto/sugestao-compra/route.ts`
- Create: `components/produtos/ExportarSugestaoBtn.tsx`
- Modify: `app/(app)/produto/page.tsx` (adicionar o botão no modo "compras")

**Interfaces:**
- Consome: RPC `produtos_repor(p_loja_id)` (já existe), tabela `produtos`.
- Produz: `GET /api/.../sugestao-compra?formato=csv|texto` que retorna o arquivo/texto da lista a repor.

- [ ] **Step 1: Escrever a rota de export**

Create `app/(app)/produto/sugestao-compra/route.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { formatarNomeProduto } from '@/lib/formatar-nome'

// Exporta a lista "a repor" (produtos abaixo do minimo) em CSV ou em texto
// pronto para colar no WhatsApp do fornecedor.
export async function GET(req: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) {
    return new Response('Sem permissao', { status: 403 })
  }
  const formato = new URL(req.url).searchParams.get('formato') === 'texto' ? 'texto' : 'csv'

  const supabase = await createClient()
  const { data: codigos } = await supabase.rpc('produtos_repor', { p_loja_id: lojaId })
  const lista = (codigos ?? []) as number[]

  const { data: prods } = lista.length
    ? await supabase
        .from('produtos')
        .select('codigo, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', lista)
        .order('descricao')
    : { data: [] }

  const linhas = prods ?? []

  if (formato === 'texto') {
    const corpo = linhas
      .map((p) => `- ${formatarNomeProduto(p.descricao)} (${p.codigo ?? 's/cod'})`)
      .join('\n')
    const texto = `Pedido de reposicao\n\n${corpo || 'Nada a repor.'}`
    return new Response(texto, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const csv = [
    'codigo;produto;unidade',
    ...linhas.map(
      (p) => `${p.codigo ?? ''};${(formatarNomeProduto(p.descricao) || '').replace(/;/g, ',')};${p.unidade ?? ''}`,
    ),
  ].join('\n')
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sugestao-compra.csv"',
    },
  })
}
```

- [ ] **Step 2: Escrever o botão (client, com copiar para WhatsApp)**

Create `components/produtos/ExportarSugestaoBtn.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { btnClass } from '@/components/ui-kit/Button'
import { toast } from 'sonner'
import { Download, MessageCircle } from 'lucide-react'

export function ExportarSugestaoBtn() {
  const [carregando, setCarregando] = useState(false)

  async function copiarTexto() {
    setCarregando(true)
    try {
      const res = await fetch('/produto/sugestao-compra?formato=texto')
      const texto = await res.text()
      await navigator.clipboard.writeText(texto)
      toast.success('Lista copiada. Cole no WhatsApp do fornecedor.')
    } catch {
      toast.error('Nao foi possivel copiar a lista.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="flex gap-2">
      <button type="button" onClick={copiarTexto} disabled={carregando} className={btnClass('outline')}>
        <MessageCircle className="size-4" /> Copiar p/ WhatsApp
      </button>
      <a href="/produto/sugestao-compra?formato=csv" className={btnClass('outline')}>
        <Download className="size-4" /> CSV
      </a>
    </div>
  )
}
```

- [ ] **Step 3: Montar o botão na tela de compras**

Em `app/(app)/produto/page.tsx`, no bloco que só aparece quando `vista === 'compras'` (modo compras), renderizar `<ExportarSugestaoBtn />` perto do toggle "So repor". Importar no topo:

```tsx
import { ExportarSugestaoBtn } from '@/components/produtos/ExportarSugestaoBtn'
```

E no JSX do modo compras:

```tsx
{vista === 'compras' && <ExportarSugestaoBtn />}
```

(posicionar junto dos controles do modo compras já existentes, respeitando o layout atual.)

- [ ] **Step 4: Verificar o build + visual**

Run: `npm run build`
Expected: compila. No preview: ir em `/produto?vista=compras&repor=1`, clicar "Copiar p/ WhatsApp" e conferir que o texto cai no clipboard; baixar o CSV e abrir no Excel sem quebrar acento (BOM já incluído).

- [ ] **Step 5: Commit**

```bash
git add app/(app)/produto/sugestao-compra/route.ts components/produtos/ExportarSugestaoBtn.tsx app/(app)/produto/page.tsx
git commit -m "feat: exportar sugestao de compra (CSV e texto WhatsApp)"
```

---

## Task T7: Aviso de loja com sync travado

**Files:**
- Create: `lib/actions/sync-status.ts` (adicionar função; o arquivo pode já existir, então MODIFICAR)
- Create: `components/shell/AvisoSyncTravado.tsx`
- Modify: `app/(app)/layout.tsx`

**Interfaces:**
- Consome: tabela `lojas` (campo `produto_ultima_atualizacao` e/ou os `*_ultima_atualizacao`).
- Produz: `syncTravadoDaLoja(lojaId: number): Promise<{ travado: boolean; horas: number }>`.

Contexto: lojas 5 e 6 têm `ListarEmpresas` bloqueado no Omie ("Consumo Indevido"), e qualquer loja pode ficar com sync parado silenciosamente. Hoje o usuário não percebe que está olhando dado velho. Este banner avisa.

- [ ] **Step 1: Escrever a função de status**

Em `lib/actions/sync-status.ts` (criar se não existir), adicionar:

```ts
import { createClient } from '@/lib/supabase/server'

// "Travado" = a ultima atualizacao de produtos passou de N horas. Os crons
// rodam varias vezes ao dia; 12h sem atualizar e sinal de problema.
const LIMITE_HORAS = 12

export async function syncTravadoDaLoja(
  lojaId: number,
): Promise<{ travado: boolean; horas: number }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('lojas')
    .select('produto_ultima_atualizacao')
    .eq('id', lojaId)
    .single()

  const ts = data?.produto_ultima_atualizacao
  if (!ts) return { travado: true, horas: Infinity }
  const horas = (Date.now() - new Date(ts).getTime()) / 3600000
  return { travado: horas > LIMITE_HORAS, horas: Math.floor(horas) }
}
```

- [ ] **Step 2: Escrever o banner**

Create `components/shell/AvisoSyncTravado.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react'

// Banner discreto no topo do conteudo. So renderiza quando travado=true.
export function AvisoSyncTravado({ horas }: { horas: number }) {
  const quando = Number.isFinite(horas) ? `ha ${horas}h` : 'ainda nao sincronizou'
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-[var(--warn,#f59e0b)]/30 bg-[var(--warn,#f59e0b)]/10 px-3.5 py-2.5 text-[13px] text-text">
      <AlertTriangle className="size-4 shrink-0 text-[var(--warn,#f59e0b)]" strokeWidth={2} />
      <span>
        Esta loja nao atualiza com o Omie {quando}. Os dados podem estar
        desatualizados. Se persistir, verifique a conexao da loja com o Omie.
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Montar no layout do shell**

Em `app/(app)/layout.tsx`, depois de obter `lojaId`, computar o status e renderizar o banner acima do `{children}` quando travado:

```tsx
import { syncTravadoDaLoja } from '@/lib/actions/sync-status'
import { AvisoSyncTravado } from '@/components/shell/AvisoSyncTravado'

// ... dentro do componente, apos resolver a loja atual:
const lojaIdAtual = await getCurrentLojaId().catch(() => null)
const sync = lojaIdAtual ? await syncTravadoDaLoja(lojaIdAtual) : { travado: false, horas: 0 }

// ... no JSX, logo antes de {children}:
{sync.travado && (
  <div className="mb-4">
    <AvisoSyncTravado horas={sync.horas} />
  </div>
)}
```

> Nota: respeitar a estrutura real do `layout.tsx`. Se ele não resolve `lojaId` hoje, usar o mesmo helper que as páginas usam (`getCurrentLojaId`), com `.catch` para não quebrar telas sem loja selecionada.

- [ ] **Step 4: Verificar o build + visual**

Run: `npm run build`
Expected: compila. Teste manual do estado "travado": no banco de teste, envelhecer a data de uma loja e conferir o banner.

```bash
node scripts/db.mjs "update lojas set produto_ultima_atualizacao = now() - interval '20 hours' where id = 3"
```

Abrir o sistema na loja 3: o banner amarelo aparece. Reverter depois com um sync normal.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/sync-status.ts components/shell/AvisoSyncTravado.tsx app/(app)/layout.tsx
git commit -m "feat: aviso visivel quando a loja esta com sync travado"
```

---

## Task T8: Validade com saldo real + filtro por local

**Files:**
- Modify: `app/(app)/validade/page.tsx`

**Interfaces:**
- Consome: `posicao_estoques` (saldo atual por produto/local), `local_estoques` (lista de locais para o filtro).
- Mantém: toda a lógica de período/semáforo/filtros que já existe.

Contexto: a tela hoje mostra a quantidade da OP (`o.quantidade ?? o.identificacao_n_qtde`), que é o tamanho do lote produzido, não quanto ainda tem em estoque. Para a cozinha, o que importa é "vence em 3 dias E ainda tem 12 unidades". Esta tarefa adiciona o saldo real e o filtro por local de estoque.

> **Confirmar antes (decisão 3 do topo):** de onde vem o saldo. Assumindo `posicao_estoques.n_saldo` (ou `fisico`) por `n_cod_prod` + `codigo_local_estoque`, pegando a posição mais recente (`data_posicao`).

- [ ] **Step 1: Adicionar o filtro de local na lista de campos**

Em `app/(app)/validade/page.tsx`, dentro da função, buscar os locais da loja (perto de onde busca `familias`) e adicionar o campo:

```tsx
const { data: locais } = await supabase
  .from('local_estoques')
  .select('codigo_local_estoque, descricao')
  .eq('loja_id', lojaId)
  .neq('inativo', 'S')
  .order('descricao')

// adicionar ao array `campos`:
{
  tipo: 'select',
  nome: 'local',
  label: 'Local de estoque',
  opcoes: (locais ?? []).map((l) => ({
    value: String(l.codigo_local_estoque),
    label: l.descricao ?? String(l.codigo_local_estoque),
  })),
},
```

E ler `sp.local` no tipo de `searchParams` e no `defaults` do `FiltrosGaveta`.

- [ ] **Step 2: Buscar o saldo dos produtos da lista**

Depois de resolver `prodMap`, buscar a posição mais recente desses produtos (e, se houver `sp.local`, só daquele local):

```tsx
// Saldo atual por produto (posicao mais recente). Se houver filtro de local,
// restringe ao local; senao, soma os locais.
const codsLista = [...new Set((ordens ?? []).map((o) => o.identificacao_n_cod_produto).filter(Boolean))]
let saldoMap = new Map<number, number>()
if (codsLista.length) {
  let posQuery = supabase
    .from('posicao_estoques')
    .select('n_cod_prod, n_saldo, codigo_local_estoque, data_posicao')
    .eq('loja_id', lojaId)
    .in('n_cod_prod', codsLista)
    .order('data_posicao', { ascending: false })
  if (sp.local) posQuery = posQuery.eq('codigo_local_estoque', Number(sp.local))
  const { data: posicoes } = await posQuery
  // primeira ocorrencia por produto = mais recente (ja ordenado desc)
  for (const p of posicoes ?? []) {
    if (!saldoMap.has(p.n_cod_prod)) saldoMap.set(p.n_cod_prod, Number(p.n_saldo) || 0)
  }
}
```

> Nota: confirmar os nomes de coluna reais em `posicao_estoques` (`n_cod_prod`, `n_saldo`, `codigo_local_estoque`, `data_posicao`) contra a migration 001/009. Ajustar se diferente.

- [ ] **Step 3: Mostrar o saldo na coluna de quantidade**

Trocar a coluna "Qtd" da `Lista` para mostrar o saldo real ao lado da quantidade da OP:

```tsx
{
  label: 'Em estoque',
  alinhar: 'right',
  larguraDesktop: 'w-32',
  render: (o) => {
    const prod = prodMap.get(o.identificacao_n_cod_produto)
    const saldo = saldoMap.get(o.identificacao_n_cod_produto as number)
    return (
      <span className="num">
        {saldo != null ? <Num value={saldo} frac={0} /> : <span className="text-text-muted">-</span>}
        {prod?.unidade && <span className="ml-1 text-[12px] text-text-muted">{prod.unidade}</span>}
      </span>
    )
  },
},
```

- [ ] **Step 4: Verificar o build + visual**

Run: `npm run build`
Expected: compila. No preview, em `/validade`: a coluna passa a mostrar o saldo atual; o filtro "Local de estoque" aparece na gaveta e restringe corretamente.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/validade/page.tsx
git commit -m "feat: validade mostra saldo real de estoque e filtra por local"
```

---

## Task T9: Relatório de gestão mensal (PDF)

**Files:**
- Create: `components/relatorio/RelatorioGestaoPDF.tsx`
- Create: `app/(app)/relatorio-gestao/page.tsx`
- Create: `app/(app)/relatorio-gestao/pdf/route.ts`
- Modify: `components/shell/NavItems.ts`

**Interfaces:**
- Consome: `movimentos_historico` (entradas/saídas), `notas_fiscais` (qtd e R$ do mês), `ordens_producao` (concluídas no mês), `@react-pdf/renderer` (já usado nos outros relatórios).
- Produz: `GET /api/.../relatorio-gestao/pdf?mes=YYYY-MM` que devolve o PDF.

Contexto: os donos não têm hoje nenhuma saída resumida de gestão. Todos os dados estão no banco mas não há um "fechamento do mês". Este é o "Bloco 7" do roadmap, recortado no mínimo viável: 1 PDF com os números do mês.

- [ ] **Step 1: Escrever o componente PDF**

Create `components/relatorio/RelatorioGestaoPDF.tsx` (seguir o padrão dos PDFs já existentes em `components/relatorio/`):

```tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

export type DadosGestao = {
  lojaNome: string
  mesLabel: string
  totalEntradas: number
  totalSaidas: number
  qtdNotas: number
  valorNotas: number
  opsConcluidas: number
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 11, fontFamily: 'Helvetica', color: '#1f2733' },
  h1: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 10, color: '#64748b', marginBottom: 20 },
  card: { borderWidth: 1, borderColor: '#e6e9ef', borderRadius: 6, padding: 12, marginBottom: 10 },
  label: { fontSize: 9, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 },
  valor: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  rodape: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 8, color: '#94a3b8' },
})

function n(v: number) {
  return v.toLocaleString('pt-BR')
}
function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function RelatorioGestaoPDF({ d }: { d: DadosGestao }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Relatorio de gestao</Text>
        <Text style={s.sub}>
          {d.lojaNome} | {d.mesLabel}
        </Text>

        <View style={s.card}>
          <Text style={s.label}>Entradas no mes</Text>
          <Text style={s.valor}>{n(d.totalEntradas)}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.label}>Saidas no mes</Text>
          <Text style={s.valor}>{n(d.totalSaidas)}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.label}>Notas fiscais recebidas</Text>
          <Text style={s.valor}>
            {n(d.qtdNotas)} ({brl(d.valorNotas)})
          </Text>
        </View>
        <View style={s.card}>
          <Text style={s.label}>Ordens de producao concluidas</Text>
          <Text style={s.valor}>{n(d.opsConcluidas)}</Text>
        </View>

        <Text style={s.rodape}>Gerado pelo NTB Estoque. Assinado por Joaquim Salles.</Text>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Escrever a rota do PDF**

Create `app/(app)/relatorio-gestao/pdf/route.ts` (seguir o padrão das rotas `*/relatorio/route.ts` existentes para renderizar o PDF com `@react-pdf/renderer`):

```ts
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { RelatorioGestaoPDF, type DadosGestao } from '@/components/relatorio/RelatorioGestaoPDF'

export async function GET(req: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return new Response('Sem permissao', { status: 403 })
  }

  const mes = new URL(req.url).searchParams.get('mes') || new Date().toISOString().slice(0, 7)
  const ini = `${mes}-01`
  const [ano, m] = mes.split('-').map(Number)
  const fim = `${mes}-${String(new Date(ano, m, 0).getDate()).padStart(2, '0')}`

  const supabase = await createClient()
  const head = { count: 'exact' as const, head: true }

  const [movRes, lojaRes, notasRes, opsRes] = await Promise.all([
    supabase
      .from('movimentos_historico')
      .select('entradas, saidas')
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
      .limit(100000),
    supabase.from('lojas').select('nome_fantasia, nome').eq('id', lojaId).single(),
    supabase
      .from('notas_fiscais')
      .select('n_valor_nfe')
      .eq('loja_id', lojaId)
      .gte('d_emissao_nfe', ini)
      .lte('d_emissao_nfe', fim)
      .is('deleted_at', null)
      .limit(100000),
    supabase
      .from('ordens_producao')
      .select('id', head)
      .eq('loja_id', lojaId)
      .eq('concluida', true)
      .gte('identificacao_d_dt_previsao', ini)
      .lte('identificacao_d_dt_previsao', fim),
  ])

  const mov = movRes.data ?? []
  const notas = notasRes.data ?? []
  const d: DadosGestao = {
    lojaNome: lojaRes.data?.nome_fantasia || lojaRes.data?.nome || `Loja ${lojaId}`,
    mesLabel: new Date(`${ini}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    totalEntradas: mov.reduce((a, r) => a + (Number(r.entradas) || 0), 0),
    totalSaidas: mov.reduce((a, r) => a + (Number(r.saidas) || 0), 0),
    qtdNotas: notas.length,
    valorNotas: notas.reduce((a, r) => a + (Number(r.n_valor_nfe) || 0), 0),
    opsConcluidas: opsRes.count ?? 0,
  }

  const buffer = await renderToBuffer(<RelatorioGestaoPDF d={d} />)
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="gestao-${mes}.pdf"`,
    },
  })
}
```

> Nota: o arquivo é `.ts` mas usa JSX (`<RelatorioGestaoPDF/>`). Conferir como as rotas de PDF existentes resolvem isso (provavelmente são `.tsx` ou usam `React.createElement`). Seguir o padrão do projeto: se as outras rotas de relatório usam `.tsx`, criar como `route.tsx`.

- [ ] **Step 3: Escrever a página com seletor de mês**

Create `app/(app)/relatorio-gestao/page.tsx`:

```tsx
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { btnClass } from '@/components/ui-kit/Button'
import { FileBarChart, FileText } from 'lucide-react'

export default async function RelatorioGestaoPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  const sp = await searchParams
  const mes = sp.mes || new Date().toISOString().slice(0, 7)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Relatorio de gestao"
        icon={FileBarChart}
        description="Fechamento mensal: entradas, saidas, notas e producao"
      />
      <form className="flex items-end gap-3" method="get">
        <div>
          <label htmlFor="mes" className="mb-1 block text-[12px] font-medium text-text-muted">
            Mes
          </label>
          <input
            id="mes"
            name="mes"
            type="month"
            defaultValue={mes}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-brand"
          />
        </div>
        <button type="submit" className={btnClass('outline')}>
          Atualizar
        </button>
        <a
          href={`/relatorio-gestao/pdf?mes=${mes}`}
          target="_blank"
          rel="noopener noreferrer"
          className={btnClass('primary')}
        >
          <FileText className="size-4" /> Gerar PDF
        </a>
      </form>
      <p className="text-[13px] text-text-muted">
        Selecione o mes e gere o PDF do fechamento. O arquivo abre em uma nova aba.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Adicionar ao menu**

Em `components/shell/NavItems.ts`, adicionar (na seção de relatórios/leitura):

```ts
{ href: '/relatorio-gestao', label: 'Relatorio de gestao', icon: FileBarChart, permissao: 'Notas Fiscais' },
```

(importar `FileBarChart` de `lucide-react`.)

- [ ] **Step 5: Verificar o build + visual**

Run: `npm run build`
Expected: compila. No preview: `/relatorio-gestao`, escolher o mês atual, "Gerar PDF", conferir que o PDF abre com os 4 números preenchidos e batendo com o que a tela de movimentações/NF mostra para o mesmo período.

- [ ] **Step 6: Commit**

```bash
git add components/relatorio/RelatorioGestaoPDF.tsx app/(app)/relatorio-gestao components/shell/NavItems.ts
git commit -m "feat: relatorio de gestao mensal em PDF"
```

---

## Self-Review (feita ao fechar o plano)

- **Cobertura:** os 5 blocos de "o que falta" da varredura estão cobertos (alertas T1-T5, sugestão de compra T6, aviso de sync T7, validade T8, relatório de gestão T9). Nada do que já existe foi reescrito.
- **Sem placeholders de código:** cada passo que altera código traz o código real. Os pontos de incerteza de schema/assinatura estão marcados como "Nota de verificação" explícita (não como TODO no código), porque dependem de confirmar nomes contra o banco/arquivos reais; o implementador valida antes de colar.
- **Consistência de tipos:** `AlertaLoja`/`ItemAlerta` (T3) são consumidos com o mesmo shape em T4. `DadosGestao` (T9) é o mesmo na rota e no componente. `coletarAlertasLoja`, `enviarEmail`, `salvarAlertasConfig`, `syncTravadoDaLoja` mantêm a mesma assinatura onde citadas.
- **Free tier:** Resend free tier; nenhuma dependência paga. Tabela nova é só config (1 linha/loja), não pesa no banco.

## Pontos que o outro chat DEVE confirmar antes de colar código

1. `lib/supabase/server.ts`: nome exato do client service-role (`createServiceClient`?) e do client SSR (`createClient`).
2. `lib/omie/sync-all.ts`: assinatura de `assertCronAuth` e shape de `getLojasAtivas()`.
3. `lib/auth.ts`: confirmar `getCurrentLojaId` e `requirePermissao`, e qual permissão representa "config/admin da loja" (usei `'Local de Estoque'` como aproximação).
4. `posicao_estoques`: nomes reais das colunas de saldo/local/data (migration 001 e 009).
5. Rotas de PDF existentes: se usam `route.tsx` ou `React.createElement` (para T9 seguir o mesmo padrão).
6. `components/shell/NavItems.ts`: shape exato dos itens (campo de permissão se chama `permissao`?).
7. `vercel.json`: formato atual do array `crons` antes de adicionar a linha de T4.

## Execução

Plano salvo em `docs/superpowers/plans/2026-06-17-melhorias-operacionais-fase2.md`.

Cada tarefa (ou cada bloco T1-T5 / T6 / T7 / T8 / T9) entrega software funcionando e pode virar um PR independente. Sugestão de ordem de entrega: T6 e T7 primeiro (rápidos), depois T1-T5, T8 e T9.

Assinado por Joaquim Salles.
