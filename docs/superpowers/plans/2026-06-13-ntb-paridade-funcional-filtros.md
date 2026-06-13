# Paridade Funcional NTB — Filtros, Seleção e Etiqueta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans. Passos com checkbox (`- [ ]`).

**Goal:** Fechar os gaps FUNCIONAIS do novo sistema contra o Laravel original: corrigir a colisão QR×texto na etiqueta, dar seleção/impressão por item na nota fiscal, e implementar os filtros e recursos de busca que faltam em todas as telas.

**Architecture:** Filtros viram um componente cliente reutilizável (`Filtros`) que serializa campos em searchParams; cada page.tsx lê os params e aplica nas queries Supabase. Seleção de itens na NF usa estado client + rota de impressão que aceita lista de IDs. Etiqueta corrige larguras fixas e tamanho do QR. Sem libs novas, exceto `html5-qrcode` (opcional, fase QR scanner).

**Tech Stack:** Next.js 16, Base UI, Supabase, @react-pdf/renderer, lucide-react, design system existente (`components/ui-kit`).

---

## Varredura — gaps confirmados (original × novo)

| Área | Falta no novo |
|---|---|
| **Etiqueta** | QR (58pt) colide com texto da coluna esquerda (largura %; texto longo transborda) |
| **Nota Fiscal — itens** | imprimir por item individual; botões +/− na quantidade |
| **Filtro Produto** | família, tipo de item |
| **Filtro Nota Fiscal** | tipo (00-10,99), status (Pendente/Concluído), busca por produto |
| **Filtro Ordem Produção** | TODOS (data, tipo, nº OP, produto, concluído) |
| **Filtro Transferência** | TODOS (data início/fim, família, tipo) |
| **Filtro Inventário** | TODOS (data início/fim, família, tipo) |
| **Filtro Log** | datas, loja, request/response, HTTP code |
| **Busca Loja/Usuário** | não funciona |
| **Contagem (inv/transf)** | filtro produto/família/tipo; indicador visual "já adicionado"; QR scanner câmera; modal buscar-na-lista paginado |
| **Listagens** | status de sincronização visível (timestamp); duplicar inventário (modal data); imprimir na listagem; paginação |
| **Produto** | coluna Tipo de item; status de sync |

Constantes do Omie (já no original, `app/Helpers/Constants.php`): `PRODUTO_TIPO_ITEM` (00 Mercadoria p/ Revenda, 01 Matéria Prima, 02 Embalagem, 03 Produto em Processo, 04 Produto Acabado, 05 Subproduto, 06 Produto Intermediário, 07 Material de Uso e Consumo, 08 Ativo Imobilizado, 09 Serviços, 10 Outros Insumos, 99 Outras). Status NF: P/C. OP concluído: S/N.

---

## FASE 0 — Itens citados pelo usuário (prioridade máxima)

### Task 1: Corrigir colisão QR × texto na etiqueta

**Files:**
- Modify: `components/etiqueta/EtiquetaPDF.tsx`

Causa: `left` e `right` usam `width: '68%'/'32%'` sem `flexShrink: 0`; textos longos (descrição, fornecedor, CNPJ) empurram a largura e o conteúdo invade a coluna do QR. Além disso QR 58pt é grande para a coluna.

- [ ] **Step 1: Travar larguras e reduzir QR**

```tsx
const s = StyleSheet.create({
  page: { paddingTop: 3 * MM, paddingHorizontal: 3 * MM, fontSize: 8, color: '#000' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  left: { width: '64%', flexShrink: 0, flexGrow: 0, paddingRight: 6, overflow: 'hidden' },
  right: { width: '36%', flexShrink: 0, flexGrow: 0, alignItems: 'center', overflow: 'hidden' },
  descricao: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  campoRow: { flexDirection: 'row', marginBottom: 4 },
  campo: { flex: 1, minWidth: 0 },
  label: { fontSize: 6.5, color: '#000' },
  valor: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  linha: { fontSize: 7, marginBottom: 1.5 },
  qr: { width: 50, height: 50, marginBottom: 5 },
  logo: { width: 40, height: 'auto' },
})
```

- [ ] **Step 2: Garantir que textos não quebrem para fora** — adicionar `wrap={false}` nas linhas longas e manter os `.slice()` atuais. Em `descricao`, trocar `.slice(0,38)` por `.slice(0,40)` e adicionar `<Text style={s.descricao} wrap={false}>`. Nas `s.linha` de fornecedor/CNPJ, manter slice.

