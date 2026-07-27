# Filtros rápidos e dimensões novas nos relatórios — Design

## Contexto

Auditoria de relatórios pediu, ao vivo, mais filtros rápidos ("chips" de
1 clique) espalhados pelas telas de relatório e algumas dimensões de filtro
que faltam em telas específicas. Hoje só 3 telas têm chips: Faturamento
(período: Todos/Este mês/3 meses/6 meses, falta "Ano passado"), Ordens de
Produção e Transferências (status, via `ChipsStatus`). O resto só tem a
gaveta de filtro (`FiltrosGaveta`) sem atalho.

Escopo fechado com o usuário (ver histórico da conversa): Margem foi
excluída deste projeto — teria que decidir entre 2 fontes de dado
conflitantes (import manual por mês vs. cálculo ao vivo sem noção de mês) e
means reescrever o cálculo ao vivo; vira investigação própria depois.

## Objetivo

1. Um componente novo, `ChipsPeriodo`, reaproveitável nas 6 telas que já
   têm filtro de período por `data_inicio`/`data_final` mas nenhum atalho.
2. `ChipsStatus` (já existe) aplicado em Notas Fiscais, que tem filtro de
   situação na gaveta mas nenhum chip.
3. Chip que falta ("Ano passado") na régua já existente de Faturamento.
4. Três dimensões de filtro novas onde o dado já existe mas o campo de UI
   não: período em Pendências de Classificação, local de estoque em
   Indicadores, família multi-select em Auditoria Fiscal.

## Componente `ChipsPeriodo`

Novo arquivo `components/ui-kit/ChipsPeriodo.tsx`, mesmo molde de
`ChipsStatus.tsx` (client component, `router.push` preservando os demais
searchParams, reseta `page`). Diferença: cada opção carrega um par de datas
prontas (não um valor de enum), e o clique escreve/apaga OS DOIS params
`data_inicio`/`data_final` de uma vez — os mesmos params que a gaveta de
filtro livre já usa em todas as 6 telas-alvo. Não precisa de um novo
searchParam por página: o chip é só um atalho pros mesmos 2 campos que já
existem.

```ts
// components/ui-kit/ChipsPeriodo.tsx
export type ChipPeriodoOpcao = { value: string; label: string; dataIni: string; dataFim: string }

export function ChipsPeriodo({
  basePath,
  opcoes,
}: {
  basePath: string
  opcoes: ChipPeriodoOpcao[]  // opcoes[0] deve ser o "default" da tela (ex.: Ano corrente) com value=''
}) {
  // 'use client', useRouter/useSearchParams — mesma estrutura de ChipsStatus.
  // Ativo = data_inicio/data_final atuais da URL batem com dataIni/dataFim
  // da opção (ou nenhum dos dois params está setado E value === '').
  // Ao clicar: se value === '', remove data_inicio/data_final da URL
  // (volta ao default da própria página); senão seta os dois.
}
```

Cálculo das datas de cada chip é responsabilidade de CADA PÁGINA (não do
componente) — cada tela tem seu próprio "default" (ano corrente, mês
corrente, 30 dias) e o componente só recebe já prontos os pares
`{dataIni, dataFim}`. Função utilitária nova, `lib/periodo-rapido.ts`:

