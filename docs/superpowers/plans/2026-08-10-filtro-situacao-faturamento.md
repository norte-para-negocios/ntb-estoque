# Filtro de Situação no Faturamento — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar um filtro "Situação" (Normal/Devolvido/Cancelado) no
painel principal de Filtros do relatório de Faturamento, mantendo o mesmo
resumo por Tipo/Família/Forma de pagamento que já existe hoje.

**Architecture:** Quando "Situação" estiver definida, a tela troca a
fonte do resumo do agregado pré-calculado (`buscarFatAgregado`, que exclui
cancelado de forma fixa e não conhece devolvido) para uma agregação em
JavaScript sobre o fato linha-a-linha (`buscarFatCupons` +
`buscarFatCupomItens`/`buscarFatCupomPagamentosPeriodo`, já existentes),
filtrado pelo status escolhido e cruzado com `produtos` (Supabase) pra
resolver tipo/família — mesmo padrão já usado por
`agregarFaturamentoPorTipoFamilia`/`agregarMovimentacaoJS` neste
codebase. Sem seleção, nada muda.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, API de
histórico frio do Contabo (`ntb-frio-api`).

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging.** Toda verificação usa SQL/dado real.
- **Sem seleção de status na URL, o comportamento tem que ficar
  BYTE-A-BYTE idêntico ao de hoje.** Qualquer task que mexer no branching
  de `usarFato`/`buscarFatAgregado` precisa validar isso explicitamente
  (comparar total antes/depois sem filtro de status ativo).
- **`npx tsc --noEmit`** limpo antes de qualquer commit.
- **Não presumir** o esquema exato de valores do parâmetro `status`
  compartilhado com o "Ver cupons" existente — a Task 1 investiga isso
  antes de qualquer código ser escrito nas tasks seguintes.
- **Export**: investigar custo primeiro (Task 4); só implementar se for
  barato reusando a mesma agregação. Se caro, documentar como fora de
  escopo e reportar — não implementar sozinho.
- **Drill-down**: já fora de escopo (não se aplica ao caminho `usarFato`
  hoje, confirmado no código). Task 5 só garante que não quebra a tela
  quando o filtro de Situação está ativo — não precisa fazer o drill
  respeitar o filtro.
- **Se qualquer task encontrar a arquitetura da spec errada**, reportar
  claramente e não prosseguir com suposição.
- Acesso pra validação real: SSH `ssh -i ~/.ssh/notebook_contabo_key
  root@185.193.66.240`. **Atenção**: o Postgres do `ntb_frio` NÃO fica
  dentro do container Docker `supabase-db` — é uma instância nativa
  separada no host; connection string real em `/opt/ntb-frio-api/.env`
  (`DATABASE_URL`). Usar `psql "$(grep '^DATABASE_URL=' /opt/ntb-frio-
  api/.env | cut -d= -f2-)"` via SSH, não `docker exec supabase-db`
  (esse é o banco quente/principal, diferente).
- Conta QA: `claude.qa@ntb-estoque.dev` / `claudeqa123456` contra
  `https://app-estoque.norteparanegocios.com.br` (mudanças só ficam
  visíveis lá após deploy — deploy fica pra depois de todas as tasks,
  não fazer deploy no meio do plano).

---

## Task 1: Investigação — esquema de valores do `status` + fluxo real de agregação por dimensão

**Contexto:** duas coisas precisam ser confirmadas com o código real
antes de escrever qualquer lógica nova, porque impactam diretamente o
design das tasks seguintes:

1. **Esquema de valores do parâmetro `status`.** Hoje, dentro do modo
   "Ver cupons", `const statusCupomSel = sp.status || 'NORMAL'`
   (`page.tsx` linha ~194) — ou seja, **vazio já significa "só Normal"**
   dentro desse modo, e `ChipsStatus`/`OPCOES_STATUS_CUPOM` usa os valores
   `''` (Normal), `'CANCELADO'`, `'DEVOLVIDO'`, `'TODOS'`. Só que o modo
   PADRÃO (fora de "Ver cupons", o que o usuário vê na tela normal) tem
   um default DIFERENTE: `buscarFatAgregado` exclui só cancelado, incluindo
   devolvido junto com normal — ou seja, vazio no modo padrão hoje
   significa "Normal + Devolvido juntos", não "só Normal" como no "Ver
   cupons". **Esses dois defaults são diferentes hoje.** Ler
   `components/ui-kit/ChipsStatus.tsx` inteiro e a função
   `cupomBateStatus` (procurar onde está definida, provavelmente
   `page.tsx` ou `lib/faturamento-frio.ts`) pra confirmar exatamente como
   ela compara `statusCupomSel` contra `cupom.cancelado`/`cupom.devolvido`.
   Depois, propor (documentar no relatório da task, não implementar
   ainda) o esquema de valores que o NOVO campo "Situação" do painel vai
   usar pro parâmetro `status`, de forma que:
   - Vazio/não setado no painel principal → comportamento de hoje
     inalterado (Normal + Devolvido combinados no agregado).
   - As 3 opções novas (Normal isolado / Devolvido isolado / Cancelado
     isolado) precisam de valores que, se o usuário depois clicar em "Ver
     cupons" com esse `status` já na URL, o `ChipsStatus`/`cupomBateStatus`
     existente também entenda corretamente (não quebrar nem mostrar dado
     errado no "Ver cupons" por causa de um valor que ele não reconhece).
   - Se não der pra reusar o mesmo parâmetro sem ambiguidade, documentar
     essa limitação claramente e propor alternativa (ex: um parâmetro novo
     `situacao` separado de `status`, aceitando o custo de não sincronizar
     automaticamente com "Ver cupons") — reportar essa decisão para o
     controller antes de prosseguir pras tasks seguintes, é uma mudança de
     design real, não só detalhe de implementação.