- [ ] **Step 3: Build + verificar PDF** — gerar uma etiqueta de teste e conferir que QR e logo ficam contidos na coluna direita sem sobrepor texto.

Run: `npm run build` → `✓ Compiled successfully`. Abrir `/nota-fiscal/{id}/imprimir` de uma NF com itens e quantidade.

- [ ] **Step 4: Commit**

```bash
git add components/etiqueta/EtiquetaPDF.tsx
git commit -m "fix(etiqueta): trava larguras das colunas e reduz QR para nao colidir com o texto"
```

### Task 2: Nota Fiscal — selecionar item e imprimir individual + botões +/−

**Files:**
- Modify: `app/(app)/nota-fiscal/[id]/imprimir/route.ts` (aceitar `?itens=ID,ID`)
- Modify: `components/nota-fiscal/QuantidadeInput.tsx` (botões +/−)
- Create: `components/nota-fiscal/ItensNotaFiscal.tsx` (client: seleção + impressão)
- Modify: `app/(app)/nota-fiscal/[id]/page.tsx` (usar o client de itens)

- [ ] **Step 1: Rota de impressão aceita subconjunto de itens.** Em `route.ts`, ler `const ids = searchParams.get('itens')` e, se presente, filtrar `.in('id', ids.split(',').map(Number))`; senão, comportamento atual (todos com quantidade > 0). Preservar toda a montagem da etiqueta/QR.

- [ ] **Step 2: `QuantidadeInput.tsx` ganha botões −/+** (mesma lógica de save onBlur já existente; os botões só incrementam/decrementam o valor e disparam o save).

```tsx
// dentro do componente, ao redor do input:
<div className="inline-flex items-center gap-1">
  <button type="button" onClick={() => ajustar(-1)} className="flex size-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-2">−</button>
  <input ...existente... className="w-16 text-center rounded-md border border-border bg-surface px-2 py-1 text-sm text-text" />
  <button type="button" onClick={() => ajustar(1)} className="flex size-7 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-2">+</button>
</div>
// ajustar(delta): novo = max(0, (valor||0)+delta); setValor(novo); salvar(novo)
```

- [ ] **Step 3: `ItensNotaFiscal.tsx`** (client) — recebe `notaId` e `itens[]`. Mantém um `Set` de IDs selecionados (checkbox por linha + "selecionar todos"). Cabeçalho com 2 ações: "Imprimir selecionados" (`/nota-fiscal/{id}/imprimir?itens=...`) habilitado só se houver seleção, e "Imprimir todos" (rota sem `itens`). Cada linha: checkbox + código + descrição + Qtd NFe + `QuantidadeInput` + botão "Imprimir" individual (`?itens={id}`). Renderiza dentro de `DataTable`.

- [ ] **Step 4: `page.tsx`** passa os itens para `<ItensNotaFiscal notaId={id} itens={itens ?? []} />` (mantém query atual).

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add "app/(app)/nota-fiscal" components/nota-fiscal
git commit -m "feat(nota-fiscal): selecao de itens para impressao individual + botoes +/- na quantidade"
```

---

## FASE 1 — Filtros nas listagens

### Task 3: Componente de filtros reutilizável

**Files:**
- Create: `components/ui-kit/Filtros.tsx`

Um client component genérico que recebe uma definição de campos e renderiza dentro de `Toolbar`, serializando em searchParams e fazendo `router.push`.

- [ ] **Step 1: Implementar**

```tsx
'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Toolbar } from './Toolbar'
import { btnClass } from './Button'

export type CampoFiltro =
  | { tipo: 'texto'; nome: string; label: string }
  | { tipo: 'data'; nome: string; label: string }
  | { tipo: 'select'; nome: string; label: string; opcoes: { value: string; label: string }[] }

