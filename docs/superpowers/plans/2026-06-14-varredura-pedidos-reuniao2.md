# Varredura — Pedidos da Reunião 2026-06-14

> Documento de RECONHECIMENTO. Mapeia onde cada pedido se encaixa no código atual.
> Nada foi alterado no sistema. Base para um plano de execução posterior.

Fonte: `C:\Users\media\Videos\transcricao-ntb-2026-06-14-pedidos.md`

Legenda de esforço: 🟢 baixo · 🟡 médio · 🔴 alto. ⚠️ = escreve no Omie (testar só com Ramon).

---

## CORREÇÕES (bugs apontados ao vivo)

### 1. Contagem em tempo real (produto some até dar refresh) 🟢 — PRIORIDADE
- **Arquivos:** `components/inventario/ContagemInventario.tsx` (`adicionar`, l.58-73), `components/transferencia/ContagemTransferencia.tsx` (análogo), `lib/actions/inventario.ts` (`addInventarioItem`, l.26-44), `lib/actions/transferencia.ts` (`addMovimento`).
- **Hoje:** após `addInventarioItem`, o componente chama `router.refresh()` para o item aparecer — daí o atraso. A action faz `insert` mas **não retorna** o registro criado.
- **Mudança:** a action retorna o item inserido (`.select(...).single()`); o componente faz **update otimista** — insere o novo item no TOPO do `setItens` na hora, sem depender do refresh. Idem remover/editar (já são otimistas no remove/edit).
- **Risco:** baixo. Garantir o `id` real para o `editQuantidade`/`remove` subsequentes funcionarem.

### 2. NF: coluna "Etapa 40" crua 🟢
- **Arquivos:** `app/(app)/nota-fiscal/page.tsx` (coluna "Etapa" usa `StatusPill status={nf.c_etapa}`), `components/ui-kit/StatusPill.tsx`.
- **Hoje:** `c_etapa` vem "40"/"50"/"60" (código do Omie) e cai no fallback do StatusPill, mostrando o número cru.
- **Mudança:** ou remover a coluna Etapa, ou mapear os códigos para rótulo (ex.: 60 = Concluída, demais = Pendente/Em andamento) — o controller original usa 60 como concluída.
- **Risco:** baixo. Confirmar o significado de cada etapa no Omie antes de rotular.

### 3. Mostrar NOME do depósito em vez do código 🟡
- **Arquivos:** `components/transferencia/NovaTransferencia.tsx` (já usa `l.descricao` ✓), `components/transferencia/NovoInventario`/`NovoInventario.tsx`, `app/(app)/inventario/[id]/contagem/page.tsx` e `transferencia/[id]/contagem/page.tsx` (cabeçalho), listagens.
- **Hoje:** na CRIAÇÃO de transferência o select já mostra o nome. O problema é o **fallback**: quando o `localMap` não acha o local, exibe o código (`localMap.get(cod) || cod`). Acontece no cabeçalho da contagem e nas listagens.
- **Mudança:** garantir que `local_estoques` esteja sincronizado e o `localMap` cubra os códigos usados; exibir sempre a descrição. Conferir o `NovoInventario` (se mostra código).
- **Risco:** baixo. Depende de o local existir na tabela `local_estoques`.

### 4. Contagem: unidade de medida (kg/litro) + quantidade 🟢
- **Arquivos:** `ContagemInventario.tsx`/`ContagemTransferencia.tsx`, `lib/actions/produtos-search.ts` (`ProdutoBusca` já tem `unidade` ✓), `lib/actions/inventario.ts`/`transferencia.ts` (add), tipo `ItemContagem`.
- **Hoje:** a busca já retorna `unidade`, mas o `addInventarioItem` não a repassa e o card de contagem não exibe. (A "quantidade que não aparece" é o mesmo bug do item 1.)
- **Mudança:** incluir `unidade` no payload de add e no tipo `ItemContagem`; exibir ao lado do número (ex.: "5 kg"). Verificar se `inventario_items` tem coluna de unidade (senão, exibir via join/estado, sem persistir).
- **Risco:** baixo.

### 5. Indicador "X de Y integrados" + quais deram erro 🟡
- **Arquivos:** `app/(app)/inventario/page.tsx`, `transferencia/page.tsx` (listagens), itens têm `status` ('Iniciado'/'Concluido'/'Erro'/'Sem CMC').
- **Hoje:** os dados existem (status por item) mas a listagem não mostra o resumo "X de Y".
- **Mudança:** na listagem (e/ou na tela de contagem finalizada) mostrar "concluídos de total" e destacar os itens com erro, com ação de reprocessar (já existe `forceSync`).
- **Risco:** baixo.

