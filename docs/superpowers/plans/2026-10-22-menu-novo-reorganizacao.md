# Menu novo e Central dos módulos: análise e plano (22/10/2026)

Só desenvolvedores veem (`/central`, menu novo). Nenhuma mudança para clientes.

## Diagnóstico (o que deixava o menu pior que o antigo)

Levantado do código e do relatório por modo de loja (estoque próprio × Omie, script `organizar` com ctx de cada modo).

1. **Caminho mais longo.** No menu antigo, um clique abre a tela. No novo era menu → central → tela (2 cliques), e a central pedia leitura.
2. **Dois nomes para a mesma tela.** Menu antigo "Ordens de Produção", cartão "Ver ordens de produção"; "Inventários" × "Fazer um inventário" × "Criar um inventário" × "Ver inventários". Quebra "um nome por coisa".
3. **A mesma tela em vários lugares.** Transferências aparecia 3× (Estoque, Produção como criar e como cadastro); Notas Fiscais em Dashboard, Compras e Fiscal; Central de correções em Dashboard e Estoque.
4. **Categorias erradas.** "Cadastros" tinha Transferências, Pedidos, Requisições, Notas (são operações/documentos, não cadastro); "Consultar" e "O que você quer fazer?" misturavam telas iguais.
5. **"Dashboard" não abria o dashboard.** Abria uma página de cartões que repetiam outros módulos.
6. **Cartão em destaque aleatório.** Era o primeiro visível; na loja Omie virou "Ver ordens de produção" por acaso.
7. **Cabeçalho alto demais.** ~250 px de cabeçalho com 3D e busca antes do primeiro botão; a busca repetia a busca global.
8. **"+ Novo" sem formulário.** OP levava ao passo 2 (tela "Comece pela tela de Ordens…"); cadastros com modal abriam só a lista. (Corrigido em 22/10 com `?criar=1`.)
9. **Lojas Omie (5 de 6 lojas) quase vazias** em Compras/Fiscal/Finanças porque os itens novos são só de estoque próprio — esperado, mas o módulo precisa continuar útil com o que sobra.

## Regras (o que guia a nova organização)

- **Uma tela, um nome, um lugar.** Nome = o do menu antigo; aparece igual no menu lateral, na central e no título. Nenhuma repetição entre módulos (o teste falha se repetir).
- **Um clique até qualquer tela.** O módulo abre no menu lateral com todas as telas e cadastros dele.
- **Criar é botão, não tela.** Cada módulo tem uma faixa "Novo" com as ações de criar documentos (pedido, nota, OP, inventário, transferência, conta a pagar). Criar cadastro (produto, fornecedor, local…) fica no cartão do próprio cadastro.
- **Cadastro é só cadastro**: produtos, locais, famílias, grupos, fornecedores, compradores, categorias, contas, usuários, cargos, lojas.
- **Destaque fixo e explícito** (`principal`): a tela mais usada do módulo.
- **Dashboard abre o painel** (`/home`) direto.
- Cabeçalho baixo; o 3D fica, menor.

## Onde cada coisa mora

| Módulo | Novo | Telas | Cadastros |
|---|---|---|---|
| Dashboard (abre /home) | — | Painel do dia, Resumo operacional, Feito pelo robô | — |
| Estoque | — | **Estoque**, Central de correções, Movimentações, Validade, Reposição, Kardex (Omie), Ajustes, Fichas que usam o insumo, Quem mexeu, Sincronização Vendas | Produtos, Locais, Famílias, Grupos |
| Compras | Pedido de compra, Requisição, Importar XML, Nota sem XML, Importar pedidos | **Notas Fiscais**, Sugestão de compra, Tarefas, Pedidos, Requisições, Etapas do recebimento, Devoluções, SINTEGRA | Fornecedores, Compradores e prazos |
| Produção | Ordem de produção, Inventário, Transferência | **Ordens de Produção**, Ordens abertas, Inventários, Transferências, Impressões | — |
| Fiscal | Transferência entre lojas | **NF-e de saída**, Transferências entre lojas, Contador e fechamento | Categorias contábeis |
| Finanças | Conta a pagar | **Contas a pagar**, Extrato (+ em breve) | Contas correntes, Categorias financeiras |
| Administração | — | **Relatórios**, Saúde da integração, Logs, Saúde do banco, Sincronização (app) | Usuários, Cargos, Lojas |

Relatórios continuam nos módulos (gerenciais em Finanças).

## Verificação

- Testes: todo item do menu antigo tem dono; nenhuma rota repetida entre módulos (sem exceção `ref` nas telas); nomes de tela únicos; "Novo" só aponta para formulário real ou `?criar=1` de tela com modal.
- Relatório por modo (próprio × Omie) conferido módulo a módulo.
- tsc, build, revisão independente, deploy; clique real em cada "Novo" pendente de sessão logada.
