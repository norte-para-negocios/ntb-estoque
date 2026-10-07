# Resultado do teste completo — 07/10/2026

## QA1 — blocos A (loja), B (catálogo), C (locais), D (venda)

Contra produção em 07/10/2026 (Vendas c2a1d8b, Estoque 1f1a1ec), pelas telas (Playwright em segundo plano) e conferido no banco.
Lojas de teste ZZ QA ESTOQUE A1/A2/A4 criadas e apagadas; vendas e NFC-e de homologação feitas na ODARA (ficam lá). Capturas em `/tmp/qa1/`.

| Caso | Estado | Evidência / observação |
|---|---|---|
| A1 criar loja no Vendas (modal, Estoque próprio, Pizzaria impressão, Bar acompanhamento) | PASSOU | Vendas `stock_mode=proprio`, `locais_preparo_modo` certo, setor Pizzaria; Estoque loja com mesmo CNPJ, modo próprio, 3 locais, 5 famílias, Bar/Cozinha mapeados, chave nos dois lados. `a1-*.png` |
| A1b vínculo da loja criada pelo Vendas | FALHOU → corrigido na branch `qa1-fix` (Estoque 0f413f6, Vendas 3bdec69), não está no ar | `lojas.vendas_store_id` ficava vazio; o cron do Estoque "religava" pela rota do Vendas. Na ODARA isso **criou uma 2ª loja ODARA no Vendas** (02:03 UTC, antes do Vendas idempotente subir) e ligou o Estoque a ela. Dado corrigido na hora: loja duplicada apagada (0 produtos/pedidos), vínculo de volta para `e73782c1`. |
| A2 criar loja no Estoque (modal, próprio, sem marcar "criar no Vendas") | PASSOU | apareceu no Vendas ligada após o cron (≤10 min), modo próprio. Obs.: o modal ainda mostra o interruptor "Criar no NTB Vendas também" (a ligação já é automática) |
| A3 editar nome/ativa num lado → outro | FALHOU → corrigido na branch `qa1-fix` (não está no ar) | nome editado no Vendas não chegou ao Estoque (nem o contrário). Correção: PATCH de loja nos dois sistemas autenticado pela chave da loja + aviso após editar |
| A3b trocar modo depois do 1º movimento | PASSOU | banco do Estoque recusa ("A loja já tem movimentos…") |
| A4 loja "Sem estoque" / "Com Omie" | PASSOU | Sem estoque: `stock_mode=nenhum`, nada no Estoque; Com Omie é o padrão do modal |
| A5 modal 70%/celular | PASSOU | desktop 1008×810 em 1440×900; celular folha cheia, sem rolagem horizontal. `a5-*.png` |
| B6 grupo → subgrupo → sub-subgrupo | PASSOU | 1º nível virou grupo de categorias e 2º virou categoria no Vendas; 3º só no Estoque |
| B7 produto simples no Estoque → Vendas; preço | PASSOU (com bug) | chegou no Vendas (código 90001, categoria do ancestral, indisponível até ativar). Preço do Vendas vence; nome do Estoque propaga |
| B7b NCM | FALHOU → corrigido na branch `qa1-fix` (não está no ar) | NCM do Estoque não ia para o Vendas (payload sem `ncm`): NFC-e desse produto falharia "sem NCM" |
| B8 produto criado no Vendas → Estoque | PASSOU | ganhou 90002 e o código voltou ao Vendas |
| B9 produto mãe com variações (Estoque) | PASSOU | no Vendas: mãe sem código, grupo "Variação", preço base = menor, acréscimos certos, código por opção; mãe não aceita saldo |
| B10 variação criada no Vendas → filho no Estoque | PASSOU | 700 ml virou 90006 com preço 28,00 e o código voltou à opção |
| B11 inativar/reativar | PASSOU | inativar no Estoque inativou no Vendas; reativar não reativou (regra) |
| B12 insumo fora do cardápio | PASSOU | nenhum dos 14 insumos da ODARA está no Vendas |
| B13 código repetido/imutável, divergências | PASSOU | banco recusa código repetido; tela de divergências ok |
| B-extra grupos na volta do Vendas | FALHOU → corrigido (migration 143 na branch `qa1-fix`, testada em ROLLBACK, não aplicada) | (1) produto em grupo de 1º nível gerou subgrupo duplicado com o mesmo nome; (2) produto em sub-subgrupo foi "achatado" para o subgrupo do 2º nível |
| C14 local criado no Vendas ↔ Estoque | PASSOU | "QA1 Camara Fria" (Vendas→Estoque) e "QA1 Deposito Seco" (Estoque→lista do Vendas) |
| C15 baixa no local certo (Bar/Cozinha) | PASSOU | venda da ODARA baixou Bar e Cozinha. Mapeamento por setor (Pizzaria→local) do Vendas: NÃO TESTADO |
| C16 inativar local com movimento / padrão | NÃO TESTADO | regra só na ação da tela; sem tempo |
| D17 mesa ponta a ponta (ODARA) | PASSOU | garçom/gerente lançou 4 itens, conta R$ 96,00, dinheiro 200 → troco 104, **NFC-e homologação nº 1 autorizada**, baixa por receita (peixe 390 g pelo FC 1,3, cachaça 60 ml, limão 80 g…), faturamento e CMV gravados (17,00 / 3,555 / 18,63 conferidos à mão). `d17-*.png` |
| D18 balcão (nova venda, receber agora PIX, entregar) | PASSOU | NFC-e nº 2 autorizada; baixa no entregar (gin 50 ml + tônica pela receita). Obs.: texto do resultado diz "Produto sem estrutura (revenda)" mesmo para item com receita (só texto) |
| D19 reenvio do mesmo pedido / código desconhecido / chave errada | PASSOU | `duplicado:true`, saldo igual; item sem cadastro "pulada" visível; chave errada 401 |
| D20 estorno | PASSOU (parcial) | rota de estorno do Estoque devolveu ao ledger e cancelou a venda no faturamento; repetir não estorna 2×. Cancelar NFC-e de **homologação** só cancela a nota (de propósito, o estorno da venda só roda em produção) — cancelamento cStat 135 ok |
| D21 saldo negativo | PASSOU | vendeu 5 com saldo 2 → -3, alerta em `estoque_negativos`, custo 7,50 preservado |
| D22 taxa de serviço, desconto, meio a meio no faturamento | NÃO TESTADO | sem tempo |

