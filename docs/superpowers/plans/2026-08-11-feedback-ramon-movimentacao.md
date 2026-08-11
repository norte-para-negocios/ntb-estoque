# Feedback do Ramon (Movimentação) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corrigir a fórmula do card PDV na Movimentação, permitir agrupar
a tabela "Por operação (R$)" por produto (além de família), parar de
esconder a coluna "Local" atrás da coluna fixa "Família" quando o tipo
já está filtrado, e confirmar se o cupom físico que o Ramon mandou existe
corretamente no fato.

**Architecture:** Achados 1 e 3 tocam a mesma função de agregação
(`gerarMovimentacaoOperacaoAutomatica`) — um campo novo (`produto`) no
tipo `LinhaOperAuto` e a correção da fórmula de valor do PDV, na mesma
task. Achado 2 é só JSX/lógica de exibição em `page.tsx`, depende do
campo novo da Task 1. Achado 4 é investigação pura (1 SELECT), roda
independente.

**Tech Stack:** TypeScript (Next.js), Postgres nativo do Contabo
(`ntb_frio`, leitura via `lib/faturamento-frio.ts`/`lib/historico-contabo.ts`).

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging.**
- **`npx tsc --noEmit`** limpo antes de qualquer commit de código.
- **Deploy sempre síncrono**: `git push origin main` PRIMEIRO, depois
  `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd
  /opt/ntb-estoque && bash deploy.sh"`, aguardando terminar por completo
  (sem nohup/background). Confirmar depois:
  `curl -s -o /dev/null -w "HTTP %{http_code}\n"
  https://app-estoque.norteparanegocios.com.br/login` (esperar 200) e
  `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd
  /opt/ntb-estoque && git log --oneline -1"` (commit certo).
- **Achado 4 é só leitura** (`SELECT`) — se encontrar algo errado, PARE
  e reporte no relatório da task, não tente corrigir na mesma task sem
  entender a causa raiz primeiro.
- Nenhuma credencial da Omie é tocada nesta rodada — achado 4 é direto
  no Postgres do fato (`ntb_frio`), sem chamada à API da Omie.
- Acesso: SSH `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`.
  Postgres do fato (`ntb_frio`, NÃO o `supabase-db`): `psql
  "$(grep '^DATABASE_URL=' /opt/ntb-frio-api/.env | cut -d= -f2-)"`.
  Schema confirmado de `fat_cupons`: colunas `loja_id, n_id_cupom,
  chave, data, hora, num, serie, seq_caixa, id_cliente, id_vendedor,
  valor, cancelado, devolvido`, PK `(loja_id, n_id_cupom)`.

---

## Task 1: Corrigir fórmula do PDV + adicionar campo `produto` na agregação

**Files:**
- Modify: `lib/movimentacao-operacao-auto.ts`

**Contexto:** `gerarMovimentacaoOperacaoAutomatica` monta um array de
`LinhaOperAuto` a partir de 3 fontes (NF de entrada, fato de cupom PDV,
ajustes manuais). O tipo hoje não tem campo `produto` (só `familia`), e
o valor do PDV usa `Number(it.v_item) || 0` sem o fallback que o resto
do sistema já usa (achado real, medido hoje: R$1.701,35 de diferença
pra loja 2/2026 entre a fórmula atual e a correta).

**Step 1: Ler o arquivo real e confirmar estrutura atual**

Leia `lib/movimentacao-operacao-auto.ts` inteiro (só 258 linhas) antes
de editar — confirme os nomes exatos de variável (`meta`, `it`, `a`,
`add`) e que a estrutura ainda bate com o que está descrito aqui (pode
ter mudado desde este plano).

**Step 2: Adicionar campo `produto` ao tipo**

```ts
export type LinhaOperAuto = {
  origem: string
  sentido: 'E' | 'S'
  local: string
  tipo_sped: string
  familia: string
  produto: string
  mes: string
  inventario: boolean
  qtde: number
  valor: number
}
```

**Step 3: Popular `produto` nos 3 pontos onde `add(...)` é chamado**

Cada um dos 3 blocos (`NF de entrada`, `PDV`, `Ajustes manuais`) já
resolve um `meta` via `metaPorCodigo.get(...)` — adicione
`produto: meta?.descricao || meta?.codigo || String(<id_produto_da_linha>)`
em cada objeto passado pra `add(...)`. Exemplo pro bloco de NF (linha
~167-171, ajuste conforme o real):

```ts
add({
  origem, sentido, local: nomeLocal(localDeNF(it)), tipo_sped: tipoSpedLabel(meta?.tipo ?? null),
  familia: meta?.familia || 'N/D',
  produto: meta?.descricao || meta?.codigo || String(it.n_id_produto ?? ''),
  mes: data.slice(0, 7), inventario: false,
  qtde: Number(it.n_qtde_nfe) || 0, valor,
})
```

