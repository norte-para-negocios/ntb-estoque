# Redesign Visual do Frontend, NTB Estoque — Varredura Completa + Plano

> **Para quem vai implementar:** plano de REDESIGN VISUAL (aparência, não features). Use `superpowers:executing-plans` e, antes de tocar em QUALQUER JSX/CSS, invoque `design-taste-frontend` ou `impeccable`. Os passos usam checkbox (`- [ ]`).

## O que é e como foi feito

Auditoria visual COMPLETA do frontend do NTB Estoque. **11 agentes de design independentes**, cada um com uma ou duas skills diferentes, cobrindo TODAS as áreas do app, mais **screenshots reais do sistema rodando** (desktop e mobile) para validar o que os agentes só puderam estimar lendo código. Nenhum código foi alterado.

**Cobertura (todas as telas):** home, produto, validade, nota-fiscal (lista + detalhe), ordem-producao (lista), inventário + transferência + contagem QR, formulários (novo produto, criar OP, inputs inline), PDFs + etiquetas, login/cadastro/aguardando, admin/técnicas (loja, usuário, local-estoque, sync-status, log), movimentações, impressões, ui-kit e shell.

**As skills/lentes usadas:** `impeccable`, `design-taste-frontend`, `ui-ux-pro-max`, `distinctive-frontend`, `frontend-design-pro`, `ilm-alan-frontend-design`, `high-end-visual-design`, `minimalist-ui`.

**Screenshots reais** (em `docs/superpowers/plans/screens/`): `home-desktop.png`, `produto-desktop.png`, `validade-desktop.png`, `home-mobile.png`. Capturados em 1440x900 e 390x844, sistema rodando em localhost com dados reais.

---

## Veredito consolidado

As 11 lentes convergem: **a base é sólida e madura, mas o acabamento é desigual.** Token system semântico, dark mode real, numerais tabulares, fonte com caráter (Plus Jakarta + JetBrains Mono), estados vazios desenhados. O problema não é a estrutura, é a disciplina, e ele se concentra em pontos que se repetem em quase toda auditoria.

**O que os screenshots confirmaram visualmente:**
- **Home:** o hero preto com "2.279" gigante + glow teal ocupa a primeira dobra inteira; no mobile, a fila "Precisa de atenção" (a info que importa) só aparece depois de rolar. Os 3+3 cards iguais estão lá. As réguas pretas `border-b-2` destoam.
- **Validade (a mais crítica):** confirmadamente pobre. Uma tabela de 2 linhas num oceano de espaço branco vazio. Bolinha vermelha + data é o único sinal. Sem saldo de estoque, sem semáforo visual, sem usar a tela. Para um restaurante (validade = perda de produto), é a tela que mais desperdiça potencial.
- **Produto:** 4 botões na mesma linha competindo (só "Novo produto", a ação mais rara, é destaque teal); margem em verde/vermelho só por cor, sem ícone; tabela densa porém folgada.

---

## Achados consolidados por área

### 0. TRANSVERSAL: cores semânticas hardcoded (citado por 8 das 11 lentes, prioridade #1)
O `globals.css` define `--ok/--warn/--err/--info` com variantes dark, mas ~24 arquivos cravam os hex (`#10b981/#f59e0b/#ef4444/#3b82f6`) à mão. **No dark mode os tokens trocam e os hex não acompanham: bug visual real.** Há 4+ semáforos duplicados (`corMargem`, `tom`, `alertas[].cor`, 2 mapas de status) e 3 grafias de "ok". Falta expor `--color-ok/warn/err/info` no `@theme inline` (só por isso o povo cravou hex). O `#10151c` do hero é cor órfã sem token. O padrão `text-[var(--err,#ef4444)]` tem o hex antigo embutido como fallback que mente se o token mudar.

### 1. Home (4 lentes)
Hero-metric template banido (número 4.5rem + glow + `#10151c`). Info acionável empurrada para baixo da dobra (confirmado no mobile). 3+3 cards iguais. `StatCard` existe mas a home reimplementa KPI inline. Dois sistemas de heading na mesma página (eyebrow apagado vs régua preta `border-b-2 border-text`). Acento teal sobrecarregado (identidade + link + nav + nível de alerta ao mesmo tempo).

