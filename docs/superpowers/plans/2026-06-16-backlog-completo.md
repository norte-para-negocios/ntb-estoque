# Backlog COMPLETO — NTB Estoque (tudo que falta, consolidado em 16/06/2026)

> Junta os pedidos da reunião 16/06 (`2026-06-16-pedidos-reuniao.md`) com o que
> ainda está aberto do plano gigante (`2026-06-15-plano-gigante.md`). Cada item
> diz o comportamento esperado. Marcadores: 🟢 dá pra fazer já · 🟠 depende do
> Ramon (fiscal/escrita) · 🔵 depende do André (infra/Vendas) · ⚪ stand by.
>
> **✅ FEITO e no ar (16/06 noite):** A1, A2 (validade por dias + recorrência,
> validado em tela) · A3 (escolher data na conclusão) · A7 (busca de produtos:
> limite 50 + ordena por código) · C3 (minimo/quantidade aceitam decimais —
> bug `step=1` confirmado ao vivo) · C5 (código em coluna própria) · C8 (validade:
> 60 dias + filtro Vencidos) · B4 (conferência só com o nome do local) · C6
> (margem-alvo salva no perfil) · D1 (dashboard: bloco "Repor estoque" + alerta de
> ruptura, validado em tela). D2 (últimas notas) e D4 (vencimentos) já existiam.
> Criacao/escrita no Omie segue para teste com o Ramon.

---

## A. ORDEM DE PRODUÇÃO

### A1. Validade por DIAS, não por data 🟢  ⭐ (refinamento do fundador)
Na criação da OP você escolhe **só o dia** (data de início/produção) e a **validade em QUANTOS DIAS** (ex.: 30). O sistema calcula a data de validade = **dia + X dias**. Não escolher uma data de validade fixa.

### A2. Validade na recorrência = dia da ocorrência + X dias 🟢  ⭐
Decorre do A1. Hoje todas as OPs recorrentes herdam a validade da 1ª (bug). Com validade em dias, cada ocorrência calcula sozinha: **data daquela repetição + X dias**. Cálculo simples, automático. (Ex.: 1ª 23/06 +30 = 23/07; 2ª 30/06 +30 = 30/07.)
> **Técnico (API):** o Omie recebe a validade como **data**, no array `lote_validade` do `IncluirOrdemProducao` (campo `dDataVal`, ex. 08/09/2025) — **não** aceita "dias". Então o "X dias" fica só na nossa UI: guardamos os dias, calculamos `dDataVal = data da OP + X dias` **por ocorrência** e enviamos o valor certo em cada OP. É por isso que o bug se resolve 100% do nosso lado.

### A3. Concluir OP na data prevista + escolher a data 🟢
Hoje conclui na data de **hoje** e não dá opção de escolher. Tem que concluir na **data prevista da OP** e permitir **escolher a data** de conclusão (retroativa).

### A4. Concluir VÁRIAS OPs atrasadas de uma vez 🟢
Filtro (atrasadas) + botão "concluir todas". Como o Omie processa **uma de cada vez** e não deixa concluir outra enquanto calcula a anterior, fazer uma **fila com intervalo** entre cada conclusão (respeitar o tempo do Omie).

### A5. Reverter conclusão + excluir OP 🟢
- **Reverter**: numa OP concluída, botão que **cancela a conclusão** e volta o status (prevista/pendente/atrasada).
- **Excluir**: apagar OPs **abertas**, com **permissão** (ver A10).

### A6. Tratar o erro do Omie ao concluir 🟢
Quando falta saldo do insumo no local, o Omie devolve "não será possível gerar movimento de estoque". Mostrar isso de forma clara: **qual insumo faltou e em qual local** (não um erro cru).

### A7. Busca de produtos na criação de OP 🟢
- Hoje **faltam produtos** (ao buscar os 70mil de produção, não vêm todos) — investigar/corrigir o truncamento.
- **"Buscar na lista"**: busca por código **dentro da própria lista** já montada (além da busca geral do sistema).
- **Lista de seleção por família**: escolher a família e puxar a lista toda de produtos.

