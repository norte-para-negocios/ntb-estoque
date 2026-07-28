# Gaveta de Detalhe da Movimentação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicar na origem de uma linha em `/movimentacoes` (aba Movimentos) — Ordem de Produção, Transferência, Nota Fiscal ou Inventário — abre uma gaveta lateral (`Sheet`) com o conteúdo COMPLETO daquela movimentação; a gaveta de Ordem de Produção também tem o botão "Reverter". A tabela de Movimentos ganha um seletor de colunas visíveis, persistido por rota.

**Architecture:** Um componente-shell (`DetalheMovimentoSheet`, client) recebe `origem: {tipo, id} | null`; ao abrir, chama uma Server Action específica do tipo (`lib/actions/detalhe-movimento.ts`) que busca os dados completos e devolve pro shell renderizar o conteúdo certo. Pra Transferência/Nota Fiscal/Inventário, o conteúdo REAPROVEITA os componentes client já existentes (`ContagemTransferencia`, `ItensNotaFiscal`, `ContagemInventario`) — mesmos componentes das telas completas, só que dentro da gaveta em vez de uma página. Ordem de Produção não tem componente equivalente hoje (vive inline na lista) — ganha um novo, read-only + botão Reverter reaproveitando a Server Action `reverterOP` já existente.

**Tech Stack:** Next.js Server Actions, `components/ui/sheet.tsx` (Sheet/SheetContent, já existe), Supabase.

## Global Constraints

- Reaproveitar Server Actions/queries já existentes sempre que possível — não duplicar lógica de negócio (ex.: `reverterOP` já existe e chama a Omie de verdade; não reescrever).
- A gaveta mostra o conteúdo COMPLETO direto nela (não um resumo com link pra outra tela) — decisão já confirmada com o usuário.
- Reverter só existe pra Ordem de Produção (não criar essa ação pra Transferência/Nota Fiscal/Inventário — não existe no sistema).
- Nenhum framework de teste automatizado no repo — verificação via `npx tsc --noEmit -p .` + `npm run build` a cada tarefa, e QA manual (Playwright, conta QA) abrindo a gaveta dos 4 tipos.
- Sem paginação/filtro dentro da gaveta (mesmo padrão das telas completas hoje).

---

## Task 1: Server Actions de detalhe + shell da gaveta (sem conteúdo específico ainda)

**Files:**
- Create: `lib/actions/detalhe-movimento.ts`
- Create: `components/movimentacoes/DetalheMovimentoSheet.tsx`

**Interfaces:**
- Produces: `type OrigemMovimento = { tipo: 'op'; id: number } | { tipo: 'transferencia'; id: number } | { tipo: 'nota_fiscal'; id: number } | { tipo: 'inventario'; id: number }` (exportado de `DetalheMovimentoSheet.tsx`, usado pelas Tasks 2-6). Funções `buscarDetalheOP(opId: number)`, `buscarDetalheTransferencia(id: number)`, `buscarDetalheNotaFiscal(id: number)`, `buscarDetalheInventario(id: number)` em `lib/actions/detalhe-movimento.ts` — cada uma retorna `{ error: string } | <shape específico>` (shapes definidos nas Tasks 2-5, que são quem realmente usa o retorno; nesta Task 1 elas retornam só `{ error: 'not implemented' }` como placeholder temporário, substituído nas próprias Tasks 2-5 — não é o placeholder proibido pelo plano porque cada uma vira uma implementação real e completa dentro da MESMA task que a introduz, não deixado pra depois sem dono).
- Consumes (Task 6): `<DetalheMovimentoSheet origem={origem} onOpenChange={setOrigem} />`, onde `origem: OrigemMovimento | null` (controla se a gaveta está aberta) e `onOpenChange: (o: OrigemMovimento | null) => void`.

### Passo 1: criar `lib/actions/detalhe-movimento.ts` com as 4 funções (assinatura completa, corpo real nas próximas tasks)

```ts
'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'

export type Ingrediente = { cod: number; nome: string; unidade: string; qtd: number }

export type DetalheOP = {
  id: number
  numOP: string
  produto: string
  unidade: string
  qtdPlanejada: number | null
  qtdProduzida: number | null
  dataPrevisao: string | null
  dataConclusao: string | null
  concluida: boolean
  podeReverter: boolean
  ingredientes: Ingrediente[]
}

export async function buscarDetalheOP(opId: number): Promise<{ error: string } | DetalheOP> {
  return { error: 'not implemented' } // substituído na Task 2
}

export type DetalheTransferencia = {
  id: number
  origem: string
  destino: string
  data: string
  responsavel: string | null
  status: string
  finalizado: boolean
  podeEditar: boolean
  itens: import('@/components/transferencia/ContagemTransferencia').ItemMovimento[]
}

export async function buscarDetalheTransferencia(id: number): Promise<{ error: string } | DetalheTransferencia> {
  return { error: 'not implemented' } // substituído na Task 3
}

export type DetalheNotaFiscal = {
  id: string
  numero: string | null
  razaoSocial: string | null
  dataEmissao: string | null
  valor: number | null
  statusLabel: string
  statusTom: 'ok' | 'warn' | 'err'
  chaveNfe: string | null
  itens: import('@/components/nota-fiscal/ItensNotaFiscal').ItemNF[]
  categorias: { id: number; nome: string }[]
}

export async function buscarDetalheNotaFiscal(id: string): Promise<{ error: string } | DetalheNotaFiscal> {
  return { error: 'not implemented' } // substituído na Task 4
}

export type DetalheInventario = {
  id: number
  local: string
  data: string
  responsavel: string | null
  status: string
  finalizado: boolean
  podeEditar: boolean
  itens: import('@/components/inventario/ContagemInventario').ItemContagem[]
}

export async function buscarDetalheInventario(id: number): Promise<{ error: string } | DetalheInventario> {
  return { error: 'not implemented' } // substituído na Task 5
}
```

### Passo 2: criar `components/movimentacoes/DetalheMovimentoSheet.tsx` (shell genérico)

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui-kit/Spinner'
import {
  buscarDetalheOP,
  buscarDetalheTransferencia,
  buscarDetalheNotaFiscal,
  buscarDetalheInventario,
  type DetalheOP,
  type DetalheTransferencia,
  type DetalheNotaFiscal,
  type DetalheInventario,
} from '@/lib/actions/detalhe-movimento'

