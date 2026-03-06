# Guia Rápido de Onboarding — NTB Estoque

Bem-vindo ao **NTB Estoque**! Este guia ajuda você a começar a usar o sistema em poucos passos.

---

## 1. Primeiro acesso

### Login
- Acesse o sistema com o **e-mail** e **senha** fornecidos pelo administrador.
- O cadastro de novos usuários é feito apenas por administradores.

### Seleção de loja (obrigatório)
Após o login, você **precisa selecionar uma loja** para operar:

1. No menu lateral, localize o seletor **"Acessando:"**
2. Escolha a loja desejada na lista
3. O sistema redireciona automaticamente e passa a exibir apenas os dados dessa loja

> **Importante:** Sem loja selecionada, o acesso aos módulos de negócio (Notas Fiscais, Transferências, Inventário etc.) fica bloqueado.

---

## 2. Navegação principal

O menu lateral oferece acesso aos módulos. A ordem sugerida para começar:

| Módulo | O que faz |
|--------|-----------|
| **Página Inicial** | Resumo e acesso rápido ao menu |
| **Notas Fiscais** | Consulta, itens, quantidades e impressão de etiquetas |
| **Ordens de Produção** | OPs, validade, quantidade e etiquetas |
| **Transferências** | Movimentação entre locais de estoque |
| **Inventário** | Contagens e ajustes de estoque |
| **Produtos** | Consulta e sincronização com Omie |
| **Locais de Estoque** | Consulta e sincronização com Omie |

---

## 3. Fluxos mais usados

### Notas Fiscais
1. Acesse **Notas Fiscais** e filtre por período, número, fornecedor ou produto
2. Clique em uma nota para ver os **itens**
3. Informe a **quantidade recebida** em cada item
4. Use **Imprimir** para gerar etiquetas em PDF (QR Code, validade, lote)

### Ordens de Produção
1. Liste as OPs e filtre por período, número ou produto
2. Atualize **validade** e **quantidade produzida**
3. Gere **etiquetas em PDF** para identificação

### Transferências
1. Crie uma nova transferência (origem, destino, data, motivo)
2. Adicione itens informando **código do produto** e **quantidade**
3. Finalize para processar os ajustes no Omie (em background)
4. Acompanhe o status; ao concluir, você recebe notificação

### Inventário
1. Crie uma contagem (local, data, motivo)
2. Adicione itens por **código** e **quantidade**
3. Finalize para enviar ajustes ao Omie
4. Gere PDF para documentação

---

## 4. Sincronização com Omie

Produtos, locais de estoque, notas fiscais e ordens de produção podem ser sincronizados com o Omie:

- **Produtos** e **Locais de Estoque**: use o botão de sincronização na tela de listagem
- **Notas Fiscais** e **Ordens de Produção**: use o botão de sincronização no topo da tela

> As sincronizações podem levar alguns minutos. O processamento ocorre em background e o sistema respeita o rate limit do Omie.

---

## 5. Permissões e perfis

### Usuário comum
- Acesso aos módulos conforme permissões atribuídas **por loja**
- Exemplo: pode ter acesso a Notas Fiscais em uma loja e não em outra

### Administrador (Admin)
- Acesso total ao sistema
- Módulos extras no menu:
  - **Lojas** — cadastro e credenciais Omie (App Key/Secret)
  - **Usuários** — cadastro, vínculo com lojas e permissões
  - **Logs de Integração** — auditoria de chamadas à API Omie

---

## 6. Dicas rápidas

- **Trocar de loja:** use o seletor no menu; o contexto muda imediatamente
- **Etiquetas:** em Notas Fiscais e OPs, as etiquetas incluem QR Code, validade, lote e quantidade
- **Duplicar:** transferências e inventários podem ser duplicados para agilizar operações repetidas
- **PDFs:** inventários e transferências permitem gerar PDF para documentação
- **Notificações:** processamentos longos (Omie) geram notificações em tempo real ao concluir

---

## 7. Suporte

Em caso de dúvidas ou problemas:
- Verifique se a **loja está selecionada**
- Confirme suas **permissões** com o administrador
- Para erros de integração, o Admin pode consultar **Logs de Integração**

---

*NTB Estoque — Gestão de estoque integrada ao Omie*