### 6. Transferência: botão Editar/Contar 🟢
- **Arquivos:** `app/(app)/transferencia/page.tsx` (l.188-189 já tem `Contar/Ver` + `AcoesTransferencia`).
- **Hoje:** o botão **já existe** na listagem. O que o Ramon viu pode ser: (a) o "Editar" dentro da contagem para itens já contados, ou (b) uma versão anterior.
- **Mudança:** confirmar no deploy o que faltava; provavelmente é o item 1 (atualização) e/ou exibir "Editar quantidade" por item na contagem (a action `editQuantidade` já existe).
- **Risco:** baixo. **Verificar primeiro** — pode já estar resolvido.

### 7. PDF de contagem bonito + logo 🟡
- **Arquivos:** `components/relatorio/ContagemInventarioPDF.tsx`, `ContagemTransferenciaPDF.tsx` (hoje SEM logo), `lib/etiqueta-logo.ts` (tem `NTB_LOGO_DATA_URL`).
- **Hoje:** PDFs simples, sem logo, "sem graça".
- **Mudança:** cabeçalho com logo NTB + layout mais cuidado (igual ao padrão das etiquetas/relatórios), mantendo as colunas atuais.
- **Risco:** baixo.

### 16. Cantos do cabeçalho fixo no dark 🟢
- **Arquivos:** `components/ui-kit/DataTable.tsx`, `components/ui-kit/Lista.tsx` (thead `sticky` sem `overflow-hidden`).
- **Hoje:** ao remover `overflow-hidden` para o sticky funcionar, o thead vaza o canto arredondado no dark.
- **Mudança:** arredondar o thead (cantos superiores) ou aplicar um clip que não quebre o `position: sticky`.
- **Risco:** baixo.

---

## TELA DE PRODUTOS (ajustes)

### 8. Margem alvo editável 🟢
- **Arquivos:** `app/(app)/produto/page.tsx` (chips `ALVOS = [40,50,60]`).
- **Hoje:** só chips fixos; Ramon quer digitar (60/70/75%) e acha 40% apertado.
- **Mudança:** trocar os chips por um input de % (com persistência em searchParams), ou manter chips + opção "outro". Server component → input precisa de um pequeno client wrapper.
- **Risco:** baixo.

### 9. Trazer o código do produto 🟢
- **Arquivos:** `app/(app)/produto/page.tsx` (colunas).
- **Hoje:** removi a coluna Código ao adicionar custo/margem; só mostra Descrição/Família.
- **Mudança:** reintroduzir a coluna Código (já está no select).
- **Risco:** baixo.

### 10. Filtro ativo/inativo + só ativos por padrão 🟡
- **Arquivos:** `app/(app)/produto/page.tsx` (filtros), `lib/omie/produto.ts` (sync — **não mapeia `inativo`**), schema `produtos.inativo varchar(1)` existe; `full_object.inativo` vem do Omie.
- **Hoje:** coluna `inativo` existe no schema mas o sync **não a popula**; sem filtro. Produtos "vazios" (sem custo/preço) provavelmente são inativos.
- **Mudança:** (a) sync gravar `inativo` a partir de `full_object.inativo`; (b) backfill dos existentes; (c) filtro ativo/inativo na gaveta, default = só ativos.
- **Risco:** baixo. Depende do valor real de `inativo` no Omie ('S'/'N').

---

## FEATURES NOVAS

### 11. Criar Ordem de Produção pela tela ⚠️ 🔴
- **Arquivos:** `lib/omie/ordem-producao.ts` (hoje só leitura — **não há `IncluirOrdemProducao`**), `app/(app)/ordem-producao/page.tsx`, nova action + componente de criação.
- **Hoje:** OPs só são listadas/sincronizadas do Omie. Nenhuma escrita.
- **Mudança:** criar `IncluirOrdemProducao` no Omie (produto + **3 datas iguais**: início/conclusão/previsão). A **validade** fica só no nosso sistema (Omie não tem). **Puxar a data de inclusão** da OP. Form de criação na tela.
- **Risco:** ALTO — escreve no Omie. Testar só com o Ramon. Validar os params da API `v1/produtos/op` (IncluirOrdemProducao).

### 12. Sugestão de compra 🔴 — a maior
- **Arquivos:** novo módulo `lib/omie/vendas.ts` (integrar `ListarPedidos`/movimentos — **vendas não integradas hoje**), `posicao_estoques` (saldo atual ✓), `estoque_minimo` (precisa vir do Omie — hoje 0), `app/(app)/produto/page.tsx` (exibição) + provável tela/alerta dedicado.
- **Hoje:** temos saldo (posição) e CMC. **Faltam:** estoque mínimo real (Omie zerado) e o histórico de vendas (API não integrada).
- **Fórmula (definida pelo Ramon):** `previsão de compra = estoque mínimo + previsão de venda (próxima semana, baseada nas vendas do mesmo período do ano anterior) − estoque atual`. Alerta quando saldo ≤ mínimo.
- **Mudança:** (a) integrar vendas do Omie (período do ano anterior, por produto); (b) obter/usar estoque mínimo; (c) calcular e exibir estoque mín/atual/prev venda/prev compra na tela de produtos; (d) alerta de reposição.
- **Risco:** ALTO. Dependências de dados: estoque mínimo (cliente precisa preencher no Omie) e volume de vendas (API pesada — caching). Vale plano próprio.

