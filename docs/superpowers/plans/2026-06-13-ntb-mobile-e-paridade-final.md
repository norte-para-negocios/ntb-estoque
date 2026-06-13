# Mobile + Paridade Final NTB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Passos com checkbox.

**Goal:** Fazer o sistema funcionar bem no celular (tabelas viram cards, sem scroll lateral), fechar o último gap de paridade (relatório PDF de transferências) e verificar/garantir o que não foi testado (QR scanner, fluxos de criação).

**Architecture:** Um componente `Lista` data-driven (colunas + linhas) que renderiza TABELA em desktop (≥lg) e CARDS empilhados no mobile, a partir da mesma definição — elimina o scroll horizontal de vez e é DRY. As listagens migram para ele. Relatório de transferência reusa o padrão dos relatórios existentes. Verificação via deploy real.

**Tech Stack:** Next.js 16, Supabase, @react-pdf/renderer, design system existente.

**Varredura de paridade (confirmada no código, não no relatório bruto):** falsos positivos descartados — local-estoque já tem sync manual, NovaTransferencia/NovoInventario já existem, validação origem≠destino já existe, QR em etiqueta já corrigido, histórico de impressão já existe. **Gap real único:** relatório PDF de transferências.

---

## FASE 1 — Mobile: listagens viram cards (prioridade)

### Task 1: Componente `Lista` responsivo (tabela desktop / cards mobile)

**Files:**
- Create: `components/ui-kit/Lista.tsx`

- [ ] **Step 1: Implementar** — data-driven, tipado por genérico.

