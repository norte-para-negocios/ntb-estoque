---
title: Varredura completa API Omie -- NTB Estoque
domain: triforce
type: reference
tags: [omie, api, ntb, faturamento, nfc-e, sync]
sources: []
updated: 2026-06-26
related: []
---

# SPEC COMPLETO -- API OMIE / NTB ESTOQUE

Resultado da varredura com 17 agentes (2 workflows paralelos) sobre toda a documentacao, comunidade e casos reais da API do Omie.

---

## 1. MAPA COMPLETO DOS ENDPOINTS OMIE

### USAMOS (funcionando em producao)

| Endpoint | Call(s) | Arquivo |
|---|---|---|
| v1/geral/empresas | ListarEmpresas | scripts/sync-empresa.mjs |
| v1/geral/clientes | ListarClientes | lib/omie/cliente-fornecedor.ts |
| v1/geral/produtos | ListarProdutos, IncluirProduto, AlterarProduto, ExcluirProduto | lib/omie/produto.ts |
| v1/geral/familias | PesquisarFamilias | lib/omie/familia.ts |
| v1/geral/malha | ConsultarEstrutura, IncluirEstrutura, AlterarEstrutura, ExcluirEstrutura | lib/omie/malha.ts |
| v1/estoque/consulta | ListarPosEstoque | lib/omie/posicao-estoque.ts |
| v1/estoque/movestoque | ListarMovimentos | lib/omie/movimento.ts |
| v1/estoque/ajuste | IncluirAjusteEstoque, ExcluirAjusteEstoque | lib/omie/ajuste.ts |
| v1/estoque/local | ListarLocaisEstoque, IncluirLocalEstoque, AlterarLocalEstoque | lib/omie/local-estoque.ts |
| v1/produtos/op | ListarOrdemProducao, ConsultarOrdemProducao, IncluirOrdemProducao, ExcluirOrdemProducao, ConcluirOrdemProducao, ReverterOrdemProducao | lib/omie/ordem-producao.ts |
| v1/produtos/recebimentonfe | ListarRecebimentos, ConsultarRecebimento | lib/omie/nota-fiscal.ts |

### NAO USAMOS -- prioridade P0 (bloqueiam objetivos imediatos)

| Endpoint | Call(s) relevantes | Por que importa |
|---|---|---|
| v1/produtos/cupomfiscalconsultar | CuponsFiscais, CuponsItens, CuponsPagamentos | UNICA fonte de NFC-e/PDV com itens por produto |
| v1/produtos/nfconsultar | ListarNF (tpNF=1) | NF-e de saida B2B com itens por produto |
| v1/financas/contareceber | ListarContasReceber | DRV de faturamento (sistema do Andre) |
| v1/financas/contapagar | ListarContasPagar | DRV de compras (base financeira) |
| v1/financas/pesquisartitulos | PesquisarLancamentos | Unifica CR+CP, busca por chave NFe |
| v1/financas/mf | ListarMovimentos (financeiro) | Consolidado CR+CP+baixas em uma call |
| v1/produtos/pedidocompra | PesquisarPedCompra, IncluirPedCompra | POs integrados ao sistema |
| v1/estoque/movestoque | ConsultarPrevisao | Sugestao de compra automatica |
| v1/estoque/produtofornecedor | ListarProdutoFornecedor | De qual fornecedor pedir cada produto |

### NAO USAMOS -- prioridade P1 (alto valor, sem bloqueio critico)

| Endpoint | Call(s) relevantes | Por que importa |
|---|---|---|
| v1/estoque/resumo | ObterEstoqueProduto | Lookup rapido de produto individual |
| v1/estoque/ajuste | ListarAjusteEstoque | Relatorio de perdas/movimentacao |
| v1/produtos/recebimentonfe | AlterarEtapaRecebimento, ConcluirRecebimento | Workflow completo de conferencia NF |
| v1/geral/empresas | ConsultarEmpresa | Dados completos loja p/ /minha-loja e etiqueta |
| v1/produtos/lotes | ListarLotes, ConsultarLote | Controle de validade |
| v1/financas/extrato | ListarExtrato | Saldo real por conta corrente |
| v1/financas/resumo | ObterResumoFinancas | Widget de saude financeira no dashboard |
| v1/servicos/nfse | ListarNFSEs | Se lojas emitem NFS-e alem de NF-e |

### NAO USAMOS -- prioridade P2 (futuro ou depende de decisao externa)

