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

### 1. Performance percebida — ALTO impacto (FEITO)
- [x] `loading.tsx` global (skeleton ao navegar).
- [x] Tela de **Produtos** paralelizada: lojaSync+familias+repor juntos; posicoes+previsao juntos (eram ~6 round-trips em serie). Mesma logica, menos latencia.
- [x] Entrada animada do conteudo a cada navegacao (AppShell key={pathname}) pareando com o skeleton.

### 2. Hierarquia tipográfica — ALTO, baixo esforço (FEITO)
- [x] Cabeçalhos de página com mais presença (`text-xl font-semibold tracking-[-0.01em]`).
- [x] Scroll suave (`scroll-behavior: smooth`).

### 3. Mobile — ALTO (dor relatada) (FEITO)
- [x] Alvos de toque ≥ 44px no drawer (py-3).
- [x] Feedback de toque (active state) nos links de navegação mobile: drawer `active:bg-surface-2`, bottom bar `active:scale-95 active:text-brand`.

### 4. Tabelas e listas — MÉDIO (parcial)
- [x] Tabela de OP alinhada (status em coluna, ordenar pelo cabeçalho, steppers centralizados).
- [ ] Padronizar **todas** as tabelas/listas no mesmo ritmo (hover de linha, zebra sutil, paddings iguais). _Refino marginal — proxima leva._
- [ ] Reduzir "card dentro de card": agrupar dados com `divide-y`/`border-t`. _Proxima leva._

### 5. Micro-interações — MÉDIO (decidido não fazer agora)
- [~] Stagger de entrada das listas: DESCARTADO por ora — o AppShell ja anima a entrada do conteudo; stagger nas linhas seria redundante e arriscaria *parecer mais lento* (a dor do usuario).

### 6. Estados e acabamento — MÉDIO (parcial)
- [x] Focus rings visíveis (`:focus-visible` com cor da marca — acessibilidade/teclado).
- [x] Favicon/ícone branded (`app/icon.svg` NTB no lugar do default do Next).
- [x] Empty states "compostos" (componente `EmptyState` ícone+texto+hint já em uso).
- [ ] Erros inline nos formulários (não só toast). _Form a form — proxima leva._

## Ordem de execução sugerida
1. Performance (Produtos + prefetch) — fecha a dor de lentidão.
2. Tipografia/hierarquia — refino global rápido, alto retorno visual.
3. Mobile polish — a dor que você mais sente.
4. Tabelas/listas no mesmo ritmo.
5. Micro-interações.
6. Estados/acabamento.

> Tudo trabalhando com o design system atual (sem trocar stack/fonte). Mudanças
> pequenas e revisáveis, testando no deploy a cada passo.
