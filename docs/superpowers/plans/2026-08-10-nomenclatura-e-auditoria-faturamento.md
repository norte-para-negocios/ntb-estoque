# Nomenclatura SEFAZ + auditoria completa do Faturamento — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Trocar a nomenclatura do filtro de Situação do Faturamento pra
bater com o vocabulário oficial da SEFAZ (Autorizada/Cancelada/Devolvida),
investigar e corrigir qualquer "dado lixo" residual no fato de faturamento
(cupom fantasma) no histórico 2025, e blindar `syncFaturamento` com
reconciliação automática pra esse mesmo tipo de problema nunca mais
precisar de correção manual.

**Architecture:** Duas frentes independentes. (1) Troca de texto pura —
sem tocar em valor interno/enum, baixo risco. (2) Auditoria + correção
pontual (mesma técnica já validada hoje: comparar `id_item` que a Omie
retorna agora contra `fat_cupom_itens` gravado) + uma mudança de código
real em `syncFaturamento` que reaproveita o fetch mensal já existente pra
detectar cupom sumido automaticamente, sem chamada extra à Omie.

**Tech Stack:** TypeScript (Next.js), Omie ERP API, Postgres nativo do
Contabo (`ntb_frio`), Python (scripts ad-hoc de auditoria via SSH).

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging.**
- **Regra de ouro pra qualquer correção de dado**: só `UPDATE` de um campo
  específico (`cancelado`) em linha que já existe, identificada por
  `n_id_cupom` — nunca `INSERT`/`DELETE`, nunca mexer noutro campo.
- **Nunca salvar credencial Omie** (`app_key`/`app_secret`) em arquivo
  local nem expor em log/saída de comando fora do servidor — todo o
  fluxo de busca de credencial + chamada Omie roda como comando(s)
  remoto(s) via SSH, sem trazer o segredo pro lado local.
- **`npx tsc --noEmit`** limpo antes de qualquer commit de código.
- **Deploy sempre síncrono**: `git push origin main` PRIMEIRO, depois
  `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd
  /opt/ntb-estoque && bash deploy.sh"`, aguardando terminar por completo
  (sem nohup/background). Confirmar depois:
  `curl -s -o /dev/null -w "HTTP %{http_code}\n"
  https://app-estoque.norteparanegocios.com.br/login` (esperar 200) e
  `ssh ... "cd /opt/ntb-estoque && git log --oneline -1"` (commit certo).
- **Task 1 (renomeação) só troca texto visível** — o valor interno
  (`sp.status`: `'NORMAL' | 'DEVOLVIDO' | 'CANCELADO' | 'TODOS'`) não
  muda. Confirmar que nenhum comportamento de filtro muda, só o rótulo.
- **Task 4 (reconciliação automática) só pode marcar como sumido um cupom
  do MESMO loja+mês que está sendo reprocessado no momento pelo loop** —
  nunca aplicar a lógica a meses fora do loop atual de `syncFaturamento`
  (que só processa o ano corrente, mês 1 até o mês atual).
- Acesso: SSH `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`.
  Credenciais Omie por loja: `docker exec supabase-db psql -U
  supabase_admin -d postgres -t -A -F'|' -c "select omie_app_key,
  omie_app_secret from lojas where id=X"`. Postgres do fato (`ntb_frio`,
  NÃO o `supabase-db`): `psql "$(grep '^DATABASE_URL='
  /opt/ntb-frio-api/.env | cut -d= -f2-)"`. Endpoint Omie: `POST
  https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/`, `call:
  CuponsFiscais`, `param: [{dDtEmissaoDe, dDtEmissaoAte (dd/mm/aaaa),
  nPagina, nRegPorPagina: 50}]`, resposta tem `cupons[]`/`nTotPaginas`.
  Rate limit ~340ms entre chamadas. Em Python, usar
  `socket.setdefaulttimeout(10)` global + `timeout=10` em cada
  `urlopen` (sem isso, uma chamada pode travar minutos sem terminar —
  já aconteceu hoje). Lojas ativas: ids 2, 3, 4, 5, 6, 7.

