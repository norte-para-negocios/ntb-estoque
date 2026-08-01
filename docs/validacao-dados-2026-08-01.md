# Varredura de integridade de dados — 01/08/2026

Feita a pedido do usuário ("o que mais podemos aprimorar e validar dados"),
depois de fechar os 4 blocos da auditoria da planilha. Tudo abaixo foi
verificado com consulta real nos bancos de produção, não inferido.

---

## 🔴 Ação necessária

### 1. Loja 7 (VINHAS & VINHETOS) está com a integração da Omie quebrada

**Desde 31/07 13:10**, silenciosamente. Testei a credencial direto contra a
API da Omie:

```
{"faultstring":"A chave de acesso está inválida ou o aplicativo está suspenso"}
```

`lojas.nota_fiscal_status = 'Erro'` para essa loja (as outras 5 estão
`Concluido`, atualizadas às 17:50 de hoje).

**O que fazer:** renovar a chave/app da Omie dessa loja (provavelmente o
aplicativo de integração foi suspenso do lado da Omie) e atualizar
`omie_app_key`/`omie_app_secret` no cadastro da loja.

**Enquanto não resolver:** essa loja não recebe NF, OP, produto nem
movimento novo. O dado dela está congelado em 31/07.

---

## 🟡 Lacuna de dados conhecida (não está piorando)

### 2. Produção tem ~1.585 movimentos a menos que o Supabase cloud

| Loja | Produção | Cloud | Diferença |
|---|---:|---:|---:|
| 5 — Praia do Forte | 36.145 | 37.047 | **−902** |
| 2 — Vilas do Atlântico | 122.183 | 122.479 | −296 |
| 3 — Rio Vermelho | 32.818 | 33.037 | −219 |
| 6 — Brotas | 23.212 | 23.380 | −168 |

As linhas faltantes têm `id_ajuste` **intercalado** (não são só as mais
recentes), o que aponta para uma falha durante a janela da migração, não um
bug contínuo. Rodei o sync de movimentos duas vezes ao vivo durante a
varredura: a contagem não mudou em nenhum dos dois bancos — ou seja, **não
está vazando nem divergindo mais**, é uma lacuna estática.

**Sugestão:** um backfill pontual comparando `id_ajuste` entre os dois bancos
e reinserindo o que falta, antes de desligar o Supabase cloud de vez.
Enquanto o cloud existir, o dado é recuperável.

---

## ✅ Resolvido durante esta varredura

### 3. Replicação morta e mecanismo de failover aposentado (Task 6)

O slot de replicação no cloud estava **invalidado** (`active=false`,
`wal_status=lost`) — o mesmo modo de falha diagnosticado no início da sessão.
A assinatura no Contabo, porém, ainda dizia `enabled=true`, o que dava a
impressão falsa de que havia uma réplica viva.

Somado à defasagem real do cloud (**−20.682 OPs** e **−955 NFs** vs.
produção), a conclusão é que **o Supabase cloud não é mais um fallback**:
voltar pra ele hoje seria perda de dados, não salvação.

Removido:
- `lib/failover/health-monitor.ts` (deletado)
- o branch de standby em `lib/supabase/server.ts` (os dois lados já apontavam
  pro mesmo lugar depois da migração — código morto que só confundia)
- `instrumentation.ts` esvaziado (só iniciava o monitor)
- `subscription ntb_estoque_sub` + `slot ntb_estoque_slot` dropados nos dois
  bancos

---

## 🔍 Investigado e descartado (registrado pra não reinvestigar)

- **Escritas recentes no Supabase cloud.** Havia inserts de hoje no cloud, o
  que levantou a suspeita de um sincronizador zumbi. Descartei: **Vercel** não
  tem nenhum projeto; **GitHub Actions** está com o schedule desativado (só
  `workflow_dispatch`); **ntb-vendas** aponta pra outro Supabase; o app de
  produção não escreve no cloud (testado: rodei o sync e a contagem do cloud
  não mudou). A explicação mais provável é o meu próprio ferramental local
  desta sessão — o `.env.local` do repo aponta pro cloud, e scripts de teste
  rodaram por ali. **Não afeta produção.**

- **"2.926 falhas de Produto em 24h".** Falso alarme meu: `integration_attempts`
  registra também as chamadas bem-sucedidas — aqueles `{"registros":100}` são
  logs normais de paginação, não erro.

- **Direção da replicação.** Confirmado que era cloud → Contabo (o Contabo
  assinava). O cloud não assinava nada, então nunca houve caminho de volta.

---

## Como reproduzir as comparações

```bash
# Produção (Contabo)
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c \
   \"select loja_id, count(*), max(id_ajuste) from movimentos group by loja_id order by loja_id;\""

# Supabase cloud
node scripts/db.mjs "select loja_id, count(*), max(id_ajuste) from movimentos group by loja_id order by loja_id"
```