```ts
// lib/periodo-rapido.ts
import { hojeBahiaISO } from '@/lib/data-bahia'

export type ChipPeriodoOpcao = { value: string; label: string; dataIni: string; dataFim: string }

// Gera os 4 chips padrão (Este mês / 3 meses / 6 meses / Ano passado),
// relativos a hoje (America/Bahia). `extra` permite a cada tela prependar
// seu próprio chip de default (ex.: {value:'', label:'Ano corrente', ...}).
export function chipsPeriodoPadrao(extra?: ChipPeriodoOpcao): ChipPeriodoOpcao[] {
  const hoje = hojeBahiaISO() // YYYY-MM-DD
  const [ano, mes] = hoje.slice(0, 7).split('-').map(Number)
  const primeiroDiaMes = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}-01`
  const voltarMeses = (n: number): string => {
    let a = ano, m = mes - n
    while (m < 1) { m += 12; a-- }
    return primeiroDiaMes(a, m)
  }
  const chips: ChipPeriodoOpcao[] = [
    { value: 'mes', label: 'Este mês', dataIni: voltarMeses(0), dataFim: hoje },
    { value: '3m', label: '3 meses', dataIni: voltarMeses(2), dataFim: hoje },
    { value: '6m', label: '6 meses', dataIni: voltarMeses(5), dataFim: hoje },
    { value: 'ano_passado', label: 'Ano passado', dataIni: `${ano - 1}-01-01`, dataFim: `${ano - 1}-12-31` },
  ]
  return extra ? [extra, ...chips] : chips
}
```

`value` de cada chip não é lido de volta da URL (a URL só carrega
`data_inicio`/`data_final`, nunca um `periodo=mes` como Faturamento faz
hoje) — `value` existe só como `key` React e para "ativo" comparar contra
o default (`value === ''`). Isso mantém os filtros livres da gaveta e os
chips como a MESMA fonte de verdade (2 campos de data), sem duplicar
estado — diferente do padrão atual de Faturamento (`periodo=1|3|6`), que
fica como está (não mexer, é uma tela de mês, granularidade diferente).

Detecção de "ativo": o componente compara `sp.get('data_inicio')`/`sp.get('data_final')`
atuais contra `opcao.dataIni`/`opcao.dataFim`; nenhuma combinação ativa
(period customizado da gaveta) = nenhum chip realçado, o que é o
comportamento correto (mesma regra que Faturamento já usa: "período
customizado tem prioridade sobre os chips fixos").

## Telas que ganham `ChipsPeriodo`

Renderizado logo abaixo do `PageHeader`/`ListaHeader`, acima da tabela —
mesma posição que `ChipsStatus` ocupa em OP/Transferências.

1. **Compras** (`app/(app)/relatorio-compras/page.tsx`) — chip default
   `{value:'', label:'Ano corrente', dataIni: '${anoAtual}-01-01', dataFim: hoje}`
   (mesmo default que a página já usa quando os campos vêm vazios).
2. **Movimentação** (`app/(app)/relatorio-movimentacao/page.tsx`) — MESMOS
   chips nos dois modos (`SegmentLinks` Em quantidade / Por operação); o
   default de ambos já é ano corrente hoje, mesmo chip default de Compras.
3. **Auditoria Fiscal** (`app/(app)/auditoria-fiscal/page.tsx`) — default
   ano corrente, mesmo padrão.
4. **Indicadores** (`app/(app)/relatorio-indicadores/page.tsx`) — hoje não
   tem default fixo declarado no campo (cai no intervalo de anos do
   faturamento internamente); chip default vira `{value:'', label:'Tudo', dataIni:'', dataFim:''}`
   (não seta nada, mantém o comportamento atual quando nenhum chip nem
   filtro livre está ativo).
5. **Ordens de Produção** (`app/(app)/ordem-producao/page.tsx`) — já tem
   `ChipsStatus`; `ChipsPeriodo` entra do lado, chip default `{value:'', label:'Este mês', ...}`
   (mesmo default atual da página).
6. **Transferências** (`app/(app)/transferencia/page.tsx`) — já tem
   `ChipsStatus`; sem default fixo hoje (campos vêm vazios), chip default
   `{value:'', label:'Tudo', dataIni:'', dataFim:''}`.

Nenhuma dessas 6 telas muda a lógica de busca de dado (RPC, complemento
frio, paginação) — o chip só preenche os mesmos 2 query params que a
gaveta já lê. Zero mudança de backend/RPC para este item.

## Faturamento: chip "Ano passado"

`CHIPS_PERIODO` (`app/(app)/relatorio-faturamento/page.tsx:30-35`) ganha
uma 5ª entrada. Diferente dos outros 4 valores (`''`/`1`/`3`/`6`, que
alimentam `mesOffset` como contagem de meses pra trás), "Ano passado"
precisa de um valor sentinela específico (não é "N meses atrás" — é o ano
calendário INTEIRO anterior). Tratamento:

```ts
const CHIPS_PERIODO = [
  { value: '', label: 'Todos' },
  { value: '1', label: 'Este mês' },
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: 'ano_passado', label: 'Ano passado' },
] as const
```

E o cálculo de `mesIniChip`/`mesFim` (hoje só `mesIni`, linha ~104) precisa
tratar o novo valor à parte do `mesOffset` numérico:

```ts
const anoAtualNum = Number(mesAtual.slice(0, 4))
const mesIniChip =
  periodo === 'ano_passado' ? `${anoAtualNum - 1}-01`
  : periodo && !temPeriodoCustom ? mesOffset(mesAtual, -(Number(periodo) - 1))
  : null
