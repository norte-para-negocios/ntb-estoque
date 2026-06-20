# Varredura: limitações, CRUD e melhorias (20/06/2026)

Análise sem implementação. Insumo para conversa. Não modifica nada.

## 1. O valor absurdo em R$ (o CMC inflado)

**O que acontece:** a tela de Movimentações estima o valor multiplicando quantidade pelo CMC (custo médio) que vem do Omie. Em ~293 produtos o CMC veio inflado, então o total estoura (ex.: R$ 22 trilhões).

**Causa raiz (dois motivos, ambos no Omie, não no sistema):**
1. **Saldo negativo no Omie.** Quando o produto fica com estoque negativo (vendeu/saiu sem ter dado entrada ou produzido a OP antes), o cálculo do custo médio do Omie explode matematicamente. Exemplos reais: "Casquinha de siri" (Rio Vermelho) CMC R$ 100 bilhões com saldo -64; "Suco de Limão" CMC R$ 5,9 milhões com saldo -6; "Moqueca de Camarão" CMC R$ 906 mil com saldo -18. Quase todos os pratos produzidos (códigos 9xxxx) caem nisso. Concentra em Praia do Forte (24) e Rio Vermelho (10).
2. **Custo cadastrado errado.** Produto com CMC digitado errado no cadastro do Omie. Ex.: "CRETA 1.6" (um carro) cadastrado como produto na loja Sertão com CMC R$ 102.000 e saldo 1. Saldo positivo, mas o custo é lixo.

**O que dá para fazer no SISTEMA (puxar de um jeito certo, sem tocar no Omie):**
- Não somar CMC claramente suspeito no total. O sistema já DETECTA o CMC absurdo (mostra aviso "CMC suspeito"), mas ainda soma esses valores no total, por isso infla. Mudança: ao calcular o total, ignorar (ou marcar como "custo não confiável") os produtos com CMC suspeito, em vez de multiplicar. O total para de mentir.
- Critério de suspeito: saldo negativo, ou CMC acima de N vezes o preço de venda.

**O que é "na pele" (só no Omie):** regularizar o estoque negativo (dar entrada/produzir a OP antes da venda dos pratos) e corrigir o custo dos produtos cadastrados errado (ex.: tirar o carro CRETA do estoque do restaurante). Enquanto o Omie tiver esses dados, o custo continua errado na fonte.

## 2. Limitações do Omie (corrigir "na pele", não dá pelo sistema)

A API do Omie é só leitura para várias coisas. O sistema lê e mostra, mas a alteração tem que ser feita no Omie:
- **Estoque mínimo:** o Omie NÃO aceita escrita do mínimo via API. O mínimo definido no NTB vale só localmente; não volta pro Omie. (Já avisado na tela ao editar.)
- **CMC / custo médio:** é calculado pelo Omie, snapshot. Não dá pra escrever. Corrige na origem (ver item 1).
- **Ficha técnica / estrutura (malha) do produto:** só leitura. Mexe nos itens reais do produto, então edita no Omie.
- **Dados da empresa da loja** (CNPJ, IE, CNAE, regime, contador): só leitura. Edita no Omie.
- **Notas Fiscais:** só leitura (documento fiscal, vem do Omie por webhook). Não dá criar/excluir NF pela API.
- **Famílias:** a API do Omie não cria/edita família via integração. No NTB dá pra criar família LOCAL, mas não espelha no Omie (a confirmar com Ramon).
- **Clientes / Fornecedores:** só leitura via API. Cria local no NTB, não escreve no Omie.
- **Local de estoque:** dá pra CRIAR no Omie via API, mas não ALTERAR nem EXCLUIR (Omie não expõe). Exclusão no NTB é só local.
- **Produto inativo no Omie:** não dá pra movimentar (inventário/transferência dá erro). Reativar no Omie.
- **Origem/destino de movimentação histórica:** o Omie não devolve o movimento granular (a tabela vem agregada por produto/dia). Por isso a tela de Movimentações não mostra de/para. Precisaria reimportar movimento a movimento.
- **Lojas Praia do Forte (5) e Brotas (6):** dados da empresa bloqueados pelo Omie ("Consumo Indevido"). Só o suporte Omie libera.
- **CEST / origem da mercadoria do produto:** só entram na criação, não na edição via API. Mudar depois é no Omie.

## 3. "Tudo editável" (substituir o ERP no futuro): onde estamos

**Já dá para criar, editar e excluir (funciona):** Produto (reflete no Omie), Loja, Usuário, Transferência (inclusive editar/adicionar/remover item depois de concluída, por permissão), Inventário (idem), Família (local), Fornecedor (local).

**Parcial / gaps reais:**
- **Nota Fiscal:** só leitura + editar quantidade do item. Criar/excluir NF não dá (limitação Omie). Um "lançar NF manual" seria recurso novo grande.
- **Local de estoque:** falta EDITAR (criar e excluir existem). Daria pra fazer edição local.
- **Ordem de Produção:** não exclui OP concluída direto (tem que reverter a conclusão antes). É regra, não bug; dá pra rever.
- **Família / Fornecedor:** criar/editar/excluir é só local; não espelha no Omie (limitação Omie + falta validar com Ramon).
- **Trilha de auditoria:** o sistema não registra "quem criou/editou/excluiu o quê e quando" de forma consultável (só erros de integração). Importante para um ERP.

## 4. Melhorias que valem (curado, fora o que já foi feito esta semana)

**Rápidas:**
- Total de Movimentações ignorar CMC suspeito (item 1) para não inflar.
- Atalhos de data nos filtros (Hoje / 7 dias / Este mês / Mês passado).
- Coluna "Responsável" nas listas de inventário e transferência (o dado existe).
- Ao finalizar contagem com itens sem quantidade ou com erro, confirmar com um resumo.

**Médias:**
- Trilha de auditoria (log de criação/edição/exclusão por usuário + data).
- Editar local de estoque (local).
- Exportar XLSX de Transferência e Inventário (Produto, OP e NF já exportam).
- Home como painel de ação: ruptura de estoque, vencimentos próximos, contagens abertas.

**Estruturais (futuro, alinhado ao "substituir o ERP"):**
- Relatórios financeiros (faturamento por período/família, margem, curva ABC, consumo x compra).
- Alertas automáticos quando o produto bate o mínimo (e-mail/WhatsApp).
- OP concluir parcial MANTENDO o saldo pendente na mesma OP (o Omie permite; falta confirmar o parâmetro da API com o Ramon, ver memória).
- Entrada de NF via certificado A1/SEFAZ (quando o certificado por loja estiver no ar).

## 5. Fases (o fundador vai mandar depois)

O fundador sinalizou que vai mandar a divisão em fases do que falta para o sistema substituir o ERP por completo (criar/editar/excluir/lançar tudo). Este documento é insumo para essa conversa. Nada aqui foi executado.
