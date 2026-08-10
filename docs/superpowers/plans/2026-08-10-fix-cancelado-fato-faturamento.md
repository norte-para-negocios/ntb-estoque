# Correção do bug de cupom cancelado no fato de Faturamento — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Corrigir `syncFaturamento` pra que um cupom cancelado DEPOIS da
primeira sincronização seja corretamente atualizado no fato
(`fat_cupons`), e reprocessar o resíduo histórico já travado desde
2026-07-18.

**Architecture:** O `continue` que exclui cupom cancelado do agregado
pré-calculado hoje também impede (indevidamente) o cabeçalho do cupom de
entrar no fato bruto. Mover o `push` pra antes do `continue` resolve o
problema dai pra frente, sem mecanismo novo (o UPSERT do servidor já
sabe atualizar por `n_id_cupom`). O resíduo histórico precisa de um
script pontual que consulta a Omie e corrige só o campo `cancelado` de
linhas já existentes.

**Tech Stack:** TypeScript (Next.js), Omie ERP API, Postgres nativo do
Contabo (`ntb_frio`).

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging.** Toda verificação usa SQL/API real.
- **Regra de ouro do reprocessamento retroativo**: só `UPDATE` de um
  campo específico (`cancelado`) em linha que já existe, identificada
  por `n_id_cupom` — nunca `INSERT`/`DELETE`, nunca mexer noutro campo.
  Testar com 1-2 cupons de 1 loja antes de rodar em lote pras 6.
- **Nunca salvar credencial Omie** (`app_key`/`app_secret`) em arquivo
  local nem expor em log/saída de comando fora do servidor — todo o
  fluxo de busca de credencial + chamada Omie + update no Postgres roda
  como comando(s) remoto(s) via SSH, sem trazer o segredo pro lado
  local.
- **`npx tsc --noEmit`** limpo antes de qualquer commit de código.
- **Deploy sempre síncrono**: `git push origin main` PRIMEIRO (achado
  real repetido nesta sessão: sem isso o deploy no servidor não pega
  nada de novo, silenciosamente), depois `ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque
  && bash deploy.sh"`, aguardando terminar por completo (sem nohup/
  background).
- **Se qualquer task encontrar a causa raiz ou o comportamento do UPSERT
  diferente do que a spec descreve**, reportar claramente e não
  prosseguir com suposição.
- Acesso: SSH `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`.
  Credenciais Omie por loja: `docker exec supabase-db psql -U
  supabase_admin -d postgres -t -A -F'|' -c "select omie_app_key,
  omie_app_secret from lojas where id=X"`. Postgres de destino do fato
  (`ntb_frio`, NÃO o `supabase-db`): `psql "$(grep '^DATABASE_URL='
  /opt/ntb-frio-api/.env | cut -d= -f2-)"`. Endpoint Omie: `POST
  https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/`, `call:
  CuponsFiscais`, `param: [{dDtEmissaoDe, dDtEmissaoAte (dd/mm/aaaa),
  nPagina, nRegPorPagina: 50}]`, resposta tem `cupons[]`/`nTotPaginas`.
  Rate limit: ~340ms entre chamadas. Lojas ativas: ids 2, 3, 4, 5, 6, 7.

---

## Task 1: Corrigir `syncFaturamento` + deploy + confirmação

**Files:**
- Modify: `lib/omie/faturamento.ts` (função `syncFaturamento`, linha
  119, trecho do loop de cupons ~linhas 185-201)

**Contexto:** `syncFaturamento(loja: LojaOmie, opts?: {importadoPor?:
string}): Promise<number>` — reprocessa o ano corrente inteiro (mês 1 até
o mês atual) toda vez que roda, chamada 1x/hora pelo cron
`/api/cron/sync-faturamento`.

**Step 1: Aplicar a correção exata**

Trecho ANTES (código atual):

```ts
for (const c of r.cupons ?? []) {
  if (c.cabecalhoCupom?.info?.cCupomCancelado === 'S') continue
  const cab = c.cabecalhoCupom
  cuponsBulk.push({
    n_id_cupom: Number(cab?.nIdCupom),
    chave: cab?.cChaveCupom ?? null,
    data: cab?.dDtEmissaoCupom ? cab.dDtEmissaoCupom.split('/').reverse().join('-') : mesISO + '-01',
    hora: cab?.cHrEmissaoCupom ?? null,
    num: cab?.nNumCupom != null ? String(cab.nNumCupom) : null,
    serie: cab?.nSerieCupom != null ? String(cab.nSerieCupom) : null,
    seq_caixa: cab?.seqCaixa != null ? Number(cab.seqCaixa) : null,
    id_cliente: cab?.idCliente != null ? Number(cab.idCliente) : null,
    id_vendedor: cab?.idVendedor != null ? Number(cab.idVendedor) : null,
    valor: Number(cab?.nValorCupom) || 0,
    cancelado: cab?.info?.cCupomCancelado === 'S',
    devolvido: cab?.info?.cCupomDevolvido === 'S',
  })
  for (const p of c.pagamentosCupom ?? []) { ... }
  for (const it of c.itensCupom ?? []) { ... }
}
```

