# Etiquetas de produto, clareza de status de NF, e performance — design

Data: 2026-07-22

## Contexto

Três pedidos do usuário na mesma mensagem, tratados como três sub-projetos
sequenciais (cada um com escopo e risco bem diferentes):

1. Imprimir etiqueta de produto (nome + QR code + logo), selecionando vários
   de uma vez, a partir de uma "biblioteca" de produtos.
2. Deixar claro TODAS as situações possíveis de uma nota fiscal (concluída,
   pendente, cancelada) e poder filtrar por elas.
3. Melhorar a lentidão geral do sistema, que persiste.

## 1. Etiqueta de produto (nome + QR + logo)

**O que já existe (reuso, não é do zero):** o app já gera etiqueta em PDF
(`components/etiqueta/EtiquetaPDF.tsx`) pra NF/OP, com QR code (`qrcode` npm,
já embutido) que codifica só o `codigo_produto` — ou seja, o QR **já é fixo**
por natureza (não muda a menos que o produto mude de código no Omie).
`EtiquetaConfig` já tem flags `mostrarValidade/mostrarLote/mostrarFornecedor/
mostrarCnpj/etc` — pra essa etiqueta nova, todas ficam `false`, sobra só nome
+ QR + logo, sem precisar de um componente de PDF novo.

**O que falta:**
- Rota nova `app/(app)/produto/imprimir-etiquetas/route.ts` (GET,
  `?codigos=1,2,3`): busca os produtos pelos códigos, monta 1 `Etiqueta` por
  produto (campos NF/OP-específicos vazios), gera o QR (`codigo_produto`),
  renderiza com `EtiquetaConfig` fixo (nome+qr+logo, ignora o
  `etiqueta_config` da loja pra esses campos — mas reaproveita tamanho/cor se
  já configurado). Registra em `impressao_etiquetas` com `origem: 'PRODUTO'`
  (novo valor — hoje só aceita 'NF'/'OP', checar CHECK constraint da coluna
  antes).
- Checkbox na lista de Produtos (`app/(app)/produto/page.tsx`, hoje sem
  nenhum padrão de seleção múltipla no app inteiro — vai ser o primeiro).
  Client component novo (`SeletorProdutosEtiqueta`) guarda o Set de
  selecionados em estado local, mostra barra fixa "Imprimir etiquetas (N)"
  quando `N > 0`, linka pra rota acima com os códigos selecionados.
- **Escopo da seleção**: só a página atual (se a lista paginar, não persiste
  entre páginas nesta v1). Simples, resolve o pedido central. Selecionar
  centenas de produtos de uma vez (ex: catálogo inteiro) fica pra depois se
  pedir.

## 2. Clareza de status de Nota Fiscal

**Dado real (checado agora, 5 lojas):** só existem 2 valores de `c_etapa` na
base hoje — `'60'` (Concluída) e `'40'` (ainda em processamento/recebimento
no Omie — hoje mostrado como "Notas fiscais travadas" no Resumo Operacional).
Não achei documentação da Omie listando todos os códigos possíveis de
`cEtapa` (API oficial não retornou nada, busca na web também não). Em vez de
inventar rótulos pra códigos que nunca vi, o rótulo pra qualquer `c_etapa`
diferente de `'60'` mostra **"Pendente (etapa {código})"** — nunca esconde o
código cru, então nada fica querido "misterioso".

**Achado extra relevante:** `cCancelada` (dentro de `full_object.
infoCadastro`) é uma flag **independente** de `c_etapa` — hoje existem 1-2
notas por loja que são `c_etapa='60'` E `cCancelada='S'` ao mesmo tempo, e o
app mostra elas como "Concluída" (errado). O status de verdade tem que
cruzar as duas: **Cancelada** (se `cCancelada='S'`, não importa a etapa) >
**Concluída** (`c_etapa='60'` e não cancelada) > **Pendente (etapa X)**
(qualquer outra etapa, não cancelada).

**Onde muda:**
- `lib/nf-status.ts` (novo, pequeno): uma função
  `statusNF(c_etapa, cCancelada): { label, tom }` — fonte única de verdade,
  usada em TODOS os lugares abaixo (evita duplicar a lógica de novo, que já
  tá espalhada em 3 arquivos hoje sem tradução nenhuma).
- `app/(app)/nota-fiscal/page.tsx`: coluna "Situação" na lista (hoje não
  existe nenhuma coluna de status visível — só existe o filtro cego C/P).
  Filtro na gaveta ganha 3 opções (Concluída / Pendente / Cancelada) em vez
  do C/P binário atual (compatibilidade: manter `status=C`/`P` funcionando
  pros links antigos do Resumo Operacional).
- `app/(app)/nota-fiscal/[id]/page.tsx`: troca "Etapa: 60" (código cru) por
  um selo com o rótulo (mantém o código cru do lado, pra quem quiser
  conferir).
- Export/relatório da lista de NF: nova coluna "Situação".

## 3. Performance

Não tem bala de prata nova aqui além do que já foi decidido e não
executado: cache Redis (já rodando no Contabo) pro relatório mais pesado
(`Movimentação — Por operação`, ~14MB agregados). Continua esperando decisão
sobre TTL. Fora isso, o padrão que funcionou em Pendências de Classificação
(paralelizar buscas independentes com `Promise.all` em vez de `await`
sequencial) vale auditar nas outras páginas mais lentas — sem prometer
melhora garantida em todas, mas é um fix de baixo risco onde existir esse
padrão sequencial.

**Decisão pendente do usuário (bloqueia início do item 3):** TTL do cache
Redis — 2 min? Outro valor? Ou pular o cache e só auditar
paralelização (menor risco, ganho menor)?

## Ordem de execução

Um de cada vez (padrão desta sessão), commit+push+deploy no Contabo depois
de cada item, validado com dado real antes de seguir pro próximo:
1. Etiqueta de produto (menor risco, feature isolada, reusa infra existente)
2. Clareza de status de NF (mexe em tela usada o dia todo, mais chance de
   pegar algo que quebrou sem querer — testar com as 5 lojas antes de
   deployar)
3. Performance (só depois da decisão do TTL, ou só a auditoria de
   paralelização se preferir não mexer em cache agora)