Repita o padrão equivalente nos outros 2 blocos (PDV usa `it.id_produto`,
Ajustes usa `a.id_prod`).

**Step 4: Corrigir a fórmula de valor do PDV**

No bloco `// ---------- PDV: Movimento Gerado pelo PDV ----------`
(linha ~211-226), troque:

```ts
qtde: Number(it.quant) || 0, valor: Number(it.v_item) || 0,
```

por:

```ts
// Achado real (2026-08-11, feedback Ramon via WhatsApp): v_item cru às
// vezes vem zerado do Omie; sem o fallback abaixo o card "Movimento
// Gerado pelo PDV" ficava R$1.701,35 mais baixo que o valor correto pra
// loja 2/2026 -- mesma fórmula já usada em lib/faturamento-frio.ts
// (buscarFatAgregadoPorSituacao) e lib/omie/faturamento.ts.
qtde: Number(it.quant) || 0,
valor: (Number(it.v_item) || (Number(it.v_unit) * Number(it.quant) - Number(it.v_desc))) || 0,
```

**Step 5: `npx tsc --noEmit`**

**Step 6: Testar valor com dado real**

Rode uma query manual (via `psql` no `ntb_frio`, mesmo padrão de hoje)
comparando o total de `fat_cupom_itens` pra loja 2/2026 com fallback
vs. sem fallback, e confirme que a run local/dev do `gerarMovimentacaoOperacaoAutomatica`
(ou uma chamada isolada) reflete o número COM fallback agora
(R$2.965.658,30 esperado pra loja 2, mesmo total já validado hoje pro
Faturamento).

**Step 7: Commit**

```bash
git add lib/movimentacao-operacao-auto.ts
git commit -m "fix: fórmula do valor PDV na Movimentação + campo produto na agregação"
```

---

## Task 2: Toggle Família/Produto + esconder coluna Tipo quando filtrada

**Depende da Task 1** (usa o campo `produto` novo).

**Files:**
- Modify: `app/(app)/relatorio-movimentacao/page.tsx`

**Contexto:** dentro do bloco `modo === 'operacao'` (~linha 94-393), a
tabela por família/local/tipo tem a chave de agrupamento fixa em
`JSON.stringify([familia, local, tipo])` (linha ~253) e sempre renderiza
3 colunas (Família/Local/Tipo, linhas ~344-349). A coluna Família é
`sticky left-0`, então Local/Tipo somem de vista quando a tabela rola
(ela é `overflow-x-auto`).

**Step 1: Ler o bloco `modo === 'operacao'` inteiro**

Leia `app/(app)/relatorio-movimentacao/page.tsx` do início do bloco
`if (modo === 'operacao') {` (~linha 94) até o fechamento dele
(~linha 393) — confirme nomes exatos de variável e estrutura JSX antes
de editar.

**Step 2: Adicionar estado de dimensão via searchParam**

Novo parâmetro de URL, ex. `sp.dimOper` (`'familia' | 'produto'`,
default `'familia'`). Padrão de leitura (mesmo estilo já usado no resto
do arquivo pra outros params):

```ts
const dimOper: 'familia' | 'produto' = sp.dimOper === 'produto' ? 'produto' : 'familia'
```

**Step 3: Trocar a chave de agrupamento condicionalmente**

Onde hoje é (linha ~248-259):

```ts
const porDim = new Map<string, { familia: string; local: string; tipo: string; total: number; meses: Record<string, number> }>()
for (const r of filtradas) {
  const familia = r.familia || 'N/D'
  const local = r.local || 'N/D'
  const tipo = r.tipo_sped || 'N/D'
  const chave = JSON.stringify([familia, local, tipo])
  ...
}
```

Trocar pra usar `r.produto` no lugar de `r.familia` quando
`dimOper === 'produto'` (mantendo `familia`/`local`/`tipo` como estão
quando `dimOper === 'familia'`, comportamento de hoje inalterado por
padrão). Ajuste o tipo do `Map` e o objeto guardado pra incluir o campo
certo (`rotulo: string` genérico no lugar de `familia` fixo, ou um campo
a mais — use o nome que fizer mais sentido lendo o código real).

**Step 4: Adicionar o toggle na UI**

Acima da tabela (antes do `<table>` de linha ~342), um controle simples
de 2 opções ("Família" / "Produto") que muda `sp.dimOper` via link/botão
(mesmo padrão de outros toggles já existentes na página — procure um
componente reusável tipo `Segmented`/`Tabs` já usado em outro lugar do
arquivo antes de criar um novo).

**Step 5: Esconder coluna "Tipo (SPED)" quando já filtrada**

Onde hoje o cabeçalho sempre mostra as 3 colunas (linha ~344-349):

```tsx
<th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Família</th>
<th className={`text-left ${th}`}>Local</th>
<th className={`text-left ${th}`}>Tipo (SPED)</th>
```

