# Finanças, etapa 1: contas correntes, categorias, contas a pagar e pagamento (21/10/2026)

Origem: `docs/propostas/central-e-financeiro.html` (Parte 2, etapas 1, 2 e 4 da ordem de construção, sem a nota de entrada e sem aprovação)
e `~/Projects/omie-rea/gaps/matriz-financeiro-vendas-config-relatorios.md` (FIN 1, 10, 13, 24, 28). **Nada aplicado em produção, nada deployado.**

## Regras que valem para tudo

- **Só desenvolvedores** (`profiles.is_super_admin`): rota-mãe `/financeiro` em `ROTAS_SO_DEV` (+ espelho em `lib/central/visibilidade.ts`),
  `exigirDev` no layout `app/(app)/financeiro/layout.tsx`, `exigirDevAcao` em toda action, itens de menu com `superAdmin`.
- **Só loja de estoque próprio** (`modo_estoque = 'proprio'`, hoje ODARA, loja 15): `acessoFinanceiro()` dá 404 nas outras; toda função SQL
  chama `fin_exigir_loja_propria`. Loja Omie nunca cria título. **Nenhuma escrita no Omie, nenhuma chamada externa.**
- **Pagamento é só registro**: anota baixa + saída no extrato. Não fala com banco.
- **Nada se apaga**: lançamentos e eventos são append-only (trigger); pagamento só muda uma vez, para "estornado" (trigger); título cancelado fica.
- Fora do modo offline do desktop (`lib/offline/politica.ts` comentado; ações sem entrada nas listas = "precisa de internet").

## Decisão: tabelas novas `fin_*`, não as antigas

`contas_pagar`/`contas_receber`/`contas_correntes` (052–054) são espelho de títulos ABERTOS do Omie, sem chave de pessoa/origem, sem histórico,
com `status_titulo` do Omie e alimentadas por `scripts/sync-financeiro.mjs`; loja Omie pode ter dados nelas. Reaproveitar misturaria dois donos
da verdade na mesma tabela. Elas ficam **intactas**. `categorias_contabeis` (069) também fica intacta (a classificação das notas, usada pelo
desktop offline): `fin_categorias` é tabela própria com ponte opcional `categoria_contabil_id`, mais a linha da DRE.

## Modelo (migrations 285 e 286)

| Tabela | Papel |
|---|---|
| `fin_contas_correntes` | caixa/bancos por loja, `saldo_inicial` + `data_saldo_inicial`, ativa/inativa |
| `fin_categorias` | despesa/receita, `grupo_dre` (11 linhas), ponte p/ `categorias_contabeis`; 17 categorias padrão semeadas p/ lojas próprias |
| `fin_lancamentos` | extrato; imutável; `estorno_de` (índice único: um estorno por lançamento); `origem_tipo/origem_id` |
| `fin_titulos_pagar` | título; `valor`, `valor_quitado`, `status` guardado, `origem_tipo/origem_id/parcela` **prontos para a nota de entrada** (etapa 2: índice único parcial impede dois títulos ativos da mesma parcela) |
| `fin_pagamentos` | baixa: `valor_principal`, `juros`, `desconto`, `valor_pago = principal + juros − desconto`, chave de idempotência, campos de estorno |
| `fin_eventos` | histórico append-only (quem fez o quê) |

Situação: `status` guardado (`aberto | parcial | pago | cancelado`, com CHECK que o amarra a `valor_quitado`) + derivada `atrasado`
(`vencimento < hoje` Bahia e ainda com saldo) em `fin_situacao_titulo()` (SQL) e `situacaoTitulo()` (`lib/financeiro/titulo-puro.ts`, testada).
Saldo da conta = `saldo_inicial + entradas − saídas`; o estorno é um lançamento de entrada.