### A8. Coluna de validade mais fina 🟢
Na lista de produtos da OP a coluna de validade está larga demais — afinar.

### A9. Filtro de data da listagem não cortar 🟢
O filtro default (mês corrente) cortava OPs criadas para julho. Ajustar para não esconder OPs futuras/previstas.

### A10. Permissão de excluir no perfil de produção 🟢
Adicionar a permissão "excluir" no cadastro de perfil (produção) — habilita A5.

### A11. Quantidade decimal na etiqueta 🟢
A etiqueta arredonda a quantidade decimal (3,9 saiu 4). Verificar se deve **imprimir o decimal**.

### A12. Status "prevista" abaixo do produto ⚪ (baixa prioridade)
Mover o status para baixo do nome libera espaço — mas o layout atual já está ok.

---

## B. TRANSFERÊNCIA

### B1. Motivo (perda/quebra) funcionando 🟢
Confirmar que o **motivo** aparece e grava (TRF/TPQ + perda/quebra entre locais). Ficou a dúvida se está completo.

### B2. Observação automática com quem fez 🟢  ➡️ ver item TRANSVERSAL T1
Na reunião isso apareceu na **transferência** (a observação no Omie), mas o Joaquim disse "é uma automação **também**". Decisão: vale para **toda escrita do NTB no Omie** — ver **T1** abaixo.

### B3. "Buscar na lista" + seleção por família 🟢
Mesma melhoria da OP (A7) aplicada à transferência.

### B4. Relatório/conferência sem os números 🟢
No relatório/lista de conferência, **tirar os códigos numéricos** e deixar só o **nome do local**.

---

## C. PRODUTOS / COMPRAS / ESTOQUE MÍNIMO

### C1. Cadastro de produto COMPLETO 🟠 (escreve no Omie — testar com Ramon)
A criação tem que ser **bem maior**. Campos: **família** (obrigatório), **NCM** (obrigatório, com **lista para escolher**), **origem da mercadoria**, **tipo do produto**, **unidade**, **"vendido por loja ou não"** e demais campos fiscais. O código aceita letras.

### C2. Excluir produto 🟠
Botão de excluir produto (não existe) — inclusive limpar produtos de teste. Com permissão.

### C3. Editar estoque mínimo salvando/enviando 🟢
Editar o mínimo no NTB não está funcionando ("tentei editar, não edita"). Tem que **salvar e refletir no Omie** quando for o caso.

### C4. Alerta de mínimo em 2 níveis 🟢
- **Chegou** no mínimo → 1º alerta (atenção).
- **Baixou** do mínimo → 2º alerta (dispara compra).
Hoje só considera **abaixo** do mínimo. Incluir o "chegou no mínimo".

### C5. Código separado da descrição 🟢
Onde o código está colado no nome, separar em **coluna própria** (código | descrição).

### C6. Margem-alvo salva no perfil 🟢
Quando o usuário define a margem (ex.: 75%), **fica salva** no perfil dele.

### C7. Exportar Excel + PDF da sugestão de compra 🟢
- Exportar **.xlsx direto** (o CSV traz valor com ponto e não dá pra calcular).
- **Melhorar o visual/densidade** da planilha ("tá feia").
- **Imprimir/exportar PDF** da sugestão de compra, com mais opções de exportação.

### C8. Filtro de validade com mais opções 🟢
Mais opções de filtro e ordenação (A→Z) na tela de Validade.

### C9. Insight de consumo × compra 🟠 (liga com relatórios)
Sinalizar compra "à toa" — produto com 1 consumo no mês e compra de 3 litros. Cruzar consumo (vendas) com compras.

---

## D. DASHBOARD / HOME / ALERTAS

### D1. Bloco "stocks prestes a ruptura" 🟢
No Home: produtos **próximos da ruptura, zerados ou negativos** — mostrar os **principais** + "ver mais" (não todos, pra não poluir).

### D2. Últimas notas carregadas 🟢
Bloco com as últimas NFs carregadas.

### D3. Acessos rápidos 🟢
Atalhos para **inventários e transferências abertas** (ótimo no celular).