export type OrigemMovimento =
  | { tipo: 'op'; id: number }
  | { tipo: 'transferencia'; id: number }
  | { tipo: 'nota_fiscal'; id: number }
  | { tipo: 'inventario'; id: number }

const TITULOS: Record<OrigemMovimento['tipo'], string> = {
  op: 'Ordem de Produção',
  transferencia: 'Transferência',
  nota_fiscal: 'Nota Fiscal',
  inventario: 'Inventário',
}

type Estado =
  | { status: 'carregando' }
  | { status: 'erro'; mensagem: string }
  | { status: 'op'; dados: DetalheOP }
  | { status: 'transferencia'; dados: DetalheTransferencia }
  | { status: 'nota_fiscal'; dados: DetalheNotaFiscal }
  | { status: 'inventario'; dados: DetalheInventario }

export function DetalheMovimentoSheet({
  origem,
  onOpenChange,
}: {
  origem: OrigemMovimento | null
  onOpenChange: (o: OrigemMovimento | null) => void
}) {
  const [estado, setEstado] = useState<Estado>({ status: 'carregando' })

  useEffect(() => {
    if (!origem) return
    setEstado({ status: 'carregando' })
    ;(async () => {
      if (origem.tipo === 'op') {
        const r = await buscarDetalheOP(origem.id)
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'op', dados: r })
      } else if (origem.tipo === 'transferencia') {
        const r = await buscarDetalheTransferencia(origem.id)
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'transferencia', dados: r })
      } else if (origem.tipo === 'nota_fiscal') {
        const r = await buscarDetalheNotaFiscal(String(origem.id))
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'nota_fiscal', dados: r })
      } else {
        const r = await buscarDetalheInventario(origem.id)
        setEstado('error' in r ? { status: 'erro', mensagem: r.error } : { status: 'inventario', dados: r })
      }
    })()
  }, [origem])

  return (
    <Sheet open={origem !== null} onOpenChange={(open) => !open && onOpenChange(null)}>
      <SheetContent side="right" className="w-[92vw] overflow-y-auto bg-surface sm:max-w-none sm:w-[520px]" showCloseButton>
        <SheetHeader>
          <SheetTitle>{origem ? TITULOS[origem.tipo] : ''}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          {estado.status === 'carregando' && (
            <div className="flex items-center justify-center py-12"><Spinner /></div>
          )}
          {estado.status === 'erro' && (
            <p className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[13px] text-text-muted">{estado.mensagem}</p>
          )}
          {/* Task 2 preenche estado.status === 'op' */}
          {/* Task 3 preenche estado.status === 'transferencia' */}
          {/* Task 4 preenche estado.status === 'nota_fiscal' */}
          {/* Task 5 preenche estado.status === 'inventario' */}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

Confira em `components/ui/sheet.tsx` se `SheetHeader`/`SheetTitle` já existem com essa assinatura (mesmo padrão usado em outros lugares do repo que já consomem `Sheet`) — se os nomes exportados forem diferentes, ajuste os imports pra bater com o que o arquivo realmente exporta, sem mudar o comportamento visual pedido (título no topo da gaveta, X pra fechar já vem de `showCloseButton`).

### Passo 3: Verificar tipos

Run: `npx tsc --noEmit -p .`
Expected: sem erros (os `{ error: 'not implemented' }` retornados nesta task batem com a assinatura `Promise<{ error: string } | Detalhe...>` declarada).

### Passo 4: Commit

```bash
git add lib/actions/detalhe-movimento.ts components/movimentacoes/DetalheMovimentoSheet.tsx
git commit -m "feat: shell da gaveta de detalhe de movimentação + assinaturas das Server Actions"
```

---

## Task 2: Detalhe de Ordem de Produção (conteúdo real + Reverter)

**Files:**
- Modify: `lib/actions/detalhe-movimento.ts` (substitui `buscarDetalheOP`)
- Create: `components/movimentacoes/DetalheOP.tsx`
- Modify: `components/movimentacoes/DetalheMovimentoSheet.tsx` (renderiza `DetalheOP` quando `estado.status === 'op'`)

**Interfaces:**
- Consumes: `DetalheOP` (Task 1), `reverterOP(opId: number): Promise<{ok: true} | {error: string}>` já existente em `lib/actions/ordem-producao.ts:736`.
- Produces: componente `<DetalheOP dados={DetalheOP} onRevertido={() => void}>` — `onRevertido` é chamado após reverter com sucesso, pro shell poder fechar a gaveta ou recarregar a lista de trás (a `MovimentosTab` decide o que fazer, via `router.refresh()`).

### Passo 1: Implementar `buscarDetalheOP` de verdade

Espelha a montagem de `ingredientesMap` já feita em `app/(app)/ordem-producao/page.tsx` (linhas ~275-314), só que para UMA OP em vez da página inteira:

```ts
export async function buscarDetalheOP(opId: number): Promise<{ error: string } | DetalheOP> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: op } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, identificacao_d_dt_previsao, dt_conclusao_real, concluida, full_object')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (!op) return { error: 'Ordem de produção não encontrada.' }

  const { data: prod } = op.identificacao_n_cod_produto
    ? await supabase.from('produtos').select('descricao, unidade').eq('loja_id', lojaId).eq('codigo_produto', op.identificacao_n_cod_produto).maybeSingle()
    : { data: null }

  const itensDetalhes = (op.full_object as { itensDetalhes?: { nIdProdutoMalha: number; nQtde: number }[] } | null)?.itensDetalhes ?? []
  const codsIngrediente = [...new Set(itensDetalhes.map((i) => i.nIdProdutoMalha).filter(Boolean))]
  const { data: ingProds } = codsIngrediente.length
    ? await supabase.from('produtos').select('codigo_produto, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', codsIngrediente)
    : { data: [] as { codigo_produto: number; descricao: string; unidade: string }[] }
  const ingMap = new Map((ingProds ?? []).map((p) => [p.codigo_produto, p]))
  const ingredientes: Ingrediente[] = itensDetalhes
    .filter((i) => i.nIdProdutoMalha)
    .map((i) => {
      const p = ingMap.get(i.nIdProdutoMalha)
      return { cod: i.nIdProdutoMalha, nome: p?.descricao || `#${i.nIdProdutoMalha}`, unidade: p?.unidade ?? '', qtd: Number(i.nQtde) }
    })

  const podeReverter = await requirePermissao(lojaId, 'Ordens de Producao - Reverter')

  return {
    id: op.id,
    numOP: op.identificacao_c_num_op || op.num_ordem || String(op.id),
    produto: prod?.descricao || `Produto ${op.identificacao_n_cod_produto}`,
    unidade: prod?.unidade || 'UN',
    qtdPlanejada: op.identificacao_n_qtde,
    qtdProduzida: op.quantidade,
    dataPrevisao: op.identificacao_d_dt_previsao,
    dataConclusao: op.dt_conclusao_real,
    concluida: !!op.concluida,
    podeReverter,
    ingredientes,
  }
}
```

(`formatarNomeProduto` de `lib/formatar-nome` pode ser aplicado em `prod?.descricao`/ingredientes se o revisor achar que o nome cru não fica legível — mesmo tratamento que `OrdemProducaoRow`/`ordem-producao/page.tsx` já aplicam; adicione o import e a chamada se necessário, mantendo o resto igual.)

### Passo 2: Criar `components/movimentacoes/DetalheOP.tsx`

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { reverterOP } from '@/lib/actions/ordem-producao'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import type { DetalheOP as DetalheOPData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

export function DetalheOP({ dados, onRevertido }: { dados: DetalheOPData; onRevertido: () => void }) {
  const [pending, startTransition] = useTransition()

  function reverter() {
    if (!window.confirm('Reverter esta OP? A produção será estornada no Omie.')) return
    startTransition(async () => {
      const res = await reverterOP(dados.id)
      if (res && 'error' in res) {
        toast.error('Erro ao reverter', { description: res.error })
      } else {
        toast.success('OP revertida')
        onRevertido()
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">OP</p>
        <p className="text-sm text-text">{dados.numOP}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Produto</p>
        <p className="text-sm text-text">{dados.produto} ({dados.unidade})</p>
      </div>
      <div className="flex gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Qtd. planejada</p>
          <p className="num text-sm text-text">{dados.qtdPlanejada ?? '-'}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Qtd. produzida</p>
          <p className="num text-sm text-text">{dados.qtdProduzida ?? '-'}</p>
        </div>
      </div>
      <div className="flex gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Previsão</p>
          <p className="text-sm text-text">{fmtData(dados.dataPrevisao)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Conclusão real</p>
          <p className="text-sm text-text">{fmtData(dados.dataConclusao)}</p>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Status</p>
        <p className={`text-sm font-medium ${dados.concluida ? 'text-ok' : 'text-text-muted'}`}>
          {dados.concluida ? 'Concluída' : 'Em andamento'}
        </p>
      </div>
      {dados.ingredientes.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Ingredientes</p>
          <ul className="space-y-1 rounded-md border border-border bg-surface-2 p-2.5">
            {dados.ingredientes.map((i) => (
              <li key={i.cod} className="flex items-center justify-between text-[13px]">
                <span className="text-text">{i.nome}</span>
                <span className="num text-text-muted">{i.qtd} {i.unidade}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dados.concluida && dados.podeReverter && (
        <button onClick={reverter} disabled={pending} className={`${btnClass('outline')} w-full`}>
          {pending ? <Spinner /> : <Undo2 className="size-4" />}
          {pending ? 'Revertendo...' : 'Reverter'}
        </button>
      )}
    </div>
  )
}
```