Funções (todas `security definer`, `execute` só para `service_role`): `fin_conta_salvar`, `fin_contas_saldo`, `fin_extrato`, `fin_categoria_salvar`,
`fin_categorias_semear`, `fin_titulo_pagar_salvar` (incluir/editar), `fin_titulo_pagar_cancelar`, `fin_pagamento_registrar`, `fin_pagamento_estornar`,
`fin_titulos_pagar_listar` (filtros + totais do filtro inteiro), `fin_titulo_pagar_detalhe`.

Atomicidade e concorrência: cada função é uma transação. Baixa e estorno travam o **título com `FOR UPDATE` antes de tudo**; a chave é conferida
depois da trava (duas chamadas iguais = uma baixa; duas baixas diferentes do saldo inteiro = uma passa, a outra recusa "já pago").
Incluir título usa advisory lock por loja (numeração `numero` sequencial) + chave. Regras de baixa: principal ≤ saldo, desconto ≤ principal,
saída > 0, data não futura e ≥ `data_saldo_inicial`, conta ativa da mesma loja, título não cancelado/pago. Estorno devolve só o principal ao título.
Editar: valor ≥ já quitado; com pagamento não troca fornecedor; título pago só muda observação/documento/categoria/competência.
Cancelar: só sem pagamento ativo (estorne antes).

RLS: habilitada com a política por loja do padrão (`usuario_e_admin() or loja_id in usuario_lojas()`), porém **sem `grant select` para `authenticated`**
(dinheiro: só o servidor lê, depois de checar dev + loja + permissão). Abrir leitura direta no futuro = um `grant select`.

## Permissões novas (tabela `permissoes`, criadas na 285; catálogo + `MENU_PERMISSAO` atualizados)

`Financeiro - Contas a pagar` (ver/lançar/editar/cancelar), `Financeiro - Contas a pagar - Pagar` (registrar/estornar), `Financeiro - Contas correntes`
(contas e extrato), `Financeiro - Categorias`. Admin/AdminLoja seguem as regras atuais de `requirePermissao`.

## Endurecimentos da revisão independente (mesmas migrations 285/286, ainda não aplicadas em lugar nenhum)

- **Idempotência com assinatura**: título e pagamento guardam `assinatura` (md5 dos dados normalizados). Mesma chave + mesmos dados = `duplicado`;
  mesma chave + dados diferentes = erro 22023 "Essa chave já foi usada com outros dados". A UI gera chave nova a cada mudança nos campos.
- **Conta travada na baixa**: `fin_pagamento_registrar` faz `select … for share` na conta depois de travar o título (inativar a conta ou mexer no saldo
  inicial ao mesmo tempo não deixa passar pagamento com a regra antiga; `fin_conta_salvar` não trava título, sem deadlock). Coberto em `286_concorrencia.sh` (caso C).
- **NaN/lixo**: `fin_numero()` recusa texto não numérico, NaN e valores ≥ 1 trilhão em título, saldo inicial, principal, juros e desconto; CHECK `<> 'NaN'`
  em todas as colunas de dinheiro.
- **Conta**: data de saldo inicial não pode ser futura; com lançamentos, saldo inicial e data não mudam mais.
- **Categorias**: semente por chave estável `padrao` (renomear/inativar não recria); tipo despesa↔receita não muda se há título ou lançamento usando.
- **Listagem**: `%` e `_` da busca são literais; "Pagas em parte" inclui parciais atrasadas (que também aparecem em "Atrasadas").
- **Dinheiro digitado** (`paraCentavos`): vírgula = decimal; ponto só é decimal com 1–2 casas, senão é milhar ("1.500" = R$ 1.500); recusa "1e3", "1,500.00", letras.
  Os formulários mostram a prévia "= R$ 1.500,00".
- **Erros**: só PGRST202/PGRST205/42883/42P01 viram "financeiro ainda não ativado"; o resto vai ao log com a mensagem real. `listarCategorias`/`listarFornecedores` checam erro.
- **Navegador**: quem só tem "Pagar" não recebe saldos das contas; diálogos reabrem limpos (e o de pagamento com o saldo atual).
- **Reverter** (`285_286_reverter.sql`): recusa se houver qualquer dado/evento/categoria alterada à mão; funciona se só a 285 (ou nenhuma) foi aplicada.