Correções (sem push, sem deploy): Estoque `.worktrees/qa1-fix` commit `0f413f6` (NCM no payload, recusa ligar loja sem CNPJ, grava `vendas_store_id` na criação, PATCH de loja, aviso ao Vendas ao editar/ativar, migration `143_catalogo_sync_correcoes.sql` + teste SQL); Vendas `.worktrees/qa1-fix` commit `3bdec69` (manda `vendasStoreId`, PATCH de loja, rota `loja-atualizada`, teste). `tsc`, build e testes passam nos dois.

## QA2 — blocos E (operação do Estoque), F (relatórios), G (regressão Omie, parte Estoque), H (robustez), I (design)

Executado em 06–07/10/2026 contra produção (Estoque commit 91c486c no ar), loja ODARA BEACH (Estoque id 15), pelas telas (Playwright headless) e conferido no banco. Usuário admin temporário `qa2-temp@ntb-estoque.dev` (apagado no fim). Tudo que o QA2 criou foi desfeito pelas próprias telas (desfazer entrada da nota, excluir OP, inventário e transferência) ou por estorno; o histórico append-only do ledger fica. O QA1 vendia na mesma loja ao mesmo tempo, por isso os saldos foram conferidos por movimento, não por total.

| # | Caso | Resultado | Evidência |
|---|---|---|---|
| 23 | Ordem de Produção: criar (tela), concluir, custo do intermediário, detalhe, Excel, reverter, excluir | PASSOU (com bug de tela) | OP 2026/00001, 1000 g de "QA2 Molho da Casa": baixou 800 ml de leite de coco e 84 ml de dendê (40×2×1,05) na Cozinha, entrou 1000 g a R$ 0,01128/g, custo do lote R$ 11,28; detalhe mostra versão da ficha, insumos e movimentos; Excel 200; reverter gerou os 3 estornos; excluir ok. **Bug: a 1440 px a linha da OP fica escondida atrás do cabeçalho fixo** (só aparece ≥1536 px) — vale para todas as lojas → corrigido na branch `qa2-fix` (não está no ar). Concluir parcial pela tela do computador não existe (só pelo celular). |
| 24 | Ficha técnica (estrutura): criar com FC, perda, rendimento, versão, custo ao vivo | PASSOU | Versão 1, rendimento 500 g, custo R$ 0,0113/g = (400×0,012 + 40×1,05×0,02)/500. Sub-receita não testada pela tela (coberta só pelo teste SQL da Fase 2). |
| 25 | Inventário: criar por tipo, contagem cega, motivo acima do limite, concluir, ajuste no ledger | PASSOU | Inventário #553 (Bar): a tela não mostra saldo; Refri 30 (−18, R$ 57,60 > R$ 50) ficou "Aguardando motivo" até informar; Heineken −3; concluir → "Finalizado", AJU no ledger com o motivo na observação; refazer quantidade estorna e relança (verificado). "Venda durante a contagem": não testado pela tela (a diferença é calculada contra o saldo no momento de lançar o item). |
| 26 | Transferência: criar, alterar quantidade, concluir, excluir | PASSOU | #1401 Estoque Geral → Bar Heineken 10 → 12: estornou as duas pernas de 10 e lançou 12; custo médio R$ 8,50 inalterado; excluir estornou tudo. **Bug: o kardex mostrava o id do usuário (uuid) em "Usuário" nas transferências** → corrigido em `qa2-fix`. |
| 27 | Movimentações: busca, filtros por origem, clicar e abrir o documento, totais, Excel/CSV | PASSOU com falhas → corrigidas na branch | Filtro por origem ok (Produção 3, Inventário 5, Transferência 4, Venda 34); totais ok; CSV 113 linhas, Excel 200. **Bugs:** (1) a tabela do kardex (1.204–1.216 px) é mais larga que o cartão (1.088 px) e cortava a coluna Custo e o botão de detalhe em todas as larguras de computador; (2) o detalhe só tinha "Abrir documento" para inventário — OP, transferência e venda não abriam o documento → os dois corrigidos em `qa2-fix` (não está no ar). |
| 28 | Tela Estoque: cartões, saldo por local, entrada com custo, mínimo | PASSOU | Entrada de 1000 g de limão a R$ 0,008 no Estoque Geral → custo médio 0,006224 (bate com a média ponderada); mínimo 5000 g no Bar salvo. Observação: custo médio de item em grama aparece "R$ 0,01" (2 casas esconde o valor real). |
| 29 | Reposição: abaixo do mínimo, sugestão, CSV | PASSOU | Limão no Bar 2.920 de 5.000 g, comprar 2.080 g, R$ 16,64; CSV correto. Cartão "Mínimos definidos" mostrava o texto "no produto" → corrigido em `qa2-fix`. |
| 30 | Notas Fiscais: consulta SEFAZ real, importar XML, conferência, entrada, reimportar sem duplicar, desfazer | PASSOU (SEFAZ sem notas) | Consulta real NFeDistribuicaoDFe com o certificado da ODARA já tinha rodado pelo cron às 23:10: **cStat 137 "Nenhum documento localizado"**, 0 documentos, próxima consulta liberada às 00:10 (respeitado, não consultei de novo). Importação de XML de teste (fornecedor fictício, chave válida): itens ligados por nome, fator CX→G 20.000 e FD→UN 12, entrada a R$ 0,0061538/g e R$ 1,53846/un (frete rateado), de-para aprendido, reimportar mostra "já foi importada" e não duplica; "Desfazer entrada" estornou. Conferência automática por de-para/EAN com nota real da SEFAZ: não testada (não há nota real ainda). |
| 31 | Validade | NÃO TESTADO / FALHOU no requisito | A tela abre, mas em loja de estoque próprio lê só ordens do Omie; lote e validade (frente VAL) não foram feitos. |
| 32 | Relatórios contra SQL | PASSOU com 1 bug → corrigido na branch | Faturamento, Indicadores e Lucro mostram R$ 96,00 (2 vendas do QA1); Lucro: custo R$ 39,19 e margem 59,2% batem com o ledger (isca 18,63 + Heineken 17,00 + caipirinha 3,56). **Estoque Valorizado R$ 5.008,02 contra R$ 5.008,53 no SQL**: a projeção guardava o custo médio antigo nos outros locais quando uma entrada mudava o custo → migration 143 em `qa2-fix` (testada em ROLLBACK, **não aplicada**). |
| 33 | Relatórios de loja Omie iguais | PASSOU (leitura) | Loja de teste 12: Notas Fiscais, Inventários, Transferências, Movimentações, Locais e OP abrem sem erro, só leitura. |
| 35 | Telas do Estoque em loja Omie | PASSOU (leitura) | Idem 33; `/estoque` dá 404 em loja Omie (por desenho). |
| 36 | Loja própria nunca chama Omie | PASSOU | Nenhuma tela de loja própria mostrou erro de Omie; regressão coberta pelos testes de código. |
| 37 | Chave errada / loja Omie | PASSOU | Rotas de integração com chave errada: 401; `registrar_movimento` em loja Omie: "A loja 2 não usa estoque próprio". |
| 38 | 20 vendas simultâneas | PASSOU | 20 de 20 ok, Heineken no Bar 48 → 28, soma do ledger 28, 20 saldos-após distintos; 20 estornos devolveram a 48. |
| 39 | Queda de rede entre os sistemas | NÃO TESTADO | Não dá para derrubar a rede de produção com segurança. |
| 40 | Design (capturas) | PASSOU com observações | `/tmp/qa2/` (desktop/celular, claro; escuro no desktop pelo botão do app — o app não segue o tema do sistema). Sem rolagem horizontal e sem erro de página em 31 telas. Textos "Omie" em loja própria (vazio de Notas Fiscais e Produtos, botão "Importar do Omie" da Margem, subtítulo do Estoque Valorizado, card de Relatórios, alerta de sincronização no Início) → corrigidos em `qa2-fix`. Visual: rótulos do formulário de produto não ligados aos campos (acessibilidade); ficha técnica com o texto do rendimento espremido; cartão de limite de motivo do Inventário apertado no celular; botões de ação da OP sem nome acessível; produtos da ODARA sem família (dado da semente). |