2. **Como o resumo por Tipo/Família/Produto realmente é montado no
   caminho `usarFato`.** Ler `agregarFaturamentoPorTipoFamilia`
   (`lib/faturamento-frio.ts`, ~linhas 78-111) inteira, e também como
   `matrizFato`/`cuponsFatoTodos` (resultado de `buscarFatAgregado`/
   `buscarFatCupons`) são consumidos no JSX de `page.tsx` (procurar onde
   `matrizFato` é lido/renderizado, provavelmente perto de onde `matriz`/
   `historico` — o caminho do pré-agregado normal — também são
   renderizados, já que a spec supõe que os dois caminhos produzem o
   mesmo formato `LinhaFatAgregado[]` pra caírem na mesma tabela).
   Confirmar: quando `dim==='tipo'` ou `dim==='familia'`, o `group:
   'produto'` passado pra `buscarFatAgregado` (linha ~201) devolve linhas
   por produto, e alguma agregação ADICIONAL agrupa isso por tipo/família
   antes de renderizar — ou o `rotulo` de `LinhaFatAgregado` já vem como
   tipo/família diretamente do servidor nesse caso (o que contradiria o
   `group: 'produto'` sendo usado igual pra tipo E família)? Se houver uma
   segunda etapa de agregação em algum lugar (client ou já dentro de
   `buscarFatAgregado`/endpoint), documentar exatamente onde, pra a Task 2
   replicar o mesmo comportamento na nova função.

**Não escrever código nesta task** — é investigação pura. Escrever a
resposta completa (com trechos de código citados) num relatório, e
reportar como parte do status da task (não precisa de arquivo de
relatório commitado — a resposta no retorno da task já serve pro
controller decidir como prosseguir).

**Se a resposta do item 1 for "não dá pra reusar o mesmo parâmetro sem
ambiguidade"**: PARE nesta task e reporte como BLOCKED — é uma decisão de
design que precisa voltar pro controller/usuário antes de continuar.

---

## Task 2: Nova função de agregação filtrada por situação em `lib/faturamento-frio.ts`

**Depende da Task 1** (usa o esquema de valores e o fluxo de agregação
confirmados lá).

**Files:**
- Modify: `lib/faturamento-frio.ts`

**O que fazer:**
1. Escrever uma nova função (nome sugerido: `buscarFatAgregadoPorSituacao`,
   ajustar se o nome colidir com algo já existente) que:
   - Recebe os mesmos parâmetros de `buscarFatAgregado` (`lojaId`,
     `dataInicio`, `dataFinal`, `group`, `group2`) MAIS um parâmetro de
     situação (usar o esquema de valores confirmado na Task 1).
   - Busca `buscarFatCupons` (pra ter `cancelado`/`devolvido` por
     `n_id_cupom`).
   - Busca `buscarFatCupomItens` (se `group !== 'forma'`) ou
     `buscarFatCupomPagamentosPeriodo` (se `group === 'forma'`).
   - Filtra as linhas de item/pagamento pelo status do cupom
     correspondente (via `n_id_cupom`).
   - Agrega/soma reusando `agregarFaturamentoPorTipoFamilia` (se a Task 1
     confirmar que ela serve pro caso `produto` genérico) ou uma lógica
     paralela no mesmo molde (mapa `Map<string, {...}>`, chave via
     `JSON.stringify([rotulo, mes])`, `Number(...)` explícito em valor
     vindo do fato) se não servir diretamente.
   - Retorna `LinhaFatAgregado[]` (mesmo formato de `buscarFatAgregado`).
2. Rodar `npx tsc --noEmit`.

**Validação obrigatória (produção real):** escolher 1 loja e 1 período
reais com pelo menos alguns cupons cancelados/devolvidos conhecidos
(confirmar antes com uma query rápida, ex: `select count(*) from
fat_cupons where loja_id=X and cancelado=true and data between ...`).
Comparar o resultado da nova função (rodando localmente ou via um script
ad-hoc temporário, apagado ao final) contra uma soma manual via SQL
direto no Postgres do `ntb_frio` (join `fat_cupom_itens`/`fat_cupons`,
filtrando pelo mesmo status, mesmo agrupamento). Reportar os números
batendo exato no relatório da task.

**Commit** direto na main (`git add`/`git commit` como comandos
SEPARADOS).

