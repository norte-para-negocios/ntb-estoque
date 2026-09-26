# Redesign visual "estilo Apple" do NTB Estoque — design

## Objetivo
Pedido do dono (2026-09-26): o NTB Estoque inteiro com a mesma linguagem
visual aplicada no NTB Vendas (spec `ntb vendas/docs/superpowers/specs/2026-09-26-redesign-estilo-apple-design.md`).
Só aparência: nenhum fluxo, dado, rota, permissão ou posição de tela muda.

## Evidência (prints "antes")
`~/ClaudeGerado/ntb-estoque-redesign-antes/` — 44 telas desktop (1440x900)
+ 42 mobile (390x844), conta QA na loja de teste 12 (contagens de
inventário/transferência da loja 6, modo leitura). Achados:

1. **Números em fonte de máquina de escrever** — `.num` usa JetBrains Mono
   (245 usos): hero da home, cards, R$/% de todas as tabelas de relatório,
   CNPJ, datas, placeholders ("Buscar produto…" em mono em Movimentações).
2. **CAIXA ALTA** (103 ocorrências em 44 arquivos): grupos do menu
   (OPERAÇÃO/CADASTROS/ADMINISTRAÇÃO), seções da home (PRECISA DE ATENÇÃO,
   REPOR ESTOQUE, TOP 10…), KPIs de relatório, seções do formulário de
   produto, todos os cabeçalhos de tabela.
3. **Estado vazio em caixa tracejada** (`EmptyState`) em ~15 telas.
4. **Cartões com borda 1px** em quase todas as telas; cartão dentro de cartão
   (Minha loja).
5. **Faixas/acentos coloridos**: faixa no topo dos KPIs (`StatCard`,
   Saúde do banco, Sincronização), sublinhado teal no hero da home, cartão
   ativo tingido no Resumo, blocos azul-claros "Precisa de ação".
6. **Cores demais**: Margem (vermelho/laranja/preto/verde na mesma coluna),
   Auditoria fiscal, Indicadores; gráfico de produção fora da marca.
7. **Status em pílula colorida** (`StatusPill`) em vez de ponto + texto;
   selo laranja de 3 linhas "NTB VENDAS · HOMOLOG." em cada OP.
8. **Quadradinho com ícone ao lado de todo título** (`PageHeader.icon`),
   somado ao botão ← nos relatórios; títulos pequenos (20px).
9. **Subtítulos genéricos/técnicos** ("Locais sincronizados do Omie",
   "Monitoramento do Postgres (Supabase free tier, limite 500 MB)").
10. **Três estilos de "selecionado"** (contorno teal, pílula preta,
    segmented cinza) e grupos de filtro empilhados.
11. **Tabelas** com cabeçalho cinza em caixa alta, colunas truncadas
    ("Focac…"), coluna total cortada à direita já no desktop.
12. **Botões retangulares com borda**; barras com 6–7 botões que estouram
    (Ordens de produção: último botão sai da tela, título quebra em 3 linhas).
13. **Inputs com borda branca** (login, Minha loja, Novo produto, Usuários).
14. **Mobile**: barras de ferramentas em 3–4 linhas, chips de período cortados
    sem indicação, busca ocupando uma linha inteira no topo, tabelas largas
    sem rolagem visível (Faturamento/Margem/Estoque valorizado).
15. **Marca**: o Estoque é teal (`#2eb5c3`) com menu branco. Decisão do dono
    (2026-09-26): continua teal — identidade própria, não o azul do Vendas.
    Menu lateral na cor da marca (teal), texto branco.

Não são do redesign (registrado pra não culpar depois): entidades HTML cruas
em nomes de produto ("DANIEL&amp;apos;S" — dado), textos sem acento em
Relatórios (corrigidos junto por serem rótulos), "30.4" com ponto no
Dashboard de produção, página `estoque-local-teste` sem casca (admin),
"Saúde do banco" com limite de 500 MB desatualizado.

## Linguagem visual (decisões)
Idêntica à do Vendas, com o menu azul que o dono pediu:
- **Fonte:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI
  Variable Text", "Segoe UI", system-ui, sans-serif`. Números: mesma fonte +
  `tabular-nums`. Mono só em código (chave de NF, JSON de log, XML).
- **Claro:** fundo `#f5f5f7`, superfície `#fff`, superfície 2 `#f2f2f7`,
  texto `#1d1d1f`, secundário `#6e6e73`, separador `rgba(60,60,67,.14)`,
  marca teal `#168e9a` (tom mais fundo do `#2eb5c3` original, pra texto branco ficar legível; só ação/seleção), ok `#248a3d`, aviso `#b25000`, erro
  `#d70015`, info `#0066cc`.
- **Escuro:** fundo `#000`, superfície `#1c1c1e`, superfície 2 `#2c2c2e`,
  texto `#f5f5f7`, secundário `#98989d`, separador `rgba(84,84,88,.45)`,
  marca `#3fc6d4`. Só via tokens (`.dark`), nunca utilitário `dark:`.
- **Raios** 8/12/18, modal 22 (folha no celular). Botões e chips pílula
  (32/38/44px).
- **Cartões** sem borda, sombra `0 1px 2px rgba(0,0,0,.04), 0 2px 12px rgba(0,0,0,.04)`.
- **Inputs** preenchidos (`surface-2`, sem borda, anel de foco da marca).
- **Rótulos de seção** em frase normal, 13px, cinza, 600. Títulos de página
  28–30px, `-0.02em`, sem quadradinho de ícone.
- **Status**: ponto 8px + texto. **Vazio**: sem caixa tracejada.
- **SegmentedControl** único pra visões/filtros exclusivos; chips pílula pra
  período.
- **Tabelas**: separador fino, cabeçalho frase normal cinza 13px sem fundo,
  números à direita com `tabular-nums`, hover suave, sem zebra; rolagem
  horizontal visível no celular.
- **Menu lateral** na cor da marca (gradiente teal `#1a9aa7→#106e78`), texto branco,
  item ativo em pílula branca translúcida; grupos em frase normal.
- **Movimento**: molas sem quique (bounce 0, ~0.35s), press 0.97, pílula do
  menu deslizando, troca de aba suave, folhas de baixo arrastáveis no
  celular, toasts estilo iOS, count-up nos resumos, listas animando
  entrada/saída; tudo respeita `prefers-reduced-motion`. `motion/react`.

## Fora de escopo
Fluxo/funcionalidade/texto funcional; PDFs e impressão (`components/etiqueta/*PDF.tsx`,
`components/relatorio/*PDF.tsx`, `PdfChrome.tsx`, `EtiquetaEditor`); ícones
(lucide continua); dados (entidades HTML nos nomes).
