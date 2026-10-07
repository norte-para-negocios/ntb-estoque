# Plano de teste completo — Norte Vendas + Norte Estoque (modos de loja e estoque próprio)

Data: 07/10/2026. Vale para o SISTEMA (todas as lojas), não só para a ODARA. Cada caso tem: passo, resultado esperado, evidência (captura, linha de banco ou resposta). Resultado registrado em `docs/superpowers/plans/2026-10-07-resultado-teste.md` com PASSOU / FALHOU / NÃO TESTADO e o motivo.

## Regras do teste
- Lojas usadas: **ODARA BEACH** (modo próprio, Vendas `e73782c1-…`, Estoque id 15) e uma **loja nova de teste criada pelo próprio teste** (apagada no fim). Regressão de modo Omie só em **ZZ Laboratório** e **lojas de teste do Estoque (is_test)**. **Nunca o Sertão**, nunca escrever no Omie real.
- Fiscal só em **homologação**. Nenhuma nota em produção.
- Usuários de teste temporários (Vendas: gerente/caixa/garçom; Estoque: admin) criados e apagados pelo teste; senhas nunca impressas.
- Telas: Playwright em segundo plano, desktop 1440×900 e celular 390, claro e escuro; captura de cada tela nova.
- Tudo que o teste cria é registrado e apagado no fim (exceto o cardápio de teste da ODARA).

## A. Criação e conexão de loja (os dois sentidos)
1. Criar loja no **painel master do Vendas** pelo modal novo, modo **Estoque próprio**, só balcão, com Pizzaria em impressão direta e Bar em acompanhamento → aparece no Estoque com o mesmo CNPJ, modo próprio, locais Estoque Geral/Bar/Cozinha, famílias padrão, Bar e Cozinha mapeados, integração ligada nos dois lados.
2. Criar loja no **Estoque** pelo modal novo, modo próprio → aparece no Vendas sozinha (sem checkbox), ligada.
3. Editar nome/ativo/modo num lado → reflete no outro; troca de modo bloqueada depois do primeiro movimento (nos dois).
4. Criar loja modo **Omie** e modo **Sem estoque** → comportamento de hoje (Omie) e sem baixa (Sem estoque).
5. Modal: 70% da tela no desktop, tela cheia no celular, todas as seções, todos os campos antigos presentes, salvar/editar sem perder nada.

## B. Catálogo conectado
6. Criar **grupo → subgrupo → sub-subgrupo** no Estoque → categorias no Vendas (até 2 níveis), produtos na categoria do ancestral.
7. Criar **produto simples vendável** no Estoque (código 90xxx automático) → aparece no Vendas indisponível até ter categoria e preço; definir preço no Vendas → preço vale nos dois; Estoque não sobrescreve preço.
8. Criar **produto no Vendas** → aparece no Estoque com código por tipo.
9. Criar **produto mãe com variações** (ex.: Açaí 300/500/700 ml) no Estoque → no Vendas vira produto com grupo "Variação", preço base = menor, acréscimos certos, cada opção com o código da variação; mãe sem saldo.
10. Criar variação no Vendas → produto filho no Estoque com código.
11. Editar nome/inativar num lado → reflete no outro; reativar no Estoque não reativa no Vendas.
12. Insumo (80xxx) nunca aparece no cardápio.
13. Código repetido recusado; código não muda depois de criado; tela de divergências mostra o que não bateu.

## C. Locais
14. Criar local no **Vendas** (Configurações > Locais de estoque) → aparece no Estoque; criar no Estoque → aparece no Vendas.
15. Mapear Cozinha/Bar/Pizzaria (local de preparo) → local de estoque; venda de cada um baixa no local certo.
16. Inativar local com movimento (só inativa, não exclui); local padrão não inativa.

## D. Venda ponta a ponta (Vendas → Estoque)
17. Mesa: garçom lança itens de bar, cozinha e pizzaria com variação e adicional → impressão/tela conforme o modo de cada local → conta → pagamento (dinheiro com troco, cartão) → NFC-e **homologação** autorizada → baixa no Estoque por receita (insumos com fator de correção) no local certo → faturamento e lucro registrados.
18. Balcão: venda da equipe, receber agora e depois.
19. Reenvio do mesmo pedido não baixa duas vezes; item sem código aparece como pendente visível.
20. Cancelar item / estornar venda → estorno no ledger, faturamento cancelado.
21. Saldo negativo: vende, alerta, custo preservado.
22. Taxa de serviço, desconto e meio a meio refletidos no faturamento.

## E. Estoque operação (telas existentes)
23. **Ordem de Produção**: criar OP (molho), concluir parcial e total, consumo de insumos, custo do intermediário, reverter, excluir, recorrência, histórico e detalhe com movimentos, pesquisa e Excel.
24. **Ficha técnica/estrutura**: receita com sub-receita, FC, perda, rendimento, versão; custo ao vivo.
25. **Inventário**: criar (geral e curva A), contar sem ver saldo, motivo obrigatório acima do limite, venda durante a contagem, concluir, ajuste no ledger, PDF/Excel.
26. **Transferência**: criar entre locais, alterar quantidade (estorna e relança), concluir, excluir, perda/quebra, PDF/Excel.
27. **Movimentações**: busca livre, filtros (tipo, origem, local, família, usuário, negativos, estornos), filtro "só ordens de produção/notas/inventários/transferências/vendas", clique abre o documento de origem, totais, Excel/CSV.
28. **Estoque**: cartões, saldo por local, negativos, entrada/ajuste/mínimo/transferência, kardex do produto.
29. **Reposição**: abaixo do mínimo e sugestão de compra, CSV.
30. **Notas Fiscais**: consulta SEFAZ real com o certificado da ODARA (somente leitura, NSU, respeitar 656), nota com itens casados por de-para/EAN entra sozinha, item sem match fica a conferir, vincular aprende, upload de XML e lançamento manual como opção, reimportar não duplica, estorno.
31. **Validade**: lote e validade na entrada e na produção, alerta de vencimento (frente VAL).

## F. Relatórios
32. Faturamento, Margem, **Lucro**, Indicadores, Resumo, Mensal e Estoque Valorizado na ODARA com as vendas do teste: números batem com o banco (somas conferidas por SQL).
33. Lojas Omie: relatórios idênticos antes e depois.

## G. Regressão do modo Omie e do Vendas
34. Portão do Vendas completo (`scripts/e2e/portao-deploy.sh`) passando.
35. Telas do Estoque em loja Omie de teste: Notas Fiscais, OP, Inventário, Transferência, Movimentações, Locais iguais a antes (sem escrita no Omie real; usar loja `is_test`).
36. Nenhuma rota nova chama `omieRequest` em loja própria (testes de código já cobrem; conferir log).

## H. Segurança e robustez
37. Rotas de integração recusam chave errada; loja Omie recusa RPCs do ledger.
38. 20 vendas simultâneas no mesmo produto: saldo final = soma do ledger.
39. Falha de rede entre os sistemas: outbox reenvia, nada duplica, divergência aparece.

## I. Design
40. Capturas de cada tela nova e alterada (desktop/celular, claro/escuro), revisadas; nada genérico, nada cortado, sem rolagem horizontal, textos sem "Omie" no modo próprio.
