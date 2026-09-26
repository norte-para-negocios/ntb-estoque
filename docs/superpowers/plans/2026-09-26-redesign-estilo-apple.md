# Redesign "estilo Apple" do NTB Estoque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao NTB Estoque inteiro a linguagem visual do NTB Vendas (estilo Apple), sem mudar funcionalidade.

**Architecture:** O Estoque já é todo por tokens (`app/globals.css`) e kit central (`components/ui-kit/*`, `components/ui/*`, `components/shell/*`), então a Fase 1 (tokens + fonte + kit + casca) entrega ~70% do efeito. As fases 2–4 são varreduras por grupo de telas (CAIXA ALTA, cartões com borda, cores cruas, barras que estouram no celular). A Fase 5 traz o movimento (`motion/react`) e fecha o tema escuro. Sem suíte de testes: cada tarefa é verificada por `npx tsc --noEmit`, `npm run build` e prints Playwright em produção comparados ao "antes".

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (tokens via CSS vars; escuro por `.dark` no `<html>`), lucide-react, sonner, `motion` (novo).

**Spec:** `docs/superpowers/specs/2026-09-26-redesign-estilo-apple-design.md` (referência: `ntb vendas/docs/superpowers/specs/2026-09-26-redesign-estilo-apple-design.md`).