---

## Task 3: Novo campo "Situação" no painel de Filtros + branching em `page.tsx`

**Depende da Task 2.**

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`

**O que fazer:**
1. Adicionar `{ tipo: 'select', nome: 'status', label: 'Situação', opcoes:
   [...] }` (usando o parâmetro/valores confirmados na Task 1) ao array
   `campos` (linha ~395-401). `FiltrosGaveta`/`ChipsFiltrosAtivos` já
   suportam `tipo: 'select'` nativamente — não precisa mudar esses
   componentes (confirmado: `components/ui-kit/filtros-utils.ts` já
   define esse tipo, `FiltrosGaveta.tsx` linhas 171-185 já renderiza um
   `<select>` HTML pra ele).
2. No bloco que decide `usarFato`/chama `buscarFatAgregado` (linha
   ~154-208): quando o novo parâmetro de situação estiver definido com um
   valor que force agregação (não o valor "vazio/default"), trocar a
   chamada de `buscarFatAgregado` pela nova `buscarFatAgregadoPorSituacao`
   da Task 2, passando o `group`/`group2` já calculados igual hoje.
3. **Validação de não-regressão obrigatória**: com o filtro de Situação
   NÃO setado, o total exibido pra pelo menos 1 loja/1 período tem que
   ficar idêntico ao valor de antes da mudança (comparar antes/depois do
   commit, mesma URL sem `status`).
4. Rodar `npx tsc --noEmit`.

**Validação com dado real:** testar as 3 opções de Situação pra pelo
menos 1 loja real, em pelo menos 2 abas de dimensão diferentes (ex: Tipo
e Forma de pagamento), confirmando visualmente ou via leitura direta do
HTML gerado (a app ainda não estará deployada — se não der pra testar
via `npm run dev` local por causa do `.env.local` apontar pro Supabase
cloud descontinuado, documentar isso e confiar na validação de dado da
Task 2 + no `tsc`, deixando o teste visual final pra Task 5, que já vai
rodar contra produção depois do deploy).

**Commit** direto na main.

---

## Task 4: Investigar custo de estender o export pra respeitar o filtro de Situação

**Files:**
- Read-only nesta task: `app/(app)/relatorio-faturamento/export/route.ts`

**Contexto:** confirmado que o export hoje é **totalmente independente**
da página — usa a RPC `relatorio_faturamento_matriz` direto, nunca o
fato do Contabo, nunca `usarFato`/`buscarFatCupons`. Não tem ideia
nenhuma de status hoje.

**O que fazer:**
1. Ler o arquivo inteiro. Avaliar: dá pra estender esse endpoint pra
   aceitar `status` e, quando setado, reusar a `buscarFatAgregadoPorSituacao`
   da Task 2 em vez da RPC (mesma troca de fonte que a Task 3 fez na
   página)? Ou o export tem alguma particularidade (múltiplas abas,
   formato de saída, período diferente) que tornaria isso um trabalho de
   reescrita grande?
2. **Se for barato** (reusar a função da Task 2 sem reescrever a
   estrutura do export): implementar, seguindo o mesmo padrão condicional
   da Task 3. `npx tsc --noEmit`. Commit.
3. **Se for caro**: NÃO implementar. Documentar a decisão e o motivo no
   relatório da task, e reportar isso claramente no status final (não é
   silêncio — é uma decisão explícita de escopo).

---

## Task 5: QA final + deploy

**Depende de todas as tasks anteriores.**

**O que fazer:**
1. `npx tsc --noEmit` limpo no estado final.
2. `git push origin main` (⚠️ **sempre confirmar que este passo rodou** —
   achado real desta sessão: sem isso, os commits ficam só no clone
   local e o deploy seguinte não pega nada de novo, silenciosamente).
3. Deploy síncrono via SSH: `ssh -i ~/.ssh/notebook_contabo_key
   root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`,
   aguardando terminar por completo (sem nohup/background).
4. Confirmar `curl -s -o /dev/null -w "HTTP %{http_code}\n"
   https://app-estoque.norteparanegocios.com.br/login` → `200`.
5. QA manual com a conta QA contra produção:
   - Abrir `/relatorio-faturamento` sem filtro de Situação — confirmar
     visualmente que nada mudou.
   - Testar as 3 opções de Situação em pelo menos 2 abas de dimensão.
   - Clicar em "Ver cupons" com um filtro de Situação ativo no painel
     principal — confirmar que sincroniza (ou documentar se não
     sincronizar, conforme decidido na Task 1).
   - Clicar num drill-down (se disponível na tela) com o filtro de
     Situação ativo — confirmar que a tela NÃO trava nem mostra erro sem
     aviso (não precisa respeitar o filtro, só não pode quebrar).
6. Reportar o resultado da QA no relatório final da task.

---

## Execução

Oferecida via `superpowers:subagent-driven-development` nesta mesma
sessão. Mudança read-only (sem escrita em banco), risco de produção
baixo — revisão padrão de task (spec + qualidade) é suficiente, sem o
nível extra de rigor usado nos blocos de escrita de sessões anteriores.