---

## Task 1: Renomeação (Situação: Normal → Autorizada, Cancelado → Cancelada, Devolvido → Devolvida)

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`
- Modify: `app/(app)/relatorio-faturamento/export/route.ts`

**Contexto:** o valor interno do parâmetro de URL/estado (`sp.status`,
valores `'NORMAL' | 'DEVOLVIDO' | 'CANCELADO' | 'TODOS'`) NÃO muda — só o
texto (`label`) mostrado na tela. Isso preserva qualquer link salvo,
filtro ativo, e o comportamento do export sem nenhuma mudança de lógica.

**Step 1: Trocar os labels em `page.tsx`**

Linhas a editar (confirmar o texto exato lendo o arquivo antes — pode ter
mudado desde este plano):

- Linha 32: `{ value: '', label: 'Normal' }` → `{ value: '', label:
  'Autorizada' }`
- Linha 33: `{ value: 'CANCELADO', label: 'Cancelado' }` → `{ value:
  'CANCELADO', label: 'Cancelada' }`
- Linha 34: `{ value: 'DEVOLVIDO', label: 'Devolvido' }` → `{ value:
  'DEVOLVIDO', label: 'Devolvido' }` → `'Devolvida'`
- Linha 56: `{ value: 'NORMAL', label: 'Normal' }` → `{ value: 'NORMAL',
  label: 'Autorizada' }`
- Linha 57: `{ value: 'DEVOLVIDO', label: 'Devolvido' }` → `'Devolvida'`
- Linha 58: `{ value: 'CANCELADO', label: 'Cancelado' }` → `'Cancelada'`
- Linha 729 (comentário): pode manter `Normal/Cancelado/Devolvido` como
  está (é referência a um commit antigo, não texto exibido) — avaliar ao
  ler o contexto se vale a pena atualizar por clareza, mas não é
  obrigatório.
- Linha 737 (texto exibido ao usuário): `"...filtrar por situação
  (Normal/Cancelado/Devolvido/Todos)."` → `"...filtrar por situação
  (Autorizada/Cancelada/Devolvida/Todos)."`
- Linha 779 (texto exibido): `"cupom{...} cancelado{...}"` → manter
  "cancelado" minúsculo aqui está OK gramaticalmente (concorda com
  "cupom", não é o nome do status em si) — NÃO precisa mudar, é uma frase
  diferente do label do filtro. Ler o contexto e confirmar antes de
  decidir.
- Linha 831: `{c.cancelado ? 'Cancelado' : c.devolvido ? 'Devolvido' :
  'Normal'}` → `{c.cancelado ? 'Cancelada' : c.devolvido ? 'Devolvida' :
  'Autorizada'}` (esta é a célula da tabela "Ver cupons" que mostra o
  status de cada cupom — É texto exibido, precisa mudar).

Depois de editar essas linhas manualmente, rodar:
```bash
grep -n "'Normal'\|'Cancelado'\|'Devolvido'" "app/(app)/relatorio-faturamento/page.tsx"
```
pra confirmar que não sobrou nenhum rótulo visível com o nome antigo (fora
de comentários técnicos que não aparecem na tela).

**Step 2: Trocar o label no export**

`app/(app)/relatorio-faturamento/export/route.ts` linha 23:
```ts
const STATUS_LABEL: Record<string, string> = { NORMAL: 'Normal', DEVOLVIDO: 'Devolvido', CANCELADO: 'Cancelado' }
```
→
```ts
const STATUS_LABEL: Record<string, string> = { NORMAL: 'Autorizada', DEVOLVIDO: 'Devolvida', CANCELADO: 'Cancelada' }
```

**Step 3: `npx tsc --noEmit`**

**Step 4: Testar ao vivo**

Rodar `npm run dev`, abrir `/relatorio-faturamento`, confirmar:
- O dropdown de Situação mostra "Autorizada"/"Cancelada"/"Devolvida"/
  "Todos".