```tsx
import * as React from 'react'

export type Coluna<T> = {
  label: string
  render: (row: T) => React.ReactNode
  alinhar?: 'right'
  primaria?: boolean        // vira o título do card no mobile
  ocultarMobile?: boolean   // não aparece no card
  larguraDesktop?: string   // classe tailwind opcional p/ <th> (ex.: 'w-28')
}

export function Lista<T>({
  colunas,
  linhas,
  chaveLinha,
  acao,
  vazio,
}: {
  colunas: Coluna<T>[]
  linhas: T[]
  chaveLinha: (row: T) => string | number
  acao?: (row: T) => React.ReactNode
  vazio?: React.ReactNode
}) {
  if (!linhas.length) return <>{vazio}</>
  const primaria = colunas.find((c) => c.primaria) ?? colunas[0]
  const demais = colunas.filter((c) => c !== primaria && !c.ocultarMobile)
  return (
    <>
      {/* Desktop: tabela */}
      <div className="hidden lg:block overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-border bg-surface-2/50">
            <tr>
              {colunas.map((c, i) => (
                <th key={i} className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted ${c.alinhar === 'right' ? 'text-right' : 'text-left'} ${c.larguraDesktop ?? ''}`}>
                  {c.label}
                </th>
              ))}
              {acao && <th className="px-4 py-2.5 w-24" />}
            </tr>
          </thead>
          <tbody>
            {linhas.map((row) => (
              <tr key={chaveLinha(row)} className="border-b border-border/60 last:border-0 transition-colors hover:bg-surface-2/40">
                {colunas.map((c, i) => (
                  <td key={i} className={`px-4 py-2.5 ${c.alinhar === 'right' ? 'text-right' : ''} truncate`}>
                    {c.render(row)}
                  </td>
                ))}
                {acao && <td className="px-4 py-2.5 text-right whitespace-nowrap">{acao(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards empilhados */}
      <div className="lg:hidden space-y-3">
        {linhas.map((row) => (
          <div key={chaveLinha(row)} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-semibold text-text">{primaria.render(row)}</div>
              {acao && <div className="shrink-0">{acao(row)}</div>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {demais.map((c, i) => (
                <div key={i} className={c.alinhar === 'right' ? 'text-right' : ''}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{c.label}</dt>
                  <dd className="text-sm text-text truncate">{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ui-kit/Lista.tsx
git commit -m "feat(ui-kit): componente Lista responsivo (tabela desktop / cards mobile)"
```

### Task 2: Migrar listagens para `Lista`

**Files (migrar a renderização da tabela, mantendo queries/filtros/ações):**
- Modify: `app/(app)/nota-fiscal/page.tsx`, `ordem-producao/page.tsx` (+ OrdemProducaoRow), `produto/page.tsx`, `transferencia/page.tsx`, `inventario/page.tsx`, `validade/page.tsx`, `impressoes/page.tsx`, `sync-status/page.tsx`, `log/page.tsx`, `local-estoque/page.tsx`, `nota-fiscal/[id]/page.tsx` (ItensNotaFiscal)

- [ ] **Step 1:** Para cada listagem, substituir o `<DataTable>...<thead><tbody></DataTable>` por `<Lista colunas={...} linhas={...} chaveLinha acao vazio={<EmptyState/>} />`, definindo a coluna `primaria` (o identificador mais importante: fornecedor na NF, produto na OP, descrição no produto, etc). Não alterar nenhuma query, filtro, permissão ou ação. Componentes client com linhas interativas (OrdemProducaoRow com steppers, ItensNotaFiscal com checkbox) podem manter tabela própria mas com layout mobile que não estoure (empilhar controles); priorizar que NADA gere scroll horizontal no mobile.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add "app/(app)" components
git commit -m "feat(mobile): listagens viram cards no celular via componente Lista"
```

---

## FASE 2 — Relatório PDF de Transferências

### Task 3: Relatório de transferências

**Files:**
- Create: `components/relatorio/RelatorioTransferenciaPDF.tsx`
- Create: `app/(app)/transferencia/relatorio/route.ts`
- Modify: `app/(app)/transferencia/page.tsx` (botão "Relatório PDF" no header, preservando filtros)

- [ ] **Step 1: Componente PDF** — espelhar `RelatorioNFPDF`/`RelatorioOPPDF` (mesmo estilo): título "Relatório de Transferências", loja, período; tabela com colunas Data, Origem, Destino, Produtos (contagem), Status.

- [ ] **Step 2: Rota** — repete a query/filtros da listagem de transferência (data/família/tipo), gera o PDF, devolve inline. Escopo `getCurrentLojaId` + `requirePermissao('Transferencias - Ver')`.

- [ ] **Step 3: Botão** no header da página de transferência (como nas outras), preservando os searchParams.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add components/relatorio/RelatorioTransferenciaPDF.tsx "app/(app)/transferencia"
git commit -m "feat(transferencia): relatorio PDF (paridade com o original)"
```

---

## FASE 3 — Verificação funcional do que não foi testado

### Task 4: Verificar e corrigir fluxos não testados

- [ ] **Step 1: QR scanner na contagem** — abrir `/inventario` no deploy, criar/abrir uma contagem, clicar "Ler QR Code". Verificar: pede permissão de câmera, abre o preview, e se a câmera não existir (desktop) mostra mensagem clara em vez de quebrar. Corrigir o componente `QrScanner.tsx` se travar/erro de import dinâmico.

- [ ] **Step 2: Fluxo de criação** — testar "Nova transferência" e "Novo inventário" no deploy: abrir modal, escolher local(is), salvar, e confirmar que redireciona para a contagem. Verificar a validação origem≠destino aparece como toast. Corrigir o que estiver quebrado.

- [ ] **Step 3: Mobile geral** — no deploy a 390px, navegar por home, NF, OP, inventário, contagem: confirmar que nada tem scroll horizontal e que os controles (steppers, botões) são tocáveis. Ajustar o que estourar.

- [ ] **Step 4: Commit de quaisquer correções**

```bash
npm run build
git add -A && git commit -m "fix(verificacao): ajustes de QR scanner / criacao / mobile apos teste real"
```

---

## Self-Review

**Cobertura:** mobile (T1-T2, foco do usuário), relatório de transferência (T3, único gap real), verificação funcional incl. QR scanner (T4). Falsos positivos do relatório bruto descartados (sync manual, criação, validação já existem).

**Não quebra o fluxo:** `Lista` é aditivo; a migração troca só a renderização, preservando queries/filtros/ações/permissões. Relatório é rota nova + botão. Verificação só corrige o que estiver quebrado.

**Restrições:** status do banco sem acento; sem travessão; acentuação correta; nunca acionar escrita Omie/finalizar em teste; mobile sem scroll horizontal é o critério de aceite.

**Tipos:** `Coluna<T>`/`Lista` (T1) reusados em todas as listagens (T2); `RelatorioTransferenciaPDF` (T3) segue a assinatura dos relatórios existentes.
