# Manual de Uso — NTB Estoque

Manual detalhado do sistema NTB Estoque — gestão de estoque integrada ao Omie.

---

## Sumário

1. [Introdução](#1-introdução)
2. [Acesso e Autenticação](#2-acesso-e-autenticação)
3. [Contexto Multiloja](#3-contexto-multiloja)
4. [Notas Fiscais](#4-notas-fiscais)
5. [Ordens de Produção](#5-ordens-de-produção)
6. [Transferências](#6-transferências)
7. [Inventário](#7-inventário)
8. [Produtos](#8-produtos)
9. [Locais de Estoque](#9-locais-de-estoque)
10. [Administração (Admin)](#10-administração-admin)
11. [Logs de Integração](#11-logs-de-integração)
12. [Integração Omie e Sincronização](#12-integração-omie-e-sincronização)
13. [Notificações em Tempo Real](#13-notificações-em-tempo-real)
14. [Glossário e Referências](#14-glossário-e-referências)

---

## 1. Introdução

O **NTB Estoque** é uma aplicação web para gestão de estoque integrada ao ERP Omie. Oferece módulos para Notas Fiscais, Ordens de Produção, Transferências, Inventário, Produtos e Locais de Estoque, com sincronização bidirecional e processamento em background.

### Requisitos de acesso

- Navegador web atualizado
- Credenciais (e-mail e senha) fornecidas pelo administrador
- Conexão com a internet

---

## 2. Acesso e Autenticação

### 2.1 Login

1. Acesse a URL do sistema
2. Informe o **e-mail** e a **senha**
3. Clique em **Entrar**

> O cadastro de novos usuários é feito apenas por administradores. Não há opção de registro público.

### 2.2 Recuperação de senha

O sistema utiliza o fluxo padrão de recuperação de senha do Laravel. Em caso de esquecimento, use o link "Esqueci minha senha" na tela de login.

### 2.3 Logout

No menu lateral, clique em **Sair** para encerrar a sessão.

---

## 3. Contexto Multiloja

### 3.1 Seleção de loja

Após o login, é **obrigatório** selecionar uma loja para operar:

1. No menu lateral, localize o seletor **"Acessando:"**
2. Selecione a loja desejada
3. O sistema redireciona e passa a exibir apenas os dados dessa loja

### 3.2 Restrições

- Sem loja selecionada, o acesso aos módulos de negócio (Notas Fiscais, Transferências, Inventário etc.) fica bloqueado
- Cada usuário só visualiza as lojas às quais foi vinculado pelo administrador
- Todas as operações são filtradas automaticamente pela loja atual

---

## 4. Notas Fiscais

**Permissão necessária:** Notas Fiscais

### 4.1 Listagem e filtros

A tela de Notas Fiscais permite filtrar por:

| Campo | Descrição |
|-------|-----------|
| Data Início / Data Final | Período de emissão da NFe |
| Nº NFe | Número da nota fiscal |
| Fornecedor | Nome do fornecedor |
| Produto | Código ou descrição do produto |
| Tipo | Tipo de item (Mercadoria para Revenda, Matéria Prima, etc.) |
| Status | Pendente (P) ou Concluído (C) |

Os filtros são aplicados automaticamente ao alterar os valores. A listagem é paginada (20 registros por página).

### 4.2 Visualizar itens da nota

1. Na listagem, clique em **Ver** na nota desejada
2. Será exibida a lista de itens da nota com:
   - Código do produto
   - Descrição
   - Unidade de medida
   - Quantidade para produção na etiqueta

### 4.3 Registrar quantidade por item

1. Na tela de itens, use os botões **-** e **+** ou digite diretamente no campo de quantidade
2. A quantidade é salva automaticamente ao sair do campo (blur)
3. A quantidade informada será usada na geração das etiquetas

### 4.4 Impressão de etiquetas

- **Imprimir Todos:** gera PDF com etiquetas de todos os itens da nota que possuem quantidade informada
- **Imprimir** (por item): gera PDF apenas do item selecionado

As etiquetas incluem: QR Code, descrição, código, validade, lote, quantidade e demais dados do produto.

### 4.5 Sincronização com Omie

- Use o botão de sincronização (ícone de setas circulares) no topo da tela
- **Permissão:** Notas Fiscais - Sincronizar
- A sincronização busca notas dos últimos 7 dias
- O processamento ocorre em background; o status aparece na tela (ex.: "Processando", "Concluído")
- Enquanto houver sincronização em andamento, o botão fica desabilitado

---

## 5. Ordens de Produção

**Permissão necessária:** Ordens de Produção

### 5.1 Listagem e filtros

| Campo | Descrição |
|-------|-----------|
| Data Início / Data Final | Período de conclusão da OP |
| Nº Ordem de Produção | Número da OP |
| Tipo de Produto | Código do tipo (00, 01, 02, etc.) |
| Produto | Código ou descrição do produto |
| Concluído | Todos, Concluído (S) ou Pendente (N) |

### 5.2 Atualizar validade

1. Use o campo de data **Validade** ou os botões **-** e **+**
2. A alteração é enviada automaticamente ao sair do campo
3. O sistema exibe a diferença em dias entre a data de conclusão e a validade

### 5.3 Atualizar quantidade

1. Use o campo **Quantidade** ou os botões **-** e **+**
2. A alteração é salva automaticamente ao sair do campo

### 5.4 Impressão de etiquetas

Clique em **Imprimir** na OP desejada. O PDF é gerado com etiquetas contendo:
- QR Code
- Descrição e código do produto
- Lote (número da OP)
- Quantidade
- Validade
- Data de produção

Para produtos em unidade (UN), são geradas etiquetas individuais (1 de N, 2 de N, etc.).

### 5.5 Concluir Ordem de Produção

1. Clique em **Concluir** na OP pendente
2. No modal, informe:
   - **Data Conclusão:** data em que a OP foi concluída
   - **Quantidade Produzida:** quantidade efetivamente produzida
   - **Observações:** opcional
3. Clique em **Concluir**

A conclusão é enviada ao Omie e atualiza o status da OP.

### 5.6 Sincronização

- Botão **Forçar atualização** no topo da tela
- **Permissão:** Ordens de Produção - Sincronizar
- Busca OPs dos últimos 7 dias até 2 dias à frente

---

## 6. Transferências

**Permissões:** Transferências - Ver, Transferências - Criar, Transferências - Editar, Transferências - Excluir

### 6.1 Listagem e filtros

| Campo | Descrição |
|-------|-----------|
| Data Início / Data Final | Período da transferência |
| Família | Família do produto |
| Tipo | Tipo de item do produto |

### 6.2 Criar nova transferência

1. Clique em **Nova Transferência** (botão fixo na parte inferior)
2. No modal, preencha:
   - **Data:** data da transferência
   - **Estoque de Origem:** local de onde saem os produtos
   - **Estoque de Destino:** local para onde vão os produtos
   - **Motivo:** TRF (Transferência entre Locais) ou TPQ (Transferência por Perda ou Quebra)
3. Clique em **Salvar**

**Regra:** Não é possível criar nova transferência se já existir outra **Processando** para o mesmo par origem/destino e mesma data.

### 6.3 Adicionar itens (contagem)

1. Após criar a transferência, você será redirecionado para a tela de contagem
2. Adicione itens por:
   - **Busca por código/descrição:** digite no campo de busca e selecione o produto
   - **Leitura de QR Code:** use o botão **Ler QRcode** (em dispositivos com câmera)
   - **Buscar na lista:** abra o modal e escolha o produto

3. Para cada item, informe a **quantidade** usando os botões **-** e **+** ou digitando
4. A quantidade é salva automaticamente e o ajuste é enviado ao Omie em tempo real (quando há CMC disponível)

### 6.4 Status dos itens

- **Concluído:** ajuste processado no Omie
- **Erro:** falha no processamento (ex.: rate limit)
- **Sem CMC:** custo médio zerado; use **Atualizar** para tentar novamente após obter posição de estoque

### 6.5 Editar quantidade de item

- Em itens já processados, altere a quantidade e confirme. O sistema exclui o ajuste anterior no Omie e cria um novo.
- **Permissão:** Transferências - Editar

### 6.6 Excluir item

Clique no botão de excluir (ícone de lixeira) ao lado do item. Se o item já foi processado no Omie, o sistema tenta excluir o ajuste correspondente.

### 6.7 Finalizar transferência

1. Após adicionar todos os itens, clique em **Finalizar**
2. O sistema dispara um job em background para processar itens pendentes (Sem CMC, Erro)
3. Você receberá notificação quando o processamento concluir

### 6.8 Duplicar transferência

1. Na listagem, clique em **Duplicar** na transferência desejada
2. Informe a nova data no modal
3. A transferência será criada com os mesmos itens, mas com quantidades zeradas (a serem preenchidas)

### 6.9 Gerar PDF

Clique em **Imprimir** na transferência para gerar o PDF com o resumo da movimentação.

### 6.10 Excluir transferência

Clique em **Excluir**. O sistema tenta excluir os ajustes no Omie. Se algum ajuste não puder ser excluído, uma mensagem de aviso será exibida.

### 6.11 Reprocessar (Force Sync)

Para transferências com itens em erro ou sem CMC, use **Atualizar** para tentar processar novamente no Omie.

---

## 7. Inventário

**Permissões:** Inventários - Ver, Inventários - Criar, Inventários - Editar, Inventários - Excluir

### 7.1 Listagem e filtros

| Campo | Descrição |
|-------|-----------|
| Data Início / Data Final | Período do inventário |
| Família | Família do produto |
| Tipo | Tipo de item do produto |

### 7.2 Criar novo inventário

1. Clique em **Novo Inventário**
2. No modal, preencha:
   - **Data:** data da contagem
   - **Local de Estoque:** local onde será feita a contagem
3. Clique em **Salvar**

**Regra:** Não é possível criar novo inventário se já existir um **Em contagem** no mesmo local.

O motivo é fixo como "Ajuste por Inventário" (INV).

### 7.3 Adicionar itens (contagem)

1. Após criar, você será redirecionado para a tela de contagem
2. Adicione itens por:
   - **Busca:** digite no campo de busca e selecione o produto
   - **Leitura de QR Code:** botão **Ler QRcode**
   - **Buscar na lista:** modal com lista de produtos

3. Informe a **quantidade** de cada item
4. Os ajustes são enviados ao Omie em tempo real quando há CMC disponível

### 7.4 Status dos itens

- **Concluído:** ajuste processado
- **Erro:** falha (ex.: rate limit)
- **Sem CMC:** custo zerado; use o botão de refresh para tentar novamente

### 7.5 Editar quantidade

- Durante a contagem: altere e a quantidade é salva automaticamente
- Após finalizar: altere e confirme no modal de confirmação. O sistema exclui o ajuste anterior e cria um novo.

### 7.6 Excluir item

Clique no botão de excluir ao lado do item.

### 7.7 Finalizar inventário

1. Clique em **Finalizar**
2. O sistema processa itens pendentes em background
3. Você receberá notificação ao concluir

### 7.8 Duplicar inventário

1. Na listagem, clique em **Duplicar**
2. Informe a nova data
3. O inventário será criado com os mesmos itens, quantidades zeradas

### 7.9 Gerar PDF

Clique em **Imprimir** para gerar o PDF do inventário (disponível mesmo antes de finalizar, para conferência).

### 7.10 Excluir inventário

Clique em **Excluir**. Os ajustes já enviados ao Omie serão excluídos.

### 7.11 Reprocessar (Force Sync)

Use **Atualizar** na tela de contagem para tentar processar novamente itens com erro ou sem CMC.

---

## 8. Produtos

**Permissões:** Produtos, Produtos - Sincronizar

### 8.1 Listagem

A tela exibe produtos da loja atual com:
- Família
- Código
- Descrição / Unidade
- Tipo (Mercadoria para Revenda, Matéria Prima, etc.)
- Valor unitário

### 8.2 Busca

Use o campo **Pesquisar** e clique em **Pesquisar** para filtrar por descrição.

### 8.3 Sincronização

- Clique no botão de sincronização (ícone de setas circulares)
- O processamento ocorre em background
- O status e a data da última atualização aparecem no topo da tela

---

## 9. Locais de Estoque

**Permissões:** Locais de Estoque, Locais de Estoque - Sincronizar

### 9.1 Listagem

A tela exibe os locais de estoque da loja com:
- Código do local
- Código
- Descrição

### 9.2 Sincronização

Use o botão de sincronização para atualizar os locais a partir do Omie.

---

## 10. Administração (Admin)

Acesso restrito a usuários com perfil **Admin**.

### 10.1 Lojas

**Menu:** Lojas

#### Listar lojas

Exibe todas as lojas cadastradas. É possível buscar por CNPJ ou nome.

#### Criar loja

1. Clique em **Novo** ou **Criar**
2. Preencha:
   - CNPJ, Nome, Nome Fantasia
   - Endereço (CEP, UF, Cidade, Bairro, Logradouro, Número)
   - **App Key** e **App Secret** do Omie (credenciais de integração)
   - Ativo (marcar se a loja está ativa)
3. Salve

#### Editar loja

Acesse a loja e altere os campos desejados. As credenciais Omie podem ser atualizadas aqui.

#### Sincronização forçada

Algumas lojas possuem opção de **Sync Force** para forçar nova sincronização de dados.

### 10.2 Usuários

**Menu:** Usuários

#### Listar usuários

Exibe todos os usuários. Busca por nome ou e-mail.

#### Criar usuário

1. Clique em **Novo Usuário**
2. Preencha:
   - Nome
   - E-mail
   - Perfil (Usuário ou Admin)
3. Marque as **lojas** às quais o usuário terá acesso
4. Para cada loja, marque as **permissões** desejadas
5. Salve

Uma senha aleatória é gerada e enviada por e-mail ao usuário.

#### Editar usuário

Altere nome, e-mail, perfil, lojas e permissões. As permissões podem ser alteradas em tempo real pelos checkboxes (attach/detach via AJAX).

#### Vincular usuário a loja

Na tela de usuários, o administrador pode selecionar a loja atual do usuário para que ele comece a operar nesse contexto.

### 10.3 Catálogo de permissões

| Permissão | Descrição |
|-----------|-----------|
| Notas Fiscais | Ver e operar notas fiscais |
| Notas Fiscais - Sincronizar | Disparar sincronização de NFe |
| Ordens de Produção | Ver e operar OPs |
| Ordens de Produção - Sincronizar | Disparar sincronização de OPs |
| Inventários - Ver | Listar e visualizar inventários |
| Inventários - Criar | Criar, adicionar itens, finalizar |
| Inventários - Editar | Editar quantidade, excluir itens |
| Inventários - Excluir | Excluir inventário |
| Transferências - Ver | Listar e visualizar transferências |
| Transferências - Criar | Criar, adicionar itens, finalizar |
| Transferências - Editar | Editar quantidade, excluir itens |
| Transferências - Excluir | Excluir transferência |
| Produtos | Ver produtos |
| Produtos - Sincronizar | Sincronizar produtos |
| Locais de Estoque | Ver locais |
| Locais de Estoque - Sincronizar | Sincronizar locais |

---

## 11. Logs de Integração

**Menu:** Logs de Integração (Admin)

Registra todas as tentativas de integração com o Omie:
- Método e URL
- Payload enviado
- Resposta recebida
- Status HTTP
- Mensagens de erro

Útil para auditoria e troubleshooting quando há falhas na integração.

---

## 12. Integração Omie e Sincronização

### 12.1 Fluxo geral

- **Sincronização sob demanda:** o usuário dispara a sincronização nas telas de Produtos, Locais, Notas Fiscais e Ordens de Produção
- **Processamento em background:** operações longas são executadas em filas (jobs)
- **Webhooks:** o Omie pode enviar eventos (Produto, LocalEstoque, RecebimentoProduto, OrdemProducao) que são processados automaticamente

### 12.2 Rate limit

O sistema respeita o rate limit da API Omie. Em caso de erro 425 ou 429, aguarde cerca de 60 segundos e tente novamente. Alguns jobs fazem retry automático.

### 12.3 CMC (Custo Médio Contábil)

Para inventários e transferências, o sistema obtém o CMC da posição de estoque no Omie. Se o CMC estiver zerado ou indisponível, o item ficará com status "Sem CMC" até que a posição seja atualizada.

---

## 13. Notificações em Tempo Real

O sistema utiliza WebSockets (Reverb) para notificar o usuário quando:
- Um inventário termina de processar no Omie
- Uma transferência termina de processar no Omie

As notificações aparecem no navegador quando o usuário está com a aplicação aberta.

---

## 14. Glossário e Referências

### Tipos de movimento — Transferência

| Código | Descrição |
|--------|-----------|
| TRF | Transferência entre Locais de Estoque |
| TPQ | Transferência por Perda ou Quebra |

### Tipos de movimento — Inventário

| Código | Descrição |
|--------|-----------|
| INV | Ajuste por Inventário |
| INI | Ajuste por Inventário (Estoque Inicial) |

### Tipos de produto

| Código | Descrição |
|--------|-----------|
| 00 | Mercadoria para Revenda |
| 01 | Matéria Prima |
| 02 | Embalagem |
| 03 | Produto em Processo |
| 04 | Produto Acabado |
| 05 | Subproduto |
| 06 | Produto Intermediário |
| 07 | Material de Uso e Consumo |
| 08 | Ativo Imobilizado |
| 09 | Serviços |
| 10 | Outros Insumos |
| 99 | Outras |

### Status comuns

- **Em contagem:** inventário em andamento
- **Processando / Processando no Omie:** job em execução
- **Finalizado:** processo concluído
- **Concluído:** item processado com sucesso no Omie
- **Erro:** falha no processamento
- **Sem CMC:** custo médio zerado ou indisponível

---

*NTB Estoque — Manual de Uso v1.0*
