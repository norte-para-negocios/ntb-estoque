# Pedidos e bugs da reunião NTB 17/06/2026 (Joaquim + Ramon)

Capturado da transcrição completa (1.142 segmentos, 62 min). Áudio ruim em partes;
itens marcados (?) precisam de confirmação.

## BUGS (corrigir)
1. **CMC / custo zerado** — JÁ CORRIGIDO (commit no main). Causa: a posição do dia corrente
   vem sem CMC; tela usava a foto sem custo e o sync apagava a de ontem. Eles confirmaram na
   reunião ("dia 16 = 2.125 custos, hoje = 46"). Tela agora pega o CMC não-zero mais recente.
2. **Transferência não "volta" / fica zerado** — ao fazer transferência o produto some/zera, "não
   inteira", "não volta" (precisa de refresh; às vezes nem aparece). Investigar o fluxo de transferência.
3. **Inventário fica "Iniciado" e não conclui** — item dá erro e trava como "iniciado"; precisa de
   "reenviar pendentes" e que CADA item seja lançado individualmente (um erro não trava os outros).
4. **OP com quantidade zerada** — alguns produtos na OP aparecem com quantidade 0.
5. **NF faltando por loja (a re-investigar)** — na reunião: loja 5 só junho, loja 6 só maio parcial,
   loja 4 completa. (Minha varredura via banco mostrou lojas 2-6 com todos os meses; pode ser a TELA
   de NF com filtro/bug, ou diferença de numeração de loja. Conferir.)
6. **Estoque mínimo não trazendo** em alguns produtos.
> Obs: o Joaquim atribuiu vários desses a alterações locais ainda não subidas pro link (mexeu no
> banco pra pegar histórico, deu conflito). Disse que sobe e testa amanhã (18/06 10h).

## PEDIDOS / MELHORIAS
A. **OP reverter (concluída) + excluir (em aberto)** — reconfirmado (A5/A10).
B. **Inventário e transferência: envio automático** — ao digitar item + quantidade e SAIR do campo,
   já integra na hora (não esperar fechar a lista de 100). Mexeu na quantidade -> reprocessa.
C. **Inventário: botão imprimir direto na lista** (sem entrar no item).
D. **Inventário: permitir editar/excluir item** mesmo depois de finalizado.
E. **Movimentações: filtros ricos + VALOR** (o pedido mais detalhado):
   - Filtro por **tipo de movimentação**: entrada, saída, rejeito, entrada de OP, saída de OP,
     manual de estoque, transferência.
   - Filtro por **local de estoque** (qual local entrou/saiu — trabalham por local).
   - Filtro por origem (já tem), produto, família, tipo de produto.
   - **Trazer VALOR (R$), não só quantidade** — interessa mais o valor; opção de alternar qtd/valor.
   - Agrupar por **mês** (não só por data); priorizar produtos com entrada.
   - "Aberto pra criar" mais filtros.
F. **Cadastro de produto: ESTRUTURA (ficha técnica / BOM)** — produto em processo/acabado deve
   permitir cadastrar a estrutura (itens que compõem o prato + quantidades, em kg/un). É a malha do
   Omie. Ex.: arrumadinho = base + farofa + vinagrete + feijão. Permitir estrutura do produto.
G. **Cadastro via SINTEGRA/endereço** — tela onde se informa um CNPJ/endereço pra PUXAR cadastros:
   produtos, clientes, **fornecedor**, CEST. Preparação pra integração fiscal (entrada de NF).
H. **Usuários (várias):**
   - Esconder o seletor de loja quando a pessoa só tem 1 loja (mostrar só o nome, não revelar que há
     várias lojas). Só mostrar o seletor pra quem tem 2+.
   - **Esconder do menu** o que a pessoa não tem permissão (NF, Produção, etc.), não só bloquear.
   - Cadastros (Produtos, Locais) visível conforme permissão; Saúde da integração e Logs só admin.
   - **Onboarding por código de loja:** admin gera um código; funcionário se cadastra, escolhe perfil,
     informa o código da loja, loga; o chefe ajusta as permissões. (resolve o login que estava em standby)
   - Melhorar o visual do cadastro de usuário ("tá muito feio").
I. **Local de estoque:** confirmado que o Omie não exclui local por API; tratar via inativar. Limpar
   os locais de teste ZZ.

## ELOGIOS / CONFIRMAÇÕES
- "Saúde da integração" foi muito útil (achou a Brotas não puxando).
- Lançar pelo sistema é mais rápido que pelo Omie direto.

## AGENDA / PRÓXIMOS PASSOS
- Joaquim sobe as alterações pendentes e testa tudo amanhã (18/06, 10h).
- Reunião com o André amanhã (18/06) 20h: testar como usuário comum (sem admin).
- Quando tudo estiver funcionando: começar a AUTOMATIZAÇÃO DE RELATÓRIOS.
- Transcrição vai pro Drive.
