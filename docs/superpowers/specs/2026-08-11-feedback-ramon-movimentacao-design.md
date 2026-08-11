# Feedback do Ramon (WhatsApp 2026-08-10) — Movimentação — Design

**Data:** 2026-08-11

**Gatilho:** revisão completa da conversa de WhatsApp com Ramon Carneiro
(operador real do NTB Estoque, testa o app nas lojas Donana) de
2026-08-10, 20h09-21h27 — 8 fotos, 7 áudios transcritos, 1 planilha.
Conteúdo focado quase inteiramente na tela **Movimentação**
(`app/(app)/relatorio-movimentacao`, aba "Por operação (R$)").

## Contexto já investigado (não re-investigar)

- A tela tem 2 modos: `modo=quantidade` (import manual do Excel MOV_DRV
  OU cálculo em quantidade) e `modo=operacao` (automático, "Por operação
  (R$)" — o que o Ramon estava usando). Este design cobre só o modo
  `operacao`.
- `lib/movimentacao-operacao-auto.ts` (`gerarMovimentacaoOperacaoAutomatica`)
  monta linhas (`LinhaOperAuto`) de 3 fontes: NF de entrada (Compra/
  Devolução), fato de cupom PDV (`fat_cupons`/`fat_cupom_itens`), e
  `movimentos` (ajustes manuais/inventário). Tipo atual:
  ```ts
  export type LinhaOperAuto = {
    origem: string; sentido: 'E' | 'S'; local: string; tipo_sped: string
    familia: string; mes: string; inventario: boolean; qtde: number; valor: number
  }
  ```
  **Não tem campo `produto`** — a granularidade de produto é descartada
  na hora de montar cada linha (só sobrevive `familia`).
- `app/(app)/relatorio-movimentacao/page.tsx`, dentro do bloco
  `modo === 'operacao'` (~linha 94-393):
  - Linha 224: valor do PDV usa `Number(it.v_item) || 0` — sem o
    fallback que o resto do sistema usa quando `v_item` vem zerado do
    Omie (`v_item || v_unit*quant - v_desc`, já usado em
    `lib/faturamento-frio.ts` e `lib/omie/faturamento.ts`, ambos
    corrigidos/confirmados hoje mais cedo nesta sessão).
  - Linha 253: `const chave = JSON.stringify([familia, local, tipo])` —
    agrupamento correto e seguro (sem risco de colisão por separador),
    mas SEM opção de trocar a dimensão de agrupamento (sempre os 3
    juntos).
  - Linhas 344-349: tabela sempre renderiza as 3 colunas Família/Local/
    Tipo (SPED). Família é `sticky left-0` (linha 345); a tabela é
    `overflow-x-auto` (linha 341) — em telas estreitas ou quando o
    usuário rola pra direita, Local/Tipo somem de vista atrás da coluna
    fixa, mas os valores continuam corretos.
  - Não existe seletor de dimensão nesse bloco (o `DIMS_MANUAL`/
    `dimExibidaManual` de linha 407+ pertence ao OUTRO modo,
    `modo=quantidade`, código totalmente separado).

## Achado 1 (bug real, confirmado): fórmula do PDV inconsistente

Medido ao vivo hoje: card "Movimento Gerado pelo PDV" mostrou
R$2.967.359,65 pra loja 2/2026, enquanto o número correto (mesma fórmula
usada em `buscarFatAgregadoPorSituacao`/`agregarFaturamentoPorTipoFamilia`,
já validado hoje) é R$2.965.658,30 — diferença de R$1.701,35 causada
só pelos itens com `v_item=0` que deveriam cair no fallback e não caem.

**Correção**: linha 224 de `lib/movimentacao-operacao-auto.ts`:
```ts
// antes
valor: Number(it.v_item) || 0,
// depois
valor: (Number(it.v_item) || (Number(it.v_unit) * Number(it.quant) - Number(it.v_desc))) || 0,
```
(usar exatamente a mesma expressão já usada nos outros 2 lugares do
sistema, incluindo o comentário explicativo padrão já usado hoje.)

## Achado 2 (UX): Local/Tipo escondidos atrás da coluna fixa

Quando o filtro de "Tipo (SPED)" já está fixado num valor único (chip
ativo em `sp.tipo`), a coluna "Tipo (SPED)" na tabela por
família/local/tipo fica redundante (sempre mostra o mesmo valor em toda
linha) — mas ainda ocupa espaço e empurra "Local" pra mais longe da
coluna fixa "Família", piorando a rolagem necessária pra ver o que
diferencia duas linhas com a mesma família.

**Correção**: esconder a coluna "Tipo (SPED)" (cabeçalho E células) só
quando `sp.tipo` está setado com exatamente 1 valor (não uma lista).
Quando não há filtro de tipo ou há mais de 1 selecionado, a coluna
continua aparecendo normalmente (comportamento de hoje, sem mudança).
Local nunca é escondido (pode ter múltiplos valores mesmo com família
fixa, como o achado de hoje provou: Depósito vs Bar pro mesmo
"Geladas com Álcool").

## Achado 3 (pedido): agrupar "por produto" na tabela "Por operação (R$)"

Hoje a tabela só agrupa por família (+ local + tipo). Ramon pediu poder
ver por produto também.

**Design**: adicionar campo `produto` (nome) ao tipo `LinhaOperAuto` e
popular nos 3 pontos de `add(...)` em
`lib/movimentacao-operacao-auto.ts` (usar `meta?.descricao || meta?.codigo
|| String(idProduto)`, mesmo fallback já usado em outros lugares do
sistema pra "produto sem nome"). Na tela, adicionar um toggle simples
"Família / Produto" acima da tabela (não precisa reaproveitar
`DIMS_MANUAL`, que pertence ao outro modo — é um controle novo,
independente, só pra este bloco). Quando "Produto" selecionado, a chave
de agrupamento vira `JSON.stringify([produto, local, tipo])` em vez de
`[familia, local, tipo]`, mesma lógica de esconder a coluna Tipo do
Achado 2 se aplicando igual. Sem filtro novo de produto (já existe um
campo de busca por produto no filtro geral da página, `sp.produto`,
que já funciona pra este modo — linha 113-120 de
`lib/movimentacao-operacao-auto.ts`).

## Achado 4 (verificação pontual): cupom físico do Ramon

Ele mandou foto de um NFC-e real: **loja Rio Vermelho (loja_id=3)**, nº
000171458, Série 1, emitido 16/06/2026 14:53:59, Protocolo de Autorização
229260772116569, Total R$334,07 (Cartão de Crédito), chave de acesso
`2926 0642 2007 4100 0166 6500 1000 1714 5610 0244 5643`.

**Verificação a fazer**: confirmar direto no Postgres (`ntb_frio`,
`fat_cupons`) se existe uma linha com essa chave/número pra loja 3, com
valor e status batendo. Se não existir ou estiver com valor/status
errado, é um achado novo a documentar (não corrigir sem entender a causa
primeiro — mesma disciplina de hoje). Se estiver tudo certo, só
documentar a confirmação (não precisa de código).

## Fora de escopo (explícito)

- Indicadores nativos tipo as planilhas pessoais do Ramon (Faturamento×
  Compras, Faturamento×Perdas) — fica pra um brainstorm próprio, futuro,
  não cabe aqui.
- Origens/operações que faltam no filtro (Ordem de Produção, Nota Fiscal
  de Produto) — já é limitação conhecida e documentada no próprio código
  (`gerarMovimentacaoOperacaoAutomatica`, comentário de cabeçalho),
  decisão de escopo já tomada antes, não revisitada aqui.
- O "trap do SLD" (saldo contado tratado como movimento assinado) — já
  documentado como SUPERSEDED no código e no AGENTS.md, fix de verdade
  fica pra depois por decisão explícita de escopo anterior.
- Cadastro de produtos sem EAN/GTIN — achado de qualidade de cadastro,
  não é bug de código, fora de escopo.
