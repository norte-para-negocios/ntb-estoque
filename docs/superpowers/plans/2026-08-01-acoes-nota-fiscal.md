# Ações na Nota Fiscal (Manifestar/Reverter/Excluir) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development para executar este plano task-by-task.

**Goal:** Deixar o usuário clicar numa nota fiscal específica e realmente
agir sobre ela (marcar como recebida/manifestada, reverter isso, ou
excluir o recebimento) — hoje a tela só mostra dado, não deixa fazer nada.

**Architecture:** Mesmo padrão já usado e validado em produção pras Ordens
de Produção (`lib/omie/ordem-producao.ts` + `lib/actions/ordem-producao.ts`
+ `OrdemProducaoRow.tsx`): uma função por ação em `lib/omie/nota-fiscal.ts`
que chama a API real da Omie (endpoint `v1/produtos/recebimentonfe`), uma
Server Action correspondente em `lib/actions/nota-fiscal.ts` que carrega a
nota da loja atual, chama a função Omie, trata o caso "já não existe mais
do lado da Omie" graciosamente, atualiza o banco local, registra auditoria
e revalida a página — e um componente cliente com botões + confirmação na
tela de detalhe.

**Tech Stack:** Next.js Server Actions, API SOAP/JSON da Omie
(`lib/omie/client.ts`'s `omieRequest`), Supabase (via `createServiceClient`).

---

## Global Constraints

- **Estas ações escrevem de verdade no Omie real (produção).** Não existe
  ambiente de teste separado da Omie neste projeto. Qualquer implementador
  precisa testar contra uma NOTA DE TESTE REAL, chamando a Server Action de
  verdade — não simular/mockar a chamada. Antes de escolher qual nota usar
  como teste, **peça confirmação ao usuário** sobre qual nota é segura de
  mexer (uma nota pendente antiga, de baixo valor, ou uma nota criada
  especificamente para teste) — não assuma que uma nota citada em contexto
  de sessões anteriores ainda está no mesmo estado.
- **`ExcluirRecebimento` no Omie é uma ação DESTRUTIVA e IRREVERSÍVEL do
  lado da Omie** (remove o registro de recebimento de lá). A ação
  correspondente no nosso banco (`excluirRecebimentoNF`) espelha isso
  apagando a linha de `notas_fiscais` (os itens em `nota_fiscal_items`
  cascateiam automaticamente via FK `ON DELETE CASCADE`, confirmado). O
  botão de excluir na UI precisa de confirmação clara (`window.confirm`
  com texto explícito de que é irreversível), igual ao padrão já usado em
  `OrdemProducaoRow.tsx` pra ações destrutivas.
- **Não existe cancelamento fiscal de NF-e do lado do recebedor via API da
  Omie** — cancelamento de NF-e é ação do EMISSOR junto à SEFAZ, fora do
  escopo do que a Omie expõe pra quem recebe a nota (investigação
  exaustiva feita nesta sessão, ver `docs/omie-api-referencia-completa.md`
  seção "Achado sobre manifestação do destinatário"). "Excluir o
  recebimento" é a ação mais próxima disponível — nomear o botão como
  "Excluir recebimento", não "Cancelar", pra não prometer algo que a API
  não faz.
- **`cEtapa` só tem 2 valores reais confirmados em produção: `'40'`
  (pendente) e `'60'` (concluída/recebida).** Manifestar = mover pra `60`;
  reverter = mover pra `40`.
- **Padrão de erro "fantasma"** (registro já não existe mais do lado da
  Omie): igual ao já usado pra Ordens de Produção — o texto de erro da
  Omie contém "não cadastrada" (ou "nao cadastrada", sem acento) quando o
  `nIdReceb` não existe mais. Detectar isso e tratar graciosamente (não
  propagar erro cru pro usuário), igual `pareceOPNaoExiste`.
- **Sem framework de testes automatizado neste projeto** — "teste" abaixo
  significa: comando exato + chamada real + confirmação visual na tela.

---

### Task 1: Funções de ação no `lib/omie/nota-fiscal.ts`

**Files:**
- Modify: `lib/omie/nota-fiscal.ts`

**Interfaces:**
- Consumes: `omieRequest` (já importado no arquivo, de `./client`), `LojaOmie`
  (tipo já usado no arquivo).
- Produces: `concluirRecebimento`, `reverterRecebimento`,
  `excluirRecebimento`, `pareceRecebimentoNaoExiste` — usadas pela Task 2.

**Step 1: Adicionar as 4 funções no final do arquivo**

Abrir `lib/omie/nota-fiscal.ts`, ver como `fetchNotaFiscal` (perto do fim
do arquivo) já usa `endpoint: 'v1/produtos/recebimentonfe'` — usar o MESMO
endpoint pras novas funções. Adicionar depois de `fetchNotaFiscal`:

```typescript
// Marca o recebimento como CONCLUÍDO no Omie (ConcluirRecebimento) --
// equivalente a "manifestar": move da coluna Pendente pra Recebido no
// Kanban de Compras da Omie. cChaveNfe e opcional na Omie mas mandamos
// quando disponivel (mais preciso que so nIdReceb).
export async function concluirRecebimento(
  loja: LojaOmie,
  nIdReceb: number,
  cChaveNfe?: string | null
) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ConcluirRecebimento',
    data: { nIdReceb, ...(cChaveNfe ? { cChaveNfe } : {}), cEtapa: '60' },
  })
}

// Desfaz a conclusao (ReverterRecebimento) -- volta pra Pendente.
export async function reverterRecebimento(
  loja: LojaOmie,
  nIdReceb: number,
  cChaveNfe?: string | null
) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ReverterRecebimento',
    data: { nIdReceb, ...(cChaveNfe ? { cChaveNfe } : {}), cEtapa: '40' },
  })
}

// Remove o recebimento inteiro do Omie (ExcluirRecebimento) -- so aceita
// nIdReceb, nao tem cChaveNfe nesse metodo especifico (confirmado na doc).
export async function excluirRecebimento(loja: LojaOmie, nIdReceb: number) {
  return omieRequest({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/produtos/recebimentonfe',
    call: 'ExcluirRecebimento',
    data: { nIdReceb },
  })
}

// Mesma logica de lib/omie/ordem-producao.ts:pareceOPNaoExiste -- detecta
// pelo texto do erro quando o recebimento ja nao existe mais do lado da
// Omie (excluido direto por la, ou id invalido).
export function pareceRecebimentoNaoExiste(msg: string): boolean {
  return /nao cadastrada|não cadastrada|nao encontrado|não encontrado/i.test(msg)
}
```

**Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erro novo relacionado a `lib/omie/nota-fiscal.ts`.

**Step 3: Commit**

```bash
git add lib/omie/nota-fiscal.ts
git commit -m "feat: funções de ação (concluir/reverter/excluir) pro recebimento de NF na Omie"
```

---

### Task 2: Server Actions em `lib/actions/nota-fiscal.ts`

**Files:**
- Modify: `lib/actions/nota-fiscal.ts`

**Interfaces:**
- Consumes: `concluirRecebimento`, `reverterRecebimento`,
  `excluirRecebimento`, `pareceRecebimentoNaoExiste` (Task 1);
  `getCurrentLojaId`, `requirePermissao` (`@/lib/auth`);
  `registrarAuditoria` (`@/lib/auditoria`); `revalidatePath` (`next/cache`).
- Produces: `manifestarNF(notaId)`, `reverterManifestacaoNF(notaId)`,
  `excluirRecebimentoNF(notaId)` — usadas pela Task 3 (UI).

**Step 1: Adicionar o helper de carregamento + as 3 Server Actions**

No topo de `lib/actions/nota-fiscal.ts`, adicionar aos imports existentes:

```typescript
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import {
  concluirRecebimento,
  reverterRecebimento,
  excluirRecebimento,
  pareceRecebimentoNaoExiste,
} from '@/lib/omie/nota-fiscal'
import { registrarAuditoria } from '@/lib/auditoria'
import type { LojaOmie } from '@/lib/omie/client'
```

Adicionar no final do arquivo:

```typescript
// Mesmo padrao de lib/actions/ordem-producao.ts:carregarOPdaLoja -- carrega
// a nota + a loja (com credenciais Omie) na loja ATUAL, verificando
// permissao antes.
async function carregarNFdaLoja(notaId: number, permissao: string) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, permissao))) {
    return { error: 'Sem permissão' }
  }
  const supabase = createServiceClient()
  const { data: nf, error: dbError } = await supabase
    .from('notas_fiscais')
    .select('n_id_receb, c_chave_nfe, c_etapa, c_numero_nfe, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', notaId)
    .eq('loja_id', lojaId)
    .single<{
      n_id_receb: string | null
      c_chave_nfe: string | null
      c_etapa: string | null
      c_numero_nfe: string | null
      loja: LojaOmie
    }>()
  if (dbError) {
    return { error: `Erro ao buscar nota id=${notaId}: ${dbError.message}` }
  }
  if (!nf) {
    return { error: `Nota fiscal não encontrada (id=${notaId}, loja=${lojaId})` }
  }
  if (!nf.n_id_receb) {
    return { error: `Nota id=${notaId} ainda não tem código de recebimento da Omie.` }
  }
  if (!nf.loja) {
    return { error: `Dado inconsistente: nota id=${notaId} sem loja associada.` }
  }
  return { lojaId, supabase, nf }
}

/**
 * Marca a nota como CONCLUÍDA/recebida no Omie ("manifestar" no sentido do
 * fluxo interno de recebimento -- não é a manifestação fiscal oficial
 * junto à SEFAZ, que a API da Omie não expõe).
 */
export async function manifestarNF(notaId: number) {
  const ctx = await carregarNFdaLoja(notaId, 'Notas Fiscais')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, nf } = ctx
  try {
    await concluirRecebimento(nf.loja, Number(nf.n_id_receb), nf.c_chave_nfe)
    await supabase
      .from('notas_fiscais')
      .update({ c_etapa: '60', updated_at: new Date().toISOString() })
      .eq('id', notaId)
      .eq('loja_id', lojaId)
    await registrarAuditoria('concluir', 'nota fiscal', nf.c_numero_nfe, null)
    revalidatePath(`/nota-fiscal/${notaId}`)
    revalidatePath('/nota-fiscal')
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao manifestar no Omie' }
  }
}

/** Reverte a conclusão -- volta a nota pra Pendente. */
export async function reverterManifestacaoNF(notaId: number) {
  const ctx = await carregarNFdaLoja(notaId, 'Notas Fiscais')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, nf } = ctx
  if (nf.c_etapa !== '60') {
    return { error: 'Só dá para reverter uma nota concluída.' }
  }
  try {
    await reverterRecebimento(nf.loja, Number(nf.n_id_receb), nf.c_chave_nfe)
    await supabase
      .from('notas_fiscais')
      .update({ c_etapa: '40', updated_at: new Date().toISOString() })
      .eq('id', notaId)
      .eq('loja_id', lojaId)
    await registrarAuditoria('reverter', 'nota fiscal', nf.c_numero_nfe, null)
    revalidatePath(`/nota-fiscal/${notaId}`)
    revalidatePath('/nota-fiscal')
    return { ok: true as const }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao reverter no Omie' }
  }
}

/**
 * Exclui o recebimento no Omie e remove a nota do banco local (itens
 * cascateiam via FK). IRREVERSÍVEL -- a UI precisa confirmar antes de
 * chamar isso.
 */
export async function excluirRecebimentoNF(notaId: number) {
  const ctx = await carregarNFdaLoja(notaId, 'Notas Fiscais')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, nf } = ctx
  let fantasma = false
  try {
    try {
      await excluirRecebimento(nf.loja, Number(nf.n_id_receb))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!pareceRecebimentoNaoExiste(msg)) throw e
      fantasma = true
    }
    await supabase.from('notas_fiscais').delete().eq('id', notaId).eq('loja_id', lojaId)
    await registrarAuditoria('excluir', 'nota fiscal', nf.c_numero_nfe, null)
    revalidatePath('/nota-fiscal')
    return { ok: true as const, fantasma }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao excluir no Omie' }
  }
}
```

**Step 2: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erro novo. Se `createServiceClient` não estiver importado
ainda no arquivo (checar o topo do arquivo — pode já estar, as duas
actions existentes usam), adicionar ao import existente de
`@/lib/supabase/server`.

**Step 3: Commit**

```bash
git add lib/actions/nota-fiscal.ts
git commit -m "feat: server actions pra manifestar/reverter/excluir recebimento de NF"
```

---

### Task 3: Botões de ação na tela de detalhe

**Files:**
- Create: `components/nota-fiscal/AcoesNF.tsx`
- Modify: `app/(app)/nota-fiscal/[id]/page.tsx`

**Interfaces:**
- Consumes: `manifestarNF`, `reverterManifestacaoNF`, `excluirRecebimentoNF`
  (Task 2).
- Consumes visual: `btnClass` (`@/components/ui-kit/Button`, já importado
  na página), `toast` (biblioteca já usada no projeto — conferir import
  exato em `OrdemProducaoRow.tsx`, ex.: `import { toast } from 'sonner'`
  ou equivalente já padronizado).

**Step 1: Criar o componente de ações**

```typescript
// components/nota-fiscal/AcoesNF.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, RotateCcw, Trash2 } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { manifestarNF, reverterManifestacaoNF, excluirRecebimentoNF } from '@/lib/actions/nota-fiscal'

export function AcoesNF({ notaId, cEtapa }: { notaId: number; cEtapa: string | null }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const concluida = cEtapa === '60'

  function manifestar() {
    if (!window.confirm('Marcar esta nota como recebida/concluída no Omie?')) return
    startTransition(async () => {
      const res = await manifestarNF(notaId)
      if (res?.error) toast.error(res.error)
      else { toast.success('Nota marcada como concluída.'); router.refresh() }
    })
  }

  function reverter() {
    if (!window.confirm('Reverter a conclusão desta nota no Omie? Ela volta para Pendente.')) return
    startTransition(async () => {
      const res = await reverterManifestacaoNF(notaId)
      if (res?.error) toast.error(res.error)
      else { toast.success('Conclusão revertida.'); router.refresh() }
    })
  }

  function excluir() {
    if (!window.confirm('Excluir o recebimento desta nota no Omie? Isso é IRREVERSÍVEL e remove a nota do sistema.')) return
    startTransition(async () => {
      const res = await excluirRecebimentoNF(notaId)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(res?.fantasma ? 'Nota removida (já não existia mais no Omie).' : 'Recebimento excluído.')
        router.push('/nota-fiscal')
      }
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!concluida && (
        <button type="button" disabled={pending} onClick={manifestar} className={btnClass('outline')}>
          <CheckCircle2 className="size-4" /> Manifestar (marcar recebida)
        </button>
      )}
      {concluida && (
        <button type="button" disabled={pending} onClick={reverter} className={btnClass('outline')}>
          <RotateCcw className="size-4" /> Reverter conclusão
        </button>
      )}
      <button type="button" disabled={pending} onClick={excluir} className={btnClass('outline')}>
        <Trash2 className="size-4" /> Excluir recebimento
      </button>
    </div>
  )
}
```

Antes de codar, CONFIRMAR o import certo de `toast` abrindo
`components/ordem-producao/OrdemProducaoRow.tsx` e copiando a linha de
import exata (pode ser `sonner` ou outra lib já padronizada no projeto) —
não adivinhar.

**Step 2: Adicionar o componente na tela de detalhe**

Em `app/(app)/nota-fiscal/[id]/page.tsx`, importar:

```typescript
import { AcoesNF } from '@/components/nota-fiscal/AcoesNF'
```

E adicionar `<AcoesNF notaId={Number(id)} cEtapa={nf.c_etapa} />` logo
depois do bloco de botões XML/DANFE existente (dentro do mesmo `meta`,
depois do `</div>` que fecha o `flex flex-wrap gap-2` do XML/DANFE) — ou
como uma linha própria logo abaixo, se ficar mais limpo visualmente.
Julgamento do implementador aqui, mantendo o padrão visual já usado na
página (ver o restante do arquivo pros espaçamentos usados).

**Step 3: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erro novo.

**Step 4: Commit**

```bash
git add components/nota-fiscal/AcoesNF.tsx "app/(app)/nota-fiscal/[id]/page.tsx"
git commit -m "feat: botões de ação (manifestar/reverter/excluir) na tela de nota fiscal"
```

---

### Task 4: Deploy e teste real contra o Omie

**Files:** nenhum arquivo novo — validação em produção.

**⚠️ Antes de escolher qual nota usar como teste, peça confirmação ao
usuário sobre qual nota é segura de mexer.** Não usar uma nota real de
cliente sem essa confirmação.

**Step 1: Deploy**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && git pull && bash deploy.sh"
```

**Step 2: Confirmar produção saudável**

```bash
curl -s -o /dev/null -w "app-estoque: %{http_code}\n" -L https://app-estoque.norteparanegocios.com.br --max-time 15
```
Expected: `200`.

**Step 3: Teste funcional real, com a conta QA**

Login com `claude.qa@ntb-estoque.dev` / `claudeqa123456`. Ir em Notas
Fiscais, abrir a nota de teste confirmada com o usuário, clicar em
"Manifestar", confirmar o `window.confirm`, aguardar o toast de sucesso,
confirmar visualmente que o status mudou pra "Concluída" na tela e que o
badge de etapa reflete `(60)`.

Repetir pra "Reverter conclusão" (confirma que volta pra "Pendente
(etapa 40)").

Pra "Excluir recebimento": só testar se o usuário confirmar
explicitamente uma nota descartável pra esse teste específico (ação
irreversível) — senão, deixar esse teste específico pendente/anotado pro
usuário validar manualmente quando tiver uma nota apropriada.

**Step 4: Reportar ao usuário**

Confirmar: os 3 botões aparecem na tela, "Manifestar"/"Reverter" testados
com sucesso contra o Omie real, "Excluir" implementado mas validado ou
pendente de validação conforme o Step 3 acima.