### Passo 3: Ligar no shell

Em `components/movimentacoes/DetalheMovimentoSheet.tsx`, adicionar o import de `DetalheOP` e, dentro do bloco de renderização (onde estão os comentários `{/* Task 2 preenche... */}`), trocar pelo JSX real:

```tsx
{estado.status === 'op' && (
  <DetalheOP dados={estado.dados} onRevertido={() => onOpenChange(null)} />
)}
```

### Passo 4: Verificar tipos e build

Run: `npx tsc --noEmit -p .` — sem erros.
Run: `npm run build` — build limpo.

### Passo 5: Commit

```bash
git add lib/actions/detalhe-movimento.ts components/movimentacoes/DetalheOP.tsx components/movimentacoes/DetalheMovimentoSheet.tsx
git commit -m "feat: detalhe de Ordem de Produção na gaveta, com Reverter"
```

---

## Task 3: Detalhe de Transferência (reaproveita `ContagemTransferencia`)

**Files:**
- Modify: `lib/actions/detalhe-movimento.ts` (substitui `buscarDetalheTransferencia`)
- Create: `components/movimentacoes/DetalheTransferencia.tsx`
- Modify: `components/movimentacoes/DetalheMovimentoSheet.tsx`

**Interfaces:**
- Consumes: `ContagemTransferencia` de `components/transferencia/ContagemTransferencia.tsx` (já existe, props `{transferenciaId, itensIniciais, finalizado, podeEditar}`), `type ItemMovimento` do mesmo arquivo.

### Passo 1: Implementar `buscarDetalheTransferencia`

Espelha exatamente as queries de `app/(app)/transferencia/[id]/contagem/page.tsx` (linhas 20-67), só que devolvendo os dados prontos em vez de renderizar uma página:

```ts
export async function buscarDetalheTransferencia(id: number): Promise<{ error: string } | DetalheTransferencia> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const podeEditar = await requirePermissao(lojaId, 'Transferencias - Editar')

  const { data: trans } = await supabase
    .from('transferencias')
    .select('id, data, codigo_local_origem, codigo_local_destino, status, user_id')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (!trans) return { error: 'Transferência não encontrada.' }

  const { data: responsavel } = trans.user_id
    ? await supabase.from('profiles').select('name').eq('id', trans.user_id).maybeSingle()
    : { data: null }

  const { data: movimentos } = await supabase
    .from('movimentos')
    .select('id, id_prod, quan, status, descricao_status')
    .eq('transferencia_id', id)
    .order('id')

  const codigos = [...new Set((movimentos ?? []).map((m) => m.id_prod))]
  const { data: produtos } = codigos.length
    ? await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', codigos)
    : { data: [] }
  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  const itens = (movimentos ?? []).map((m) => {
    const p = prodMap.get(m.id_prod)
    return {
      id: m.id,
      id_prod: m.id_prod,
      descricao: p?.descricao || `Produto ${m.id_prod}`,
      codigo: p?.codigo || String(m.id_prod),
      unidade: p?.unidade ?? null,
      quan: m.quan,
      status: m.status,
      descricao_status: (m as { descricao_status?: string | null }).descricao_status ?? null,
    }
  })

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .in('codigo_local_estoque', [trans.codigo_local_origem, trans.codigo_local_destino].filter((v): v is number => v != null))
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  return {
    id: trans.id,
    origem: localMap.get(trans.codigo_local_origem) || String(trans.codigo_local_origem),
    destino: localMap.get(trans.codigo_local_destino) || String(trans.codigo_local_destino),
    data: trans.data,
    responsavel: responsavel?.name ?? null,
    status: trans.status,
    finalizado: trans.status === 'Concluido',
    podeEditar,
    itens,
  }
}
```