Trecho DEPOIS (correção):

```ts
for (const c of r.cupons ?? []) {
  const cab = c.cabecalhoCupom
  const cancelado = cab?.info?.cCupomCancelado === 'S'

  // Achado real (revisão final do plano de filtro de Situação,
  // 2026-08-10): antes o `continue` pulava ANTES deste push, então um
  // cupom cancelado nunca entrava em cuponsBulk -- nunca era reenviado
  // pro upsert do fato, ficando travado com o snapshot da primeira
  // sincronização (sempre "Normal") pra sempre, mesmo cancelado de
  // verdade na Omie depois. Movido o push pra antes do continue --
  // agora o UPSERT do servidor (ON CONFLICT (loja_id, n_id_cupom) DO
  // UPDATE) consegue corrigir o status na próxima sync.
  cuponsBulk.push({
    n_id_cupom: Number(cab?.nIdCupom),
    chave: cab?.cChaveCupom ?? null,
    data: cab?.dDtEmissaoCupom ? cab.dDtEmissaoCupom.split('/').reverse().join('-') : mesISO + '-01',
    hora: cab?.cHrEmissaoCupom ?? null,
    num: cab?.nNumCupom != null ? String(cab.nNumCupom) : null,
    serie: cab?.nSerieCupom != null ? String(cab.nSerieCupom) : null,
    seq_caixa: cab?.seqCaixa != null ? Number(cab.seqCaixa) : null,
    id_cliente: cab?.idCliente != null ? Number(cab.idCliente) : null,
    id_vendedor: cab?.idVendedor != null ? Number(cab.idVendedor) : null,
    valor: Number(cab?.nValorCupom) || 0,
    cancelado,
    devolvido: cab?.info?.cCupomDevolvido === 'S',
  })

  if (cancelado) continue   // segue excluindo itens/pagamentos/acc, não mais o cabeçalho

  for (const p of c.pagamentosCupom ?? []) { ... }
  for (const it of c.itensCupom ?? []) { ... }
}
```

Confirme os nomes exatos de variável (`r`, `c`, `mesISO`, etc.) lendo o
arquivo real antes de aplicar — a spec já verificou este trecho, mas
confirme que não mudou desde a investigação.

**Step 2: `npx tsc --noEmit`**

**Step 3: Commit**

```bash
git add lib/omie/faturamento.ts
git commit -m "fix: cupom cancelado após 1a sync nunca era atualizado no fato"
```

**Step 4: Push + deploy síncrono**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

Aguardar terminar por completo. Confirmar:
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

**Step 5: Confirmar funcionando com dado real**

Não precisa esperar o cron natural (1x/hora) — dispare manualmente a
sync pra 1 loja com dado real conhecido:

1. Antes: rode a mesma query de medição já usada nesta sessão pra
   confirmar o estado atual: `psql "$(grep '^DATABASE_URL='
   /opt/ntb-frio-api/.env | cut -d= -f2-)" -c "select count(*) from
   fat_cupons where cancelado=true and data >= '2026-07-18'"` (deve
   continuar mostrando o número de antes, já que a sync ainda não rodou
   de novo).
2. Dispare `/api/cron/sync-faturamento` manualmente (mesmo padrão de
   outros crons testados nesta sessão: `curl -H "Authorization: Bearer
   $CRON_SECRET" http://127.0.0.1:3002/api/cron/sync-faturamento`, via
   SSH, `$CRON_SECRET` do `.env.local` do servidor).
3. Depois: rode a mesma query de novo. Se a loja 3 (onde já sabemos que
   existem 6 cupons genuinamente cancelados desde 18/07, confirmado via
   Omie nesta sessão) tiver algum desses 6 dentro do ano corrente sendo
   reprocessado pela sync, o número deve aumentar. Se não aumentar,
   investigar antes de prosseguir (pode ser que a sync não tenha
   alcançado ainda o cupom específico, ou pode ser que a correção não
   esteja funcionando como esperado — não presumir, confirmar).

Escreva relatório em
`.superpowers/sdd/2026-08-10-fix-cancelado-fato-faturamento/task-1-report.md`
com o resultado antes/depois.

---

## Task 2: Reprocessamento retroativo do resíduo (desde 2026-07-18)

**Depende da Task 1** (o código de produção já precisa estar corrigido
antes de reprocessar, senão a próxima sync natural desfaz o
reprocessamento retroativo pra qualquer cupom ainda dentro do ano
corrente — na real não desfaz, porque o UPSERT gravaria o mesmo valor
correto, mas é mais seguro fazer nessa ordem).