Adicione uma condição: se `sp.tipo` (o filtro de Tipo SPED da gaveta,
confirme o nome exato do searchParam lendo o código) estiver setado com
exatamente 1 valor (não vazio, não lista com 2+), não renderizar a
coluna "Tipo (SPED)" (nem no `<thead>` nem na célula correspondente do
`<tbody>`, linha ~365). Rótulo da 1ª coluna também troca pra "Produto"
quando `dimOper === 'produto'`.

**Step 6: `npx tsc --noEmit`**

**Step 7: Testar no navegador**

`npm run dev`, abrir `/relatorio-movimentacao?modo=operacao`, confirmar:
- Toggle Família/Produto aparece e funciona (trocar view sem perder
  filtros).
- Com "Tipo (SPED)" filtrado num valor só, a coluna some e a tabela fica
  mais compacta (Local mais perto da Família fixa).
- Sem filtro de tipo, a coluna volta a aparecer (comportamento de hoje).
- Números batem entre as duas visões (soma total família = soma total
  produto, pro mesmo recorte).

**Step 8: Commit**

```bash
git add "app/(app)/relatorio-movimentacao/page.tsx"
git commit -m "feat: agrupar Movimentação por produto + esconder coluna Tipo quando filtrada"
```

**Step 9: Deploy**

Seguir a seção de deploy dos Global Constraints (cobre Tasks 1 e 2
juntas, mesmo deploy).

---

## Task 3: Verificar o cupom físico do Ramon

**Files:** nenhum (investigação pura, SQL read-only).

**Contexto:** Ramon mandou foto de um NFC-e real: loja Rio Vermelho
(`loja_id=3`), nº 000171458, Série 1, emitido 16/06/2026 14:53:59,
Total R$334,07 (Cartão de Crédito), chave de acesso
`29260642200741000166650010001714561002445643` (44 dígitos, sem
espaços). Não explicou o motivo exato de ter mandado — pode ser só
contexto, ou pode estar sinalizando uma discrepância que não verbalizou.

**Step 1: Buscar pela chave**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' <<'REMOTE_SCRIPT'
FRIO_DB=$(grep '^DATABASE_URL=' /opt/ntb-frio-api/.env | cut -d= -f2-)
psql "$FRIO_DB" -c "select * from fat_cupons where loja_id=3 and chave='29260642200741000166650010001714561002445643'"
REMOTE_SCRIPT
```

**Step 2: Se não achar nada, buscar por data+valor+número**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' <<'REMOTE_SCRIPT'
FRIO_DB=$(grep '^DATABASE_URL=' /opt/ntb-frio-api/.env | cut -d= -f2-)
psql "$FRIO_DB" -c "select * from fat_cupons where loja_id=3 and data='2026-06-16' and valor=334.07"
psql "$FRIO_DB" -c "select * from fat_cupons where loja_id=3 and num='000171458'"
REMOTE_SCRIPT
```

**Step 3: Interpretar**

- Se achar o cupom com `cancelado=false`, `valor=334.07`, mesma data:
  está tudo certo, documentar a confirmação, sem código.
- Se achar mas com valor/status diferente do esperado: achado real,
  documentar detalhadamente (não corrigir nesta task — reportar pro
  controller decidir).
- Se não achar de jeito nenhum: achado real (cupom ausente do fato) —
  mesma classe dos "cupons fantasma" já corrigidos hoje mais cedo,
  documentar e reportar, não corrigir sem investigar a causa (pode ser
  caso novo, pode ser o mesmo mecanismo já conhecido — não presumir).

**Step 4: Escrever relatório**

Documentar o resultado (com a query e o output reais) em
`.superpowers/sdd/2026-08-11-feedback-ramon-movimentacao/task-3-report.md`.

---

## Task 4: Documentação final

**Depende de:** Tasks 1, 2 e 3 completas.

**Files:**
- Modify: `AGENTS.md` (só se a Task 3 encontrar algo real pra
  documentar; se o cupom estiver tudo certo, uma nota de 1-2 linhas
  já basta, ou nem precisa de entrada nova se não houver achado de
  causa raiz).

**Step 1: Revisar os relatórios das Tasks 1-3**

**Step 2: Se a Task 3 achou um problema real**, documentar no
`AGENTS.md` no mesmo padrão das seções já existentes (causa raiz,
achado real, o que foi feito). Se não achou nada (cupom certo), não
precisa de seção nova — só mencionar no relatório final desta task que
foi conferido e está ok.

**Step 3: Commit** (se houve mudança no AGENTS.md)

```bash
git add AGENTS.md
git commit -m "docs: verificação do cupom reportado pelo Ramon (Movimentação)"
```

---

## Execução

Oferecida via `superpowers:subagent-driven-development`, nesta mesma
sessão. Produção real, mas risco baixo/médio (1 fórmula, 1 campo novo,
1 toggle de UI, 1 leitura) — revisão de task padrão (spec + qualidade)
é suficiente, sem precisar do rigor extra dos blocos de reconciliação
de dado de hoje mais cedo.