(Use `formatarNomeProduto` de `lib/formatar-nome` em `p?.descricao` se quiser paridade visual exata com a tela `/transferencia/[id]/contagem`, que já formata assim — confira o arquivo original e replique a mesma chamada.)

### Passo 2: Criar `components/movimentacoes/DetalheTransferencia.tsx`

```tsx
'use client'

import { ContagemTransferencia } from '@/components/transferencia/ContagemTransferencia'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import type { DetalheTransferencia as DetalheTransferenciaData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

export function DetalheTransferencia({ dados }: { dados: DetalheTransferenciaData }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-text-muted">{dados.origem}</span>
        <span className="text-text-muted">→</span>
        <span className="rounded bg-ok/15 px-1.5 py-0.5 font-medium text-ok">{dados.destino}</span>
        <StatusPill status={dados.status} />
      </div>
      <p className="text-[13px] text-text-muted">
        {fmtData(dados.data)}{dados.responsavel && ` · por ${dados.responsavel}`}
      </p>
      <ContagemTransferencia
        transferenciaId={dados.id}
        itensIniciais={dados.itens}
        finalizado={dados.finalizado}
        podeEditar={dados.podeEditar}
      />
    </div>
  )
}
```

### Passo 3: Ligar no shell

Em `DetalheMovimentoSheet.tsx`, importar `DetalheTransferencia` e substituir o comentário correspondente:

```tsx
{estado.status === 'transferencia' && <DetalheTransferencia dados={estado.dados} />}
```

### Passo 4: Verificar tipos e build

Run: `npx tsc --noEmit -p .` — sem erros.
Run: `npm run build` — build limpo.

### Passo 5: Commit

```bash
git add lib/actions/detalhe-movimento.ts components/movimentacoes/DetalheTransferencia.tsx components/movimentacoes/DetalheMovimentoSheet.tsx
git commit -m "feat: detalhe de Transferência na gaveta"
```

---

## Task 4: Detalhe de Nota Fiscal (reaproveita `ItensNotaFiscal`)

**Files:**
- Modify: `lib/actions/detalhe-movimento.ts` (substitui `buscarDetalheNotaFiscal`)
- Create: `components/movimentacoes/DetalheNotaFiscal.tsx`
- Modify: `components/movimentacoes/DetalheMovimentoSheet.tsx`

**Interfaces:**
- Consumes: `ItensNotaFiscal` de `components/nota-fiscal/ItensNotaFiscal.tsx` (props `{notaId, itens, categorias}`), `type ItemNF`; `statusNF` de `lib/nf-status.ts`.

### Passo 1: Implementar `buscarDetalheNotaFiscal`

Espelha `app/(app)/nota-fiscal/[id]/page.tsx` (linhas 19-42) — **inclusive o fallback pro Contabo**: `notas_fiscais`/`nota_fiscal_items` são tabelas podadas a 90 dias no Supabase (ver AGENTS.md, seção "Arquitetura de histórico"), e uma NF referenciada por uma linha de `MovimentosTab` pode ser mais antiga que isso (o relatório de Movimentos olha até 1 ano pra trás). Sem o fallback, clicar numa linha "Saída (NF)" antiga devolveria "Nota fiscal não encontrada" mesmo ela existindo de verdade no Contabo — a MESMA classe de bug que a revisão da Task 2 já achou e corrigiu pra Ordens de Produção (ver ledger de progresso). Use os helpers já existentes (`complementarNotasFiscais`, `complementarNotaFiscalItems`, ambos de `lib/historico-contabo.ts`), no MESMO padrão que a própria página `/nota-fiscal/[id]` já usa:

```ts
import { complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
// ... (junto aos demais imports do topo do arquivo)

export async function buscarDetalheNotaFiscal(id: string): Promise<{ error: string } | DetalheNotaFiscal> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: nfSupabase } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, full_object')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()

  const nf = nfSupabase ?? (await complementarNotasFiscais([], { lojaId, id: Number(id) }))[0] ?? null
  if (!nf) return { error: 'Nota fiscal não encontrada.' }

  const [{ data: itensRaw }, { data: categorias }] = await Promise.all([
    supabase
      .from('nota_fiscal_items')
      .select('id, n_id_receb, n_sequencia, c_codigo_produto, c_descricao_produto, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_total_item, quantidade, categoria_contabil_id')
      .eq('nota_fiscal_id', id)
      .eq('loja_id', lojaId)
      .order('n_sequencia'),
    supabase.from('categorias_contabeis').select('id, nome').eq('loja_id', lojaId).eq('ativa', true).order('nome'),
  ])

  const itens = nfSupabase
    ? (itensRaw ?? [])
    : await complementarNotaFiscalItems(itensRaw ?? [], { lojaId, notaFiscalId: Number(id) })

  const { statusNF } = await import('@/lib/nf-status')
  const st = statusNF(nf.c_etapa, nf.full_object)

  return {
    id: String(nf.id),
    numero: nf.c_numero_nfe,
    razaoSocial: nf.c_razao_social || nf.c_nome,
    dataEmissao: nf.d_emissao_nfe,
    valor: nf.n_valor_nfe,
    statusLabel: st.label,
    statusTom: st.tom,
    chaveNfe: nf.c_chave_nfe,
    itens,
    categorias: categorias ?? [],
  }
}
```

(Use import estático de `statusNF` no topo do arquivo em vez de `await import(...)` dinâmico — o exemplo acima usa import dinâmico só pra ilustrar a dependência; no arquivo real, adicione `import { statusNF } from '@/lib/nf-status'` junto aos demais imports do topo, mesmo padrão do resto do arquivo.)

### Passo 2: Criar `components/movimentacoes/DetalheNotaFiscal.tsx`

```tsx
'use client'

import { ItensNotaFiscal } from '@/components/nota-fiscal/ItensNotaFiscal'
import { SELO_CLASSE } from '@/lib/status-cor'
import type { DetalheNotaFiscal as DetalheNotaFiscalData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${y}`
}