### 13. Impressões: filtros + quem imprimiu 🟢
- **Arquivos:** `app/(app)/impressoes/page.tsx` (sem filtros hoje), tabela `impressao_etiquetas` (já tem `user_id`).
- **Hoje:** lista as impressões, sem filtro e sem nome de quem imprimiu (tem o `user_id`, mas não resolve o nome).
- **Mudança:** `FiltrosGaveta` (período, origem NF/OP) + coluna "Usuário" (join `profiles` pelo `user_id`).
- **Risco:** baixo.

### 14. Login: auto-cadastro com aprovação 🔴
- **Arquivos:** `proxy.ts` (gate de auth), `app/(auth)/login/page.tsx`, nova `app/(auth)/cadastro/page.tsx`, `lib/actions/usuario.ts` + nova action de signup/aprovação, `app/(app)/usuario/page.tsx` (fila de aprovação), schema `profiles` (**não tem campo de status**).
- **Hoje:** admin cria usuário e gera senha (mostrada na tela). `profiles` não tem status de aprovação. `proxy.ts` redireciona não-logado para `/login` e libera só `/login`, `/api/webhook`, `/api/cron`.
- **Mudança:** (a) coluna `status` em `profiles` ('pendente'/'aprovado') via migration; (b) tela `/cadastro` pública (Supabase `signUp` com a senha do usuário) — gate: **só e-mail @norteparanegocios.com.br** (pendente de confirmação do usuário); (c) usuário pendente vê tela "aguardando aprovação" (proxy/home bloqueia); (d) fila na tela de Usuários: aprovar/recusar + atribuir loja e permissões; (e) liberar `/cadastro` no proxy.
- **Risco:** médio-alto (mexe em auth e schema). **Decisão pendente:** o gate (e-mail da empresa vs convite). Estava em stand by, agora destravado pelo Ramon. Vale plano próprio.

### 15. Mobile iOS/Android significativamente melhor 🟡
- **Arquivos:** `components/shell/*` (MobileNav, AppShell), `components/ui-kit/Lista.tsx` (cards), telas de contagem, `app/layout.tsx` (viewport/PWA), `components/contagem/QrScanner.tsx`.
- **Hoje:** responsivo (cards no mobile, bottom-bar, QR scanner). Falta polimento: safe areas do iOS (notch/barra inferior), alvos de toque, teclado numérico (já tem `inputMode` na contagem ✓ — verificar nos outros inputs), PWA instalável (manifest + ícones), performance.
- **Mudança:** `viewport-fit=cover` + `env(safe-area-inset-*)`; manifest PWA + ícones + meta apple; revisar alvos de toque e teclados; testar em viewport real iOS/Android.
- **Risco:** baixo-médio. Sem backend; é UI/PWA.

---

## FUTURO (alinhar com Andrei — fora deste ciclo)
- **Integração NTB Stock × Norte Vendas** (cardápio digital) — via API por app (não banco compartilhado). Entrega venda + estoque.
- **Entrada de NF pela tela** (não só ver): buscar no SEFAZ quando não houver Omie, validar impostos/CFOP/associação de produto, dar entrada em 2 cliques.
- **Lojas fora do Omie** (modo manual). Confirmado por Ramon que hoje ainda não opera fora do Omie.

---

## Resumo de viabilidade / ordem sugerida

| Fase | Itens | Esforço | Observação |
|---|---|---|---|
| A — Correções | 1,2,3,4,5,6,16 | 🟢🟡 | Rápidas, alto valor, sem risco. Item 6 = verificar antes. |
| B — Produtos | 8,9,10 | 🟢🟡 | Item 10 mexe no sync + backfill. |
| C — PDF | 7 | 🟡 | Visual. |
| D — Mobile | 15 | 🟡 | UI/PWA, sem backend. |
| E — Impressões | 13 | 🟢 | Join simples. |
| F — Login | 14 | 🔴 | Schema + auth; decisão do gate. Plano próprio. |
| G — Criar OP | 11 | 🔴 ⚠️ | Escreve no Omie; testar com Ramon. Plano próprio. |
| H — Sugestão de compra | 12 | 🔴 | Integra vendas + estoque mínimo. Plano próprio. |

**Dependências externas (cliente):** estoque mínimo no Omie (item 12), gate de cadastro (item 14), e o Ramon presente para testar escritas (itens 11 e finalizações).
