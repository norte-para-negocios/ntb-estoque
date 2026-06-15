# Pedidos da reunião 15/06/2026 (transcrição completa, 1h22)

> Gravação + transcrição em `Videos/Reunioes Joaquim - NTB/2026-06-15/`.
> A parte do WhatsApp (60:20-60:52) foi cortada.

## 🟢 Validado na reunião (funcionando)
- Login: pedir acesso → aprovar como admin → entrar. Excluir usuário. Dark mode. Etapa 40/60 (pendente/concluída) já visual.
- Criar OP com lista de produtos e recorrência semanal (criou dia 22 e 29 ok no Omie).
- Modos Preços/Compras na tela de produtos.

## 🔴 GRANDE pedido novo: RELATÓRIOS / dashboards
Hoje o Ramon faz tudo no Excel. Quer uma seção **Relatórios** no NTB Stock que puxa do Omie e gera automático:
- **Faturamento** (por produto/família/forma de pagamento/mês; top 10; margem com custo/venda/CMC).
- **Entrada de NF** (compras por fornecedor/tipo/família).
- **Movimentações** (entradas, saídas, rejeitos, matéria-prima, PDV).
- **Relação Faturamento × Compras** (indicador de saúde financeira, com rejeito).
- Atualização **diária/semanal automática** (workflow). Dashboards + export **PDF**.
- Vendas vêm do **WebHub do Omie** (temos acesso; hoje não guardamos vendas).
- Ele vai **mandar as planilhas modelo** (Excel) para seguir o formato exato.
- Validação na entrada de NF: apontar CFOP/categoria errada (ex.: uso-consumo 90 vs revenda 60).

## 🟠 Ordem de Produção (ajustes)
- Layout da CRIAÇÃO igual transferência/inventário (busca fixa em cima, produtos descendo). Não gostou da lista atual.
- **Validade POR PRODUTO** na lista (data de início igual; validade varia por produto).
- **Status na listagem**: PREVISTA (futura) / PENDENTE / ATRASADA / CONCLUÍDA. Botão "concluir" só nas não concluídas.
- Bug visual da recorrência: OP futura (dia 22) aparece com data de hoje (15). Omie recebeu certo; é só visual.
- Ordenação: A-Z, Z-A, por código, quantidade, validade. Filtro default = mês corrente.
- Concluídas = histórico (reimprimir etiqueta).

## 🔴 Bugs confirmados a corrigir
- **Filtro "não concluído" bugado** (OP): ignora e mostra todos; não marca quais não foram concluídos.
- **Transferência**: falta campo DATA (pode ser retroativa); NOME do depósito e MOTIVO (TRF/TPQ) ainda deram bug (não apareceram — verificar deploy).
- **Inventário**: falta campo DATA (escolher; geralmente D-1).
- **Produtos**: filtro de família não traz todas; filtro travando ("não rola").

## 🟠 Produtos / estoque mínimo
- Confirmado: Omie manda mínimo = 0. Ramon preenche manual. Testou produto 90457 (mostrou atual 18/19).

## 🟠 Certificado digital + dados da empresa (já em 2026-06-15-pedidos-novos.md)
- No cadastro da loja/empresa: anexar certificado A1 + senha, CNAE/inscrições e dados que faltam, para emitir NF e buscar no Sefaz.

## 💡 Ideias/futuro
- Usar Google Drive/OneDrive como armazenamento barato de histórico (em vez de pagar banco).
- Treinar agente de IA para lançamento de NF em 2 cliques (conferir e corrigir).

## ⚙️ Observações
- PC do Ramon travando muito (8GB RAM). Relógio do PC do Joaquim errado (Ramon comentou "12h da manhã").