function fmtMoeda(n: number | null): string {
  return n != null ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'
}

export function DetalheNotaFiscal({ dados }: { dados: DetalheNotaFiscalData }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">NFe</p>
        <p className="text-sm text-text">{dados.numero ?? '-'}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Fornecedor</p>
        <p className="text-sm text-text">{dados.razaoSocial ?? '-'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_CLASSE[dados.statusTom]}`}>
          {dados.statusLabel}
        </span>
        <span className="text-[13px] text-text-muted">{fmtData(dados.dataEmissao)}</span>
        <span className="num text-[13px] font-semibold text-text">{fmtMoeda(dados.valor)}</span>
      </div>
      {dados.chaveNfe && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Chave de acesso</p>
          <p className="num break-all text-[12px] text-text-muted">{dados.chaveNfe}</p>
        </div>
      )}
      <ItensNotaFiscal notaId={dados.id} itens={dados.itens} categorias={dados.categorias} />
    </div>
  )
}
```

### Passo 3: Ligar no shell

Em `DetalheMovimentoSheet.tsx`:

```tsx
{estado.status === 'nota_fiscal' && <DetalheNotaFiscal dados={estado.dados} />}
```

### Passo 4: Verificar tipos e build

Run: `npx tsc --noEmit -p .` — sem erros. Confirme que `SELO_CLASSE` (de `lib/status-cor.ts`) aceita as chaves `'ok'|'warn'|'err'` — é o mesmo tipo que `statusNF` já devolve em `tom`, usado hoje em `app/(app)/nota-fiscal/page.tsx:495`.
Run: `npm run build` — build limpo.

### Passo 5: Commit

```bash
git add lib/actions/detalhe-movimento.ts components/movimentacoes/DetalheNotaFiscal.tsx components/movimentacoes/DetalheMovimentoSheet.tsx
git commit -m "feat: detalhe de Nota Fiscal na gaveta"
```

---

## Task 5: Detalhe de Inventário (reaproveita `ContagemInventario`)

**Files:**
- Modify: `lib/actions/detalhe-movimento.ts` (substitui `buscarDetalheInventario`)
- Create: `components/movimentacoes/DetalheInventario.tsx`
- Modify: `components/movimentacoes/DetalheMovimentoSheet.tsx`

**Interfaces:**
- Consumes: `ContagemInventario` de `components/inventario/ContagemInventario.tsx` (props `{inventarioId, itensIniciais, finalizado, podeEditar}`), `type ItemContagem`.

### Passo 1: Implementar `buscarDetalheInventario`

Espelha `app/(app)/inventario/[id]/contagem/page.tsx` (linhas 14-70) — inclusive a paginação de `inventario_items` (o comentário original documenta que um inventário pode ter mais de 1000 itens):

```ts
export async function buscarDetalheInventario(id: number): Promise<{ error: string } | DetalheInventario> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const podeEditar = await requirePermissao(lojaId, 'Inventarios - Editar')

  const { data: inventario } = await supabase
    .from('inventarios')
    .select('id, data, codigo_local_estoque, status, user_id')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (!inventario) return { error: 'Inventário não encontrado.' }

  const { data: responsavel } = inventario.user_id
    ? await supabase.from('profiles').select('name').eq('id', inventario.user_id).maybeSingle()
    : { data: null }

  const itensRaw: { id: number; produto_codigo: string; produto_descricao: string; produto_familia: string | null; produto_codigo_produto: number; quan: number | null; status: string | null }[] = []
  const PAGE_SIZE = 1000
  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await supabase
      .from('inventario_items')
      .select('id, produto_codigo, produto_descricao, produto_familia, produto_codigo_produto, quan, status')
      .eq('inventario_id', id)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    itensRaw.push(...bloco)
    if (bloco.length < PAGE_SIZE) break
  }

  const codigos = [...new Set(itensRaw.map((i) => i.produto_codigo_produto).filter(Boolean))]
  const prods: { codigo_produto: number; unidade: string | null }[] = []
  for (let from = 0; codigos.length && from < codigos.length; from += 1000) {
    const { data } = await supabase.from('produtos').select('codigo_produto, unidade').eq('loja_id', lojaId).in('codigo_produto', codigos.slice(from, from + 1000))
    if (data?.length) prods.push(...data)
  }
  const unidadeMap = new Map(prods.map((p) => [p.codigo_produto, p.unidade]))

  const { data: local } = await supabase
    .from('local_estoques')
    .select('descricao')
    .eq('loja_id', lojaId)
    .eq('codigo_local_estoque', inventario.codigo_local_estoque)
    .maybeSingle()

  return {
    id: inventario.id,
    local: local?.descricao || String(inventario.codigo_local_estoque),
    data: inventario.data,
    responsavel: responsavel?.name ?? null,
    status: inventario.status,
    finalizado: inventario.status === 'Finalizado',
    podeEditar,
    itens: itensRaw.map((i) => ({ ...i, unidade: unidadeMap.get(i.produto_codigo_produto) ?? null })),
  }
}
```

### Passo 2: Criar `components/movimentacoes/DetalheInventario.tsx`

```tsx
'use client'

import { ContagemInventario } from '@/components/inventario/ContagemInventario'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import type { DetalheInventario as DetalheInventarioData } from '@/lib/actions/detalhe-movimento'

function fmtData(d: string): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

export function DetalheInventario({ dados }: { dados: DetalheInventarioData }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Local</p>
        <p className="text-sm text-text">{dados.local}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
        <span className="num">{fmtData(dados.data)}</span>
        <StatusPill status={dados.status} />
        {dados.responsavel && <span>por {dados.responsavel}</span>}
      </div>
      <ContagemInventario
        inventarioId={dados.id}
        itensIniciais={dados.itens}
        finalizado={dados.finalizado}
        podeEditar={dados.podeEditar}
      />
    </div>
  )
}
```

### Passo 3: Ligar no shell

Em `DetalheMovimentoSheet.tsx`:

```tsx
{estado.status === 'inventario' && <DetalheInventario dados={estado.dados} />}
```

### Passo 4: Verificar tipos e build

Run: `npx tsc --noEmit -p .` — sem erros.
Run: `npm run build` — build limpo.

### Passo 5: Commit

```bash
git add lib/actions/detalhe-movimento.ts components/movimentacoes/DetalheInventario.tsx components/movimentacoes/DetalheMovimentoSheet.tsx
git commit -m "feat: detalhe de Inventário na gaveta"
```

---

## Task 6: Ligar `MovimentosTab` à gaveta (expor IDs + trigger de clique)

**Files:**
- Modify: `components/movimentacoes/MovimentosTab.tsx`
- Create: `components/movimentacoes/LinhaMovimentoTipo.tsx` (client component — a célula "Tipo" precisa de estado de `useState` pra controlar qual origem está aberta, então não pode ficar dentro do Server Component `MovimentosTab`)

**Interfaces:**
- Consumes: `OrigemMovimento`, `DetalheMovimentoSheet` (Task 1-5).

### Passo 1: `MovimentosTab.tsx` — expor os IDs de origem

Trocar o tipo `LinhaDetalhe` (linhas 43-52):

```ts
type LinhaDetalhe = {
  chave: string
  data: string
  tipo: string
  quan: number
  local: number | null
  destino: number | null
  obs: string | null
  status: string | null
  origem?: OrigemMovimento
}
```

Adicionar o import no topo de `MovimentosTab.tsx` (junto aos demais): `import type { OrigemMovimento } from '@/components/movimentacoes/DetalheMovimentoSheet'` — **reaproveita o mesmo tipo da Task 1**, não redeclarar um tipo novo aqui (o shape é idêntico ao já usado por `DetalheMovimentoSheet`/`LinhaMovimentoTipo`; dois nomes para o mesmo shape seria uma inconsistência).

Query de `movimentos` (linha 167) ganha `transferencia_id`:

```ts
.select('id, data, tipo, quan, codigo_local_estoque, codigo_local_estoque_destino, obs, status, id_ajuste, transferencia_id')
```

`RawMov` (linha 207) ganha `transferencia_id: number | null`. `movLines` (linha 278-287):

```ts
const movLines: LinhaDetalhe[] = movsRaw.map((m) => ({
  chave: `mov-${m.id}`,
  data: m.data,
  tipo: m.tipo,
  quan: Number(m.quan) || 0,
  local: m.codigo_local_estoque != null ? Number(m.codigo_local_estoque) : null,
  destino: m.codigo_local_estoque_destino != null ? Number(m.codigo_local_estoque_destino) : null,
  obs: m.obs,
  status: m.status,
  origem: m.tipo === 'TRF' && m.transferencia_id != null ? { tipo: 'transferencia', id: m.transferencia_id } : undefined,
}))
```

`opLines` (linha 289-298) ganha `origem`:

```ts
const opLines: LinhaDetalhe[] = ((ops ?? []) as RawOP[]).map((op) => ({
  chave: `op-${op.id}`,
  data: op.dt_conclusao_real || op.identificacao_d_dt_previsao || ini,
  tipo: 'OP',
  quan: Number(op.quantidade) || Number(op.identificacao_n_qtde) || 0,
  local: null,
  destino: null,
  obs: `OP ${op.identificacao_c_num_op || op.num_ordem || op.id}${op.concluida ? '' : ' (em andamento)'}`,
  status: op.concluida ? 'Concluido' : 'Iniciado',
  origem: { tipo: 'op', id: op.id },
}))
```

Query de `nota_fiscal_items` (linha 195) ganha `nota_fiscal_id`:

```ts
.select('id, nota_fiscal_id, n_id_receb, n_sequencia, n_id_produto, n_qtde_nfe, c_codigo_produto, notas_fiscais!inner(d_emissao_nfe, c_numero_nfe, c_natureza_operacao, deleted_at, c_etapa, full_object)')
```

`RawNFI` (linha 209) ganha `nota_fiscal_id: number`. `NFIItem` (linha 216) ganha `nota_fiscal_id: number`. No mapeamento (linha 235-241):

```ts
.map((nfi) => {
  const nf = Array.isArray(nfi.notas_fiscais) ? nfi.notas_fiscais[0] : nfi.notas_fiscais
  return {
    id: nfi.id, nota_fiscal_id: nfi.nota_fiscal_id, n_id_receb: nfi.n_id_receb, n_sequencia: nfi.n_sequencia, n_id_produto: nfi.n_id_produto, n_qtde_nfe: nfi.n_qtde_nfe,
    d_emissao_nfe: nf?.d_emissao_nfe ?? null, c_numero_nfe: nf?.c_numero_nfe ?? null, c_natureza_operacao: nf?.c_natureza_operacao ?? null,
  }
})
```

`RawNFIFrio` (linha 222) **já tem** `nota_fiscal_id` — na normalização da fatia fria (linha 265-268), adicionar `nota_fiscal_id: f.nota_fiscal_id` ao objeto retornado.

`entLines` (linha 300-314) ganha `origem`:

```ts
const entLines: LinhaDetalhe[] = nfItems
  .filter((nfi) => {
    const d = nfi.d_emissao_nfe?.slice(0, 10)
    return d && d >= ini && d <= fim
  })
  .map((nfi, idx) => ({
    chave: `sai-${nfi.n_id_produto}-${nfi.d_emissao_nfe?.slice(0, 10)}-${idx}`,
    data: nfi.d_emissao_nfe ?? ini,
    tipo: 'SAI',
    quan: Number(nfi.n_qtde_nfe) || 0,
    local: null,
    destino: null,
    obs: [nfi.c_numero_nfe ? `NF ${nfi.c_numero_nfe}` : null, nfi.c_natureza_operacao ?? null].filter(Boolean).join(' — ') || 'Saída (NF)',
    status: 'Concluido',
    origem: { tipo: 'nota_fiscal', id: nfi.nota_fiscal_id },
  }))
```

`sldLines` (linha 316-334) ganha `origem`:

```ts
.map((ii) => {
  const inv = Array.isArray(ii.inventarios) ? ii.inventarios[0] : ii.inventarios
  return {
    chave: `sld-${ii.produto_codigo_produto}-${inv?.id}`,
    data: inv?.data ?? ini,
    tipo: 'SLD',
    quan: Number(ii.quan) || 0,
    local: null,
    destino: null,
    obs: 'Inventário',
    status: 'Concluido',
    origem: inv?.id != null ? { tipo: 'inventario', id: inv.id } : undefined,
  }
})
```

### Passo 2: Criar `components/movimentacoes/LinhaMovimentoTipo.tsx`

A célula "Tipo" precisa de `useState` (qual gaveta está aberta) — vira um client component pequeno que recebe o que já era renderizado hoje mais o `origem` opcional:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DetalheMovimentoSheet, type OrigemMovimento } from '@/components/movimentacoes/DetalheMovimentoSheet'