### 2. Validade (varredura + screenshot)
A tela mais importante para restaurante e a mais subaproveitada. Mostra a quantidade da OP, não o saldo real de estoque. Sem filtro por local. Sem layout de urgência (semáforo por colunas hoje/3d/7d). Bolinha de cor sem rótulo ("vence em 2d"). Oceano de branco desperdiçado.

### 3. Tabelas e listas (3 lentes)
Três tratamentos coexistem: `Lista` (responsivo), `DataTable` (table-fixed), e tabela inline na home. Prop `larguraDesktop` morta (ignorada em dezenas de colunas). Densidade folgada (`py-2.5`) para uso operacional. Sem zebra striping; borda do dark quase invisível (`rgba(255,255,255,0.09)`). Ordenação inconsistente: só OP ordena clicando no cabeçalho, as outras escondem num select da gaveta; falta `aria-sort`.

### 4. Ergonomia de toque mobile/tablet (lente UX, achado mais grave)
**Alvos abaixo de 44px em quase todo controle:** steppers +/- da OP e da contagem (`size-7`/`size-9` = 28-36px), inputs inline (~30px), `Button` (`py-1.5`~32px), "x" dos chips (16px), bottom-nav (~36px). Crítico porque a cozinha opera em tablet, em pé, com pressa, mão molhada, e os steppers de quantidade/validade são a ação mais repetida. `type="number"` rejeita vírgula decimal pt-BR ("1,5") e o scroll do mouse altera o valor; grava direto no Omie.

### 5. Operação física / scanner QR (2 lentes)
O scanner está desenhado como tela de admin, não instrumento de cozinha. O QR é botão secundário abaixo da busca por texto (hierarquia invertida). A câmera fecha a cada leitura (relê item a item num inventário de 40). Sem moldura/mira, sem feedback corpóreo (flash de tela cheia + vibração) no sucesso/erro: só toast de 13px que some sob luz forte. Status do item ("Erro"/"Sem CMC") em cinza 11px sem cor semântica. Input de quantidade (o dado mais caro da tela) é o menor elemento.

### 6. Formulários (2 lentes)
Validação 100% por toast, nunca inline: nenhum `aria-invalid`, nenhuma mensagem sob o campo, nenhum foco no campo errado. Label fraco (mesmo cinza do placeholder, cinza-sobre-cinza). Asterisco de obrigatório é texto cru sem cor nem semântica. Inconsistência de teclado: `EstoqueMinimoInput`/`QuantidadeInput` acertam `inputMode="decimal"`, mas valor unitário e dimensões do produto não. Submit sem spinner (só troca texto), apesar de escrever no Omie (lento). Autocomplete de produto sem loading/empty/teclado. Form longo sem `fieldset`/progressive disclosure (5 cards empilhados).

### 7. Telas de detalhe (2 lentes)
**Não existe tela de detalhe de OP:** a edição (incluindo concluir OP, que escreve no Omie) acontece numa `<tr>` de 7 colunas com steppers. Detalhe de NF é raso: só número + razão social, sem metadados do documento (data, CNPJ, total, nº de itens). Nenhuma tela de detalhe tem breadcrumb/voltar. Link de OP em impressões aponta para a lista inteira, não para o item. Movimentações pinta saída de estoque (operação normal) com cor de erro. Stepper de validade move 1 dia por clique (dezenas de cliques para meses).

### 8. PDFs e etiquetas (2 lentes)
Dois mundos: os PDFs de contagem têm craft de documento (logo, cabeçalho, zebra, rodapé), mas os 3 relatórios (NF, OP, transferência) são dump de tabela sem logo, rodapé nem paginação. **Cabeçalho de tabela não é `fixed`:** em PDF de 3+ páginas, as páginas 2+ ficam sem nome de coluna (erro de leitura garantido). Contraste secundário fraco para impressão P&B (`#9ca3af` ~2.6:1 some no toner). Etiqueta (73x40mm, não 5x5): 11 linhas espremidas no mesmo peso; Validade e Descrição (o que importa na prateleira) não têm destaque; QR com quiet zone apertada; truncamento cego (`.slice`) pode cortar validade.