- Escolher cada opção e confirmar que o TOTAL exibido não muda em
  relação a antes da mudança (só o texto do label muda, não o filtro).
- Ativar "Ver cupons", confirmar que os chips e a coluna de status da
  tabela mostram os nomes novos.
- Baixar o Excel com um filtro de Situação ativo, confirmar que o
  subtítulo da planilha usa o nome novo.

**Step 5: Commit**

```bash
git add "app/(app)/relatorio-faturamento/page.tsx" "app/(app)/relatorio-faturamento/export/route.ts"
git commit -m "feat: nomenclatura SEFAZ no filtro de Situação (Autorizada/Cancelada/Devolvida)"
```

**Step 6: Deploy**

Seguir a seção de deploy dos Global Constraints.

---

## Task 2: Investigar o buraco de junho/2026, loja 2

**Depende de:** nada (pode rodar em paralelo com a Task 1, mas execute em
sequência nesta sessão).

**Contexto:** `faturamento_importado` (pré-agregado) e `fat_cupons` (fato)
não têm NENHUMA linha pra loja 2, mês 2026-06 — confirmado hoje. Precisa
descobrir se é sync que falhou silenciosamente ou se a loja genuinamente
não teve movimento naquele mês.

**Step 1: Checar se existe cupom real na Omie pra loja 2, junho/2026**

