# RLS — Fase 2b (5 tabelas restantes) — Design

**Data:** 2026-08-12

**Gatilho:** continuação direta da Fase 2a (concluída, migrations 111 +
112 — ver `AGENTS.md`, seção "Contenção de RLS (Fase 0 + Fase 2a) e
incidente de recursão infinita"). Restam 5 tabelas sem `loja_id` direto,
cada uma precisando de política própria: `lojas`, `profiles`,
`permissoes`, `outbox`, `arquivos_mortos`.

**Lição do incidente da Fase 2a (não repetir)**: uma policy de RLS nunca
deve fazer `EXISTS (select ... from X ...)` referenciando a própria
tabela `X` dentro da condição `USING` — causa recursão infinita, e
qualquer OUTRA tabela cuja policy também consulte `X` herda o mesmo
travamento. Qualquer policy nova que precise consultar `loja_user`/
`profiles` usa as functions `security definer` já existentes
(`usuario_tem_acesso_loja(p_loja_id)`, `usuario_e_admin()`), nunca
subquery direta.

## Auditoria (não re-investigar)

Confirmado hoje via exploração de código (todo `.from(<tabela>)` via
`createClient()`, não `createServiceClient()`):

- **`lojas`**: todo caso de leitura sem filtro de vínculo já é gated por
  `isAdmin`/`isAdminGlobal` na aplicação antes da query (`app/(app)/
  layout.tsx`, `usuario/page.tsx`, `log/page.tsx`, `lib/auth.ts:211`,
  `lib/actions/loja-selector.ts`). Nenhuma tela de onboarding/pré-vínculo
  lê `lojas` via client de sessão (usam `createServiceClient()`). Seguro
  aplicar `usuario_tem_acesso_loja(id) or usuario_e_admin()`.
- **`profiles`, achado crítico**: dois padrões de leitura via sessão —
  (a) própria linha (`.eq('id', user.id)`, `lib/auth.ts` várias linhas),
  segura com `id = auth.uid()`; (b) **múltiplas linhas de OUTROS
  usuários, sem exigir Admin global**: `usuario/page.tsx` (gestão de
  equipe, gated só por `ator.podeGerir` — cobre Admin global E AdminLoja),
  `impressoes/page.tsx`, `transferencia/page.tsx`,
  `transferencia/export/route.ts`, `inventario/page.tsx`,
  `inventario/relatorio/route.ts`, `inventario/export/route.ts` (mostram
  "quem fez" a operação, gated só por `requirePermissao` de módulo, sem
  checar Admin), `transferencia/[id]/contagem/page.tsx`,
  `inventario/[id]/contagem/page.tsx` (`.eq('id', <id de outro
  usuário>)`). **Uma policy "própria linha OU `usuario_e_admin()`"
  quebraria todos esses casos** — `usuario_e_admin()` não cobre
  `AdminLoja`, e nenhum desses fluxos é exclusivo de Admin.
- **`permissoes`**: catálogo puro, sem filtro de linha em nenhum call
  site (`cargo/page.tsx`, `usuario/page.tsx`, `loja/page.tsx`,
  `lib/auth.ts`). Mesmo nível de `cargos`/`cargo_permissao`.
- **`outbox`**: zero `.from('outbox')` em código de app (nem sessão nem
  service role) — só o trigger interno do Postgres
  (`outbox_trigger`/`outbox_capture()`, infra fora do repo) escreve nela.
- **`arquivos_mortos`**: os 4 call sites (`app/api/cron/arquivar/
  route.ts`, `app/api/cron/restaurar/route.ts`, via `lib/arquivo-
  morto.ts`) já usam `createServiceClient()` — sem exceção.

## Escopo desta Fase (2b)

Uma migration única, aplicando 5 policies diferentes:

1. **`lojas`**:
```sql
alter table lojas enable row level security;
create policy lojas_select_por_loja on lojas for select using (
  usuario_tem_acesso_loja(id) or usuario_e_admin()
);
```

2. **`profiles`** — nova function `security definer`
`usuario_compartilha_loja(p_outro_user_id)`: verifica se o usuário
logado e o usuário-alvo têm pelo menos uma loja em comum via
`loja_user` (join simples, sem recursão — consulta `loja_user`, não
`profiles`, então não há self-reference).
```sql
create or replace function usuario_compartilha_loja(p_outro_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from loja_user lu1
    join loja_user lu2 on lu1.loja_id = lu2.loja_id
    where lu1.user_id = auth.uid() and lu2.user_id = p_outro_user_id
  );
$$;

alter table profiles enable row level security;
create policy profiles_select_por_acesso on profiles for select using (
  id = auth.uid()
  or usuario_e_admin()
  or usuario_compartilha_loja(id)
);
```

3. **`permissoes`** — mesmo padrão de `cargos`/`cargo_permissao`:
```sql
alter table permissoes enable row level security;
create policy permissoes_select_auth on permissoes for select using (
  role() = 'authenticated'
);
```

4. **`outbox`** — bloqueio total (RLS ligada, zero policy):
```sql
alter table outbox enable row level security;
```

5. **`arquivos_mortos`** — bloqueio total (RLS ligada, zero policy):
```sql
alter table arquivos_mortos enable row level security;
```

## Fora de escopo

- Qualquer mudança de código TypeScript — é só SQL (RLS/policy/function),
  mesmo princípio das Fases 0/2a.
- Auditoria de escrita (`INSERT`/`UPDATE`/`DELETE`) nessas 5 tabelas —
  já coberta pela Fase 0 (grants de escrita já revogados nas 4 delas que
  estavam na lista de 34; `lojas` também já teve escrita revogada na
  Fase 0).

## Testes

Dado o incidente da Fase 2a, ordem de teste é: **`profiles` isolada
primeiro** (é a única policy nova/complexa), só then as outras 4.

- `profiles`: simular JWT de 3 papéis reais — (a) usuário comum com 1
  vínculo, consultando o profile de um colega da MESMA loja → deve ver;
  (b) o mesmo usuário consultando o profile de alguém de OUTRA loja sem
  vínculo comum → não deve ver; (c) AdminLoja consultando a lista de
  usuários da própria loja (mesma query que `usuario/page.tsx` faz) →
  deve ver todos os vinculados àquela loja; (d) Claude QA (super_admin
  sem vínculo) → deve ver todos os profiles.
- `lojas`: usuário com 1 vínculo vê só a própria loja; Admin vê todas
  (mesmo padrão já validado na Fase 2a).
- `permissoes`: qualquer `authenticated` continua vendo o catálogo
  inteiro.
- `outbox`/`arquivos_mortos`: `SELECT` via `authenticated`/`anon` deve
  falhar (`permission denied`); via `service_role` continua funcionando.
- Fluxos reais via navegador (mesma ressalva das fases anteriores: sem
  acesso a navegador nesta sessão) — pelo menos a tela `/usuario` (gestão
  de equipe) e uma tela de transferência/inventário merecem confirmação
  manual depois, por serem os casos que motivaram a cláusula extra de
  `profiles`.
