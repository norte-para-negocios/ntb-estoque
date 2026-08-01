# Achado: divergência no aproveitamento de crédito de ICMS nas compras

**Data da análise:** 01/08/2026
**Base:** notas fiscais de entrada sincronizadas do Omie, 5 lojas ativas, período 01/01/2026 a 01/08/2026
**Para:** Joaquim → levar ao contador responsável

---

## ⚠️ Leia isto primeiro

**Este documento não é uma conclusão fiscal.** Foi produzido por análise de dados
(cruzamento dos campos fiscais que a própria Omie devolve nas notas de entrada),
não por um contador. Não afirmo que exista erro, imposto pago a maior, ou crédito
perdido.

O que este documento traz é **uma inconsistência objetiva nos dados** — situações
em que o mesmo produto, no mesmo estabelecimento, comprado com a mesma
classificação fiscal de origem e o mesmo CFOP de entrada, foi lançado ora com
aproveitamento de crédito de ICMS, ora sem.

Pode haver explicação legítima que não é visível pelos dados (regra estadual
específica, regime do fornecedor em determinado período, decisão fiscal
deliberada, particularidade de substituição tributária). **A avaliação é do
contador.**

---

## Resumo do que foi encontrado

Em compras classificadas com **CFOP 1.102** (compra para comercialização) cujo
documento do fornecedor veio com **CST 00 ou 20** (mercadoria tributada, situações
que normalmente comportam crédito), o sistema registra:

| Tratamento na entrada | Itens | Valor de mercadoria |
|---|---:|---:|
| **Sem** aproveitamento de crédito (`cNaoCredICMSE = S`) | 4.425 | R$ 3.071.245,73 |
| **Com** aproveitamento de crédito (`cNaoCredICMSE = N`) | 503 | — |

Ordem de grandeza, se a alíquota aplicável fosse 18%: aproximadamente
**R$ 553 mil** em crédito de ICMS. *Esse número é uma estimativa grosseira de
magnitude, não um cálculo fiscal* — a alíquota real varia por produto, origem e
regra estadual.

### Por loja (2026)

| Loja | Itens sem crédito | Valor de mercadoria |
|---|---:|---:|
| Donana Praia do Forte | 1.361 | R$ 853.972,90 |
| Donana Rio Vermelho | 1.020 | R$ 777.383,46 |
| Donana Brotas | 726 | R$ 666.207,58 |
| Donana Vilas do Atlântico | 696 | R$ 607.309,76 |
| O Sertão Vai Virar Mar | 622 | R$ 166.372,03 |

O padrão aparece **em todos os meses de 2026, em todas as 5 lojas** — é
sistemático, não um lançamento isolado.

---

## Por que isso chamou atenção (o sinal objetivo)

Três verificações foram feitas justamente para **descartar** explicações inocentes:

**1. Não é o regime da empresa.** Se as lojas fossem do Simples Nacional, nenhuma
entrada geraria crédito e não haveria o que discutir. Mas as mesmas lojas
aproveitam crédito em 503 itens — ou seja, o aproveitamento é possível e ocorre.

**2. Não é "uso e consumo".** Material de uso e consumo (CFOP 1.556)
legitimamente não gera crédito, e há 4.442 itens nessa situação — **corretos, e
excluídos desta análise**. O recorte aqui é só CFOP 1.102, compra para
comercialização.

**3. Não é regra por fornecedor.** A divergência aparece dentro do mesmo
fornecedor:

| Fornecedor (loja Praia do Forte) | Sem crédito | Com crédito |
|---|---:|---:|
| MACROPAC EMBALAGENS | 19 | 34 |
| VIENA COMERCIO DE ALIMENTOS | 31 | 5 |
| WMS SUPERMERCADOS | 628 | 20 |
| DALAC DISTRIBUIDORA DE LACTEOS | 1 | 63 |

---

## Exemplo concreto e verificável

Produto **"OLEO SOJA (MP)"**, loja Donana Praia do Forte, todos com **CST 20** no
documento e **CFOP 1.102** na entrada:

| NF | Fornecedor | Emissão | Crédito? | Valor |
|---|---|---|---|---:|
| 000337001 | VIENA COMERCIO DE ALIMENTOS | 03/07/2026 | **Sim** | R$ 157,80 |
| 000337808 | VIENA COMERCIO DE ALIMENTOS | 09/07/2026 | **Sim** | R$ 159,80 |
| 000130958 | WMS SUPERMERCADOS | 03/01/2026 | **Não** | R$ 198,96 |
| 000131250 | WMS SUPERMERCADOS | 05/01/2026 | **Não** | R$ 198,96 |

Outros produtos com o mesmo comportamento (loja / sem crédito / com crédito):
VINHO BRANCO COZINHA (31/1), LEITE DE COCO (28/2), CALDO KNORR (17/4),
COLORIFICO (17/3), ATUM PIZZARIA (16/1), QUEIJO COALHO CHAPA (12/1).

---

## Perguntas sugeridas para o contador

1. Nas compras para comercialização (CFOP 1.102) com CST 00/20 na origem, o
   aproveitamento do crédito de ICMS seria devido nestes casos?
2. Se sim, existe algum ajuste/retificação cabível para o período de 2026?
3. Se não, qual a razão que torna correto o não aproveitamento — e ela também se
   aplica aos 503 itens que **tomaram** crédito (ou seja, esses estariam errados)?
4. O cadastro de fornecedor/produto no Omie deveria ser ajustado para que a
   classificação de entrada saia consistente daqui pra frente?

---

## Como reproduzir os números

Todos os números vieram do banco de produção. Os campos usados estão no
`full_object` de cada item de nota fiscal, exatamente como a Omie os devolve:

- **CST do documento:** `itensICMS.cSitTrib`
- **CFOP de entrada:** `itensAjustes.cCFOPEntrada`
- **Não creditar ICMS:** `itensAjustes.itensSitTribEnt.cNaoCredICMSE` (`S`/`N`)
- **Valor do item:** `itensCabec.vTotalItem`

Consulta usada para o total:

```sql
select nf.loja_id, count(*) as itens,
       round(sum((i.full_object->'itensCabec'->>'vTotalItem')::numeric),2) as valor
from nota_fiscal_items i
join notas_fiscais nf on nf.id = i.nota_fiscal_id
where i.full_object->'itensICMS'->>'cSitTrib' in ('00','20')
  and i.full_object->'itensAjustes'->>'cCFOPEntrada' like '1.102%'
  and i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE' = 'S'
  and nf.d_emissao_nfe >= '2026-01-01'
group by nf.loja_id order by valor desc;
```

Está em construção, na tela **Auditoria Fiscal** do NTB Estoque, uma visão que
expõe essas combinações (CST do documento × CST de entrada × CFOP) de forma
contínua, para não depender de análise manual em planilha.