export function Filtros({ basePath, campos, defaults }: { basePath: string; campos: CampoFiltro[]; defaults: Record<string, string> }) {
  const router = useRouter()
  const sp = useSearchParams()
  const field = 'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus:border-brand'
  const lab = 'mb-1 block text-[11px] font-medium text-text-muted'
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const params = new URLSearchParams(sp.toString())
    for (const c of campos) {
      const v = (form.get(c.nome) as string) ?? ''
      if (v) params.set(c.nome, v); else params.delete(c.nome)
    }
    router.push(`${basePath}?${params.toString()}`)
  }
  return (
    <Toolbar>
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-end gap-3">
        {campos.map((c) => (
          <div key={c.nome}>
            <label htmlFor={c.nome} className={lab}>{c.label}</label>
            {c.tipo === 'select' ? (
              <select id={c.nome} name={c.nome} defaultValue={defaults[c.nome] ?? ''} className={field}>
                <option value="">Todos</option>
                {c.opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input id={c.nome} name={c.nome} type={c.tipo === 'data' ? 'date' : 'text'} defaultValue={defaults[c.nome] ?? ''} className={field} />
            )}
          </div>
        ))}
        <button type="submit" className={btnClass('primary')}>Filtrar</button>
      </form>
    </Toolbar>
  )
}
```

- [ ] **Step 2: Constantes compartilhadas** — Create `lib/constants-omie.ts` exportando `PRODUTO_TIPO_ITEM` (array {value,label} com os 12 tipos acima) para reuso nos filtros.

- [ ] **Step 3: Commit**

```bash
git add components/ui-kit/Filtros.tsx lib/constants-omie.ts
git commit -m "feat(ui-kit): componente de filtros reutilizavel + constantes Omie"
```

### Task 4: Filtros em Ordem de Produção, Transferência e Inventário

**Files:**
- Modify: `app/(app)/ordem-producao/page.tsx`, `app/(app)/transferencia/page.tsx`, `app/(app)/inventario/page.tsx`

- [ ] **Step 1: OP** — aceitar searchParams `data_inicio, data_final, ordem_producao, op_produto, tipo_produto, op_concluido`. Renderizar `<Filtros basePath="/ordem-producao" campos={[data,data,texto nº OP, texto produto, select tipo (PRODUTO_TIPO_ITEM), select concluído(S/N)]} />`. Aplicar nas queries: datas em `data_previsao`/coluna de data da OP; `ilike` em num_ordem; `ilike` em produto código/descrição; igualdade no tipo; concluído conforme campo de status. Remover o `.limit(50)` fixo quando há filtro de data (ou manter limite + paginação na Task 8).

- [ ] **Step 2: Transferência** — params `data_inicio, data_final, familia, tipo`. `<Filtros>` com 2 datas + select família (carregar famílias distintas de `produtos.descricao_familia` na page, server) + select tipo. Aplicar nas queries respeitando o relacionamento movimentos→produtos.

- [ ] **Step 3: Inventário** — params `data_inicio, data_final, familia, tipo`. Mesmo padrão.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add "app/(app)/ordem-producao" "app/(app)/transferencia" "app/(app)/inventario"
git commit -m "feat(filtros): OP, transferencia e inventario com filtros do original"
```

### Task 5: Filtros em Nota Fiscal (completar) e Produto

**Files:**
- Modify: `components/nota-fiscal/NotaFiscalFiltros.tsx` (ou trocar por `Filtros`), `app/(app)/nota-fiscal/page.tsx`
- Modify: `app/(app)/produto/page.tsx`

- [ ] **Step 1: NF** — acrescentar `tipo` (select PRODUTO_TIPO_ITEM aplicado aos itens), `status` (select Pendente=etapa≠50 / Concluído=etapa=50), e busca por `produto` (ilike em itens `c_descricao_produto`/`c_codigo_produto` via subconsulta nos `nota_fiscal_items`). Manter datas/num/fornecedor.

- [ ] **Step 2: Produto** — acrescentar select `familia` (distinct de `descricao_familia`) e select `tipo` (PRODUTO_TIPO_ITEM) ao lado da busca textual existente. Aplicar `eq` em `descricao_familia` e `tipo_item`.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add "app/(app)/nota-fiscal" components/nota-fiscal "app/(app)/produto"
git commit -m "feat(filtros): NF (tipo/status/produto) e Produto (familia/tipo)"
```

### Task 6: Busca em Loja, Usuário e filtros de Log

**Files:**
- Modify: `app/(app)/loja/page.tsx`, `app/(app)/usuario/page.tsx`, `app/(app)/log/page.tsx`

- [ ] **Step 1: Loja e Usuário** — adicionar `<BuscaSimples>` (já existe) lendo `q` e aplicando `ilike` em nome/nome_fantasia (loja) e name (usuário).

- [ ] **Step 2: Log** — expandir filtros: `data_inicio, data_final` (datetime), `loja_id` (select das lojas), `model` (select distinct), `code` (texto/number HTTP), `status` (erro/ok). Usar `<Filtros>` com esses campos e aplicar nas queries de `integration_attempts`.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add "app/(app)/loja" "app/(app)/usuario" "app/(app)/log"
git commit -m "feat(filtros): busca em loja/usuario e filtros completos de log"
```

---

## FASE 2 — Contagem (inventário/transferência)

### Task 7: Filtros, indicador "já adicionado" e modal buscar-na-lista

