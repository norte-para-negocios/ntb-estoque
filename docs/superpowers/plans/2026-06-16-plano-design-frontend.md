# Plano de melhoria do front-end / design — NTB Estoque (16/06/2026)

> Auditoria feita com a skill `redesign-existing-projects`. Conclusão: a base é
> sólida. Isto é um plano de **refino**, não de reforma. Stack: Next 16 + Tailwind v4.

## Diagnóstico — o que JÁ está bom (manter)
- **Design system real**: tokens em `globals.css` (bg/surface/surface-2/text/text-muted/border/brand + semânticas ok/warn/err/info), raios e sombras escalonados, `--ease` próprio.
- **Cores**: acento ÚNICO (teal `#2eb5c3`), cinzas slate frios consistentes, dark mode dedicado (não `#000`, sombras tintadas). Evita os "AI tells".
- **Fonte com caráter**: Plus Jakarta Sans (400/500/600/700) + JetBrains Mono nos números (`.num` tabular). Não é Inter.
- **Estados**: `loading.tsx` (skeleton de navegação — recém-adicionado), `EmptyState`, hover/active nos botões, transições com easing.
- **Infra**: PWA (manifest), anti-flash de tema, Toaster.

## Onde melhorar — priorizado por impacto × esforço

### 1. Performance percebida — ALTO impacto (em andamento)
- [x] `loading.tsx` global (skeleton ao navegar).
- [ ] Tela de **Produtos** é a mais pesada (produtos + posição em lotes + previsão numa request) — paralelizar/streamar, ou `Suspense` por seção.
- [ ] Garantir `prefetch` nos links de navegação; skeletons por seção nas telas densas.

### 2. Hierarquia tipográfica — ALTO, baixo esforço
- [ ] Aproveitar os pesos **500/600** (hoje quase só 400/600/700) para hierarquia mais sutil.
- [ ] Cabeçalhos de página com um pouco mais de presença (tamanho + `tracking-tight`).
- [ ] Variar os rótulos: nem tudo precisa ser `eyebrow` (uppercase) — sentence case em alguns.

### 3. Mobile — ALTO (dor relatada)
- [ ] Alvos de toque ≥ 44px; revisar o menu mobile (feedback + velocidade).
- [ ] Feedback de toque mais forte (active state) nos links de navegação, não só nos botões.
- [ ] Espaçamento e tamanho de fonte revistos no mobile (hoje `0.9rem` global pode ficar apertado).

### 4. Tabelas e listas — MÉDIO
- [x] Tabela de OP alinhada (status em coluna, ordenar pelo cabeçalho, steppers centralizados).
- [ ] Padronizar **todas** as tabelas/listas no mesmo ritmo (hover de linha, zebra sutil, paddings iguais).
- [ ] Reduzir "card dentro de card": agrupar dados com `divide-y`/`border-t` em vez de caixas aninhadas.

### 5. Micro-interações — MÉDIO
- [ ] Entrada das listas em cascata (stagger sutil) em vez de tudo de uma vez.
- [ ] Spring/scale leve no hover de linhas e cards.

### 6. Estados e acabamento — MÉDIO
- [ ] Empty states "compostos" (ícone + texto + ação) onde ainda forem genéricos.
- [ ] Erros inline nos formulários (não só toast).
- [ ] Focus rings visíveis (acessibilidade/teclado).
- [ ] Favicon/ícone PWA branded.

## Ordem de execução sugerida
1. Performance (Produtos + prefetch) — fecha a dor de lentidão.
2. Tipografia/hierarquia — refino global rápido, alto retorno visual.
3. Mobile polish — a dor que você mais sente.
4. Tabelas/listas no mesmo ritmo.
5. Micro-interações.
6. Estados/acabamento.

> Tudo trabalhando com o design system atual (sem trocar stack/fonte). Mudanças
> pequenas e revisáveis, testando no deploy a cada passo.
