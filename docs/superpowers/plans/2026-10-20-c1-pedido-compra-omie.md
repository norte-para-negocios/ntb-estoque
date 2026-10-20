# C1 — Pedido de compra do NTB gravado no Omie (lojas de estoque Omie)

Data: 20/10/2026 · Branch de origem: `paridade-omie` · Migration: **270** (não aplicada em produção)

**Estado: código pronto e DESLIGADO.** O dono ainda não autorizou escrever no Omie de produção. Nenhuma chamada ao Omie
(nem leitura) foi feita para construir isto: o formato vem da documentação pública (`~/Projects/omie-rea/endpoints/public-api/stock-and-purchase-detail.md`,
`produtos/pedidocompra`), das telas capturadas (`omie-rea/telas/COM/incluir-pedido-compra.md`) e da ajuda do Omie.

## Objetivo

1. Nas lojas Omie (2, 3, 5, 6; a 4 nunca), o pedido de compra criado e **aprovado** no NTB vira um pedido de compra de
   verdade no Omie (`IncluirPedCompra`), para a NF-e do fornecedor se ligar a ele no Omie quando chegar.
2. Os pedidos criados direto no Omie aparecem no NTB (leitura `PesquisarPedCompra`, atrás de `OMIE_LER_PEDIDOS_COMPRA`).

## Como a NF-e se liga ao pedido no Omie