### 9. Auth / primeira impressão (2 lentes)
Card centralizado genérico de 448px, sem caráter ("troca o logo e é o login de qualquer SaaS"). Halo de fundo invisível (0.10 de opacidade sobre quase-branco). Zero motion na entrada (o `tw-animate-css` e o `--ease` já estão no projeto, não usados). Logo no dark vira decalque branco (`brightness-0 invert`), perde a cor de marca. Proposta dos agentes: split-screen com uma "prateleira" SVG que se preenche em stagger no load (assinatura de domínio, custo baixo, sem virar marketing).

### 10. Coerência admin/técnicas (2 lentes, nota 8/10)
Mantêm a direção, mas com atalhos de pressa: `impressoes` reimplementa o StatusPill à mão; `formatarData` reescrita em 6 telas (devia estar em `lib/data-bahia.ts`); `local-estoque` usa filtro pill e `log` usa filtro botão para a mesma função; exclusão de loja usa `window.confirm` nativo (quebra a UI), enquanto usuário usa danger-zone inline. `loja` é muito mais densa que as demais (formulário gigante sem accordion).

---

## Decisão 1 (do fundador): refino OU nova identidade

> **DECIDIDO em 17/06/2026 pelo fundador: Caminho A (Refino).** Mantém teal + Plus Jakarta;
> os blocos V1-V11 valem como estão. B1/B2 descartados por ora.

### Caminho A — Refino (recomendado)
Mantém teal + Plus Jakarta + base atual. Corrige tudo acima. Baixo risco, alto retorno, é o que 9 das 11 lentes sustentam. Recomendado por ser cliente e a base já ser boa.

### Caminho B — Nova identidade (ambicioso)
A lente distinctive diz que o visual, embora competente, é "shadcn template com teal" e propôs 2 direções concretas:
- **B1 "Industrial-Cozinha":** bege-papel `#FAF7F1`, texto marrom-tinta, marca páprica `#B5471F`, display condensado + JetBrains Mono protagonista, tabelas raio 2px sem sombra. Vibe de ficha de câmara fria.
- **B2 "Terminal de Despensa":** dark nativo `#0C0D0F`, marca âmbar `#E8A33D`, mono como voz da interface, hero vira header de terminal (`SYNC 14:32 · 1.284 SKUS · 7 VENCENDO`). Vibe de WMS/PDV sério.

> Os blocos V1 a V11 valem nos dois caminhos. Se escolher B, faça V1 (tokens) primeiro: com as cores tokenizadas, virar a identidade vira edição de poucas linhas no `globals.css`.

---

## Plano de execução (priorizado por impacto x esforço)

Cada bloco é um commit/PR independente. Antes de tocar UI, invoque `design-taste-frontend` ou `impeccable`. Verificação = `npm run build` + screenshot no preview (este plano já mostrou que dá pra rodar o sistema localmente e fotografar).

### V1 — Saneamento de tokens de cor (MAIOR ALAVANCA, resolve a frente transversal) [CONCLUÍDO 17/06/2026 - commit 1b40a05]
- [x] Expor no `@theme inline`: `--color-ok/warn/err/info: var(--ok/warn/err/info)`. (+ `--color-ink`)
- [x] Criar `--ink` (= `#10151c`) com par no `.dark` para o hero/atalhos.
- [x] Criar `lib/status-cor.ts`: fonte única (STATUS map p/ StatusPill + badge de OP, `urgenciaValidade()` e `corMargem()` retornando NOME do token; mapas de classes SELO/TEXTO/FUNDO).
- [x] Varrer e trocar todo hex semântico por token/classe (StatusPill, OrdemProducaoRow, corMargem, tom→urgenciaValidade, alertas, impressoes, sync-status/StatCard, movimentacoes, cadastro, login, contagens, e os `[var(--err)]` avulsos). `text-[var(--err,#ef4444)]` → `text-err`.
- [x] Verificar dark/light em produto, validade, OP, home, impressoes. (navegador, claro+escuro)