**Correções na branch `qa2-fix` (Estoque, NÃO estão no ar, sem push):** `4bce04c` cabeçalho fixo e kardex largo; `2a06cd4` links do detalhe e usuário da transferência; `d43397b` textos sem Omie, reposição, PDV padrão por tipo; `e07de60` migration 143 (custo projetado em todos os locais). `tsc`, `npm run build` e 133 testes passaram.

## QA rodada 2 (07/10/2026, madrugada) — reteste do que está no ar + OP automática + casos pendentes

Contra produção: Vendas `3bdec69`, Estoque `c55c0a1` → `de0558d` (o deploy da validade entrou no meio do teste). Telas por Playwright em segundo plano, conferência no banco. Loja de trabalho: ODARA BEACH; loja de teste criada e apagada: `ZZ QA R2`. Capturas em `/tmp/qa3/`.

| Caso | Resultado | Evidência |
|---|---|---|
| A. Loja criada pelo modal do Vendas (modo próprio) grava o vínculo e NÃO duplica | PASSOU | Vendas `e17c5226…` ↔ Estoque 18, `vendas_store_id` gravado; 25 min depois (cron rodou) 1 loja em cada lado, ODARA também 1. |
| A. Nome/ativo propagam nos dois sentidos | PASSOU | Vendas → Estoque "ZZ QA R2 EDIT V"; Estoque → Vendas "ZZ QA R2 EDIT E"; Desativar no Estoque → `is_active=false` no Vendas. |
| A. NCM chega ao Vendas | PASSOU | Produto criado pela tela do Estoque com NCM 20098990 → `products.ncm=20098990`, código 90011. |
| A. Grupos sem duplicar (143) | PASSOU | Grupo "QA3 Grupo" › "QA3 Sub" → categoria "QA3 Sub" no grupo "QA3 Grupo" no Vendas; após o cron, 0 grupos/categorias duplicados. |
| A. Insumo novo não é PDV | PASSOU | "QA3 Polpa de Caju" (80015) `pdv=false`, não foi ao Vendas. |
| A. OP visível com 1 linha a 1440 px | PASSOU | linha começa em y=462, logo abaixo do cabeçalho. |
| A. Kardex sem corte | FALHOU → corrigido em `qa3-fix` | A tabela rola, mas a coluna Produto ficava espremida ("Farinha de Tr…", "Açúcar Refin…"). Largura mínima legível quando a lista rola. |
| A. Detalhe do movimento abre OP/venda/inventário | PASSOU | Filtro "Produção" → movimento #371 → "Abrir documento" → `/ordem-producao/48630222`. Venda e inventário com link. |
| A. Nome do usuário na transferência | FALHOU parcial → corrigido em `qa3-fix` | Transferências antigas do usuário QA2 (apagado) mostravam o id longo na lista e no detalhe; o detalhe mostrava o id mesmo de usuário vivo. Agora: nome do perfil, ou "Usuário removido". |
| A. Estoque Valorizado = banco | PASSOU | Tela R$ 4.925,82 = posição do dia 4925,82 = ledger 4925,82. |
| A. "Omie" fora do modo próprio | FALHOU → corrigido em `qa3-fix` | Famílias (botão "Puxar do Omie", coluna "Código Omie", texto), Margem, Indicadores e Minha loja ainda citavam o Omie. |
| B. Venda na tela do Vendas gera OP automática | PASSOU | Mesa 7 (Caipirinha + Isca + Heineken), R$ 82, NFC-e homologação nº 3 autorizada; OPs 2026/00004 (custo R$ 3,57) e 2026/00005 (R$ 18,63) criadas por "Norte Vendas", concluídas, no Bar e na Cozinha; Heineken saiu sem OP. |
| B. Abrir a OP e ver os movimentos | PASSOU com observações → corrigido em `qa3-fix` | Detalhe completo (receita, insumos, custo, movimentos). Mas: "Criada/Concluída" apareciam em 06/10 21:00 (data sem hora lida como UTC) e "Venda de origem" mostrava o ref cru. |
| B. Lista de OPs mostra a origem | FALHOU → corrigido em `qa3-fix` | Número da OP cortado ("2026/000…") e sem selo de origem: o selo "Veio do Norte Vendas" e o filtro de origem só reconheciam a OP do Omie. |
| B. Reenvio não duplica OP | PASSOU | Mesma venda reenviada: 2 → 2 OPs, 168 → 168 movimentos, `duplicado: true`. |
| B. Estorno reverte as OPs | FALHOU → corrigido em `qa3-fix` | Revertia, mas as OPs ficavam "Pendente" na lista, como se faltasse produzir. Agora o estorno exclui a OP (como no Omie), a trilha fica em `op_historico` e o detalhe do movimento não linka para OP excluída. Estorno repetido não devolve de novo. |
| C. Inativar local com movimento / local padrão | PASSOU | Excluir "Bar" recusado ("já tem movimentos… marque como inativo"); inativar Bar OK e reativado; inativar "Estoque Geral" recusado ("o local padrão não pode ser inativado"). |
| C. Taxa de serviço no faturamento | FALHOU → corrigido em `qa3-fix` (Vendas) + migration 147 (Estoque) | Com a taxa ligada, mesa 8 pagou R$ 66 (60 + 6) e o faturamento gravou R$ 60, taxa 0: sem o produto "Taxa de Serviço" cadastrado a taxa sumia. Agora entra o que foi pago (total − itens), respeita "Tirar a taxa". 147: a taxa não acende "item sem baixa" no Lucro. Achado extra: o modal do Master grava `service_fee_rate` mas não liga `charge_service_fee` — loja nova não cobra taxa até o lojista ligar (decisão de produto, não alterado). |
| C. Desconto | NÃO SE APLICA | O pagamento do Vendas não tem desconto; a Cortesia entra como forma de pagamento "COURTESY" (R$ 7,70 na mesa 1), coerente com o Omie. |
| C. Meio a meio | NÃO TESTADO | A ODARA não tem pizza/produto com grupos "maior valor"; não criei um cardápio de pizza só para isso. |
| C. Sub-receita pela tela da ficha | PASSOU (com a 148) | Editor: "QA3 Molho Base" (06, rende 100 ml: 100 ml leite de coco + 10 ml dendê) dentro de "QA3 Moqueca Teste" (200 g peixe FC 1,3 + 100 ml molho). Abrir na venda desligado: OP consome peixe 260 g + molho 100 ml; ligado: peixe 260 g + leite de coco 100 ml + dendê 10 ml (teste em transação desfeita). |
| C. Venda com sub-receita | FALHOU → corrigido (migration 148) | **CRÍTICO, no ar:** a venda falhou com "null value in column lote_id" — a 145 (lotes) quebra a saída de qualquer item que nunca teve lote naquele local (saldo indo a negativo). Toda venda/OP que consome insumo sem estoque no local cai assim. A 148 corrige; teste SQL falha sem ela e passa com ela. **Não aplicada.** |
| C. Venda durante contagem aberta | PASSOU | Inventário #554 (Bar): contado 43 com sistema 45 → AJU −2 (saldo 43); venda de 1 Heineken → 42; concluir não lançou ajuste extra. |
| C. Setor Pizzaria → local (feito no Vendas) | PASSOU | Local de estoque "QA3 Forno" e local de preparo "QA3 Pizzaria" criados no Vendas (o local apareceu no Estoque), Petiscos → QA3 Pizzaria → QA3 Forno; venda de Porção de Batata pela tela: OP consumiu batata/óleo e saiu do QA3 Forno. |
| C. Queda de conexão entre os sistemas | PASSOU | Integração desligada no Vendas, venda na mesa 10, nenhuma baixa; religada às 01:21, a varredura baixou em 3 min: 1 OP (Gin Tônica), 2 saídas, sem duplicar após mais ciclos. (A taxa dessa venda também sumiu — mesmo bug acima.) |
| D. Início, Resumo, Mensal, Estoque Valorizado | PASSOU | Todas as 25 telas do Estoque abriram com 200 e sem erro na ODARA (varredura `s1`). |