## Telas (`app/(app)/financeiro/`)

`contas-pagar` (lista, filtros vencimento/fornecedor/categoria/situação/busca, 4 totais do filtro, novo, pagar), `contas-pagar/[id]` (ficha, pagamentos
com estorno, histórico, editar, cancelar), `contas-pagar/nova` (atalho "Incluir" da central), `contas-correntes`, `extrato` (saldo corrido), `categorias`.
Central: em Finanças, "Contas a pagar", "Incluir", "Contas correntes", "Categorias financeiras" e "Exibir extrato" viraram links (`soEstoqueProprio`);
Resumo, Importar planilha, Contas a receber, lançamento/transferência/OFX e relatórios seguem "em breve".

## Testes

- `node --test lib/financeiro/titulo-puro.test.ts` (situação, atrasado por data Bahia, arredondamento, parcial, estorno, juros/desconto).
- SQL (cópia local): `scripts/testes-sql/286_financeiro_contas_pagar.sql` (roda em transação e faz rollback) e `286_concorrencia.sh <banco>`.
  Banco usado: `fin1` = `create database fin1 template c1` no container `ntb-teste-sql` + 285 + 286 (recriar do zero para reaplicar). O teste cobre também loja Omie com objetos próprios, fornecedor de outra loja, NaN, extrato com dias anteriores e chave reutilizada.
- Reversão: `scripts/testes-sql/285_286_reverter.sql` (recusa se houver qualquer dado lançado).

## Runbook de aplicação (manual, com OK do dono; NADA disto foi feito)

1. **Backup**: `ssh … 'docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc' > backup-antes-fin.dump` (ou o backup noturno do Contabo + um extra).
2. Conferir que as 285/286 ainda são os próximos números livres e que `\d fin_titulos_pagar` não existe.
3. Aplicar **nesta ordem**, cada uma já numa transação (`begin … commit`), com `-v ON_ERROR_STOP=1`:
   `docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 285_financeiro_base.sql` e depois `286_financeiro_contas_pagar.sql`.
   Ambas são idempotentes (`if not exists`, `create or replace`, `on conflict do nothing`).
4. `NOTIFY pgrst, 'reload schema'` já está no fim de cada arquivo; se o PostgREST self-hosted ainda não enxergar as funções: `docker restart supabase-rest`
   (ver nota "Migration → recarregar cache PostgREST").
5. **Verificação**: `select count(*) from fin_categorias` (17 por loja própria); `select fin_contas_saldo(15)` = `[]`; como `authenticated`,
   `select * from fin_titulos_pagar` deve dar *permission denied*; rodar `286_financeiro_contas_pagar.sql` e `286_concorrencia.sh` só em cópia, nunca em produção.
6. Só depois, deploy do código (`deploy.sh` manual). Como o código só acessa `fin_*` em telas só-dev, subir o código antes da migration não afeta ninguém
   (as telas mostram "ainda não foi ativado"), mas a ordem recomendada é migration → código.
7. `desktop/schema/estoque.sql`: **não muda** (nenhuma tabela `fin_*` entra em `offline_tabelas`); não precisa de nova versão do desktop.
8. Criar uma conta ("Caixa da loja") e dar a permissão aos cargos que devem ver, só depois de lançar o recurso (hoje só dev).

## Próxima etapa (não feita)

- Título gerado pela nota de entrada (uma parcela por título, `origem_tipo = 'nota_entrada'`, `origem_id` = nota; cancelar a nota cancela os abertos).
- Aprovação de pagamento (gerente lança, dono aprova), anexo do boleto, importar planilha, duplicar título, lançamento avulso/transferência entre contas.
- Fechamento de período (hoje o financeiro não olha `_exigir_periodo_aberto`), contas a receber, OFX/conciliação, fluxo de caixa e DRE (já com `grupo_dre`).
- Resumo de Finanças, abrir leitura de `fin_*` para `authenticated` se algum dia for preciso.
