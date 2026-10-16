# Refazer um inventário (Central de correções)

Pedidos do Ramon, 15/10/2026. O Omie não deixa alterar um ajuste de estoque (só incluir, excluir e listar). Para
corrigir um inventário, o Norte Estoque **refaz o inventário na data dele**, em vez de lançar uma saída com a data de
hoje.

## Quando aparece

- **Contagens estranhas**: a contagem foi lançada errada (ex.: 4.658 kg no lugar de 4,658 kg). Botão "Refazer o
  inventário de dd/mm", com o campo "Contagem certa".
- **Inventário fora do fim do dia** (todas as lojas): o inventário entrou no Omie **antes** de vendas do mesmo dia
  (o Omie registrou as vendas depois). Como o inventário é feito com a casa fechada, ele deve ser sempre o último do
  dia. Botão "Refazer o inventário de dd/mm no fim do dia".

## O passo a passo (o mesmo que a tela mostra antes de confirmar)

1. **Excluir a correção lançada depois**, se houver (ex.: a saída que a Central ou a faxina lançou em outro dia para o
   mesmo erro).
2. **Achar o saldo logo antes do inventário** no kardex do Omie daquele dia: saldo logo depois dele − quantidade dele.
   (A posição de estoque com data passada no Omie devolve o saldo de hoje, por isso não é usada.)
3. **Contar antes do inventário as vendas e a produção do dia** que o Omie registrou depois dele (venda do PDV,
   consumo e entrada de OP, baixa de venda sem nota). Nota de compra e ajuste manual lançados depois **não** entram:
   podem ter chegado depois da contagem e continuam valendo por cima dela.
4. **Excluir o inventário errado.**
5. **Lançar o inventário refeito na mesma data**: quantidade = saldo antes + vendas depois − contagem certa.
   Maior que zero = saída; menor = entrada; zero = não lança nada. Motivo Inventário, origem ajuste, custo = custo
   médio do movimento original, obs "Inventário de dd/mm refeito: contagem X (tinha sido lançada como Y)". O ajuste
   novo entra no fim do dia no Omie.
6. **Resultado**: o dia termina com a contagem (mais o que foi lançado depois dela e não é venda). Os dias seguintes
   acompanham a diferença.

## Segurança

- A prévia só lê o Omie. Ao confirmar, o sistema lê de novo; se o kardex mudou, nada é escrito e a tela mostra o
  passo a passo novo.
- Uma escrita por vez, com 1,5 s entre elas. Antes de cada escrita a intenção fica gravada
  (`estoque_refazer_inventario.pendente`): se a resposta do Omie se perder, o "Continuar" confere no Omie (pelo código
  `INVR-<id>`) antes de lançar de novo. Nunca duplica.
- Para no primeiro erro e diz o que já foi feito. O mesmo inventário não é refeito duas vezes.
- Mês já enviado à contabilidade: pode refazer (pedido do dono); a tela avisa. Notas fiscais nunca são mexidas
  (só ajustes de estoque são excluídos).
- Loja de teste: tudo simulado. Loja 4 (Sertão): liberada só para esta ação, pelo botão.