**O que fazer**, pra cada uma das 6 lojas ativas (ids 2, 3, 4, 5, 6, 7),
como um script bash único rodado via SSH (sem trazer credencial pro lado
local):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' <<'REMOTE_SCRIPT'
FRIO_DB=$(grep '^DATABASE_URL=' /opt/ntb-frio-api/.env | cut -d= -f2-)

for LOJA_ID in 2 3 4 5 6 7; do
  CREDS=$(docker exec supabase-db psql -U supabase_admin -d postgres -t -A -F'|' \
    -c "select omie_app_key, omie_app_secret from lojas where id=$LOJA_ID")
  KEY=$(echo "$CREDS" | cut -d'|' -f1)
  SECRET=$(echo "$CREDS" | cut -d'|' -f2)

  IDS_CANCELADOS=""
  pagina=1
  while true; do
    resp=$(curl -s -X POST 'https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/' \
      -H 'Content-Type: application/json' \
      -d "{\"app_key\":\"$KEY\",\"app_secret\":\"$SECRET\",\"call\":\"CuponsFiscais\",\"param\":[{\"dDtEmissaoDe\":\"18/07/2026\",\"dDtEmissaoAte\":\"10/08/2026\",\"nPagina\":$pagina,\"nRegPorPagina\":50}]}")
    ids=$(echo "$resp" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for c in d.get('cupons', []):
  if c.get('cabecalhoCupom',{}).get('info',{}).get('cCupomCancelado') == 'S':
    print(c['cabecalhoCupom']['nIdCupom'])
print('TOTPAG', d.get('nTotPaginas', 1), file=sys.stderr)
" 2>/tmp/totpag_$LOJA_ID)
    IDS_CANCELADOS="$IDS_CANCELADOS $ids"
    totpag=$(grep TOTPAG /tmp/totpag_$LOJA_ID | awk '{print $2}')
    if [ -z "$totpag" ] || [ "$pagina" -ge "$totpag" ]; then break; fi
    pagina=$((pagina + 1))
    sleep 0.4
  done
  unset KEY SECRET CREDS

  echo "=== Loja $LOJA_ID: $(echo $IDS_CANCELADOS | wc -w) cupons cancelados na Omie ==="
  for ID in $IDS_CANCELADOS; do
    psql "$FRIO_DB" -c "update fat_cupons set cancelado=true where loja_id=$LOJA_ID and n_id_cupom=$ID and cancelado=false" -c "\echo linha afetada: loja $LOJA_ID cupom $ID"
  done
done
REMOTE_SCRIPT
```

Ajuste o script conforme necessário durante a implementação (é um
esqueleto, não código final testado) — mas mantenha a estrutura: 1 loop
de lojas, credencial buscada e usada só dentro do mesmo comando remoto,
paginação da Omie, e UPDATE condicional (`and cancelado=false`, garante
idempotência — rodar de novo não faz nada se já estiver correto).

**Antes de rodar em lote pras 6 lojas**: teste primeiro só com a loja 3
(já sabemos que tem 6 cupons cancelados reais nesse período, confirmado
nesta sessão) — rode o script restrito a `LOJA_ID=3`, confirme que o
número de `UPDATE`s bate com 6 (ou o número atual, já que a Task 1 pode
ter corrigido 1 ou 2 deles automaticamente via sync), antes de rodar as
outras 5 lojas.

**Validação obrigatória**: depois de rodar em todas as 6 lojas, `select
loja_id, count(*) from fat_cupons where cancelado=true and data >=
'2026-07-18' group by loja_id` deve mostrar números > 0 pra pelo menos
algumas lojas (o exato depende de quantos cancelamentos reais existiram
em cada uma nesse período — não presumir um número específico por loja
além do que já foi confirmado pra loja 3).

**Registro versionado**: salve o script final (já testado, com os
resultados reais) em algum lugar versionado (ex:
`docs/incidente-cupons-cancelados-fato-faturamento-2026-08-10.md`),
mesmo padrão de documentação de incidente já usado nesta sessão — não
precisa virar código de produção reusável, só precisa ficar rastreável.

Commit direto na main (`git add`/`git commit` como comandos SEPARADOS).

---

## Task 3: Atualizar AGENTS.md

**Files:**
- Modify: `AGENTS.md`

Adicione uma seção nova, mesmo estilo/formato das já existentes nesta
sessão (causa raiz, achado real, correção, volume do reprocessamento),
documentando este bug e sua correção — inclua o número final de cupons
corrigidos por loja (resultado da Task 2).

Commit direto na main.

---

## Execução

Oferecida via `superpowers:subagent-driven-development` nesta mesma
sessão. Grava em produção real (campo `cancelado` em `fat_cupons`) —
revisão de task padrão (spec + qualidade) é suficiente, mas a Task 2
(reprocessamento retroativo) precisa do cuidado normal de escrita em
produção já estabelecido nesta sessão: testar pequeno (1 loja) antes de
lote (6 lojas), nunca pular a validação antes/depois.