### V2 — Home cockpit (resolve home + screenshots) [CONCLUÍDO 17/06/2026]
- [x] Remover hero gigante (número 4.5rem, glow, `bg-ink`, barrinha) -> cabeçalho enxuto (loja + sync).
- [x] "Precisa de atenção" no topo da tela.
- [x] KPIs viram faixa densa com `divide-x` sem caixa; "produtos em estoque" rebaixado a KPI normal. (StatCard segue só no sync-status.)
- [x] Unificar heading: `text-sm font-semibold` (sem uppercase-tracked nem `border-b-2 border-text`).
- [x] Verificar a primeira dobra no mobile (390px): fila de ação visível sem rolar.

### V3 — Ergonomia de toque (achado mais grave) [CONCLUÍDO 17/06/2026]
- [x] Steppers +/- e inputs inline ≥44px no mobile (`size-11`/`h-11`), compacto só no `lg:`. OrdemProducaoRow, EstoqueMinimoInput, MargemAlvoInput, QuantidadeInput, ContagemInventario, ContagemTransferencia, CriarOPProdutos.
- [x] "x" dos chips com área maior (`-my-1 -mr-1 p-2`). ChipsFiltrosAtivos.
- [x] Bottom-nav item ≥48px (`min-h-12`), label `text-[11px]`. MobileNav.
- [x] Quantidade decimal: `type="text" inputMode="decimal"` + `parseNumBR` (lib/num-br.ts, aceita "1,5") + `onWheel blur`. Validade-dias segue inteiro.

### V4 — Tabela única, densa, escaneável
- [ ] Eleger `Lista` como canônico; migrar tabela inline da home e a OP (`DataTable`) para `Lista`, com header ordenável + `aria-sort`.
- [ ] Remover `DataTable` sem uso e a prop morta `larguraDesktop`.
- [ ] Densidade `py-1.5` + zebra `even:bg-surface-2/30` + borda do dark para `rgba(255,255,255,0.14)`.
- [ ] Ordenação por cabeçalho em todas as telas.

### V5 — Scanner QR como instrumento de cozinha [CONCLUÍDO 17/06/2026]
- [x] Câmera em leitura contínua (não fecha a cada bip; trava só o frame, libera após 1,5s).
- [x] Mira visível (cantos) + flash de tela cheia verde + `navigator.vibrate` no sucesso; flash vermelho + vibração quando produto não encontrado (onLeitura devolve boolean).
- [x] QR como bloco primário no topo da contagem (`primary` h-14, ≥56px); busca por texto recolhida em "buscar manualmente".
- [x] Input de quantidade dominante (`h-12 w-20 text-2xl`); status do item em StatusPill (cor semântica). OBS: comportamento de câmera precisa de teste em dispositivo real.

### V6 — Formulários com validação inline
- [ ] Componente `Campo` com `error`/`required`: pinta `aria-invalid`, mostra `<p role="alert">` sob o campo, foca o primeiro inválido no submit. Aplicar em FormNovoProduto, CriarOrdemProducao, NovoLocalEstoque, CriarOPProdutos, MargemAlvoInput.
- [ ] Label em cor cheia + peso; placeholder/helper em muted; asterisco em `--err`.
- [ ] `inputMode="decimal"` em valor unitário e dimensões; spinner + `aria-busy` no submit.
- [ ] Autocomplete de produto: estados loading/empty + navegação por teclado. `autoFocus` no primeiro campo dos dialogs.

### V7 — Telas de detalhe
- [ ] Criar `ordem-producao/[id]/page.tsx` com cabeçalho de documento (nº, produto, status como selo, data) e controles de validade/quantidade/conclusão em blocos espaçados (tirar a ação grave da `<tr>`).
- [ ] Faixa de metadados na NF (data, CNPJ, total, nº itens) sob o PageHeader.
- [ ] Breadcrumb/voltar nas telas de detalhe; corrigir link de OP em impressões para o item.
- [ ] Movimentações: saída em neutro/âmbar (não `--err`) + glifo `+`/`−`.
- [ ] Stepper de validade: trocar ±1 dia por presets +30/+90/+180 ou só o date input.

