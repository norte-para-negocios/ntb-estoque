# RLS de linha (Fase 2a) — Design

**Data:** 2026-08-12

**Gatilho:** continuação da Contenção de RLS (Fase 0, concluída — commits
`f921f66..53aad67`). A Fase 0 revogou escrita e fechou colunas sensíveis,
mas `SELECT` continua liberado por completo (todas as linhas, sem filtro)
em 34 tabelas pra `authenticated` — qualquer operador logado de qualquer
loja consegue ler dado de negócio (`contas_pagar`, `clientes`,
`movimentos`, `notas_fiscais`, `produtos` etc.) de TODAS as lojas, não só
a própria.

## Auditoria (não re-investigar)

Rodada hoje em produção. Das 34 tabelas sem RLS restantes após a Fase 0:

- **29 têm coluna `loja_id` direta**: `audit_log`, `categorias_contabeis`,
  `clientes`, `contas_correntes`, `contas_pagar`, `contas_receber`,
  `convites`, `familias`, `fornecedores`, `integration_attempts`,
  `inventario_items`, `inventarios`, `local_estoque_user`,
  `local_estoques`, `loja_user`, `movimentos`, `movimentos_historico`,
  `nota_fiscal_items`, `notas_fiscais`, `ordens_producao`,
  `ordens_producao_teste`, `permissao_user`, `posicao_estoques`,
  `previsao_venda`, `produto_preco_recente`, `produto_substituicoes`,
  `produtos`, `transferencias`, `webhooks`.
- **5 não têm `loja_id`** (fora de escopo, ver abaixo): `lojas`,
  `profiles`, `permissoes`, `outbox`, `arquivos_mortos`.

**Achado real — bug pré-existente no padrão já usado nas 14 tabelas que
JÁ têm RLS** (`etiqueta_config`, `faturamento_import_meta`,
`faturamento_importado`, `impressao_etiquetas`, `margem_import_meta`,
`margem_importada`, `margem_snapshot_diario`, `movimentacao_import_meta`,
`movimentacao_importada`, `movimentacao_operacao`,
`movimentacao_operacao_meta`, `op_qtde_planejada`, mais 2 tabelas
cadastrais só de leitura): a policy hoje é só `EXISTS (select 1 from
loja_user lu where lu.loja_id = <tabela>.loja_id and lu.user_id =
uid())`, sem considerar Admin global/super_admin. Confirmado ao vivo:
5 contas com perfil `Admin`/`is_super_admin=true`, das quais **1 (Claude
QA, super_admin) tem ZERO vínculos em `loja_user`** — já fica sem acesso
a essas 14 tabelas hoje, silenciosamente (RLS nega sem erro, a tela só
mostra "sem dados").

**Confirmado (exploração de código, hoje)**: nenhuma leitura via client
de sessão (`createClient()`) nas 29 tabelas depende de ver linhas
cross-loja fora do padrão já coberto por `loja_user`/Admin — as duas
únicas queries com `.in('loja_id', [...])` multi-loja
(`app/(app)/usuario/page.tsx`, `app/(app)/sync-status/page.tsx`) já são
gated por `ator.podeGerir`/`isAdmin()` e usam exatamente o escopo de
lojas que `getAtorGestao()` (`lib/auth.ts:192-229`) já calcula — Admin
global vê todas as lojas ativas, AdminLoja vê só as vinculadas via
`loja_user`. É a mesma lógica que a policy abaixo replica em SQL.

## Escopo desta Fase (2a)

Uma migration única, duas partes:

1. **Corrige as 14 tabelas já com RLS**: `DROP POLICY` + `CREATE POLICY`
   com a cláusula de Admin acrescentada (fecha o bug do Claude QA e de
   qualquer Admin/super_admin sem vínculo em `loja_user`).
2. **Liga RLS + cria a mesma policy corrigida nas 29 tabelas restantes**
   com `loja_id` direto.

**Policy padrão** (idêntica nas 43 tabelas ao final, pra manter
consistência e facilitar auditoria futura):

```sql
create policy <tabela>_select_por_loja on <tabela> for select using (
  exists (
    select 1 from loja_user lu
    where lu.loja_id = <tabela>.loja_id and lu.user_id = auth.uid()
  )
  or exists (
    select 1 from profiles pr
    where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true)
  )
);
```

Sem policy de escrita nova — `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` já
foram revogados de `anon`/`authenticated` na Fase 0 (default-deny do RLS
cobre o resto: sem policy de escrita, nenhuma escrita passa, mesmo que
algum grant residual existisse).

## Fora de escopo (explícito, fica pra Fase 2b, plano separado)

As 5 tabelas sem `loja_id`, cada uma precisa de política própria:

- `lojas` — decisão de produto pendente: `SELECT` de linha continua
  liberado pra todas as lojas (comportamento atual, usado pelo seletor de
  loja) ou passa a exigir vínculo? Não decidido nesta rodada.
- `profiles` — candidato natural: `id = auth.uid()` OU Admin vê todas
  (mesmo padrão de cláusula usado acima).
- `permissoes` — catálogo global sem dado de negócio, candidato ao mesmo
  padrão simples já usado em `cargos`/`cargo_permissao`
  (`role() = 'authenticated'`, sem filtro de linha).
- `outbox` — contém `row_data jsonb` com o snapshot completo de qualquer
  linha alterada em qualquer tabela do sistema (inclusive, antes da Fase
  0, `lojas` com as chaves em texto puro) — candidata a bloqueio TOTAL
  pra `anon`/`authenticated` (nenhuma policy = zero acesso), não RLS de
  linha.
- `arquivos_mortos` — metadado de arquivamento (nome de tabela, período,
  path, contagem — não é dado de negócio), sem uso confirmado via client
  de sessão em nenhuma tela — candidata a bloqueio total, a confirmar.

## Testes

RLS baseada em `auth.uid()` não pode ser simulada com `SET ROLE anon`
simples (usado na Fase 0 pra testar grants) — precisa simular o JWT real
de uma sessão, mesmo padrão dos testes oficiais do Supabase:

```sql
set role authenticated;
set request.jwt.claims = '{"sub": "<uuid-do-usuario>"}';
select * from <tabela>;
reset role;
```

Casos a validar, direto em produção, depois de aplicar:

- Um usuário comum (perfil não-Admin, com 1 vínculo em `loja_user`) → só
  vê linhas da própria loja em cada uma das 43 tabelas.
- Um AdminLoja com vínculo em 2 lojas → vê só as 2.
- O Claude QA (super_admin, zero vínculos em `loja_user`) → vê TODAS as
  linhas em todas as 43 tabelas (valida a correção do bug).
- Um Admin global comum (`perfil='Admin'`, com vínculo em todas as 6
  lojas ativas) → continua vendo tudo (sem regressão).
- Fluxos reais via navegador (mesma ressalva da Fase 0: sem acesso a
  navegador nesta sessão, documentar e pedir confirmação manual): login
  como operador de uma loja específica, conferir que relatórios/telas
  continuam mostrando só a própria loja sem erro nem tela vazia
  inesperada.