- Automático: o Agente de NF-e do Omie importa a nota da SEFAZ e, **se o fornecedor preencheu `xPed` (nº do pedido no Omie)
  e `nItemPed` (nº do item, na ordem do pedido)**, vincula sozinho ao pedido. Sem as tags, a associação é manual no
  Recebimento da NF-e (só com a nota pendente). Fonte: ajuda do Omie (artigos "Associando a NF-e do fornecedor com o pedido
  de compra" e "Preenchendo o xPed e o nItemPed").
- Prova nos dados da loja 5 (`omie-rea/regras/status-numeracao-arredondamento-vinculos.md` §4): item do recebimento →
  item do pedido por `itensCabec.nIdItPedido` e `itensInfoAdic.nNumPedCompra/cNumItPedCompra`.
- Por isso o NTB: manda os itens **na ordem da linha** (nItemPed = posição), guarda o **`cNumero` do Omie** e mostra esse
  número na página do pedido e no **PDF** ("Nº para a NF-e … informe na tag xPed e o nº do item em nItemPed").

## Decisões

- **R1. Só o pedido aprovado vai ao Omie.** Rascunho/aguardando ficam só no NTB. Ao aprovar (`mudarEtapaPedido`), o pedido
  entra na fila (`pc_omie_enfileirar`) e a gravação é tentada na hora; se falhar, a aprovação continua valendo e o cron repete.
- **R2. Pedido já gravado no Omie não reabre nem cancela no NTB** (gatilho `pedidos_compra_omie_etapa` na 270 + mesma regra
  no TS, `bloqueioEtapaPorOmie`): alterar/cancelar é no Omie. `AlteraPedCompra`/`ExcluirPedCompra` ficam para depois (com OK).
- **R3. Quantidade e preço vão em unidade de estoque** (quantidade × fator, preço ÷ fator): é a unidade do cadastro do
  produto no Omie e a que o recebimento confere. A unidade do pedido do NTB (CX, fardo) vai na observação do item.
- **R4. Idempotência pelo código de integração**: `cCodIntPed = NTB-PC-<id do pedido>` (≤ 20 caracteres),
  `cCodIntItem = <id>-<linha>`. Toda tentativa depois da 1ª, e todo `enviando` esquecido há mais de 1 h, faz
  `ConsultarPedCompra {cCodIntPed}` antes de incluir; se o Omie responder "já existe" na inclusão, consulta e adota o `nCodPed`.
- **R5. Limite do Omie** (10ª requisição com erro no mesmo método = 30 min de bloqueio da chave; incidente do Sertão):
  uma tentativa por pedido por vez (status `enviando` reivindicado no banco), espera crescente (10, 20, 40, 80, 120 min…),
  teto (erro permanente/desconhecido: 3 tentativas; transitório: 8), recusa do disjuntor/bloqueio **não conta tentativa** e
  espera o bloqueio, o cron processa até 5 pedidos por loja e **para a loja no 1º erro do ciclo**, botão manual no máximo
  1× a cada 2 min por pedido. Falta de dado no NTB não chega ao Omie (vira `precisa_corrigir` antes).
- **R6. Loja de teste** (`is_test`): a inclusão é simulada pelo `omieRequest` (resposta sintética ganhou `nCodPed`/`cNumero`)
  e a consulta é pulada. **Achado corrigido junto**: o detector de escrita do `omieRequest` não reconhecia `AlteraPedCompra`
  (sem o "r") nem `UpsertPedCompra` — numa loja de teste esses métodos iriam ao Omie real. Agora `ehChamadaDeEscrita` está em
  `lib/omie/erros-omie.ts` (puro, testado) e cobre `Altera*` e `Upsert*`.
- **R7. Requisição, importação por planilha, "criar pedido" da sugestão, lead time e conferência pedido × nota** continuam só
  no estoque próprio (TS). Efeito colateral conhecido no banco: a 270 faz `_pc_loja_propria` aceitar a loja Omie liberada, e
  as funções `rc_*`/`comp_salvar`/`fornecedor_lead_time_salvar`/`pc_importar` (240–242) usam a mesma função.

## Mapeamento NTB → `IncluirPedCompra` (`v1/produtos/pedidocompra`)

| NTB (`pedidos_compra` / itens / cadastros) | Omie | Regra |
|---|---|---|
| `id` | `cabecalho_incluir.cCodIntPed` | `NTB-PC-<id>` (idempotência) |
| `previsao_entrega` (aaaa-mm-dd) | `dDtPrevisao` (dd/mm/aaaa) | **obrigatória** no C1 (vazia = não envia) |
| `fornecedor_id` → `fornecedores.codigo_omie` | `nCodFor` | só se `origem='omie'` e código < 8000000000001 (faixa própria) |
| `fornecedor_cnpj` (ou `cnpj_cpf` do cadastro) | `cCnpjCpfFor` | só quando não há `nCodFor` (a doc proíbe mandar os dois); sem nenhum = não envia |
| `lojas.omie_pedido_categoria` (270) | `cCodCateg` | omitido se vazio (categoria padrão do Omie); formato `^[0-9.]{1,20}$` |
| `contato` | `cContato` | corta em 100 |
| `numero_fornecedor` | `cNumPedido` | corta em 30 |
| `obs` | `cObs` | impressa no pedido do Omie |
| `numero` + `obs_interna` | `cObsInt` | "Pedido de compra nº N do Norte Estoque (NTB-PC-id). …" |
| `parcelas` [{dias, percentual}] | `cCodParc='999'`, `nQtdeParc`, `parcelas_incluir[]` {`nParcela`, `dVencto`, `nValor`, `nDias`, `nPercent`} | vencimento = previsão + dias; valor como `parcelasDoPedido` (última fecha o total); sem parcelas = omitidos |
| `frete`, `outras_despesas` | `frete_incluir.nValFrete`, `nValOutras` | bloco só se algum > 0; `cTpFrete` omitido |
| `lojas.omie_pedido_email_aprovador` (270) | `cEmailAprovador` | com ele o Omie cria o pedido já aprovado; vazio = omitido |
| item `linha` | `produtos_incluir[].cCodIntItem` | `<id>-<linha>`; itens na ordem da linha (= `nItemPed`) |
| item `codigo_produto` | `nCodProd` | produto precisa existir (espelho) e estar ativo |
| item `quantidade × fator` | `nQtde` | unidade de estoque, 6 casas |
| item `preco_unitario ÷ fator` | `nValUnit` | 6 casas |
| item `codigo_local_estoque` | `codigo_local_estoque` | precisa estar em `local_estoques` da loja; vazio = local padrão do Omie |
| item `obs` (+ unidade do pedido se fator ≠ 1) | `cObs` | |

Resposta: `nCodPed` → `pedidos_compra_omie.n_cod_ped`; `cNumero` → `numero_omie` (o nº que o fornecedor põe no `xPed`).

### Campos do Omie que o NTB não tem (hoje vão omitidos ou com padrão)

| Campo Omie | O que falta no NTB | Hoje |
|---|---|---|
| `cTpFrete` (modalidade CIF/FOB…) | modalidade de frete no pedido | omitido (padrão do Omie) |
| `nCodCC` (conta corrente) | conta corrente do Omie por loja/pedido | omitido |
| `nCodCompr` (comprador) | código do comprador **no Omie** (o NTB tem `compradores`, sem código do Omie) | omitido |
| `cCodCateg` por item | categoria por item | só a da loja no cabeçalho |
| `departamentos_incluir` | rateio por departamento | omitido |
| `nCodProj`, `cContrato` | projeto, contrato | omitidos |
| `nDesconto`, `nValorIcms/St/Ipi/Pis/Cofins` por item | impostos e desconto previstos | omitidos (o pedido do NTB é preço combinado líquido) |
| `cTipoDoc` da parcela | tipo de documento (boleto…) | omitido |
| transporte (`nCodTransp`, placa, volumes, pesos) | transportadora/volumes | omitidos |
| `previsao_entrega` | é opcional no NTB | obrigatória para gravar no Omie |

## Leitura dos pedidos do Omie (`OMIE_LER_PEDIDOS_COMPRA`)

Conferido o caminho que já existia (`lib/omie/pedidos-compra.ts`): formato bate com a doc (`pedidos_pesquisa[]` com
`cabecalho_consulta`/`produtos_consulta`, paginação por `nTotalPaginas`), `semRepetir`, ≤ 5 páginas de 50, cache de 10 min,
trava `pedidos-compra`. Completado no C1:
- `listarPedidosCompraOmie` (mesmo cache/trava, filtro `lista` = pendentes + faturados + faturados/recebidos em parte):
  seção **"Pedidos no Omie"** em `/pedido-compra` da loja Omie, com fornecedor pelo cadastro, previsão, situação pelo
  `nQtdeRec`, valor, e "criado aqui no NTB" (link) quando o `cCodIntPed` é `NTB-PC-<id>`. Só leitura.
- Com só a leitura ligada (gravação desligada), a loja Omie vê `/pedido-compra` com essa seção e sem "Novo pedido".
- Sugestão de compra: sem mudança (entrada prevista = pendentes do Omie); os pedidos do NTB gravados no Omie entram por
  ali, sem contar duas vezes (a `sugestao_compra_omie` não lê `pedidos_compra`).
- `cEtapa` aparece cru: o significado de cada código ainda não foi provado.

## Portões e "desligado = igual a hoje"

| Portão | Onde | Padrão |
|---|---|---|
| `OMIE_GRAVAR_PEDIDOS_COMPRA=1` | `.env` do servidor | ausente = desligado |
| `lojas.omie_gravar_pedidos_compra` | migration 270 | `false` em todas |
| loja 4 | código (`LOJA_BLOQUEADA_PEDIDO_OMIE`) e banco (`id <> 4`) | sempre bloqueada |
| `OMIE_LER_PEDIDOS_COMPRA=1` | `.env` do servidor | ausente = desligado |

Com as duas variáveis desligadas: `estadoPedidoCompraLoja` faz só a consulta de modo de antes e devolve `proprio`/null
(telas 404 na loja Omie, ações recusadas com a mesma mensagem), o menu é o de antes (nenhuma consulta a mais no layout),
a rota do cron responde `{desligado:true}` sem ler o banco, e ela **não** está no `sync-cron.sh`. Provas:
`lib/compras/pedido-omie-gravar-puro.test.ts` (regra das variáveis), `lib/compras/pedido-omie-desligado.test.ts`
(cada ponto de entrada confere a variável antes de banco/Omie; nenhuma tela volta a olhar só o modo),
`scripts/testes-sql/270_pedido_compra_omie.sql` (sem opt-in: mesma recusa e mesma mensagem da 200) e os testes SQL
200/201/240/241/242 rodados de novo com a 270 aplicada.

## Arquivos

- `supabase/migrations/270_pedido_compra_omie.sql` — colunas em `lojas` (opt-in, categoria, e-mail do aprovador),
  `pedidos_compra_omie` (fila/estado: `pendente → enviando → enviado | precisa_corrigir`, `n_cod_ped`, `numero_omie`,
  tentativas, próxima tentativa, último erro, último payload), RLS de leitura por loja, gatilho de etapa,
  `_pc_loja_propria` aceitando a loja liberada, `pc_omie_enfileirar`.
- `lib/compras/pedido-omie-gravar-puro.ts` (+ teste, fixture `lib/compras/fixtures/pedido-omie-c1.fixture.json`) — portões,
  códigos de integração, montagem do payload, decisão de falha, filtros da fila.
- `lib/omie/pedido-compra-gravar.ts` — envio (reivindica, monta, consulta na retentativa, inclui, registra em
  `integration_attempts` e `pedidos_compra_eventos`), fila do cron.
- `lib/compras/pedido-compra-loja.ts` — portão comum das telas/ações.
- `app/api/cron/enviar-pedidos-compra-omie/route.ts` — cron (não agendado).
- `lib/actions/pedido-compra.ts` — contexto pelo portão; aprovar enfileira e tenta; `enviarPedidoAoOmieAgora`; notas/sugestão/lead time só no próprio.
- Telas: `/pedido-compra` (lista + "Pedidos no Omie" + situação no Omie por pedido), `/[id]` (seção Omie,
  `components/compras/EnvioOmiePedido.tsx`), `/novo`, `/[id]/editar`, `/[id]/pdf` (nº do Omie), menu (`ouPedidosOmie`).
- `lib/omie/pedidos-compra.ts`, `lib/compras/pedidos-omie-puro.ts` — leitura completada (lista).
- `lib/omie/client.ts`, `lib/omie/erros-omie.ts` — detector de escrita (R6) e resposta simulada com `nCodPed`/`cNumero`.

## Testes

```bash
node --test lib/compras/pedido-omie-gravar-puro.test.ts lib/compras/pedido-omie-desligado.test.ts lib/compras/pedidos-omie-puro.test.ts lib/omie/erros-omie.test.ts
# banco local (nunca produção): c1 = cópia do c2 (fb + 187, 188, 190–195, 200, 201, 240–242)
docker exec ntb-teste-sql psql -U postgres -c "create database c1 template c2"
docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d c1 < supabase/migrations/270_pedido_compra_omie.sql
docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d c1 < scripts/testes-sql/270_pedido_compra_omie.sql
bash scripts/testes-sql/270_fila_postgrest.sh c1      # filtros da fila pelo PostgREST local
# regressão com a 270 aplicada: 200_pedido_compra.sql, 201_sugestao_compra.sql, 240_*, 241_*, 242_* no c1
npx tsc --noEmit && npm run build
```

## Hipóteses a confirmar no 1º pedido de teste (com OK)

1. Mensagem do Omie para `cCodIntPed` repetido casa com `ehPedidoJaExiste`, e a de consulta sem resultado com `ehPedidoNaoEncontrado`
   (senão a retentativa vira erro contado, não duplicata — a duplicata é impedida pelo próprio Omie).
2. `dDtPrevisao` é obrigatória? `cCodParc='999'` + `parcelas_incluir` gera as parcelas pedidas (e não a condição padrão)?
3. `nQtde`/`nValUnit` com 6 casas são aceitos (ou o Omie arredonda para 4).
4. Sem `cEmailAprovador` o pedido entra na etapa de aprovação do Omie (2003) — confirmar se a NF-e liga a pedido não aprovado.
5. Com `xPed`/`nItemPed` na NF-e, o vínculo automático acontece com o pedido gravado pela API.

## Ativação (cada passo pede o OK explícito do dono)

**Loja recomendada: 2 ou 6.** Não a 5 (tem o job externo de limpeza/correções `norte-faxina` mexendo no Omie dela, o que
confunde a conferência) e nunca a 4 (Sertão, bloqueada no código e no banco).

0. Backup do Postgres (`ntb-backup-postgres` manual) e aplicar a **270**:
   `docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 270_pedido_compra_omie.sql`;
   conferir `\df _pc_loja_propria` (1 overload), `select count(*) from lojas where omie_gravar_pedidos_compra` = 0;
   `desktop/scripts/gerar-schema.sh` + versão do desktop (colunas novas em `lojas`). Deploy do código. Até aqui nada muda.
1. **Ensaio sem escrita** na loja de teste gêmea da escolhida (`lojas.is_test`, `loja_origem_id` = 2 ou 6; inclusão simulada,
   consulta pulada): `OMIE_GRAVAR_PEDIDOS_COMPRA=1` no `.env` do servidor + restart; `update lojas set omie_gravar_pedidos_compra = true where id = <gêmea>`.
   A gêmea não tem cadastro sincronizado pelos crons: antes, rodar as rotas `/api/sync/*` de produtos, fornecedores e locais
   dentro dela (são leituras do Omie real com a chave da loja de origem: pedem o mesmo OK de leitura). A leitura
   `PesquisarPedCompra` na gêmea também vai ao Omie real (só leitura).
   Criar, aprovar, ver "No Omie: pedido nº -…" (simulado, `[SIMULADO] IncluirPedCompra` em `integration_attempts`), conferir o
   payload gravado em `pedidos_compra_omie.payload` contra a tabela de mapeamento, PDF com o nº. Tentar reabrir/cancelar (recusa).
2. **1 pedido real** na loja 2 (ou 6), com OK do dono para esse pedido: definir `omie_pedido_categoria` (ex. `2.01.01`, conferir
   no Omie da loja) e, se quiser o pedido já aprovado no Omie, `omie_pedido_email_aprovador`; `update lojas set omie_gravar_pedidos_compra = true where id = 2`.
   Um pedido pequeno (1–2 itens, fornecedor sincronizado do Omie, previsão preenchida), aprovar e conferir no Omie
   (Compras → Pedidos de Compra): fornecedor, itens/quantidades em unidade de estoque, preço, local, parcelas, frete, observações,
   `cCodIntPed`. Conferir as hipóteses 1–4. Se algo divergir: **desligar** (passo de rollback 1) antes de qualquer correção.
3. Receber a NF-e desse pedido (pedir ao fornecedor `xPed` = nº do Omie e `nItemPed`) e conferir o vínculo (hipótese 5).
4. Só então: agendar o cron em `scripts/sync-cron.sh` (`hit /api/cron/enviar-pedidos-compra-omie`, todo ciclo) e liberar as
   outras lojas (3, 6/2, 5 por último) uma a uma. Leitura: `OMIE_LER_PEDIDOS_COMPRA=1` pode ser ligada à parte (só leitura,
   no máximo 5 chamadas de `PesquisarPedCompra` por loja a cada 10 min por tela/sugestão).

## Rollback

1. **Parar na hora** (sem deploy): `update lojas set omie_gravar_pedidos_compra = false where id = <loja>;` — a tela da loja volta
   a 404, ações recusadas, o cron ignora a loja. Ou, para todas: tirar `OMIE_GRAVAR_PEDIDOS_COMPRA` do `.env` + restart.
   Pedidos `pendente` ficam parados na fila (não vão ao Omie).
2. Pedido que já foi para o Omie e não deveria: excluir **no Omie** (tela de Pedidos de Compra, pelo nº em `numero_omie` /
   `cCodIntPed NTB-PC-<id>`). O NTB não exclui no Omie (R2). No NTB, para liberar o pedido:
   `delete from pedidos_compra_omie where pedido_id = <id>;` e então cancelar pela tela.
3. Tirar o cron do `sync-cron.sh` (se já agendado).
4. Desfazer a migration (só se for abandonar o C1), numa transação:
   ```sql
   begin;
   drop trigger if exists pedidos_compra_omie_etapa on public.pedidos_compra;
   drop function if exists public.trg_pedidos_compra_omie_etapa();
   drop function if exists public.pc_omie_enfileirar(bigint, bigint);
   drop table if exists public.pedidos_compra_omie;
   create or replace function public._pc_loja_propria(p_loja bigint) returns void
   language plpgsql stable set search_path = public as $$
   begin
     if (select modo_estoque from lojas where id = p_loja) is distinct from 'proprio' then
       raise exception 'A loja % não usa estoque próprio: pedido de compra local só existe no estoque próprio', p_loja using errcode = '22023';
     end if;
   end $$;
   alter table public.lojas drop constraint if exists lojas_omie_pedido_categoria_formato;
   alter table public.lojas drop column if exists omie_pedido_email_aprovador, drop column if exists omie_pedido_categoria,
     drop column if exists omie_gravar_pedidos_compra;
   commit;
   notify pgrst, 'reload schema';
   ```
   Pedidos de loja Omie criados no NTB continuam em `pedidos_compra` (só leitura depois disso).

## Fora (depois, com OK)

`AlteraPedCompra` (editar pedido já no Omie), `ExcluirPedCompra` ao cancelar no NTB, recebido do Omie no pedido do NTB
(hoje a coluna "Recebido" da loja Omie fica 0; a lista "Pedidos no Omie" mostra o `nQtdeRec`), "criar pedido" da sugestão
e requisições na loja Omie, campos da tabela "Campos do Omie que o NTB não tem", significado dos códigos de `cEtapa`.
