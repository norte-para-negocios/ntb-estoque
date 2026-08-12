# Sertão Teste (NTB Estoque) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar um caminho de Ordem de Produção 100% isolado (tabela,
rota, chave de autenticação e tela próprias) pro NTB Vendas disparar
testes contra a loja Sertão, sem NUNCA chamar a Omie e sem tocar em
nenhuma tabela/relatório usado pelo sistema real.

**Architecture:** Tabela nova `ordens_producao_teste`, sem relação com
`ordens_producao`. Rota nova `/api/integracao/ordem-producao-teste`,
autenticada por uma coluna nova e separada
(`lojas.integracao_teste_api_key`), que nunca importa o módulo de
integração Omie. Tela nova, admin-only, sem link na navegação
principal. Ver a spec completa (cobre as duas pontas, NTB Estoque +
NTB Vendas):
`/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/docs/superpowers/specs/2026-08-12-sertao-teste-integracao-isolada-design.md`

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase
(Postgres self-hosted no Contabo, mesmo banco de sempre deste repo).

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging.**
- **`npx tsc --noEmit`** limpo antes de qualquer commit de código.
- **Migrations aplicadas manualmente**: `docker exec -i supabase-db
  psql -U supabase_admin -d postgres < supabase/migrations/NNN_arquivo.sql`
  (via SSH: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`,
  mesmo padrão de sempre deste repo).
- **Regra de ouro do isolamento**: a rota de teste NUNCA pode importar
  `lib/omie/ordem-producao.ts` nem `lib/omie/client.ts`. O reviewer de
  cada task que tocar a rota nova PRECISA confirmar isso explicitamente
  (`grep -n "from '@/lib/omie" app/api/integracao/ordem-producao-teste/route.ts`
  deve retornar VAZIO) antes de aprovar.
- **`ordens_producao_teste` nunca é lida por nenhum relatório/tela
  existente** — nenhuma task deste plano deve tocar
  `app/(app)/ordem-producao/*`, `lib/movimentacao-*`,
  `lib/omie/ordem-producao.ts` ou qualquer RPC/relatório que já lê
  `ordens_producao`.
- Deploy: `git push origin main` SEMPRE antes do deploy, deploy sempre
  síncrono via SSH (`ssh -i ~/.ssh/notebook_contabo_key
  root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`),
  aguardando terminar por completo. Confirmar depois:
  `curl -s -o /dev/null -w "HTTP %{http_code}\n"
  https://app-estoque.norteparanegocios.com.br/login` (esperar 200) e
  `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd
  /opt/ntb-estoque && git log --oneline -1"` (commit certo).
- Nenhuma automação/cron deve escrever em `ordens_producao_teste` —
  só a rota nova, disparada manualmente pelo teste no NTB Vendas.

---

## Task 1: Migration — tabela `ordens_producao_teste` + chave de integração de teste

**Files:**
- Create: `supabase/migrations/108_ordens_producao_teste.sql`

**Step 1: Escrever a migration**

```sql
-- Sertão Teste (2026-08-12) — ver docs/superpowers/specs/
-- 2026-08-12-sertao-teste-integracao-isolada-design.md (repo NTB
-- Vendas). Ordem de Produção de teste, totalmente isolada da tabela
-- real (ordens_producao) e da Omie -- nenhum relatório/tela existente
-- deve ler esta tabela.

create table if not exists ordens_producao_teste (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id),
  codigo_produto bigint,
  codigo_produto_texto text not null,
  quantidade numeric not null,
  pedido_ref text,
  criado_em timestamptz not null default now()
);

-- Chave de API SEPARADA de lojas.integracao_api_key (migration 061) --
-- nunca deve ser confundida/reusada com a chave real de nenhuma loja.
-- Nullable: só a loja Sertão terá valor.
alter table lojas add column if not exists integracao_teste_api_key text unique;
```

**Step 2: Aplicar via SSH**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres" < supabase/migrations/108_ordens_producao_teste.sql
```

**Step 3: Gerar a chave pra loja Sertão**

Primeiro confirme o `id`/nome real da loja (já sabido de hoje: nome
fantasia "O SERTAO VAI VIRAR MAR", mas confirme de novo, pode ter
mudado):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select id, nome, nome_fantasia from lojas where nome_fantasia ilike '%sertao%' or nome_fantasia ilike '%sertão%'\""
```

Depois gere e grave a chave (mesmo padrão de `encode(gen_random_bytes(32),
'hex')` já usado na migration 061):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"update lojas set integracao_teste_api_key = encode(gen_random_bytes(32), 'hex') where id = <ID_REAL_DO_SERTAO> and integracao_teste_api_key is null returning id, integracao_teste_api_key\""
```

**Guarde o valor retornado** — vai ser necessário pro Plano A (NTB
Vendas) configurar `store_ntb_estoque_secrets`. Escreva num relatório
de task, não em nenhum arquivo versionado do repo (não é segredo tão
sensível quanto credencial Omie, mas ainda é uma chave de API — trate
com o mesmo cuidado básico: não logar em lugar público).

**Step 4: Confirmar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"\\d ordens_producao_teste\""
```

**Step 5: Commit**

```bash
git add supabase/migrations/108_ordens_producao_teste.sql
git commit -m "feat: tabela ordens_producao_teste + chave de integração isolada"
```

(A migration em si não precisa de deploy — é aplicada direto no banco
via SSH, como sempre neste repo. O `git commit` é só pra manter o
arquivo versionado.)

---

## Task 2: Rota `/api/integracao/ordem-producao-teste`

**Depende da Task 1.**

**Files:**
- Create: `app/api/integracao/ordem-producao-teste/route.ts`

**Step 1: Ler a rota real completa antes de escrever a nova**

`app/api/integracao/ordem-producao/route.ts` — use como referência de
ESTRUTURA de entrada/autenticação/resposta, mas a versão de teste é
muito mais simples (sem Omie, sem loop de criar+concluir, sem log de
integration_attempts).

**Step 2: Escrever a rota nova**

```ts
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Sertão Teste (2026-08-12) -- ver docs/superpowers/specs/
// 2026-08-12-sertao-teste-integracao-isolada-design.md (repo NTB
// Vendas). Espelha a forma de entrada de app/api/integracao/
// ordem-producao/route.ts, mas NUNCA chama a Omie -- grava só na
// tabela isolada ordens_producao_teste. Regra de ouro: esta rota não
// pode importar lib/omie/ordem-producao.ts nem lib/omie/client.ts.

interface ItemPedido {
  codigo: string
  quantidade: number
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) {
    return NextResponse.json({ error: 'Authorization: Bearer <chave> ausente' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { itens?: ItemPedido[]; pedidoRef?: string } | null
  if (!body?.itens?.length) {
    return NextResponse.json({ error: 'Informe itens: [{ codigo, quantidade }]' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id')
    .eq('integracao_teste_api_key', apiKey)
    .eq('ativo', true)
    .maybeSingle<{ id: number }>()

  if (!loja) {
    return NextResponse.json({ error: 'Chave de integração de teste inválida' }, { status: 401 })
  }

  const resultados: { codigo: string; ok: boolean; erro?: string }[] = []

  for (const item of body.itens) {
    if (!item?.codigo || !item.quantidade || item.quantidade <= 0) {
      resultados.push({ codigo: item?.codigo ?? '?', ok: false, erro: 'Item inválido' })
      continue
    }

    const { data: produto } = await supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', loja.id)
      .eq('codigo', item.codigo)
      .maybeSingle<{ codigo_produto: number }>()

    const { error } = await supabase.from('ordens_producao_teste').insert({
      loja_id: loja.id,
      codigo_produto: produto?.codigo_produto ?? null,
      codigo_produto_texto: item.codigo,
      quantidade: item.quantidade,
      pedido_ref: body.pedidoRef ?? null,
    })

    if (error) {
      resultados.push({ codigo: item.codigo, ok: false, erro: error.message })
    } else {
      resultados.push({ codigo: item.codigo, ok: true })
    }
  }

  return NextResponse.json({ lojaId: loja.id, teste: true, resultados })
}
```

**Step 3: Confirmar o isolamento (obrigatório, não pule)**

```bash
grep -n "from '@/lib/omie" "app/api/integracao/ordem-producao-teste/route.ts"
```
Esperado: SEM saída nenhuma (vazio). Se aparecer qualquer import de
`lib/omie/*`, a task está errada — corrija antes de continuar.

**Step 4: `npx tsc --noEmit`**

**Step 5: Commit**

```bash
git add app/api/integracao/ordem-producao-teste/route.ts
git commit -m "feat: rota isolada de Ordem de Produção de teste (sem Omie)"
```

---

## Task 3: Tela admin-only pra ver as OPs de teste

**Depende da Task 2.**

**Files:**
- Create: `app/(app)/ordem-producao/teste/page.tsx`

**Step 1: Ler `app/(app)/sync-status/page.tsx` como referência** de
como usar `isAdmin()` (`lib/auth.ts:62`) pra proteger uma página
inteira (`notFound()` se não for admin).

**Step 2: Escrever a página**

Server Component simples: `isAdmin()` → `notFound()` se falso; senão,
`select * from ordens_producao_teste order by criado_em desc limit 200`
(sem paginação sofisticada, volume esperado é baixíssimo), renderizado
numa tabela simples (pode reusar `components/ui-kit/Lista.tsx` ou
`DataTable`, à escolha — não precisa de filtro/ordenação clicável,
é fora de escopo de qualquer plano anterior). Colunas sugeridas: Loja,
Código, Quantidade, Pedido Ref, Criado em.

Sem link nenhum a partir de `app/(app)/ordem-producao/page.tsx` nem da
navegação principal — só acessível digitando a URL
`/ordem-producao/teste` diretamente.

**Step 3: `npx tsc --noEmit`**

**Step 4: Commit**

```bash
git add "app/(app)/ordem-producao/teste/page.tsx"
git commit -m "feat: tela admin-only de Ordens de Produção de teste"
```

---

## Task 4: QA final + deploy

**Depende das Tasks 1-3.**

**Step 1: `npx tsc --noEmit`** no repo inteiro.

**Step 2: `git push origin main`**, deploy síncrono via SSH.

**Step 3: Confirmar HTTP 200 + commit certo no servidor** (Global
Constraints).

**Step 4: Testar a rota nova com dado real**, via SSH (curl local no
servidor, evita expor a chave de teste em trânsito público
desnecessariamente):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 'bash -s' <<'REMOTE_SCRIPT'
CHAVE=$(docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c "select integracao_teste_api_key from lojas where nome_fantasia ilike '%sertao%' or nome_fantasia ilike '%sertão%'")
curl -s -X POST http://127.0.0.1:3002/api/integracao/ordem-producao-teste \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"itens":[{"codigo":"90001","quantidade":1}],"pedidoRef":"teste-plano-2026-08-12"}'
unset CHAVE
REMOTE_SCRIPT
```

Confirme resposta `{"ok":true}` e que a linha aparece em
`ordens_producao_teste` (`select * from ordens_producao_teste order by
id desc limit 1`). **Confirme também que `ordens_producao` (a tabela
real) NÃO ganhou nenhuma linha nova** — prova direta do isolamento.

**Step 5: Relatório final**, com a chave de teste gerada (só no
relatório, não versionado) pro Plano A (NTB Vendas) usar na Task 5
dele.

---

## Execução

Oferecida via `superpowers:subagent-driven-development`, em uma sessão
própria neste repo (NTB Estoque) — independente da sessão que executar
o plano do NTB Vendas. **Execute este plano (B) ANTES do Plano A** (repo
NTB Vendas, `docs/superpowers/plans/2026-08-12-sertao-teste-vendas.md`) —
a Task 5 daquele plano precisa da chave gerada na Task 1 deste.