export function LinhaMovimentoTipo({
  label,
  cor,
  obs,
  origem,
}: {
  label: string
  cor: string
  obs: string | null
  origem?: OrigemMovimento
}) {
  const [aberto, setAberto] = useState<OrigemMovimento | null>(null)
  const router = useRouter()

  const conteudo = (
    <span>
      <span className={`font-medium text-[13px] ${cor}`}>{label}</span>
      {obs && (
        <span className="block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-text-muted">
          {obs}
        </span>
      )}
    </span>
  )

  if (!origem) return conteudo

  return (
    <>
      <button type="button" onClick={() => setAberto(origem)} className="text-left hover:opacity-80">
        {conteudo}
      </button>
      <DetalheMovimentoSheet
        origem={aberto}
        onOpenChange={(o) => {
          setAberto(o)
          if (o === null) router.refresh() // reflete reverter/edicoes feitas dentro da gaveta
        }}
      />
    </>
  )
}
```

### Passo 3: Usar `LinhaMovimentoTipo` na coluna "Tipo" de `MovimentosTab.tsx`

Trocar (linhas 458-475):

```tsx
{
  label: 'Tipo',
  primaria: true,
  larguraDesktop: 'w-44',
  render: (m) => {
    const t = TIPOS[m.tipo] ?? { label: m.tipo, cor: 'text-text-muted' }
    return (
      <span>
        <span className={`font-medium text-[13px] ${t.cor}`}>{t.label}</span>
        {m.obs && (
          <span className="block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-text-muted">
            {m.obs}
          </span>
        )}
      </span>
    )
  },
},
```

por:

```tsx
{
  label: 'Tipo',
  primaria: true,
  larguraDesktop: 'w-44',
  render: (m) => {
    const t = TIPOS[m.tipo] ?? { label: m.tipo, cor: 'text-text-muted' }
    return <LinhaMovimentoTipo label={t.label} cor={t.cor} obs={m.obs} origem={m.origem} />
  },
},
```

E adicionar o import no topo do arquivo: `import { LinhaMovimentoTipo } from '@/components/movimentacoes/LinhaMovimentoTipo'`.

### Passo 4: Verificar tipos e build

Run: `npx tsc --noEmit -p .` — sem erros.
Run: `npm run build` — build limpo.

### Passo 5: Teste manual (QA, Playwright)

Suba `npm run dev` numa porta livre em background, logue com a conta QA, vá em `/movimentacoes?produto=<algo com movimento de OP e de NF>&data_inicio=...`. Clique numa linha "Ordem de Produção" — a gaveta deve abrir com os dados da OP e (se concluída e a conta QA tiver permissão) o botão Reverter. Clique numa linha "Saída" com NF — a gaveta deve abrir com os itens da nota. Se houver transferência/inventário no período testado, confirme os outros dois tipos também. Ao final, mate o servidor e apague scripts temporários.

### Passo 6: Commit

```bash
git add components/movimentacoes/MovimentosTab.tsx components/movimentacoes/LinhaMovimentoTipo.tsx
git commit -m "feat: linhas de Movimentos abrem a gaveta de detalhe (OP/Transferência/NF/Inventário)"
```

---

## Task 7: Colunas customizáveis na tabela de Movimentos

**Files:**
- Create: `components/movimentacoes/SeletorColunas.tsx`
- Modify: `components/movimentacoes/MovimentosTab.tsx`

**Interfaces:**
- Produces: `useColunasVisiveis(rota: string, colunas: string[]): { visiveis: Set<string>; toggle: (col: string) => void }` — hook exportado de `SeletorColunas.tsx`, mesmo padrão de persistência de `hooks/use-filtros-persistentes.ts` (`localStorage`, chave por rota), mas guardando quais colunas mostrar em vez de filtros de busca.

### Passo 1: Criar `components/movimentacoes/SeletorColunas.tsx`

```tsx
'use client'