### D4. Produtos vencendo 🟢
Destaque dos produtos com validade próxima.

### D5. Alertas por e-mail 🟢/🟠
Quando atingir/baixar do mínimo, avisar o gestor no **e-mail cadastrado**. (Depende de configurar envio de e-mail.)

### D6. Alertas por WhatsApp 🔵 (precisa servidor)
Mesma ideia via **Evolution API** (free tier ~US$5/mês num servidor). Avisos do sistema no WhatsApp do gestor.

### D7. Leitura de QR trazer nome + foto 🟢
Na leitura do QR (recolhe/transferência), trazer **nome do produto + informações + foto** (revenda: foto online; prato/produto acabado: foto). Hoje só vem o código.

---

## E. RELATÓRIOS + AMBIENTE BETA  (Bloco 7/8 do plano gigante)

### E1. Relatórios financeiros 🟢 (Joaquim já vai começar — planilhas em mãos)
Seguir as 5 planilhas (FAT_DRV, MOV_DRV, COMVSFAT, NFS_ENT_DRV, IND_PER): Faturamento (por produto/família/forma de pgto, margem com CMC), Entrada de NF (compras por fornecedor/tipo), Movimentações (entradas/saídas/rejeito/PDV), **Faturamento × Compras** e **× Rejeito** (indicadores).

### E2. Dashboards + export PDF 🟢
Visualizações + exportação PDF; atualização automática (cron).

### E3. Ambiente/link BETA 🟢
Aba/botão **"ver beta"** separado, com relatórios + certificado + features novas, para as lojas **testarem**; quando estável, integra no principal.

---

## F. CERTIFICADO / SEFAZ / ENTRADA DE NF  (depende do Ramon)

### F1. Certificado das 2 lojas 🟠
**Donana Praia do Forte** e **Donana Brotas** (as bloqueadas no Omie). Ramon fornece o **.pfx + senha**; upload manual pela tela já pronta.

### F2. Puxar NFs via certificado 🟠
Com o certificado, puxar as notas direto para dentro do sistema.

### F3. Manifestação Sefaz (dfedocs) 🟠
`ListarDocumentos`/dfedocs — notas recebidas do Sefaz.

### F4. Entrada de NF em 2 cliques + validação fiscal 🟠
Listar pendentes, validar CFOP/categoria/impostos (ex.: uso-consumo 90 vs revenda 60), concluir o recebimento.

---

## G. INTEGRAÇÕES / INFRA  (depende do André — reunião quinta 18/06)

### G1. Integrar Norte Vendas (do André) 🔵
Integrar o **Norte Vendas** com o NTB Stock **via API**, mantidos **separados** (objetivos diferentes).

### G2. Migrar Norte Vendas de infra 🔵
Tirar do servidor **Contabo** e levar para **GitHub + Supabase + Vercel** (mais barato/seguro).

### G3. Token de acesso ao banco 🔵
André gera o **token** para puxar dados do Norte Stock/Vendas.

### G4. Domínio no Vercel 🔵
Apontar o domínio próprio no Vercel.

---

## H. CADASTROS QUE ESCREVEM NO OMIE  (Bloco 9)

### H1. Testar disparo real de produto/local no Omie 🟠
Código pronto (9.1/9.2); falta **testar o disparo real** com o Ramon presente.

### H2. Cadastro de fornecedor/cliente ⚪ (stand by)
`IncluirCliente`/`AlterarCliente` (base de 3.350).

### H3. Editar empresa ⚪ (stand by)
`AlterarEmpresa` — refletir edições no Omie.

---

## I. MARKETING / ROLLOUT

### I1. Vídeo de apresentação 🟢
Vídeo das atualizações (o "mexão", funcionalidades novas) para o **Instagram** (NTB Stock / Norte Stock + integrações).

### I2. Rollout das lojas 🟠
A partir de quinta; começar por **Brotas e Sertão** (as que mais trabalham). Virar pelo menos 2 lojas nesta semana.

### I3. Reunião com André — quinta 18/06 à noite 🔵
Alinhar G1–G4 (Vendas, infra, token, domínio).

---

