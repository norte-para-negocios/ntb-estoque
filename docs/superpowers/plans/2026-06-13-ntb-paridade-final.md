# Paridade Final NTB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fechar o último gap de paridade com o Laravel (PDFs de contagem de inventário e transferência) e commitar o trabalho já feito (CRUD de loja, edição de usuário com permissões granulares, relatórios PDF de NF/OP).

**Architecture:** Mesma stack do projeto: rotas `GET` em `app/(app)/.../imprimir/route.ts` que buscam dados via Supabase server client, montam um componente `@react-pdf/renderer` e devolvem `application/pdf` inline. Componentes PDF em `components/relatorio/`.

**Tech Stack:** Next.js 16 App Router, Supabase, @react-pdf/renderer, Base UI.

---

## Varredura (resultado)

Comparação rota-a-rota Laravel × novo. Estado real:

| Gap Laravel | Novo | Status |
|---|---|---|
| Loja CRUD (`loja.store/update/destroy`) | `LojaForm.tsx`, `ExcluirLoja.tsx`, `loja.ts` | FEITO (a commitar) |
| Usuário edit + permissões/locais granulares | `EditarUsuario.tsx`, `usuario.ts` (togglePermissao/toggleLocal) | FEITO (a commitar) |
| Relatórios PDF NF/OP (`*.relatorio`) | `relatorio/route.ts` + `RelatorioNFPDF/RelatorioOPPDF` | FEITO (a commitar) |
| **PDF de contagem (`inventario.pdf`, `transfers.pdf`)** | — | **FALTA** |

Só o gap de PDF de contagem precisa de código novo.

---

### Task 1: PDF de contagem do Inventário

Replica `resources/views/inventario/pdf.blade.php`: cabeçalho (id, loja, data, local, tipo) + tabela (Código, Descrição, Unidade, Quantidade, Status).

**Files:**
- Create: `components/relatorio/ContagemInventarioPDF.tsx`
- Create: `app/(app)/inventario/[id]/imprimir/route.ts`
- Modify: `app/(app)/inventario/[id]/contagem/page.tsx` (link "Imprimir PDF")

- [ ] Step 1: componente PDF
- [ ] Step 2: rota `imprimir` (permissão `Inventarios - Ver`)
- [ ] Step 3: link na página de contagem
- [ ] Step 4: `npm run build`
- [ ] Step 5: commit

### Task 2: PDF de contagem da Transferência

Replica `resources/views/transfers/pdf.blade.php`: cabeçalho (loja, data, origem, destino) + tabela (Cód., Descrição, Unidade, Quantidade, Status).

**Files:**
- Create: `components/relatorio/ContagemTransferenciaPDF.tsx`
- Create: `app/(app)/transferencia/[id]/imprimir/route.ts`
- Modify: `app/(app)/transferencia/[id]/contagem/page.tsx` (link "Imprimir PDF")

- [ ] Step 1: componente PDF
- [ ] Step 2: rota `imprimir` (permissão `Transferencias - Ver`)
- [ ] Step 3: link na página de contagem
- [ ] Step 4: `npm run build`
- [ ] Step 5: commit + push
