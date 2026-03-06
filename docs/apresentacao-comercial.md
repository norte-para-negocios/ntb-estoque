# NTB - Estoque

**Solução de gestão de estoque integrada ao Omie**

---

## Introdução

O **NTB - Estoque** é uma aplicação web que centraliza as operações de estoque, inventário, transferências, notas fiscais e ordens de produção em uma única plataforma. Desenvolvido para empresas que utilizam o Omie como ERP, o sistema elimina retrabalho, reduz erros manuais e oferece visibilidade unificada sobre o estoque em tempo real.

---

## Visão Geral da Solução

O NTB - Estoque conecta-se nativamente ao Omie, permitindo sincronização automática de produtos, locais de estoque, notas fiscais e ordens de produção. A arquitetura **multiloja** permite operar diversas unidades ou armazéns com isolamento completo de dados — cada usuário trabalha no contexto da loja selecionada, garantindo segurança e organização.

---

## Módulos e Funcionalidades

### Notas Fiscais

- Listagem e filtros por período, número, fornecedor, produto, tipo e status
- Visualização detalhada dos itens e registro de quantidades recebidas
- **Impressão de etiquetas em PDF** com QR Code e dados essenciais do produto: data de fabricação/processamento, validade, lote, quantidade e código — permitindo identificação precisa e rastreabilidade
- Sincronização automática com o Omie

### Ordens de Produção

- Listagem e filtros por período, número, tipo, produto e status de conclusão
- Atualização de validade e quantidade produzida
- **Impressão de etiquetas em PDF** com QR Code e dados importantes: data de fabricação/processamento, validade, lote e demais informações do produto — garantindo identificação precisa em toda a cadeia
- Sincronização automática com o Omie

### Transferências

- Criação de transferências entre locais de origem e destino
- Registro de itens por código de produto e quantidade
- Processamento automático dos ajustes no Omie (em background)
- Geração de PDF para documentação
- Duplicação de transferências para agilizar operações recorrentes

### Inventário

- Criação de contagens por local de estoque, com data e motivo
- Registro de itens por código e quantidade
- Ajustes automáticos no Omie via processamento em background
- Geração de PDF para documentação
- Duplicação de inventários

### Produtos

- Consulta de produtos por loja com busca por descrição
- Sincronização com o Omie sob demanda

### Locais de Estoque

- Consulta de locais de estoque por loja com filtro por descrição
- Sincronização com o Omie sob demanda

---

## Etiquetas com QR Code

Em **Notas Fiscais** e **Ordens de Produção**, o sistema permite gerar etiquetas de produtos em PDF com:

- **QR Code** para leitura rápida e identificação do produto
- **Descrição do produto**
- **Código do produto**
- **Data de fabricação/processamento**
- **Data de recebimento**
- **Validade**
- **Lote**
- **Quantidade**

Essas etiquetas garantem identificação precisa do produto em toda a operação, facilitando rastreabilidade, controle de validade e conformidade.

---

## Gestão Administrativa (Admin)

- Cadastro de lojas e configuração de credenciais Omie (App Key/Secret)
- Gestão de usuários e vínculo com lojas
- Permissões granulares por loja (ex.: Notas Fiscais, Inventários, Transferências)
- Logs de integração para auditoria e troubleshooting

---

## Integração Omie

- Sincronização bidirecional de produtos, locais, notas fiscais e ordens de produção
- Webhooks para atualização em tempo real quando o Omie envia eventos
- Processamento em background — operações longas não travam a interface
- Respeito ao rate limit da API Omie para garantir estabilidade

---

## Benefícios para o Negócio

- **Redução de erros manuais** — dados sincronizados automaticamente com o Omie
- **Visibilidade unificada** — estoque, transferências e inventários em um só lugar
- **Rastreabilidade** — etiquetas com QR Code, lotes e validades
- **Notificações em tempo real** — acompanhamento de processamentos concluídos
- **Documentação** — geração de PDFs para inventários, transferências e etiquetas

---

## Segurança e Confiabilidade

- Autenticação obrigatória para acesso
- Controle de acesso por perfil (Admin) e permissões por loja
- Isolamento de dados por loja — cada unidade opera apenas com seus dados
- Logs de integração para auditoria e suporte técnico

---

## Público-Alvo

- Empresas que utilizam **Omie** como ERP
- Operações com **múltiplas lojas** ou armazéns
- Equipes que precisam de **inventário**, **transferências** e controle de **notas fiscais** e **ordens de produção**

---

## Conclusão

O NTB - Estoque oferece uma solução integrada e prática para gestão de estoque, alinhada ao ecossistema Omie. Com foco em produtividade, rastreabilidade e redução de erros, o sistema é indicado para empresas que buscam centralizar e automatizar suas operações de estoque.

Para demonstração ou mais informações, entre em contato.