### V8 — PDFs e etiquetas
- [ ] Componente compartilhado de cabeçalho (logo) + rodapé com paginação `fixed`, aplicado aos 5 relatórios.
- [ ] `<View ... fixed>` no thead de todos (repete cabeçalho de coluna por página) + `wrap={false}` nas linhas.
- [ ] Contraste P&B: cabeçalho de coluna `#374151`/`#111`, rodapé ≥`#6b7280`.
- [ ] Etiqueta: Validade e Descrição em destaque (≥11-12pt bold), CNPJ/lote/fornecedor rebaixados; QR com `margin:2` gerado a 240-320px; validar truncamento (ellipsis, não corte cego).

### V9 — Auth / primeira impressão
- [ ] Quebrar o card centralizado: split-screen com painel de marca; ou elemento gráfico vazando atrás do card.
- [ ] "Prateleira" SVG que se preenche em stagger no load (assinatura de domínio), usando `--ease` + `tw-animate-css` já presentes; respeitar `prefers-reduced-motion`.
- [ ] Halo de fundo de verdade (0.18+) + segundo orb + grão sutil; faixa de acento no topo do card.
- [ ] Logo dark próprio (não `brightness-0 invert`); título de boas-vindas com peso/escala (`text-2xl/3xl`, tracking apertado).

### V10 — Coerência admin
- [ ] `formatarDataHoraBahia()`/`formatarDataBahia()` em `lib/data-bahia.ts`, substituir as 6 implementações inline.
- [ ] `impressoes` passa a usar `StatusPill` (não badge à mão).
- [ ] Extrair `<SegmentedFilter>` no ui-kit (resolve pill-vs-botão entre local-estoque e log).
- [ ] Fluxo destrutivo único: trocar `window.confirm` (loja) por `Dialog`/danger-zone inline (como usuário).
- [ ] `loja`: colapsar "Dados da empresa" e "Certificado" em accordion.

### V11 — Acabamento e acessibilidade
- [ ] Sinal não-cromático junto da cor (ícone/seta na margem negativa e ruptura, rótulo "vence em 2d" na validade).
- [ ] Remover side-stripe borders (sidebar ativo, KPI cards, StatCard).
- [ ] Pills de status: texto em `--*-ink` escuro do próprio hue (contraste).
- [ ] Links/CTAs de texto pequeno em `--brand-strong` (`#1c8d99`), não `--brand` (contraste <4.5:1).
- [ ] Nunca opacidade sobre `--text-muted`; criar `--text-faint`.
- [ ] `@media (prefers-reduced-motion: reduce)` + crossfade no lugar do slide repetido.
- [ ] Mover busca global para o topbar/sidebar (libera a dobra de toda tela).

---

## O que NÃO mexer (as lentes elogiaram)

- Fonte (Plus Jakarta Sans + JetBrains Mono). `font-variant-numeric: tabular-nums` e `Money`/`Num` pt-BR.
- Estados vazios (`EmptyState`) e o par desktop-tabela / mobile-card do `Lista`.
- A confirmação inline de 2 cliques do `ExcluirProdutoBtn` (padrão a propagar, não a remover).
- Intensidade de motion comedida (só falta o fallback de reduced-motion).
- A calibração de operação (variância baixa, densidade alta) que as tabelas já acertam.

---

## Prioridade sugerida de entrega

1. **V1 (tokens)** — destrava tudo e conserta o bug de dark mode. Faça primeiro.
2. **V3 (toque) + V5 (scanner)** — o que mais reduz erro operacional na cozinha.
3. **V2 (home) + V4 (tabela)** — o que mais muda a percepção de qualidade.
4. **V6, V7** — fricção de fluxo.
5. **V8, V9, V10, V11** — acabamento.

---

Varredura por 11 lentes de design + validação visual com o sistema rodando. Plano consolidado e assinado por Joaquim Salles.
