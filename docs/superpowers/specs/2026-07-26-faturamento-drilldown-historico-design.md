# Faturamento: drill-down cruzando 90 dias — Design

## Contexto

O fix de hoje mais cedo (commits `c3eecae`/`78b758b`) fechou o gap de
histórico do relatório de Faturamento pras abas Tipo/Família/Produto — a
tela nunca completava com o fato do Contabo quando o período pedido cruzava
pro ano anterior (`faturamento_importado`, a fonte da RPC quente, só guarda
o ano corrente pra essas 3 dimensões, ver comentário em
`lib/omie/faturamento.ts`). Medido: loja 5, aba Tipo, período "Todos"
mostrava R$4,99M em vez de R$9,78M reais.

Esse fix excluiu explicitamente o drill-down (`!prefixo` na condição
`cruzaAnoAnterior`, `app/(app)/relatorio-faturamento/page.tsx`) — clicar num
tipo pra ver as famílias dele, ou numa família pra ver os produtos dela, usa
dimensões compostas (`tipo>familia`, `familia>produto`, rótulo
`"<pai>>><filho>"`) que só existem no pré-agregado, gravadas pela ingestão
(`lib/omie/faturamento.ts`, chamadas `add('tipo>familia', ...)` e
`add('familia>produto', ...)`). Documentado como limitação conhecida na
época; este projeto fecha esse gap.

## Arquitetura

Estender a reagregação em JS já existente (`agregarFaturamentoPorTipoFamilia`,
`lib/faturamento-frio.ts`) pra também calcular os 2 rótulos compostos,
usando a MESMA lógica de rotulagem (`TIPO_NOME`, `descricao_familia`, `nome`
via `metaPorCodigo` — já carrega os 3 campos desde o fix de hoje) e o MESMO
separador literal `>>` já usado pela ingestão. Em `page.tsx`, remover a
exclusão de drill da condição `cruzaAnoAnterior` e, quando há drill ativo,
usar `consultaDim` (já calculado no topo da função — `tipo>familia` ou
`familia>produto`) em vez de `dim` ao chamar `buscarFaturamentoFrioHistorico`;
aplicar o mesmo corte de prefixo que já é aplicado em `matrizCrua → matriz`
(`r.rotulo.startsWith(prefixo)` + `.slice(prefixo.length)`) no resultado do
histórico, antes de concatenar com a matriz quente.

## Componentes

### `lib/faturamento-frio.ts`: `agregarFaturamentoPorTipoFamilia`

Assinatura de `dim` estendida de `'tipo' | 'familia'` para
`'tipo' | 'familia' | 'tipo>familia' | 'familia>produto'`. Dentro da função,
calcular sempre os 3 rótulos base (`tipoLabel`, `familiaLabel`,
`produtoLabel` — já existem os 2 primeiros; `produtoLabel` reaproveita
`metaPorCodigo.get(...).nome`, já populado desde o fix de hoje) e escolher
o rótulo final conforme `dim`:
- `'tipo'` → `tipoLabel`
- `'familia'` → `familiaLabel`
- `'tipo>familia'` → `` `${tipoLabel}>>${familiaLabel}` ``
- `'familia>produto'` → `` `${familiaLabel}>>${produtoLabel}` ``

Mesma chave de acumulação (`` `${rotulo}|${mes}` ``), mesmo fallback de
`v_item`. `buscarFaturamentoFrioHistorico` (mesmo arquivo) passa a aceitar
os 2 novos valores de `dim` no seu parâmetro, roteando pro mesmo ramo
não-produto (só o ramo `dim==='produto'`, que delega pro `/fat_agregado`
do servidor, continua existindo à parte, sem mudança).

### `app/(app)/relatorio-faturamento/page.tsx`

`cruzaAnoAnterior` deixa de excluir `prefixo` (drill ativo) — passa a ser
`!usarFato && !verCupons && (!mesIni || mesIni < ano-01)`, sem o `!prefixo`.
Ao chamar `buscarFaturamentoFrioHistorico`, o `dim` passado vira `prefixo ?
consultaDim : dim` (`consultaDim` já existe no topo da função, calculado a
partir de `ultimo.dim`). O resultado (`rows`) recebe o MESMO tratamento de
corte de prefixo que `matrizCrua` já recebe pra virar `matriz`:
`prefixo ? rows.filter(r => r.rotulo.startsWith(prefixo)).map(r => ({...r,
rotulo: r.rotulo.slice(prefixo.length)})) : rows` — antes de aplicar o
filtro por `rotulosFiltro` já existente.

## Tratamento de erro

Mesma filosofia do resto do sistema (fire-and-forget, nunca lança) — sem
mudança nesse aspecto, só estende os rótulos calculados.

## Verificação

Sem suite automatizada (convenção já estabelecida). Verificação manual: (1)
reproduzir com dado real (loja 5, drill num tipo específico, período
"Todos") e comparar contra uma reconstrução independente via SQL+API direto,
mesma técnica já usada nesta sessão; (2) confirmar que o nível de cima
(sem drill, já corrigido hoje) continua correto — regressão zero.

## Fora de escopo

- Qualquer mudança no pré-agregado (`faturamento_importado`) ou no sync
  (`lib/omie/faturamento.ts`) — já corrigidos hoje mais cedo (commit
  `c3eecae`), este projeto só estende a leitura fria pro drill.
- O filtro de tipo/família/produto/local em Notas Fiscais — subsistema
  independente, já corrigido em projeto separado (spec/plano
  `2026-07-26-nf-filtro-cross-90-dias`).