v1/produtos/pedidocompra (IncluirPedCompra), v1/produtos/notaentrada, v1/geral/categorias, v1/geral/departamentos, v1/geral/contacorrente, v1/geral/anexo (certificado digital), v1/produtos/tabelaprecos, v1/produtos/lote (controle por lote em OPs)

### IGNORAR (fora de escopo confirmado)

v1/crm/*, v1/servicos/os, v1/servicos/contrato, v1/financas/contareceberboleto, v1/financas/pix, v1/produtos/nfce (ImportarNFCe), v1/produtos/cfop, CFOP estatico

---

## 2. QUICK WINS P0 -- menos de 1 dia cada

### QW-1: Spike NFC-e -- confirmar fonte do faturamento PDV

**O problema:** O spike de 22/06 testou `nfconsultar` (NF-e modelo 55, so entrada). Nenhum teste foi feito em `cupomfiscalconsultar`. Esse e o pivo do modulo de faturamento inteiro.

**Acao:** Script de probe READ-ONLY na loja 3 (Donana Rio Vermelho). 30 min de trabalho.

```typescript
// scripts/probe-cupons.mjs
const res = await omieRequest({
  endpoint: 'v1/produtos/cupomfiscalconsultar',
  call: 'CuponsFiscais',
  data: {
    nPagina: 1,
    nRegPorPagina: 5,
    dDtEmissaoDe: '01/06/2026',
    dDtEmissaoAte: '30/06/2026',
  }
})
// Verificar: res.nTotRegistros > 0? cupons[0].cModeloCupom === '65'? cupons[0].itensCupomArray?
```

**Resultado esperado:** Se `cModeloCupom=65` aparecer com `itensCupomArray` contendo `cCodigo` e `nQuant`, o modulo de faturamento por produto e GO sem Excel. Se retornar vazio, fallback e `nfconsultar` tpNF=1 (venda B2B) + manter import manual para PDV.

**Criterio de sucesso:** `nTotRegistros > 0` E `cModeloCupom = '65'` E `itensCupomArray[0].cCodigo` preenchido.

---

### QW-2: Filtro c_etapa na auditoria fiscal -- fix de bug (migration necessaria)

**O bug atual:** As funcoes `relatorio_auditoria_fiscal_cfop` e `relatorio_auditoria_fiscal_itens` (migration 040) NAO filtram por `c_etapa`. Resultado: NFs canceladas/pendentes entram no relatorio do Ramon distorcendo os totais.

**O que ja temos:** Campo `c_etapa` ja e salvo na tabela `notas_fiscais`. Valor `'60'` = Concluida. O filtro ja existe em `nota-fiscal/export/route.ts` e `nota-fiscal/relatorio/route.ts`.

**Fix -- migration 047:**

```sql
-- supabase/migrations/047_fix_auditoria_fiscal_etapa.sql

CREATE OR REPLACE FUNCTION relatorio_auditoria_fiscal_cfop(...)
RETURNS TABLE(...) AS $$
  SELECT ...
  FROM notas_fiscais nf
  WHERE nf.loja_id = p_loja_id
    AND nf.data_emissao BETWEEN p_data_inicio AND p_data_fim
    AND nf.c_etapa = '60'   -- ADICIONAR
    AND COALESCE(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'  -- ADICIONAR
  ...
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION relatorio_auditoria_fiscal_itens(...)
RETURNS TABLE(...) AS $$
  -- mesma adicao dos dois filtros
$$ LANGUAGE sql;
```

**Tempo:** 1-2 horas (ler a migration 040, recriar com os dois filtros, aplicar via scripts/aplicar-migration.mjs).

---

### QW-3: ConsultarPrevisao para sugestao de compra automatica

**A call:** `v1/estoque/movestoque` / `ConsultarPrevisao` -- retorna `nQtdePrevista` por produto em um horizonte de datas.

```typescript
// lib/omie/previsao-venda.ts
export async function buscarPrevisaoProduto(
  loja: LojaOmie,
  nCodProd: number,
  dataInicial: string, // DD/MM/AAAA
  dataFinal: string
): Promise<number> {
  const res = await omieRequest<{ nQtdePrevista: number }>({
    ...lojaParams(loja),
    endpoint: 'v1/estoque/movestoque',
    call: 'ConsultarPrevisao',
    data: { nCodProd, dDtInicial: dataInicial, dDtFinal: dataFinal },
  })
  return res.nQtdePrevista ?? 0
}
```

**Integrar na tela de sugestao de compra existente.** Automatiza o calculo que hoje e manual.

---

### QW-4: ListarAjusteEstoque para relatorio de movimentacao com perdas

**A call:** `v1/estoque/ajuste` / `ListarAjusteEstoque` -- lista ajustes com tipo (ENT/SAI/SLD/TRF) e motivo.

```typescript
// lib/omie/ajuste.ts -- ADICIONAR syncAjustes():
data: {
  nPagina: pagina,
  nRegistrosPorPagina: 100,
  dDtAjusteInicial: dataIni,
  dDtAjusteFinal: dataFim,
}
// Campos: id_ajuste, nCodProd, nCodLocalEstoque, nQtde, cTipoAjuste, dDtAjuste, cObservacao, nValor
// cTipoAjuste='SAI' com cObservacao='perda' distingue perda real de ajuste contabil
```

Salvar em tabela `ajustes_estoque` no Supabase com `loja_id + id_ajuste` como conflito. Adicionar coluna de tipo (perda/inventario/transferencia) na tela de movimentacao.

---

## 3. ALTO VALOR P1 -- 2 a 5 dias cada

### P1-A: Faturamento por produto via CuponsItens (eliminar Excel FAT_DRV)

**Precondição:** QW-1 confirmou que `CuponsFiscais` tem dados.

**Interfaces:**

```typescript
interface OmieCupomItem {
  idProduto: number
  cCodigo: string        // codigo interno do produto
  xProd: string
  nQuant: number
  vUnit: number
  vDesc: number
  vItem: number
  cItemCancelado: string // S/N
  cItemDevolvido: string // S/N
}

interface OmieCupomCabec {
  nIdCupom: number
  nNumCupom: number
  cChaveCupom: string
  dDtEmissaoCupom: string  // DD/MM/AAAA
  cHrEmisaoCupom: string
  nValorCupom: number
  cModeloCupom: string     // 65=NFC-e, 59=SAT, 00=ECF
  cCupomCancelado: string  // S/N
  cCupomDevolvido: string  // S/N
  itensCupomArray?: OmieCupomItem[]
}
```

**Paginacao:** `nPagina + nRegPorPagina`, resposta tem `nTotPaginas + nTotRegistros`.

**Filtro de data para sync incremental:** Usar `dDtAlteracaoDe/dDtAlteracaoAte` (nao emissao) para pegar cancelamentos retroativos. Para backfill inicial: `dDtEmissaoDe/dDtEmissaoAte`.

**Tabelas Supabase a criar:**
- `cupons_fiscais` (loja_id, n_id_cupom, n_num_cupom, c_chave_cupom, d_dt_emissao, n_valor_cupom, c_modelo_cupom, c_cancelado, full_object)
- `cupom_itens` (loja_id, cupom_id, n_id_cupom, id_produto, c_codigo, x_prod, n_quant, v_unit, v_item, c_cancelado, c_devolvido)

**Join com produtos:** `cupom_itens.c_codigo = produtos.codigo` OU `cupom_itens.id_produto = produtos.n_cod_prod` (confirmar qual chave o PDV usa no probe QW-1).

**Cron:** `app/api/cron/sync-cupons/route.ts` -- diario, sync incremental por `dDtAlteracaoDe` da ultima execucao.

**Tela:** `/relatorio-faturamento` com agrupamento por produto, familia, periodo.

---

### P1-B: NF-e de saida B2B (complementar ao P1-A para clientes PJ)

**Endpoint:** `v1/produtos/nfconsultar` / `ListarNF`

```typescript
data: {
  nPagina: pagina,
  nRegistrosPorPagina: 20,  // MENOR -- cada NF tem muitos itens (det[])
  cApenasResumo: 'N',       // CRITICO: sem isso det[] nao retorna
  tpNF: 1,                  // saida
  dEmiInicial: dataIni,
  dEmiFinal: dataFim,
  filtrar_por_status: 'N',  // so nao canceladas
}
```

**Campos dos itens (det[]):**
- `det[].prod.cProd` -- codigo do produto
- `det[].prod.CFOP` -- filtrar: 5102/6102/5405 = venda; excluir devolucoes (5411/6411)
- `det[].prod.qCom` -- quantidade
- `det[].prod.vProd` -- valor total item
- `det[].nfProdInt.nCodProd` -- ID interno Omie (para join com tabela produtos)

**Tabelas Supabase:** `nfs_saida` + `nf_saida_itens` (mesmo padrao de `notas_fiscais` + `nota_fiscal_itens`).

---

### P1-C: Relatorio financeiro -- ListarContasReceber / PesquisarLancamentos

**Endpoint primario:** `v1/financas/pesquisartitulos` / `PesquisarLancamentos` com `cNatureza: 'R'`
- Unifica CR+CP, aceita `cChaveNFe` como filtro direto
- Retorna lancamentos parciais (pagamentos em aberto, valores baixados)
- Melhor para relatorio que cruza com NFs

**Endpoint secundario:** `v1/financas/contareceber` / `ListarContasReceber`
- Campos chave: `codigo_lancamento_omie`, `numero_documento_fiscal`, `chave_nfe`, `data_vencimento`, `valor_documento`, `status_titulo` (RECEBIDO/EMABERTO/ATRASADO/CANCELADO)
- `codigo_cliente_fornecedor` e int (ID Omie) -- join com tabela `clientes` pelo `n_cod_cliente`

**Nota:** `ListarContasReceber` NAO tem item de produto -- serve para DRV financeiro (aging, valores totais), nao para mix de produto.

---

### P1-D: ConsultarEmpresa para /minha-loja e etiqueta

```typescript
data: { codigo_empresa: loja.codigo_omie_empresa }
```

**Campos uteis:** `razao_social`, `nome_fantasia`, `cnpj`, `regime_tributario`, `habilita_nfce`, `certificado_digital` (validade).

**Cuidado:** Lojas 5 e 6 tem `ListarEmpresas` bloqueado -- `ConsultarEmpresa` pode ter o mesmo bloqueio. Testar nas lojas 1-4 primeiro. Cache local com TTL de 24h obrigatorio.

---

### P1-E: ListarProdutoFornecedor para sugestao de compra

```typescript
// v1/estoque/produtofornecedor / ListarProdutoFornecedor
// Campos: nCodFornecedor, cCNPJ_Forn, nCodProd, cCodProdForn
```

Tabela `produto_fornecedor` no Supabase (loja_id, n_cod_prod, n_cod_fornecedor, c_cnpj_forn, c_cod_prod_forn). Cron semanal. Exibir "Fornecedor preferencial" na tela de sugestao de compra.

---

## 4. ROADMAP P2 -- mais de 5 dias ou depende de insumo externo

### P2-A: Pedido de Compra integrado (IncluirPedCompra)

**Dependencias:** P1-E (saber fornecedor), decisao do Ramon sobre fluxo PO.

```typescript
data: {
  cabecalho: {
    cCodIntPed: `NTB-PO-${lojaId}-${timestamp}`,
    dDtPrevisao: '30/07/2026',
    nCodFor: fornecedorOmieId,
    cCodParc: '30',
    cNumPedido: `PO-${numero}`,
  },
  produtos: [{ cCodIntItem, nCodProd, nQtde, nValUnit }],
}
```

**Risco:** Escreve no Omie real. Testar apenas com Ramon presente na loja 3.

---

### P2-B: DRE por categoria (ListarCategorias + CR/CP)

O DRE nativo NAO existe na API. Requer:
1. `v1/geral/categorias` / `ListarCategorias` -- arvore com `codigodre`, `nivelDRE`, `sinalDRE`
2. CR + CP filtrados por `codigo_categoria`
3. Calculo DRE no Supabase via SQL

**Dependencia:** Confirmar com Ramon quais categorias estao sendo usadas nas lojas.

---

### P2-C: Controle de validade por lote (ListarLotes)

**Endpoint:** `v1/produtos/produtoslote` / `ListarLotes`

**Limitacao critica:** NAO existe filtro por `dDataValidade`. Requer varredura paginada + filtro client-side. Cron diario as 06h. A tela `/validade` ja existe no projeto -- verificar fonte atual antes de implementar.

---

### P2-D: Webhook para sync reativo

**NAO implementar agora.** A fila FIFO bloqueante do Omie e um risco operacional: um POST falho suspende todos os eventos fiscais do grupo por ate 5 dias. Manter polling via cron ate o sistema estabilizar.

**Se implementar no futuro:** endpoint receptor deve sempre retornar 200 imediatamente e processar de forma assincrona.

---

## 5. DECISAO DE ARQUITETURA

### Fonte de faturamento por produto

**Decisao: CuponsItens como fonte primaria + nfconsultar tpNF=1 como complemento**

- `CuponsItens` cobre NFC-e + SAT + ECF. E a fonte do PDV de restaurante.
- `nfconsultar` tpNF=1 cobre B2B (clientes com CNPJ). E complementar, nao concorrente.
- `ListarContasReceber` NAO tem item de produto -- serve para DRV financeiro apenas.

**Schema unificado `faturamento_itens`:**

```sql
faturamento_itens (
  loja_id, data_emissao,
  origem,    -- 'cupom' ou 'nf_saida'
  origem_id, -- n_id_cupom ou n_cod_nf
  c_codigo,  -- codigo produto
  n_cod_prod,-- ID interno Omie
  descricao,
  cfop,      -- so para nf_saida
  quantidade, valor_unit, valor_total,
  cancelado, devolvido -- bool
)
```

---

### Estrategia de sync

| Dado | Recomendacao |
|---|---|
| Posicao estoque | Manter diario |
| Movimentos estoque | Manter diario |
| NFs de entrada | Manter diario |
| OPs | Manter diario |
| CuponsItens (NOVO) | Horario, filtro por dDtAlteracaoDe |
| NF saida (NOVO) | Diario, mes-a-mes no backfill |
| ContasReceber (NOVO) | Diario |
| AjustesEstoque (NOVO) | Diario |
| ProdutoFornecedor (NOVO) | Semanal |

**Backfill:** Scripts/.mjs no mesmo padrao do `backfill-movimentos.mjs` -- mes a mes, sleep de 1s entre paginas.

---

## 6. O QUE NAO FAZER E POR QUE

### NAO: ListarMovimentos financeiro como fonte de faturamento por produto

O endpoint financeiro e um ledger (titulos, baixas, lancamentos). NAO tem produto, quantidade, CFOP. Util apenas para DRV financeiro (valores totais, aging), nao para faturamento por produto.

### NAO: ListarPedidos como fonte primaria de faturamento

Pedidos cancelados/nao faturados poluem os dados. Um pedido pode gerar multiplas NFs. Nao e a fonte fiscal definitiva.

### NAO: PosicaoEstoque em loop por produto

O NTB ja tem `ListarPosEstoque` paginado. Usar `ObterEstoqueProduto` apenas para lookup pontual em detalhe de produto individual.

### NAO: ImportarNFe como mecanismo de leitura

`ImportarNFe` e exclusivamente de ESCRITA. Para leitura: `ListarRecebimentos` (entrada) e `ListarNF` (saida).

### NAO: Ativar controle de lote via API

O campo `produto_lote` no cadastro e somente leitura via API. Ativar controle de lote requer acao manual no Omie.

### NAO: ConsultarEmpresa em loop por loja em cada request

Lojas 5 e 6 tem `ListarEmpresas` bloqueado. Cache local com TTL de 24h e obrigatorio.

### NAO: NFC-e via nfconsultar

Confirmado empiricamente (spike 22/06): `ListarNF` com `tpNF=1` nao retorna NFC-e. NFC-e so via `CuponsFiscais`. Endpoints completamente diferentes.

### NAO: Webhooks como estrategia primaria agora

Fila FIFO bloqueante. Uma falha suspende TODOS os eventos fiscais do grupo por ate 5 dias.

### NAO: Relatorio de faturamento usando ContasReceber como fonte de itens

`ListarContasReceber` retorna titulos financeiros (valor total da NF). NAO retorna itens (produto, quantidade, valor unitario). Para faturamento por produto: `CuponsItens` ou `nfconsultar` tpNF=1 com `cApenasResumo=N`.

---

## 7. PROXIMOS PASSOS (ordem de execucao)

1. **QW-2 (fix migration auditoria fiscal)** -- bug bloqueando relatorio do Ramon, impacto imediato
2. **QW-1 (probe CuponsFiscais na loja 3)** -- confirma ou descarta modulo de faturamento PDV
3. Se GO no QW-1: criar `faturamento_itens` + `lib/omie/faturamento-cupons.ts` seguindo template de `nota-fiscal.ts`
4. **QW-3 (ConsultarPrevisao)** -- automatiza sugestao de compra
5. **QW-4 (ListarAjusteEstoque)** -- destrava relatorio de movimentacao/perdas da reuniao 22/06

---

*Spec gerado em 2026-06-26 -- varredura de 17 agentes sobre docs, comunidade e casos reais da API Omie.*