const mesFimChip = periodo === 'ano_passado' ? `${anoAtualNum - 1}-12` : null
const mesFim = dataFim ? dataFim.slice(0, 7) : mesFimChip
```

(`mesFim` hoje é sempre `null` quando vem de chip — os outros chips vão até
o mês atual implicitamente. "Ano passado" é o primeiro chip que PRECISA de
um teto explícito, por isso `mesFim` ganha essa segunda fonte.) Onde `mesFim`
já é consumido mais abaixo no arquivo, confirmar que um valor não-null
restringe corretamente o teto da consulta (mesmo contrato que
`dataFim`/`sp.data_final` já usa hoje).

## Notas Fiscais: `ChipsStatus`

`app/(app)/nota-fiscal/page.tsx` ganha `ChipsStatus` com as opções
`Todas` (`value:''`), `Concluídas` (`CONCLUIDA`), `Pendentes` (`PENDENTE`),
`Canceladas` (`CANCELADA`) — os mesmos 4 valores que o campo `situação` já
aceita na gaveta hoje (linha 369-378, ver `statusBateFiltro` em
`lib/nf-status.ts`). Mesmo param (`status`) que a gaveta usa, então os
dois ficam em sincronia automaticamente (mesma garantia que já vale entre
`ChipsStatus` e a gaveta em Ordens de Produção/Transferências).

## Pendências de Classificação: filtro de período

Hoje o período de 12 meses (`ini12m`) e o corte de 90 dias (`corte`) são
fixos no código, calculados 3 VEZES de forma independente e ligeiramente
diferente (`page.tsx:25-26,58`; `export/route.ts:45-46`;
`export/route.ts:105-106`). Objetivo: um único cálculo, parametrizável por
`searchParams`, usado nos 3 lugares.

Nova função em `lib/relatorio-frio-nf.ts` (ou `lib/pendencias-periodo.ts`,
arquivo pequeno e dedicado — decisão do implementador, mas UM lugar só):

```ts
export function periodoPendencias(sp: { data_inicio?: string; data_final?: string }): { dataIni: string; dataFim: string } {
  const hojeISO = hojeBahiaISO()
  const dataFimValida = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO
  const dataIniPadrao = `${Number(dataFimValida.slice(0, 4)) - 1}${dataFimValida.slice(4, 10)}`
  const dataIniValida = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : dataIniPadrao
  return { dataIni: dataIniValida, dataFim: dataFimValida }
}
```

(Default preserva o comportamento atual — 12 meses terminando hoje —
quando nenhum param é passado.)

Usos a trocar:

1. `page.tsx:25-26,58` → `const { dataIni: ini12m, dataFim: hojeISO } = periodoPendencias(sp)` (adicionar
   `searchParams` na assinatura do componente de página, que hoje não
   recebe — ver `page.tsx` atual, componente é `async function
   PendenciasClassificacaoPage()` sem parâmetro).
2. `carregarQuentes()` (`page.tsx:67-84`) → passa a receber `dataInicio:
   string` como parâmetro (hoje fechado sobre `corte` do escopo externo,
   linha 76: `.gte('notas_fiscais.d_emissao_nfe', corte)`); chamador passa
   o `corte` derivado do novo período (a janela quente continua
   `limiteJanelaQuente()`, sem mudar — só a janela de 12 meses e o teto
   viram configuráveis).
3. `buscarItensNFFrio({ lojaId, dataInicio: ini12m, dataFinal: corteExcl
   })` (`page.tsx:88`) → já aceita parâmetro, só troca os valores vindos de
   `periodoPendencias`.
4. `export/route.ts` — os dois blocos duplicados (`sem-familia` linhas
   45-56, `sem-cadastro` linhas 105-122) trocam o cálculo inline de
   `ini12m`/`corte` por `periodoPendencias(new URL(req.url).searchParams
   como objeto)`, e a query de NF quente ganha
   `.gte('notas_fiscais.d_emissao_nfe', corte)` já usando o valor
   parametrizado (a estrutura da query não muda, só a fonte do valor).
5. Bloco `cupom-nao-identificado` (`page.tsx:164-172`,
   `export/route.ts:90-97`) mantém `.limit(12)` fixo — está fora de escopo
   (é uma lista de "últimos 12 meses de cupom não identificado", conceito
   diferente do período de 12 meses de NF; não mexer).

UI: nova entrada na gaveta de filtros da página (`FiltrosGaveta`, hoje
ausente nesta tela) com 2 campos de data (`data_inicio`/`data_final`),
mesmo padrão de campo usado em Compras/Auditoria. Título da seção:
"Período (padrão: últimos 12 meses)".

## Indicadores: filtro de local de estoque

RPC `relatorio_compras_matriz` já aceita `p_local bigint` (migration 075);
`filtrarItensCompras` (`lib/relatorio-frio-nf.ts:171-204`) já aceita
`f.local`. Mudança inteira no front, sem migration:

1. `app/(app)/relatorio-indicadores/page.tsx`: buscar `local_estoques` da
   loja (mesmo padrão de `relatorio-compras/page.tsx:245-246`), adicionar
   `CampoFiltro` tipo `select` único (mesmo tipo que Compras usa pra local,
   `page.tsx:264-269` — não é multi-select) na gaveta, ler `sp.local` →
   `localCod`.
2. Passar `p_local: localCod` na chamada a `relatorio_compras_matriz`
   (`page.tsx:133-137`, onde falta hoje).
3. Trocar `local: null` por `local: localCod` na chamada a
   `filtrarItensCompras` (`page.tsx:167`).
4. `app/(app)/relatorio-indicadores/export/route.ts:48-50` — ler `local`
   de `searchParams` e passar `p_local` na mesma chamada RPC (hoje nem lê
   esse param).

## Auditoria Fiscal: família vira multi-select

Única mudança deste projeto que toca SQL. Duas RPCs mudam de `p_familia
text` para `p_familias text[]`, replicando o padrão já usado em
`relatorio_compras_matriz` (`p_familias text[]`, `= any(p_familias)`,
sentinela `'__sem__'` preservado):

**Nova migration** `supabase/migrations/090_auditoria_fiscal_familias_array.sql`:

```sql
create or replace function relatorio_auditoria_fiscal_cfop(
  p_loja_id bigint, p_ini date, p_fim date,
  p_produto text default null, p_familias text[] default null,
  p_fornecedor text default null, p_local bigint default null
) returns table (...) as $$
  -- corpo identico ao atual (081_auditoria_fiscal_icms_creditado.sql),
  -- trocando a condicao de familia:
  -- de: and (p_familia is null or (p_familia = '__sem__' and p.descricao_familia is null) or p.descricao_familia = p_familia)
  -- para: and (p_familias is null or (array['__sem__'] <@ p_familias and p.descricao_familia is null) or p.descricao_familia = any(p_familias))
