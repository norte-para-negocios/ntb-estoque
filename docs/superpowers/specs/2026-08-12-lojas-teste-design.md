# Lojas de Teste (NTB Estoque) — Design

**Data:** 2026-08-12

**Gatilho:** o usuário quer, pra CADA loja real do sistema, uma "loja
teste" gêmea que faz tudo que a loja real faz (produtos, movimentos,
notas fiscais, ordens de produção, inventário, transferências — o app
inteiro), pode LER dado real da Omie (catálogo, preços, notas de
homologação), mas NUNCA pode enviar/escrever nada de volta pra Omie —
sandbox completo por loja, sem risco de afetar a Omie real. Escopo desta
rodada: só NTB Estoque. NTB Vendas fica pra uma rodada futura, fora de
escopo aqui.

**Relação com o "Sertão Teste" já existente**: mais cedo nesta mesma
sessão foi implementado um mecanismo muito mais estreito (migration 108,
`ordens_producao_teste`, rota isolada, zero contato com Omie mesmo de
leitura) — específico pra viabilizar o teste de integração NTB Vendas↔NTB
Estoque sem nenhum contato com a Omie. Este projeto novo é maior e mais
geral (toda a superfície do app, todas as lojas, leitura permitida) e não
substitui nem depende do mecanismo estreito — os dois coexistem, com
propósitos diferentes.

## Auditoria (não re-investigar)

Confirmado hoje via exploração de código:

- **Client central único**: `omieRequest<T>({ omie_app_key,
  omie_app_secret, loja_id, endpoint, call, data })` (`lib/omie/
  client.ts:35`) — todas as ~40 chamadas do sistema passam por aqui,
  inclusive 3 pontos fora de `lib/omie/*` que chamam direto
  (`lib/actions/inventario.ts:351`, `movimentacoes.ts:86`,
  `transferencia.ts:361`, todos `call: 'IncluirAjusteEstoque'`).
- **Convenção de nomes 100% consistente, sem caso ambíguo**: leitura =
  `Listar*`/`Consultar*`/`Obter*`/`Pesquisar*`; escrita = `Incluir*`/
  `Alterar*`/`Excluir*`/`Concluir*`/`Reverter*`.
- **22 funções de escrita em 11 arquivos** de `lib/omie/*.ts`:
  `ajuste.ts` (1), `cliente-fornecedor.ts` (3), `familia.ts` (3),
  `local-estoque.ts` (2), `malha.ts` (3), `nota-fiscal.ts` (3),
  `produto.ts` (3), `ordem-producao.ts` (5), mais os 3 pontos diretos
  citados acima.
- **`lojas.omie_app_key`/`omie_app_secret`**: mesma tabela, sem
  separação test/prod hoje. `omieRequest` recebe só as credenciais
  soltas (não a linha inteira de `lojas`) — uma loja teste reusando as
  MESMAS credenciais da loja real é tecnicamente viável sem mudança
  nenhuma nesse ponto.
- **`getLojasAtivas()`** (`lib/omie/sync-all.ts:4-12`): `select('id,
  omie_app_key, omie_app_secret').eq('ativo', true).not('omie_app_key',
  'is', null)`. **20 dos 24 crons** em `app/api/cron/*` usam essa mesma
  função — um único filtro ali cobre a esmagadora maioria da automação.
  4 crons não usam (`arquivar`, `backfill`, `prune`, `restaurar` —
  manutenção genérica de retenção/backup, não sync por loja/Omie).
  `app/api/sync/*` (8 rotas) são manuais, disparadas pela UI pra UMA
  loja de cada vez (`getCurrentLojaId()`), não fazem parte deste
  universo.
- **Seletor de loja** (`app/(app)/layout.tsx:21-39`): `.eq('ativo',
  true).order('nome_fantasia')`, com filtro adicional por `loja_user`
  pra não-admin. Precisa do mesmo filtro de `is_test`.
- **`getAtorGestao()`** (`lib/auth.ts:210-212`): Admin global = `select
  ('id').eq('ativo', true)`, sem filtro de `loja_user` — mesmo padrão,
  precisa do mesmo ajuste.
- **RLS de `lojas`** (já em produção desde a Fase 2b de hoje):
  `usuario_tem_acesso_loja(id) or usuario_e_admin()`. Uma loja teste sem
  NENHUMA linha em `loja_user` já fica automaticamente invisível pra
  qualquer usuário não-admin, sem precisar de código novo pra isso.

## Escopo desta rodada

### 1. Schema

```sql
alter table lojas add column if not exists is_test boolean not null default false;
alter table lojas add column if not exists loja_origem_id bigint references lojas(id);
```

Migration cria uma loja teste pra cada uma das 6 lojas ativas hoje:
`nome_fantasia` prefixado `[TESTE] `, mesma `omie_app_key`/
`omie_app_secret` da origem (pra leitura trazer catálogo/preços reais),
`ativo=true`, `is_test=true`, `loja_origem_id` apontando pra loja real
correspondente. Sem nenhuma linha em `loja_user` — decisão explícita do
usuário: só Admin global vê/acessa lojas teste nesta rodada (não os
operadores normais da loja real).