## T. TRANSVERSAL (vale para o sistema todo)

### T1. Carimbo "NTB Estoque · usuário" em TODA escrita no Omie 🟢
Toda movimentação/cadastro que o sistema gravar no Omie — **transferência, OP, inventário/ajuste e os cadastros** — leva na **observação** o carimbo `NTB Estoque · [usuário logado]`. Rastreabilidade de quem fez e de que veio do nosso sistema. (Responde à dúvida da reunião "era só transferência, os dois ou tudo?" → **é tudo**.) Pega o usuário do login (não inventar nome).

---

## J. O QUE A API DO OMIE DESTRAVA (oportunidades novas, além do que foi pedido)
> Da varredura da API (escrita) em 16/06. Tudo que escreve no Omie só dispara em teste com o Ramon (regra 9.5).

### J1. Sugestão de compra → Pedido de Compra real no Omie 🟠
`v1/produtos/pedidocompra` é escrita. Em vez de só exportar Excel/PDF (C7), **gerar o pedido de compra no Omie** a partir da sugestão (escolher fornecedor + quantidades). Fecha o ciclo da compra dentro do sistema.

### J2. Aplicar preço de venda no Omie pela margem 🟠
`v1/produtos/tabelaprecos` (e `AlterarProduto`) são escrita. Na tela de Preços, botão para **aplicar o preço sugerido** (calculado pela margem-alvo) direto no Omie — hoje só mostramos o sugerido.

### J3. Foto do produto via Anexos 🟢
`v1/geral/anexo` cria/edita anexos. A **foto** pedida na leitura/QR (D7) pode ser anexada ao produto no Omie ou guardada no nosso Storage e exibida.

### J4. Criar família nova no cadastro de produto 🟠
`v1/geral/familias` é escrita. Como a família é obrigatória (C1), permitir **criar uma família nova** na hora do cadastro, sem sair da tela.

### J5. Lotes e validade reais do estoque 🟢
`v1/produtos/produtoslote` (consulta) traz os lotes/validades que já existem no estoque — alimenta a tela de **Validade** com dado real (não só o que a gente lança nas OPs).

### J6. Entrada de NF + Sefaz (confirma F3/F4) 🟠
`recebimentonfe` (editar/concluir) + `dfedocs` (manifestar) confirmam o caminho da entrada de NF em 2 cliques e da manifestação no Sefaz.

---

## Verificações pontuais
- **Dark mode**: na reunião voltava ao branco ao reabrir — concluíram que era o navegador. Confirmar que a persistência do tema está ok.
- **Mobile**: continuar o polish (já houve uma varredura) — "puxar"/scroll suave nas listas.

---

## Ordem sugerida (do que dá pra fazer JÁ, sem Ramon/André)
1. **A1 + A2** — validade em dias + cálculo na recorrência (resolve o bug e o refinamento juntos). ⭐
2. **A3** — concluir OP na data prevista + escolher data.
3. **A5 + A10** — reverter conclusão + excluir OP (com permissão).
4. **A7 / B3** — busca de produtos completa + "buscar na lista" + seleção por família.
5. **A6** — erro de conclusão claro (qual insumo faltou).
6. **C3** — editar estoque mínimo salvando/enviando.
7. **C5, C6, C8** — código separado, margem no perfil, filtro de validade.
8. **C7** — exportar Excel + PDF da sugestão de compra.
9. **B2, B4** — observação automática + relatório de conferência sem números.
10. **D1–D4, D7** — Dashboard/Home (rupturas, acessos rápidos, vencimentos, QR com nome/foto).
11. **C4 + D5** — alerta de mínimo em 2 níveis + e-mail.
12. **A8, A9, A11, A12** — ajustes finos da OP.
13. **E1–E3** — relatórios + ambiente beta (Joaquim já começa).
14. **C1, C2 / H1** — cadastro de produto completo + excluir (testar disparo com Ramon).

> Depende de terceiros: F (certificado/Sefaz/NF) e I2 com o **Ramon**; D6 (WhatsApp), G (Vendas/infra) e I3 com o **André** na quinta 18/06.