**Files:**
- Modify: `components/inventario/ContagemInventario.tsx`, `components/transferencia/ContagemTransferencia.tsx`
- Modify: `components/ProdutoSearch.tsx` (ou equivalente de busca de produto)
- Create: `components/contagem/BuscarNaLista.tsx` (modal paginado)

- [ ] **Step 1: Indicador visual** — no dropdown de busca de produto, marcar com ✔ (e desabilitar) os produtos cujo `codigo_produto` já está na contagem (comparar com a lista de itens atual). Hoje só há toast ao tentar duplicar.

- [ ] **Step 2: Filtros na contagem** — barra com busca por texto (existe) + select família + select tipo, filtrando a lista de itens exibida (client-side sobre os itens já carregados) e também passando à busca de novos produtos.

- [ ] **Step 3: Modal "Buscar na lista"** — `BuscarNaLista.tsx` (Dialog Base UI) com tabela paginada de produtos (server action paginada, 50/página), filtros por descrição/família/tipo, e botão "+" por linha que adiciona à contagem (reusa a action de adicionar). Indicar os já adicionados.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add components/inventario components/transferencia components/ProdutoSearch.tsx components/contagem
git commit -m "feat(contagem): filtros, indicador de ja adicionado e modal buscar-na-lista paginado"
```

### Task 8: Leitura de QR Code por câmera (scanner)

**Files:**
- Create: `components/contagem/QrScanner.tsx`
- Modify: `components/inventario/ContagemInventario.tsx`, `components/transferencia/ContagemTransferencia.tsx`
- Modify: `package.json` (dependência `html5-qrcode`)

- [ ] **Step 1: Instalar** `npm i html5-qrcode`. Criar `QrScanner.tsx` (client, dynamic import, `ssr:false`) com botões "Ler QR Code" / "Parar" e callback `onLeitura(codigo)` que busca o produto por código e adiciona à contagem. Tratar permissão de câmera com mensagem clara.

- [ ] **Step 2: Integrar** nas duas telas de contagem, ao lado da busca.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add components/contagem package.json package-lock.json components/inventario components/transferencia
git commit -m "feat(contagem): leitura de produto por QR code com a camera"
```

---

## FASE 3 — Recursos de listagem

### Task 9: Status de sincronização visível + coluna Tipo no Produto

**Files:**
- Modify: `app/(app)/produto/page.tsx`, `app/(app)/local-estoque/page.tsx`

- [ ] **Step 1:** Exibir, abaixo do título, "Atualizado em {timestamp} · {status}" lendo os campos `*_ultima_atualizacao`/`*_status` da loja (como o original). Adicionar coluna "Tipo" no produto (label via PRODUTO_TIPO_ITEM a partir de `tipo_item`).

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add "app/(app)/produto" "app/(app)/local-estoque"
git commit -m "feat(produto/local): status de sincronizacao visivel e coluna Tipo"
```

### Task 10: Paginação nas listagens

**Files:**
- Create: `components/ui-kit/Paginacao.tsx`
- Modify: listagens com volume (nota-fiscal, ordem-producao, produto, transferencia, inventario, log)

- [ ] **Step 1:** `Paginacao.tsx` lê `page` em searchParams e renderiza anterior/próxima + indicador. Nas pages, trocar `.limit(N)` por `.range((page-1)*N, page*N-1)` e contar total para habilitar/desabilitar próxima.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add components/ui-kit/Paginacao.tsx "app/(app)"
git commit -m "feat(listagens): paginacao real no lugar de limite fixo"
```

---

## Self-Review

**Cobertura:** etiqueta QR (T1), seleção/impressão NF (T2), filtros OP/transf/inv (T4), NF/produto (T5), loja/usuário/log (T6), contagem filtros+indicador+modal (T7), QR scanner (T8), status sync+tipo (T9), paginação (T10). Todos os gaps da varredura têm tarefa.

**Restrições preservadas:** nenhuma mudança em valores de status do banco (sem acento); server actions/permissões intactas; nunca acionar escrita Omie em teste (finalizar inventário/transferência só com Ramon); sem travessão; acentuação correta. Filtros e impressão são leitura — seguros.

**Tipos/consistência:** `Filtros`/`CampoFiltro` (T3) reusados em T4-T6; `PRODUTO_TIPO_ITEM` (T3) usado em T4/T5/T9; rota de impressão por `itens` (T2) consumida pelo `ItensNotaFiscal` (T2).

**Prioridade sugerida de execução:** Fase 0 (citada pelo usuário) → Fase 1 (filtros, maior valor) → Fase 2 (contagem) → Fase 3 (refino).