**Achado de infraestrutura (não corrigido):** o `deploy.sh` do Estoque compila dentro da pasta em produção: durante os ~3 min do build o site no ar devolve 500 nos arquivos `_next/static` (visto em Movimentações enquanto o deploy da validade rodava). Build em pasta separada e troca no fim resolveria.

**Observações menores (não corrigidas):** "Abrir documento" da venda leva ao kardex filtrado, não ao pedido; movimento de venda sem usuário (poderia mostrar "Norte Vendas"); o carimbo de usuário diz "NTB Estoque · nome" (material ao cliente deveria dizer "Norte Estoque"); produto criado no Estoque com categoria e preço chega ao Vendas indisponível; inativar o local mapeado para o Bar é permitido sem aviso.

**Correções (sem push, sem deploy):**
- Estoque, branch `qa3-fix` (`.worktrees/qa3-fix`): `2fe68e7` (OP no estorno, lista e detalhe da OP, detalhe do movimento, kardex, usuário, Famílias/Margem/Indicadores/Minha loja, migration 147 + teste) e `d8f6176` (migration 148 + teste). **Aplicar 148 com urgência** (147 também), nesta ordem, antes do deploy da branch.
- Vendas, branch `qa3-fix` (`.worktrees/qa3-fix`): `609c6e8` (taxa de serviço paga no faturamento do estoque próprio + teste). Precisa do portão.

**Limpeza:** loja ZZ QA R2 apagada nos dois sistemas; usuários temporários (Master, universal, gerente da ODARA, admin do Estoque) apagados; na ODARA: OPs pendentes de teste excluídas (trilha em `op_historico`), produtos QA3 com ficha inativados e os demais apagados, grupos/categoria QA3, setor QA3 Pizzaria e mapeamento removidos, QA3 Forno esvaziado (estoque devolvido à Cozinha) e inativado, taxa de serviço desligada como estava, turno do gerente temporário fechado. Ficam na ODARA, como registro: as vendas das mesas 7 (estornada só no Estoque), 8, 9, 10 e 1, a NFC-e de homologação nº 3 e o inventário #554.