import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { btnClass } from '@/components/ui-kit/Button'

const COLUNA_OBRIGATORIA = 'Tipo' // coluna primária, nunca pode ser escondida

function chave(rota: string): string {
  return `ntb:colunas:${rota}`
}

export function useColunasVisiveis(rota: string, colunas: string[]) {
  const [visiveis, setVisiveis] = useState<Set<string>>(new Set(colunas))

  useEffect(() => {
    const salvo = localStorage.getItem(chave(rota))
    if (salvo) {
      try {
        const lista = JSON.parse(salvo) as string[]
        setVisiveis(new Set([COLUNA_OBRIGATORIA, ...lista.filter((c) => colunas.includes(c))]))
      } catch {
        // ignora storage corrompido, mantem o default (todas visiveis)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rota])

  function toggle(col: string) {
    if (col === COLUNA_OBRIGATORIA) return
    setVisiveis((prev) => {
      const novo = new Set(prev)
      if (novo.has(col)) novo.delete(col)
      else novo.add(col)
      localStorage.setItem(chave(rota), JSON.stringify([...novo]))
      return novo
    })
  }

  return { visiveis, toggle }
}

export function SeletorColunas({
  colunas,
  visiveis,
  toggle,
}: {
  colunas: string[]
  visiveis: Set<string>
  toggle: (col: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button type="button" className={`${btnClass('outline')} shrink-0`}>
            <SlidersHorizontal className="size-4" /> Colunas
          </button>
        }
      />
      <SheetContent side="right" className="w-[88vw] bg-surface sm:max-w-none sm:w-[320px]" showCloseButton>
        <SheetHeader>
          <SheetTitle>Colunas visíveis</SheetTitle>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {colunas.map((col) => (
            <label key={col} className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={visiveis.has(col)}
                disabled={col === COLUNA_OBRIGATORIA}
                onChange={() => toggle(col)}
                className="size-4 accent-[var(--brand)]"
              />
              {col}{col === COLUNA_OBRIGATORIA && <span className="text-[11px] text-text-muted"> (sempre visível)</span>}
            </label>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

### Passo 2: Usar em `MovimentosTab.tsx`

`MovimentosTab` é um Server Component — o controle de colunas precisa de estado no cliente. Extraia a `<Lista>` (linhas 447-528) e o novo `<SeletorColunas>` para um wrapper client component `components/movimentacoes/ListaMovimentos.tsx` que recebe `movDetalhes`/`locaisMap` prontos como props e decide quais colunas passar pro array `colunas` da `Lista` com base em `visiveis`:

```tsx
'use client'

import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ArrowLeftRight } from 'lucide-react'
import { LinhaMovimentoTipo } from '@/components/movimentacoes/LinhaMovimentoTipo'
import { SeletorColunas, useColunasVisiveis } from '@/components/movimentacoes/SeletorColunas'

const COLUNAS = ['Data', 'Tipo', 'Quantidade', 'Local / Destino', 'Status']

// mesmos tipos/props que MovimentosTab ja monta hoje -- veja o arquivo para o
// shape completo de `linha` e `TIPOS`.
export function ListaMovimentos({ linhas, TIPOS, locaisMap, vazioProps }: {
  linhas: /* mesmo tipo de LinhaDetalhe ja definido em MovimentosTab.tsx */ any[]
  TIPOS: Record<string, { label: string; cor: string }>
  locaisMap: Map<number, string>
  vazioProps: { title: string; hint: string }
}) {
  const { visiveis, toggle } = useColunasVisiveis('/movimentacoes', COLUNAS)

  const fmtDataDetalhe = (d: string) => {
    if (d.includes('T')) {
      return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    }
    const [y, mo, dia] = d.slice(0, 10).split('-')
    return `${dia}/${mo}/${y}`
  }
  const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })

  const todasColunas = [
    { label: 'Data', larguraDesktop: 'w-36', render: (m: any) => <span className="num text-[12px] text-text-muted">{fmtDataDetalhe(m.data)}</span> },
    {
      label: 'Tipo', primaria: true, larguraDesktop: 'w-44',
      render: (m: any) => {
        const t = TIPOS[m.tipo] ?? { label: m.tipo, cor: 'text-text-muted' }
        return <LinhaMovimentoTipo label={t.label} cor={t.cor} obs={m.obs} origem={m.origem} />
      },
    },
    {
      label: 'Quantidade', alinhar: 'right' as const, larguraDesktop: 'w-28',
      render: (m: any) => {
        const negativo = m.tipo === 'SAI' || m.tipo === 'TPQ'
        const cor = negativo ? 'text-err' : m.tipo === 'ENT' || m.tipo === 'OP' ? 'text-ok' : 'text-text'
        const sinal = negativo ? '-' : m.tipo === 'ENT' || m.tipo === 'OP' ? '+' : ''
        return <span className={`num font-medium ${cor}`}>{sinal}{fmtQtd(m.quan)}</span>
      },
    },
    {
      label: 'Local / Destino', larguraDesktop: 'w-48',
      render: (m: any) => {
        if (m.local == null) return <span className="text-text-muted">-</span>
        const nomeOrig = locaisMap.get(m.local) ?? String(m.local)
        const nomeDest = m.destino != null ? (locaisMap.get(m.destino) ?? String(m.destino)) : null
        return <span className="text-[12px] text-text-muted">{nomeOrig}{nomeDest && <span> → {nomeDest}</span>}</span>
      },
    },
    {
      label: 'Status', larguraDesktop: 'w-28',
      render: (m: any) => {
        const cor = m.status === 'Erro' ? 'text-err' : m.status === 'Concluido' ? 'text-ok' : 'text-text-muted'
        return <span className={`text-[11px] ${cor}`}>{m.status ?? '-'}</span>
      },
    },
  ]

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <SeletorColunas colunas={COLUNAS} visiveis={visiveis} toggle={toggle} />
      </div>
      <Lista
        linhas={linhas}
        chaveLinha={(m: any) => m.chave}
        colunas={todasColunas.filter((c) => visiveis.has(c.label))}
        vazio={<EmptyState icon={ArrowLeftRight} title={vazioProps.title} hint={vazioProps.hint} />}
      />
    </div>
  )
}
```

Em `MovimentosTab.tsx`, trocar o bloco `<Lista ...>` (linhas 447-528) por:

```tsx
<ListaMovimentos
  linhas={movDetalhes}
  TIPOS={TIPOS}
  locaisMap={locaisMap}
  vazioProps={{
    title: 'Sem movimentações',
    hint:
      idsProdDetalhes.length === 0
        ? 'Produto não encontrado no cadastro.'
        : localFiltro
          ? 'Nenhum ajuste registrado neste local e período. OP/NF/inventário não têm local registrado, por isso somem com o filtro de local ativo.'
          : 'Nenhuma OP ou movimento encontrado neste período para este produto.',
  }}
/>
```

E importar `ListaMovimentos` no topo (`import { ListaMovimentos } from '@/components/movimentacoes/ListaMovimentos'`). Remover o import de `Lista`/`LinhaMovimentoTipo` diretamente em `MovimentosTab.tsx` se ficarem sem uso (eles passam a ser usados só dentro de `ListaMovimentos.tsx`).

### Passo 3: Verificar tipos e build

Run: `npx tsc --noEmit -p .` — sem erros. Se o `any[]`/`any` do exemplo acima incomodar o revisor por perder tipagem, é aceitável apertar os tipos reaproveitando o `LinhaDetalhe` já exportado (ou exportando-o) de `MovimentosTab.tsx` — decisão do implementador, contanto que compile limpo.
Run: `npm run build` — build limpo.

### Passo 4: Teste manual

`npm run dev`, abra `/movimentacoes` com um produto que tenha movimentação, clique em "Colunas", desmarque "Quantidade" — a coluna some da tabela na hora, sem reload. Feche e reabra a página — a preferência deve persistir (mesma coluna continua escondida).

### Passo 5: Commit

```bash
git add components/movimentacoes/SeletorColunas.tsx components/movimentacoes/ListaMovimentos.tsx components/movimentacoes/MovimentosTab.tsx
git commit -m "feat: colunas customizáveis na tabela de Movimentos"
```

---

## Validação final (whole-branch)

1. `npx tsc --noEmit -p .` e `npm run build` limpos na branch inteira.
2. QA manual (Playwright, conta QA): abrir `/movimentacoes` com um produto real, testar a gaveta pros 4 tipos (OP com Reverter se houver uma concluída de teste — CUIDADO: reverter chama a Omie de verdade, só testar em loja/OP que possa ser revertida sem problema, ou pular esse clique específico e confirmar só que o botão aparece corretamente condicionado a `concluida && podeReverter`), testar o seletor de colunas escondendo/mostrando e recarregando a página pra confirmar persistência.
3. Deploy manual: SSH (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`), `cd /opt/ntb-estoque && bash deploy.sh` (rodar via `run_in_background: true`).