$$ language sql stable;

create or replace function relatorio_auditoria_fiscal_itens(...)
  -- mesma troca de p_familia -> p_familias, mesma condicao
```

(Implementador: copiar o corpo COMPLETO das duas funções da migration
078/081 vigente antes de editar — não reescrever do zero. `create or
replace` preserva o nome/retorno; só a assinatura do parâmetro e a
cláusula WHERE de família mudam.)

**`lib/relatorio-frio-nf.ts`**: `FiltrosAuditoriaFrio.familia: string` →
`familias: string[]` (linha 271); `filtrarItensAuditoria` troca a
comparação de igualdade (linha 291, `fam !== f.familia`) por
`!f.familias.includes(fam)` com o mesmo tratamento de sentinela
`'__sem__'` que `filtrarItensCompras` já usa (linha 182,
`f.familias.includes(fam)`).

**`app/(app)/auditoria-fiscal/page.tsx`**: campo `familia` (linha 166)
troca `tipo: 'select'` por `tipo: 'multi-select'`; leitura troca de
`sp.familia` (valor único) para `valoresMulti(sp.familia)` (já importado
em outras telas, `@/components/ui-kit/filtros-utils`); as 2 chamadas RPC
(`relatorio_auditoria_fiscal_cfop` linha 61, `relatorio_auditoria_fiscal_itens`
linha 128) passam `p_familias: familiasFiltro` (array) em vez de
`p_familia: familiaFiltro` (string); as 2 chamadas a
`filtrarItensAuditoria` (linhas 79, 144) passam `familias: familiasFiltro`.

**`app/(app)/auditoria-fiscal/export/route.ts`**: mesmo tratamento nas
linhas 21, 29, 54, 114 (mesma troca de singular pra array, mesmos 2 pontos
de chamada RPC + 2 pontos de `filtrarItensAuditoria`).

## Fora de escopo (explícito)

- Margem (período/previsão de venda) — investigação separada.
- Estoque Valorizado — é foto do saldo atual, "período" não se aplica sem
  reconstruir histórico de estoque (projeto maior, não pedido aqui).
- Novas dimensões além das 3 listadas (fornecedor em telas que não têm,
  forma de pagamento fora de Faturamento) — usuário confirmou que a lista
  acima cobre o pedido.

## Testes

Sem framework de teste automatizado no repo (`AGENTS.md`/convenção já
estabelecida) — verificação via `npx tsc --noEmit -p .` + `npm run build`
depois de cada tarefa, e verificação manual dos números (Auditoria Fiscal
com filtro de família múltipla comparado a somar duas consultas de família
única, mesmo método já usado nas validações anteriores desta sessão).