## Global Constraints
- Nenhuma mudança de comportamento, dado, rota, permissão, ordem ou posição de elementos. Exceções permitidas: CAIXA ALTA → frase normal; acento faltando em rótulo ("Relatorios" → "Relatórios"); subtítulo genérico removido; quadradinho de ícone do título removido.
- Nunca escrever no Omie nem em dado durante testes: só navegar e fotografar. Conta `claude.qa@ntb-estoque.dev` (loja de teste 12); senha só em arquivo lido pelo script e apagado no fim.
- Cor sempre por token; tema escuro só via tokens em `.dark` (remover os 16 `dark:` existentes).
- Fonte: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`. Números com `tabular-nums` na mesma fonte. `font-mono` só em código (chave de NF, JSON/XML de log).
- NÃO tocar em PDF/impressão: `components/etiqueta/*PDF.tsx`, `components/relatorio/*PDF.tsx`, `components/relatorio/PdfChrome.tsx`, `components/minha-loja/EtiquetaEditor.tsx`.
- Celular: toque ≥ 44px onde já era; inputs ≥ 16px no celular (evita zoom do iOS).
- Não usar a skill `apple-design`.
- Cada tarefa termina com: `npx tsc --noEmit` + `npm run build` limpos, commit (rodapé `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`), `git push`, deploy `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, prints em produção `~/ClaudeGerado/ntb-estoque-redesign-depois/etapaN/` e comparação com o "antes".

## Review Focus
1. Tema escuro: todo token novo tem par em `.dark`; texto branco do menu azul continua legível no escuro (menu escuro = `#23256b→#16174a`, igual ao Vendas).
2. Cores cruas que sobrevivem (`bg-[#…]`, `text-white` sobre superfície que ficou clara, `bg-brand/10` que virou roxo) — grep após cada tarefa.
3. PDFs/impressão intactos: `git diff --stat` de cada tarefa não pode listar os arquivos da lista de exclusão.
4. Tabelas largas no celular: continuam com rolagem horizontal (não cortar colunas com `overflow-hidden`).
5. `thead` fixo (`--lista-header-h`, `ListaHeader`) continua grudando no lugar certo depois da troca de alturas do cabeçalho.

---

## Fase 1 — Fundação

### Task 1: Tokens, fonte, utilitários, motion
**Files:** `app/layout.tsx`, `app/globals.css`, `package.json`, Create `lib/motion.ts`

- [ ] **Step 1:** `app/layout.tsx`: remover `Plus_Jakarta_Sans`/`JetBrains_Mono` e as classes de variável no `<html>`; `viewport.themeColor` → `#484DB5`.
- [ ] **Step 2:** `app/globals.css` `@theme inline`: `--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;` e `--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;`. Adicionar `--color-brand-strong: var(--brand-strong);`.
- [ ] **Step 3:** `:root`:
```css
--bg: #f5f5f7; --surface: #ffffff; --surface-2: #f2f2f7;
--text: #1d1d1f; --text-muted: #6e6e73; --border: rgba(60, 60, 67, 0.14);
--brand: #484DB5; --brand-strong: #3A3E91; --brand-soft: #eceefb;
--ok: #248a3d; --warn: #b25000; --err: #d70015; --info: #0066cc;
--ink: #1E1B4B; --sidebar-bg: #484DB5; --sidebar-bg-2: #3A3E91;
--r-sm: 0.5rem; --r-md: 0.75rem; --r-lg: 1.125rem; --r-xl: 1.375rem; --radius: 0.75rem;
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 2px 12px rgba(0,0,0,0.04);
--shadow-md: 0 4px 24px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05);
--press: 0.97;
```
(`--series-*` dos gráficos ficam.)
- [ ] **Step 4:** `.dark`:
```css
--bg: #000000; --surface: #1c1c1e; --surface-2: #2c2c2e;
--text: #f5f5f7; --text-muted: #98989d; --border: rgba(84, 84, 88, 0.45);
--brand: #8b90ea; --brand-strong: #a6aaf0; --brand-soft: rgba(139, 144, 234, 0.18);
--ok: #30d158; --warn: #ffb340; --err: #ff6961; --info: #409cff;
--sidebar-bg: #23256b; --sidebar-bg-2: #16174a;
--shadow-sm: 0 1px 2px rgba(0,0,0,0.5); --shadow-md: 0 8px 28px rgba(0,0,0,0.55);
```
- [ ] **Step 5:** base: `body` 15px, `letter-spacing: -0.005em`; `.num { font-family: inherit; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }`; `.eyebrow { font-size: 13px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--text-muted); }`; nova `.sidebar-blue { background: linear-gradient(180deg, var(--sidebar-bg), var(--sidebar-bg-2)); color: #fff; }`; `.u-card` sem borda (sombra `--shadow-sm`, hover `--shadow-md`).
- [ ] **Step 6:** `npm i motion`; `lib/motion.ts`:
```ts
// Molas do redesign estilo Apple (mesmos valores do NTB Vendas).
export const SPRING_UI = { type: 'spring' as const, bounce: 0, duration: 0.35 }
export const SPRING_TAP = { type: 'spring' as const, bounce: 0, duration: 0.15 }
export const SPRING_SHEET = { type: 'spring' as const, bounce: 0.18, duration: 0.4 }
```
- [ ] **Step 7:** Único `font-mono` fora de código → `num`. tsc/build; commit "Fundação estilo Apple: fonte do sistema, tokens e números sem monoespaçada".

### Task 2: Kit de componentes
**Files:** `components/ui-kit/{Button,PageHeader,StatCard,EmptyState,StatusPill,SegmentLinks,ChipsPeriodo,ChipsStatus,ChipsFiltrosAtivos,Lista,DataTable,Toolbar,Filtros,FiltrosGaveta,Paginacao,Combobox,MultiSelect,DetailHeader}.tsx`, `components/ui/{dialog,sheet,input,select,button,badge,sonner}.tsx`, `lib/status-cor.ts`, Create `components/ui-kit/SegmentedControl.tsx`, Create `components/ui-kit/form-classes.ts`

- [ ] **Step 1: Botões** — `btnClass`: `rounded-full font-semibold h-[38px] px-4 text-[15px] max-sm:h-11`; `primary` sem sombra; `outline` → preenchido `bg-surface-2 hover:bg-[var(--border)]` sem borda; `ghost` igual; `danger` mantém. `btnLinhaClass` circular `size-8`. `u-press` = scale `var(--press)`.
- [ ] **Step 2: Inputs** — `form-classes.ts` exporta `inputClass = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 h-[38px] px-3 text-[15px] max-sm:text-base max-sm:h-11 text-text placeholder:text-text-muted/70 outline-none focus:ring-2 focus:ring-brand/40'` e `labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'`; `components/ui/input.tsx`/`select.tsx` no mesmo padrão (sem `dark:`). Cada tela que declara `const inputClass` local passa a importar (varrido nas fases 2–4).
- [ ] **Step 3: PageHeader/DetailHeader** — título `text-[30px] max-sm:text-[26px] font-bold tracking-[-0.02em]`; prop `icon` continua aceita mas não renderiza; `description` em 15px cinza (sem esconder no celular); voltar = botão circular 32px `bg-surface-2`.
- [ ] **Step 4: StatCard** — sem borda e sem faixa; sombra `--shadow-sm`, raio `--r-lg`; ícone em cinza sem quadrado tingido; valor `text-[28px] font-semibold num`; `accent` aceito e ignorado.
- [ ] **Step 5: EmptyState** — sem borda tracejada e sem fundo: ícone 40px `text-text-muted/50`, título 17px, dica 13px.
- [ ] **Step 6: Status** — `StatusPill` vira `inline-flex items-center gap-1.5 text-[13px] text-text` + ponto `size-2 rounded-full` na cor (`FUNDO_CLASSE[token]`), `u-pulse-dot` mantido pros "vivos"; `SELO_CLASSE` passa a ser ponto+texto (quem usa selo: revisar nas fases).
- [ ] **Step 7: SegmentedControl** — novo componente (copiar do Vendas `components/ui.tsx`, trocando `var(--…)` por utilitários do Estoque), `motion.span layoutId` com `SPRING_UI`. `SegmentLinks` passa a renderizar com ele (mesma API). `ChipsPeriodo`/`ChipsStatus`: pílulas `h-8 px-3.5 bg-surface-2`, ativa `bg-brand text-white`, rolagem horizontal com máscara de fade nas pontas no celular.
- [ ] **Step 8: Tabelas** — `Lista`/`DataTable`: `th` `text-[13px] font-semibold text-text-muted normal-case tracking-normal` sem fundo, `border-b border-border`; linhas `border-b border-border/60 hover:bg-surface-2/60`; números `text-right num`; contêiner cartão sem borda (`bg-surface rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]`), `overflow-x-auto` preservado.
- [ ] **Step 9: Janelas** — `dialog.tsx`: raio 22, sem borda, overlay `bg-black/30 backdrop-blur-sm`, título 17px semibold, fechar circular 32px `bg-surface-2`; `sheet.tsx` lado `bottom` com `rounded-t-[22px]` + alça. `sonner.tsx`: `position="top-center"`, toasts pílula-cartão (raio 18, sombra md, sem borda); remover `richColors` do layout (ícone colorido, texto neutro).
- [ ] **Step 10:** remover `dark:` de `components/ui/*`. tsc/build; commit "Componentes base estilo Apple + SegmentedControl".

### Task 3: Casca (menu azul, topo, celular)
**Files:** `components/shell/{Sidebar,MobileNav,AppShell,BuscaGlobal,ThemeToggle,UserMenu}.tsx`, `components/loja/LojaSelector.tsx`

- [ ] **Step 1: Sidebar** — `aside` com `sidebar-blue` (sem `border-r`), `h-screen sticky`; logo em branco (`brightness-0 invert` via classe fixa, sem `dark:`); seletor de loja pílula `bg-white/12 text-white`; grupos em frase normal (`text-[13px] font-semibold text-white/60`, sem `uppercase`); item `h-9 rounded-[10px] text-white/80 hover:bg-white/10`; ativo `bg-white/[0.18] text-white font-semibold` com `motion.div layoutId="nav-ativo"` (`SPRING_UI`); rodapé (usuário, tema, sair) em `text-white/70`.
- [ ] **Step 2: MobileNav** — barra superior clara translúcida (`bg-surface/85 backdrop-blur-xl border-b border-border`), gaveta com o mesmo azul do menu; tab bar inferior (se houver) `bg-surface/85 backdrop-blur-xl`, ativo `text-brand`.
- [ ] **Step 3: Topo (AppShell)** — busca vira pílula `h-9 bg-surface-2` sem borda; no celular, ícone circular dentro da barra superior (não uma linha inteira sozinha); transição de página existente mantida.
- [ ] **Step 4:** grep `text-white\|bg-white/` nos arquivos tocados; tsc/build; commit "Casca estilo Apple: menu azul, topo limpo"; push; deploy; **prints etapa1** (todas as telas desktop+mobile) + comparação.

## Fase 2 — Telas do dia a dia
Em cada tarefa, varrer os arquivos listados com:
`grep -n "uppercase\|tracking-wider\|border border-border\|border-dashed\|rounded-md\|bg-brand/10\|const inputClass\|text-\[11px\]" <arquivos>` e aplicar: CAIXA ALTA → frase normal (`eyebrow`); cartão com borda → `bg-surface rounded-[var(--r-lg)] shadow-[var(--shadow-sm)]`; `inputClass` local → import de `form-classes`; selos coloridos → `StatusPill`; grupos de visão → `SegmentedControl`; barras que estouram no celular → rolagem horizontal em linha única (sem mudar ordem dos botões) ou ações secundárias num `⋯` que abre as MESMAS ações (sem remover nenhuma).

### Task 4: Início e Resumo operacional
**Files:** `app/(app)/home/page.tsx`, `components/home/*`, `app/(app)/resumo/page.tsx`, `components/resumo/*`
- [ ] Hero da home: cartão da marca (superfície azul `sidebar-blue`, raio 22) no lugar do preto; sem sublinhado; selo de sync como ponto + texto. Seções em frase normal; "Precisa de atenção" como lista agrupada (um cartão, separadores finos); barras dos Top 10 em `--brand`; números `num` sem mono. Resumo: cartão ativo com anel `ring-2 ring-brand` em vez de tingido; "Precisa de ação" em lista neutra com ícone `--warn`.
- [ ] tsc/build; commit; push; deploy; prints etapa2/home+resumo.

### Task 5: Produtos (lista, novo, substituição)
**Files:** `app/(app)/produto/**`, `components/produtos/*`, `app/(app)/produto-substituicao/page.tsx`, `components/produto-substituicao/*`
- [ ] Barra de ações em uma linha (desktop) e rolagem horizontal no celular; Preços/Compras no `SegmentedControl`; "Margem alvo" em frase normal com input preenchido; seções do formulário (Tipo do produto, Identificação, Fiscal) em frase normal; rodapé fixo do formulário `bg-surface/85 backdrop-blur`.
- [ ] tsc/build; commit; push; deploy; prints.

### Task 6: Movimentações
**Files:** `app/(app)/movimentacoes/page.tsx`, `components/movimentacoes/*`, `components/movimentacao/*`
- [ ] Histórico/Movimentos, Por mês/Por data, Tudo/Entradas/Saídas → `SegmentedControl`; busca preenchida sem mono; avisos em cartão neutro com ícone `--warn` (não caixa com borda); detalhe (`Detalhe*`) sem CAIXA ALTA.
- [ ] tsc/build; commit; push; deploy; prints.

### Task 7: Inventário e Transferência (listas + contagem)
**Files:** `app/(app)/inventario/**`, `components/inventario/*`, `app/(app)/transferencia/**`, `components/transferencia/*`, `components/contagem/*`
- [ ] Linhas da contagem em lista estilo Ajustes (bloco branco, separador fino), stepper −/+ circular 44px no celular, campo de quantidade preenchido; barra "Concluir" fixa translúcida; status por ponto. Nada de mudança na lógica de envio.
- [ ] tsc/build; commit; push; deploy; prints (contagem via loja 6 somente leitura, voltando a conta QA pra loja 12 no fim).

### Task 8: Ordens de produção (lista, detalhe, nova)
**Files:** `app/(app)/ordem-producao/**`, `components/ordem-producao/*`
- [ ] Título não quebra (barra de ações passa pra linha própria abaixo do título no desktop estreito); selo "NTB VENDAS · HOMOLOG." vira texto 12px cinza com ponto `--warn` numa linha; chips de período com fade nas pontas; datas `num`; steppers da linha em pílula `surface-2`; disclaimers técnicos longos do detalhe em `text-[13px] text-text-muted` recolhidos num "Detalhes técnicos" (mesmo texto, só recolhido).
- [ ] tsc/build; commit; push; deploy; prints.

### Task 9: Notas fiscais, Validade, Impressões
**Files:** `app/(app)/nota-fiscal/**`, `components/nota-fiscal/*`, `app/(app)/validade/page.tsx`, `app/(app)/impressoes/page.tsx`, `components/etiqueta/*` (exceto `*PDF.tsx`)
- [ ] Chave de acesso continua `font-mono` (código); CNPJ/datas/valores `num`; itens em tabela nova; status por ponto.
- [ ] tsc/build; commit; push; deploy; prints etapa2 completa + comparação.

## Fase 3 — Cadastros

### Task 10: Loja, Minha loja, Fornecedor, Família, Locais, Usuários, Cargos, Categorias contábeis, Pendências
**Files:** `app/(app)/{loja,minha-loja,fornecedor,familia,local-estoque,usuario,cargo,categoria-contabil,pendencias-classificacao}/**`, `components/{loja,minha-loja,fornecedor,familia,local-estoque,usuario,cargo,categoria-contabil,parceiro}/*` (exceto `EtiquetaEditor.tsx`)
- [ ] Cartões de loja/usuário sem borda (grade com sombra leve); Minha loja sem cartão dentro de cartão (seções agrupadas estilo Ajustes); inputs preenchidos; perfis de usuário como texto + ponto; "Novo cargo" dentro do cabeçalho (mesmo botão, mesma ação — só alinhamento visual); botões "Puxar do Omie" como `outline` pílula.
- [ ] tsc/build; commit; push; deploy; prints etapa3 + comparação.

## Fase 4 — Relatórios e entrada

### Task 11: Relatórios
**Files:** `app/(app)/relatorios/page.tsx`, `app/(app)/relatorio-*/**`, `components/relatorio/*` (exceto PDF), `components/{faturamento,margem,producao}/*`
- [ ] Hub: cartões sem borda, acentos corrigidos nos rótulos; KPIs com `StatCard` novo; tabelas no padrão novo com rolagem horizontal visível no celular e coluna total sem corte no desktop (`min-w` da tabela, não `overflow-hidden`); coluna de margem com uma cor só por sinal (negativo `--err`, resto `--text`); gráfico de produção na paleta `--series-*`/marca; filtros em `SegmentedControl` + chips.
- [ ] tsc/build; commit; push; deploy; prints.

### Task 12: Administração e entrada
**Files:** `app/(app)/{sintegra,auditoria,auditoria-fiscal,log,sync-status,saude-banco,estoque-local-teste}/**`, `components/{sintegra,log,sync,ajustes-omie}/*`, `app/(auth)/**`
- [ ] Saúde do banco e Sincronização sem faixas coloridas; grade de status em ponto + texto; log com JSON em mono (código) e resto `num`; login/cadastro/aguardando em cartão branco raio 22 sobre `--bg`, inputs preenchidos, botão pílula, logo sem `dark:`.
- [ ] tsc/build; commit; push; deploy; prints etapa4 + comparação.

## Fase 5 — Movimento, tema escuro, fechamento

### Task 13: Movimento
**Files:** `lib/motion.ts`, `app/layout.tsx` (`MotionConfig reducedMotion="user"` num provider client), `components/ui-kit/{Button,CountUp,Lista,SegmentedControl}.tsx`, `components/ui/{dialog,sheet,sonner}.tsx`, `components/shell/{Sidebar,MobileNav,AppShell}.tsx`
- [ ] Press 0.97 em botões/cartões (sem crescer no hover); pílula do menu deslizando (feito na Task 3, conferir); troca de página: fade + 8px (220ms entra / 120ms sai); diálogo: `scale .96→1` + fade com `SPRING_UI`; folha no celular sobe de baixo com `SPRING_SHEET` e arrasta pra fechar (`drag="y"`, fecha se `offset.y > 120` ou `velocity.y > 500`); toasts entram de cima; `CountUp` usa `animate()` do motion (300–600ms) nos resumos/KPIs; listas com `AnimatePresence` + `layout` em entrada/saída de item (contagem, OPs). Tudo vira fade simples com movimento reduzido.
- [ ] tsc/build; commit; push; deploy; GIFs curtos (troca de página, abrir diálogo, folha no celular) em `~/ClaudeGerado/ntb-estoque-redesign-depois/etapa5/`.

### Task 14: Varredura do tema escuro e prints finais
- [ ] Prints de todas as telas em escuro (`localStorage.tema='dark'`); corrigir contraste < 4.5:1 e cores cruas.
- [ ] `grep -rn "uppercase\|dark:\|bg-\[#\|text-\[#\|border-dashed" app components --include=*.tsx` (fora da lista de exclusão) → zerar ou justificar.
- [ ] Prints "depois" completos claro + escuro; tsc/build; commit; push; deploy.

### Task 15: Revisão independente
- [ ] Agente com contexto novo (modelo mais capaz) recebe a spec, este plano e as pastas antes/depois; procura telas esquecidas, contraste ruim, quebra no celular e no escuro, e mudança de comportamento acidental no diff. Corrigir Critical/Important numa rodada; deploy; prints.
