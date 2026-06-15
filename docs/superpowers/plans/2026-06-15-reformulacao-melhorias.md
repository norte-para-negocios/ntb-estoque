# NTB Estoque — Plano de Reformulação e Melhorias (visão geral)

> Ideias de evolução do sistema inteiro: dados (aproveitando toda a API), UX, e visual.
> Mantém a identidade atual (Linear/Vercel claro + ui-kit), mas eleva o nível.
> Intensidade: 🟢 refinamento rápido | 🟡 melhoria média | 🔴 reformulação grande.

## 1. Home → Painel de Comando (hoje é fraca) 🔴
Transformar a home num **dashboard de verdade** com o que importa no dia:
- KPIs ao vivo: **faturamento do mês** (Contas a Receber), **a comprar** (sugestão), **validades vencendo**, **OPs pendentes/atrasadas**, **NF pendente de entrada**, **erros de integração**.
- Mini-gráficos: faturamento do mês x mês anterior, top 5 produtos.
- Atalhos: Novo inventário / Nova transferência / Criar OP / Entrada de NF.
- Por loja e consolidado.

## 2. Produtos — ficha rica + dados da API 🔴
Hoje é uma lista. Aproveitar a API pra trazer muito mais:
- Colunas/atributos novos: **EAN, NCM, marca, fornecedor principal, giro de estoque, curva ABC, última compra, última venda**.
- **Ficha do produto** (clicar → página): histórico de movimento, evolução de preço/CMC/margem, compras x vendas, validade, locais.
- Foto do produto (se houver) e leitura por EAN.
- Alertas embutidos: abaixo do mínimo, sem CMC, inativo.

## 3. Busca global / Command Palette (Cmd+K) 🟡
Busca rápida de qualquer lugar: produto, NF, OP, transferência, inventário, loja — com navegação por teclado. (Hoje a busca é por tela.)

## 4. Central de Alertas / Notificações 🟡
Um sino/painel com: validades a vencer, estoque abaixo do mínimo, NF pendente de entrada, OP atrasada, erros de integração, certificado vencendo. Tudo num lugar, acionável.

## 5. Operação mais fluida (inventário/transferência/OP) 🟡
- Scanner QR **contínuo** com som de bip e contador (modo "balcão", sem parar a cada item).
- Atalhos de teclado (enter pra adicionar, +/- na quantidade).
- Histórico e "duplicar" mais visíveis.
- Conferência rápida com totais (X de Y, valor total).

## 6. Detalhes em tudo (drill-down) 🟡
Cada **fornecedor**, **nota fiscal**, **OP**, **local** vira uma página de detalhe com tudo relacionado (notas do fornecedor, itens da NF, malha da OP, produtos do local).

## 7. Visual / Design — refino e polish 🟡
- Tipografia e espaçamento mais respirados; hierarquia mais clara nos títulos/seções.
- **Micro-interações**: skeleton loaders no lugar de telas vazias, transições suaves, toasts melhores.
- **Dark mode** mais polido (contraste, cantos, bordas).
- Tabelas: densidade ajustável, colunas configuráveis, congelar a 1ª coluna no scroll.
- Empty states com ilustração e ação.

## 8. Mobile / PWA de verdade 🟡
- App instalável já existe; melhorar: gestos, bottom-sheet pra ações, scanner em tela cheia, offline básico pra contagem.
- Layout de contagem otimizado pra uma mão.

## 9. Performance e confiabilidade 🟢
- Optimistic UI em todas as ações (já em parte).
- Paginação infinita / virtualização nas listas grandes.
- Indicador de "última sincronização" e botão de forçar por recurso.
- Retry visível quando o Omie bloqueia (rate limit).

## 10. Configurações / personalização 🟢
- Preferências por usuário: tema, loja padrão, colunas visíveis, página inicial.
- Por loja: metas (% margem, % limite compras) que alimentam os indicadores.

## 11. Financeiro e Relatórios 🔴 (já no plano gigante, bloco 7-8)
Dashboards de faturamento, compras, faturamento×compras, fluxo de caixa, DRE, curva ABC — tudo via API, automático.

## 12. Entrada de NF + Sefaz 🔴 (plano gigante, bloco 5-6)
Puxar notas do Sefaz (certificado) e dar entrada em 2 cliques com validação fiscal.

---

## Como encarar (sugestão de fatiamento)
1. **Quick wins visuais** (🟢/🟡): skeletons, polish do dark, Cmd+K, central de alertas — deixam o sistema com cara premium rápido.
2. **Home/Dashboard** (🔴): maior impacto percebido.
3. **Produtos ricos + fichas** (🔴): valor diário.
4. **Operação fluida** (🟡).
5. O resto entra junto com o plano gigante (financeiro, NF, Sefaz).

> Observação: o Ramon já disse que **gostou do layout atual**. Então a recomendação é **elevar/refinar** (não jogar fora a identidade), a menos que você queira uma reformulação visual mais radical — aí a gente define uma nova direção de design antes.