Lojas cadastradas no futuro NÃO ganham loja teste automaticamente — fica
fora de escopo (candidato a botão/ação manual futura).

### 2. Exclusão da automação e do seletor comum

- `getLojasAtivas()` ganha `.eq('is_test', false)` — cobre 20 dos 24
  crons de uma vez.
- `app/(app)/layout.tsx` (seletor de loja) ganha `.eq('is_test', false)`
  pro ramo de usuário comum/AdminLoja; Admin global continua vendo TODAS
  as lojas (reais + teste), com o prefixo `[TESTE] ` já no nome
  bastando como marcador visual (sem componente novo).
- `getAtorGestao()` (`lib/auth.ts`) ganha o mesmo filtro na branch de
  Admin global, pra manter `ator.lojaIds` consistente com o resto do
  app (telas de gestão de usuário não devem contar lojas teste como
  lojas "reais" a gerir).
- Os 4 crons de manutenção (`arquivar`/`backfill`/`prune`/`restaurar`)
  não precisam de mudança — não são sync por loja/Omie.

### 3. Gate central de escrita

`omieRequest` (`lib/omie/client.ts`) recebe um parâmetro novo
`is_test?: boolean` (resolvido a partir de `LojaOmie.is_test` —
o tipo `LojaOmie`, hoje usado em praticamente toda função de escrita
como parâmetro, ganha esse campo). Quando `is_test===true` E o `call`
bate no padrão de escrita (`Incluir`/`Alterar`/`Excluir`/`Concluir`/
`Reverter` no início do nome), a função:
- NÃO faz a chamada HTTP real.
- Devolve uma resposta sintética plausível — mínimo necessário: código
  de sucesso (`{ faultstring: undefined }` ou equivalente ao formato
  real da Omie em caso de sucesso) + um ID fictício no campo que a
  chamada normalmente devolveria (ex: `nCodOP` pra ordem de produção,
  `nCodProduto` pra produto) — gerado de forma simples e
  auto-consistente (ex: negativo, baseado em sequência local ou
  timestamp), só precisa ser plausível o suficiente pra código
  downstream (que espera um ID) não quebrar.
- Loga a simulação de alguma forma visível (nem que seja um
  `console.log`/campo extra na tabela local relevante) — não precisa de
  tabela de auditoria nova nesta rodada, mas o dev/QA rodando o teste
  precisa conseguir confirmar "isso foi simulado, não uma chamada real".

Leituras (`call` fora do padrão de escrita) sempre passam de verdade,
usando a credencial real (idêntica à loja de origem).

### 4. Verificação dos call sites

Cada uma das 22 funções de escrita + os 3 pontos diretos precisa ser
conferida: ela recebe o objeto `LojaOmie` (que carrega `is_test`) e
repassa pra `omieRequest`, ou desestrutura só `omie_app_key`/
`omie_app_secret` soltos em algum ponto (o que quebraria a propagação)?
Corrigir os que quebrarem antes de considerar o gate completo.

## Fora de escopo (explícito)

- NTB Vendas — fica pra rodada futura, sem relação com este projeto.
- Lojas cadastradas no futuro ganharem loja teste automaticamente — só
  as 6 ativas hoje.
- Operadores normais/AdminLoja acessarem lojas teste — só Admin global
  nesta rodada.
- Tabela de auditoria dedicada pra chamadas simuladas — um log simples
  já basta por enquanto.
- Qualquer mudança no "Sertão Teste" estreito já existente
  (`ordens_producao_teste`) — continua existindo em paralelo, sem
  relação com este projeto.

## Sequenciamento (risco a evitar)

O schema (Item 1) e o gate central (Item 3) precisam entrar JUNTOS, no
mesmo plano/execução — nunca a loja teste existindo e sendo
selecionável ANTES do gate estar pronto e verificado. Se isso
acontecer, uma ação manual de um Admin dentro da loja teste chamaria a
Omie de verdade, com credenciais reais, exatamente o cenário que este
projeto existe pra evitar.

## Testes

- QA real: como Admin, entrar na loja teste de "Vinhas & Vinhetos",
  criar uma Ordem de Produção — confirmar que a tela mostra sucesso
  normal, e que NENHUMA chamada real saiu pra Omie (checar
  `integration_attempts`/logs — nenhuma linha nova pra essa loja teste
  no período do teste, ou confirmar direto no painel da Omie que nada
  novo apareceu).
- Confirmar que os crons não tocam a loja teste (rodar um cron
  manualmente, ex: `sync-produtos`, e confirmar via log que a loja
  teste não aparece na lista processada).
- Confirmar que um usuário comum (não-Admin) logado não vê a loja teste
  no seletor, mesmo se soubesse o ID e tentasse acessar direto (RLS já
  bloqueia isso, mas vale confirmar).
- Confirmar que uma LEITURA (ex: sincronizar produtos manualmente
  dentro da loja teste, se essa ação existir na UI) traz dado real da
  Omie normalmente.