Comando único via SSH (credencial nunca sai do servidor):
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' <<'REMOTE_SCRIPT'
CREDS=$(docker exec supabase-db psql -U supabase_admin -d postgres -t -A -F'|' -c "select omie_app_key, omie_app_secret from lojas where id=2")
export OKEY=$(echo "$CREDS" | cut -d'|' -f1)
export OSECRET=$(echo "$CREDS" | cut -d'|' -f2)
timeout 200 python3 <<'PYEOF'
import json, urllib.request, time, os, socket
socket.setdefaulttimeout(10)
KEY = os.environ["OKEY"]; SECRET = os.environ["OSECRET"]
def call(pagina):
    body = json.dumps({"app_key": KEY, "app_secret": SECRET, "call": "CuponsFiscais",
        "param": [{"dDtEmissaoDe": "01/06/2026", "dDtEmissaoAte": "30/06/2026", "nPagina": pagina, "nRegPorPagina": 50}]}).encode()
    req = urllib.request.Request("https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
r = call(1)
print("nTotPaginas:", r.get("nTotPaginas"), "cupons na pagina 1:", len(r.get("cupons", [])))
PYEOF
unset OKEY OSECRET CREDS
REMOTE_SCRIPT
```

**Step 2: Interpretar o resultado**

- Se `nTotPaginas` for 0 ou não houver cupons: loja genuinamente sem
  movimento em junho (dado real, não é bug). Documentar isso e seguir
  pra Task 3.
- Se houver cupons de verdade: é um 3º bug (sync pulou o mês inteiro
  silenciosamente). Investigar a causa antes de prosseguir — checar se
  o cron rodou naquele período (não presumir, checar logs se existirem
  ou o padrão de outros meses) — e reportar antes de decidir corrigir
  (pode precisar de um reprocessamento do mês inteiro, que é diferente
  da correção pontual de cupom-a-cupom das outras tasks). Se este cenário
  acontecer, PARE e escreva o achado claramente no relatório da task
  antes de tentar corrigir — não presumir a causa raiz.

**Step 3: Documentar o achado**

Escrever o resultado (com números reais) em
`.superpowers/sdd/2026-08-10-nomenclatura-e-auditoria-faturamento/task-2-report.md`.
Não precisa de commit nesta task se o achado for "dado real, sem bug" —
só documentação do relatório. Se for bug real, escalar pro controller
decidir o próximo passo (pode virar uma task nova, fora deste plano).

---

## Task 3: Auditoria do histórico 2025-07 a 2025-12 (todas as 6 lojas)

**Depende de:** nada, mas execute depois da Task 2 (mesma sessão,
sequencial).

**Contexto:** técnica já validada hoje ao vivo (usada pra achar e corrigir
5 cupons fantasma em julho/agosto de 2026). Sem pré-agregado pra comparar
nesses meses de 2025 (ele só cobre o ano corrente), então a checagem é
direta: buscar todo `id_item` que a Omie retorna AGORA pra um loja+mês, e
comparar contra `fat_cupom_itens` local (cupons com `cancelado=false` e
`devolvido=false` daquele loja+mês) — qualquer `id_item` no banco ausente
da resposta da Omie é órfão (cupom fantasma).

**Step 1: Escrever o script de auditoria**

Adaptar o padrão já usado hoje (ver histórico desta sessão) pra rodar em
loop sobre 6 lojas × 6 meses (2025-07 a 2025-12) = até 36 combinações.
Script único, rodado via SSH, sem trazer credencial pro lado local:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' <<'REMOTE_SCRIPT'
FRIO_DB=$(grep '^DATABASE_URL=' /opt/ntb-frio-api/.env | cut -d= -f2-)

for LOJA in 2 3 4 5 6 7; do
  CREDS=$(docker exec supabase-db psql -U supabase_admin -d postgres -t -A -F'|' -c "select omie_app_key, omie_app_secret from lojas where id=$LOJA")
  export OKEY=$(echo "$CREDS" | cut -d'|' -f1)
  export OSECRET=$(echo "$CREDS" | cut -d'|' -f2)

  for MM in 07 08 09 10 11 12; do
    case $MM in
      07|08|10|12) ULT=31 ;;
      09|11) ULT=30 ;;
    esac
    echo "=== loja $LOJA, 2025-$MM ==="
    timeout 250 python3 <<PYEOF > /tmp/omie_ids_${LOJA}_2025${MM}.txt
import json, urllib.request, time, os, socket
socket.setdefaulttimeout(10)
KEY = os.environ["OKEY"]; SECRET = os.environ["OSECRET"]
def call(pagina, de, ate):
    body = json.dumps({"app_key": KEY, "app_secret": SECRET, "call": "CuponsFiscais",
        "param": [{"dDtEmissaoDe": de, "dDtEmissaoAte": ate, "nPagina": pagina, "nRegPorPagina": 50}]}).encode()
    req = urllib.request.Request("https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
pagina=1; total_pag=1
valid_ids = {}
while pagina <= total_pag:
    r = call(pagina, "01/${MM}/2025", "${ULT}/${MM}/2025"); total_pag = r.get("nTotPaginas",1)
    for c in r.get("cupons", []):
        cab = c.get("cabecalhoCupom", {}); info = cab.get("info", {})
        if info.get("cCupomCancelado") == "S" or info.get("cCupomDevolvido") == "S":
            continue
        for it in c.get("itensCupom", []):
            if it.get("cItemCancelado") == "S" or it.get("cCupomCancelado") == "S":
                continue
            idi = it.get("idItem") or f"{cab.get('nIdCupom')}{it.get('nSequencia')}"
            valid_ids[int(idi)] = cab.get("nIdCupom")
    pagina += 1
    if pagina <= total_pag: time.sleep(0.34)
for k,v in valid_ids.items():
    print(k, v)
PYEOF

    psql "$FRIO_DB" -t -A -c "
      select i.id_item, i.n_id_cupom, coalesce(nullif(i.v_item,0), i.v_unit*i.quant - i.v_desc) as valor_calc
      from fat_cupons c join fat_cupom_itens i on i.n_id_cupom=c.n_id_cupom and i.loja_id=c.loja_id
      where c.loja_id=$LOJA and c.cancelado=false and c.devolvido=false and c.data >= '2025-${MM}-01' and c.data < '2025-$(printf %02d $((10#$MM + 1)))-01'
    " > /tmp/db_ids_${LOJA}_2025${MM}.txt

    awk '{print $1}' /tmp/omie_ids_${LOJA}_2025${MM}.txt | sort -n > /tmp/omie_only_${LOJA}_2025${MM}.txt
    awk -F'|' '{print $1}' /tmp/db_ids_${LOJA}_2025${MM}.txt | sort -n > /tmp/db_only_${LOJA}_2025${MM}.txt
    ORFAOS=$(comm -23 /tmp/db_only_${LOJA}_2025${MM}.txt /tmp/omie_only_${LOJA}_2025${MM}.txt)
    N_ORFAOS=$(echo "$ORFAOS" | grep -c . || true)
    if [ "$N_ORFAOS" -gt 0 ]; then
      echo "!!! loja $LOJA 2025-$MM: $N_ORFAOS itens orfaos !!!"
      echo "$ORFAOS" > /tmp/orphan_ids_${LOJA}_2025${MM}.txt
      grep -F -f /tmp/orphan_ids_${LOJA}_2025${MM}.txt /tmp/db_ids_${LOJA}_2025${MM}.txt | awk -F'|' '{print $2}' | sort -u
      grep -F -f /tmp/orphan_ids_${LOJA}_2025${MM}.txt /tmp/db_ids_${LOJA}_2025${MM}.txt | awk -F'|' '{s+=$3} END {print "soma: "s}'
    else
      echo "sem orfaos"
    fi
    rm -f /tmp/omie_ids_${LOJA}_2025${MM}.txt /tmp/db_ids_${LOJA}_2025${MM}.txt /tmp/omie_only_${LOJA}_2025${MM}.txt /tmp/db_only_${LOJA}_2025${MM}.txt
  done
  unset OKEY OSECRET CREDS
done
REMOTE_SCRIPT
```

Ajuste o script conforme necessário (é um esqueleto validado no padrão,
não testado byte a byte) — mantenha a estrutura: credencial só dentro do
mesmo comando remoto, comparação por `id_item`, nunca `INSERT`/`DELETE`.
Isso é ~36 chamadas de até 250s cada no pior caso — pode levar bastante
tempo total. Rode com `run_in_background` se disponível, ou aceite que
pode ser uma execução longa.

**Step 2: Pra cada cupom órfão confirmado, aplicar a correção**

Mesma regra de ouro: `UPDATE fat_cupons SET cancelado=true WHERE
loja_id=X AND n_id_cupom=Y AND cancelado=false`. Rodar um `UPDATE` por
cupom encontrado (não em lote silencioso — quer ver a confirmação
`UPDATE 1` de cada um).

**Step 3: Validar**

Depois de todas as correções, rodar o mesmo script de detecção de novo
(Step 1) pras combinações que tinham órfão — confirmar 0 órfãos restantes.

**Step 4: Registrar os números**

Escrever em
`.superpowers/sdd/2026-08-10-nomenclatura-e-auditoria-faturamento/task-3-report.md`:
tabela loja × mês × quantos órfãos encontrados × valor total × quais
`n_id_cupom` foram corrigidos. Esse relatório alimenta a Task 5
(documentação).

---

## Task 4: Reconciliação automática em `syncFaturamento`

**Depende de:** nenhuma outra task tecnicamente, mas é código de
produção que roda a cada hora via cron — trate com o mesmo cuidado de
qualquer mudança em `lib/omie/faturamento.ts` hoje (task review completo
antes de deployar).

**Files:**
- Modify: `lib/omie/faturamento.ts` (dentro do loop de `syncFaturamento`,
  função inteira ~linha 119-330)

**Contexto:** `syncFaturamento` já busca TODOS os cupons de um loja+mês a
cada execução (o loop `for (let mes = 1; mes <= mesAtual; mes++)`, ~linha
165). Depois de montar `cuponsBulk` pro mês (o conjunto que a Omie
retornou AGORA), comparar contra o que já existe em `fat_cupons` pra esse
mesmo loja+mês com `cancelado=false` — qualquer `n_id_cupom` que estava lá
mas NÃO está em `cuponsBulk` desta rodada é candidato a "sumiu da Omie".
Isso reaproveita o fetch que já existe (zero chamadas extras à Omie).

**Step 1: Ler o estado atual da função**

Ler `lib/omie/faturamento.ts` linhas 119-275 (o loop de meses inteiro,
até o `gravarFatoNoFrio`) pra confirmar a estrutura exata antes de editar
— pode ter mudado desde este plano.

**Step 2: Adicionar a leitura do fato existente pro loja+mês**

Reusar `buscarFatCupons` de `lib/faturamento-frio.ts` (já existe, mesmo
padrão de leitura usado no resto do app):

```ts
import { buscarFatCupons } from '@/lib/faturamento-frio'
```

Dentro do loop de meses, DEPOIS de montar `cuponsBulk` completo pro mês
(depois do `do...while` de paginação, antes ou logo depois do `await
gravarFatoNoFrio(...)`), adicionar:

```ts
// Reconciliação (achado real 2026-08-10): cupom que some INTEIRAMENTE da
// consulta da Omie (nem aparece como cancelado -- só não vem mais) fica
// "fantasma" no fato pra sempre, contando como Normal. syncFaturamento
// já busca TODOS os cupons do mes a cada run -- reusa esse mesmo fetch
// (cuponsBulk) pra detectar sumico sem nenhuma chamada extra à Omie:
// qualquer n_id_cupom que já existia como Normal no fato desse MESMO
// loja+mes mas não veio nesta resposta é candidato a sumido.
try {
  const existentes = await buscarFatCupons({ lojaId: loja.id, dataInicio: `${mesISO}-01`, dataFinal: `${mesISO}-${String(ultimoDia(ano, mes)).padStart(2, '0')}` })
  const idsRetornados = new Set(cuponsBulk.map((c) => c.n_id_cupom))
  const sumidos = existentes.filter((c) => !c.cancelado && !idsRetornados.has(c.n_id_cupom))
  for (const c of sumidos) {
    await atualizarCanceladoNoFrio(loja.id, c.n_id_cupom)
  }
  if (sumidos.length) {
    console.warn(`[faturamento] loja ${loja.id}, ${mesISO}: ${sumidos.length} cupom(ns) sumiram da Omie, marcados cancelado`)
  }
} catch (e) {
  console.error('faturamento: falha na reconciliação de cupons sumidos', e)
}
```

Confirme os nomes exatos de variável (`mesISO`, `ano`, `mes`,
`ultimoDia`) lendo o arquivo real — este trecho assume os nomes já usados
no restante da função, mas confirme antes de colar.

**Step 3: Criar o helper `atualizarCanceladoNoFrio`**

Precisa de uma função nova que faça um UPDATE pontual (não um bulk
insert/upsert como `gravarFatoNoFrio`) — endpoint novo ou reuso de um
existente na `ntb-frio-api` (fora deste repo git, só no servidor). Se não
existir um endpoint pra UPDATE pontual de `cancelado` em `fat_cupons`,
crie um: `PATCH /fat_cupons/:n_id_cupom` (ou `POST
/fat_cupons_marcar_cancelado`, aceitando `{loja_id, n_id_cupom}`) que
faça exatamente `UPDATE fat_cupons SET cancelado=true WHERE loja_id=$1
AND n_id_cupom=$2 AND cancelado=false` — mesma regra de ouro do resto
deste plano. Documente esse endpoint novo no comentário do código (mesmo
padrão dos outros endpoints já documentados em `AGENTS.md`).

```ts
async function atualizarCanceladoNoFrio(lojaId: number, nIdCupom: number): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url) return
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const resp = await fetch(`${url}/fat_cupons_marcar_cancelado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
      body: JSON.stringify({ loja_id: lojaId, n_id_cupom: nIdCupom }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
  } catch (e) {
    console.error('faturamento: falha ao marcar cupom sumido como cancelado', e)
  }
}
```

O endpoint em si (`server.js` na `ntb-frio-api`) precisa ser criado via
SSH direto no servidor (arquivo fora deste repo git) — adicione a rota,
reinicie o serviço (`systemctl restart ntb-frio-api` ou equivalente, checar
o nome exato do serviço antes), e teste com 1 chamada manual (`curl`)
antes de considerar a task pronta.

**Step 4: `npx tsc --noEmit`**

**Step 5: Testar com dado real**

Não dá pra testar "cupom sumindo" de forma determinística (depende do
Omie). Teste indireto: rodar `syncFaturamento` manualmente pra 1 loja
(mesmo padrão de hoje: disparar `/api/cron/sync-faturamento` via SSH) e
confirmar que:
1. Não gera nenhum erro novo no log.
2. O total de `faturamento_importado`/fato continua batendo como antes
   (a reconciliação não deve mudar nada pra cupons que NÃO sumiram).
3. Se por acaso algum cupom real tiver sumido entre a auditoria de hoje e
   agora (baixa probabilidade, mas possível), o log deve mostrar o aviso
   `console.warn` e o `fat_cupons` desse cupom deve aparecer com
   `cancelado=true` depois.

**Step 6: Commit**

```bash
git add lib/omie/faturamento.ts
git commit -m "feat: reconciliação automática de cupom sumido em syncFaturamento"
```

**Step 7: Deploy**

Seguir a seção de deploy dos Global Constraints.

---

## Task 5: Documentação final

**Depende de:** Tasks 1-4 completas (precisa dos números finais delas).

**Files:**
- Modify: `AGENTS.md`
- Modify: `.superpowers/sdd/2026-08-10-fix-cancelado-fato-faturamento/progress.md`

**Step 1: Atualizar `AGENTS.md`**

Adicionar uma seção nova, mesmo padrão/formato das já existentes nesta
sessão (causa raiz, achado real, correção, volume). Deve cobrir:
- Os 2 bugs do fato de faturamento achados/corrigidos hoje (cupom
  cancelado que nunca atualizava; cupom fantasma que some da Omie).
- O achado do buraco de junho/2026 (Task 2) — o que foi confirmado.
- Os números finais da auditoria de 2025 (Task 3) — quantos cupons
  fantasma por loja/mês, valor total corrigido.
- A descrição do mecanismo de reconciliação automática novo (Task 4) —
  como funciona, e que não custa chamada extra à Omie.
- A renomeação SEFAZ (Task 1) — só uma linha, é mudança de texto, não
  precisa de muito detalhe.

**Step 2: Fechar o ledger do plano anterior**

Adicionar uma linha final em
`.superpowers/sdd/2026-08-10-fix-cancelado-fato-faturamento/progress.md`
apontando pra este plano novo, já que ele absorveu o que faltava (Task 2
e Task 3 daquele plano original, documentação).

**Step 3: Commit**

```bash
git add AGENTS.md .superpowers/sdd/2026-08-10-fix-cancelado-fato-faturamento/progress.md
git commit -m "docs: nomenclatura SEFAZ + auditoria completa do faturamento (2 bugs, reconciliação automática)"
```

Note: `.superpowers/` é git-ignored no geral, mas se este arquivo
específico já está sendo versionado (confirme com `git status`), inclua
normalmente; se não, o `git add` simplesmente não vai adicionar nada pra
esse path e está tudo bem.

---

## Execução

Oferecida via `superpowers:subagent-driven-development`, nesta mesma
sessão (mesmo padrão usado o dia inteiro hoje). Tasks 1 e 5 são baixo
risco (texto/documentação). Tasks 2 e 3 envolvem SQL real em produção
(regra de ouro: só UPDATE pontual, sempre testado no comando único via
SSH). Task 4 é código de produção que roda toda hora via cron — merece
task review cuidadoso (spec + qualidade) antes do deploy, e o teste do
Step 5 antes de considerar a task fechada.
