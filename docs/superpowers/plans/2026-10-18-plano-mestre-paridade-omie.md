# Plano-mestre: tudo que o Omie tem e o Norte Estoque não tem

> Roteiro por fases. Cada fase vira um plano de implementação próprio (`superpowers:writing-plans`) antes de começar; a Fase A já tem o seu: `2026-10-18-fase-a-correcoes-provadas.md`.

**Base:** engenharia reversa do Omie (empresa ANA.FILHAS = loja 5), em `~/Projects/omie-rea`. As fontes são:
- `gaps/matriz-compras-estoque-producao.md`: 196 itens, com status separado para as lojas Omie (2–7) e para a loja de estoque próprio (15, ODARA);
- `gaps/matriz-financeiro-vendas-config-relatorios.md`: 312 itens, incluindo os 124 relatórios;
- as regras provadas com dado real (`regras/*.md`) e as divergências provadas (`GAPS.md`).

Os códigos entre colchetes (ex.: [I2], [G1.1]) são as linhas dessas matrizes.

**Status da análise:** as telas, ações, protocolos, regras de saldo e custo e a entrada de NF estão 100% mapeados. Ainda faltam os dados de parte dos 124 relatórios (lote rodando), o diálogo "Novo Movimento" e os sub-painéis de leitura (anexos, históricos). Essas pendências podem ajustar números, não a forma deste plano.

## Números

| | Igual | Parcial | Falta | Fora de escopo / não se aplica |
|---|---|---|---|---|
| Compras, Estoque, Produção e NF de entrada (lojas Omie) | 32 | 78 | 49 | 37 |
| Idem, loja de estoque próprio | 43 | 84 | 59 | 10 |
| Financeiro, Vendas, Contador, CRM, Configurações, relatórios | 33 | 58 | 102 | 119 |

## Decisão que muda a ordem (precisa do dono)

**D1. Destino das lojas reais.**
- (a) **Continuar no Omie e espelhar melhor** (recomendado agora). As lojas 2–7 seguem no Omie. O Norte Estoque fica um "Omie melhor" de leitura, relatório e correção. O que importa aqui: Fases A, C (sem fiscal), D e o relatório de CMV.
- (b) **Sair do Omie, loja por loja.** O estoque próprio vira o ERP. Para isso viram obrigatórias as Fases B, E e F inteiras: entrada fiscal completa, contas a pagar e a receber, conciliação, pacote do contador e devolução ao fornecedor. É o caminho da ODARA hoje.

A ordem abaixo serve às duas. Se o dono escolher (b), a Fase E sobe para logo depois da B.

## Fase A — Corrigir o que já está provado errado (1–2 semanas, tamanho P)

Tudo com divergência numérica provada ou bug citado no código. Nada aqui muda o desenho do app.

1. **Saldo em data e ordem do kardex** [G2.5/L14]: migration 173 + `reordenarPagina`, já feitos na branch `paridade-omie` (validado nos 100.603 movimentos reais, 7.067/7.067 dias certos).
2. **Valor do estoque com custo por local** [G2.1/L8]: `valorPorLocal`, já na branch. Na loja 5 a tela mostrava R$ 1.810,97 a mais.
3. **Custo médio com saldo negativo** no estoque próprio [G2.3]: migration 174, já na branch.
4. **Religar o espelho completo da loja 5** [G2.4a]: o kardex parou em 09/10 e tem 86 quebras de cadeia; precisa reler o período parado.
5. **Valor das compras igual ao valor de estoque do Omie** [G1.1]: hoje os relatórios usam quantidade × preço unitário. A regra N3 (valor do item, que já vem sem o desconto, − créditos conforme as 8 marcações), provada em 99,3% (quantidade × preço bate só 83,8%), entra em Compras, Indicadores, Notas e PPTX, com coluna "valor fiscal" × "valor de estoque".
6. **Itens marcados "não movimenta estoque" / "não gera conta a pagar"** [G1.4/C6/C7]: saem de Compras, Indicadores e Movimentação, como no Omie.
7. **Venda → estoque sem duplicar** [H11]: o código da OP passa a ser derivado do pedido (hoje usa a hora); o estorno deixa de depender de log podado.
8. **Entrada manual com custo digitado e motivo de perda** [L3/G2.6]: entrada no Omie aceita valor unitário; perda sai como PER (hoje tudo vira INV).
9. **Nota cancelada no estoque próprio** [F12]: estorna o que foi lançado e bloqueia lançamento automático de XML cancelado.
10. **Lançamento manual de compra sem duplicar** [A5]: chave idempotente no formulário.
11. **Fornecedor do XML vira cadastro** [B1/J1]: a nota da SEFAZ/XML cria ou liga o fornecedor (hoje `n_id_fornecedor` fica nulo).
12. **Bugs menores já citados**: relatório de produção com fim de mês `-31`; Lucro cortado em 1.000 linhas [N9/R1]; `produtos_repor` sem paginação e sem filtro de inativo [N5].
13. **Infra**: `SUPABASE_DB_URL` do servidor aponta para o banco antigo (Cloud). Qualquer script que use essa variável lá mexe no banco errado.

## Fase B — Entrada de nota fiscal completa (o pedido "até a parte notas fiscais") (4–6 semanas)

Meta: a entrada de NF do Norte Estoque faz tudo o que o cartão de recebimento do Omie faz (abas Dados, Itens, Transporte, Totais, Parcelas, Departamentos, Informações adicionais, Observações; editor do item; 8 marcações de custo).

1. **Custo de estoque por item com as 8 marcações do Omie** [D14/G1.2]: IPI, ICMS, ICMS-ST, PIS, COFINS (com alíquota de crédito), frete, seguro e outras despesas, cada um "entra no custo: sim/não" por item. Sugestão automática por regime e CFOP, editável. Fórmula N3 provada.
2. **Quantidade recebida ≠ quantidade da nota** [D3]: entrega parcial, unidade de estoque e fator por item, com tabela de unidades [D4/K14/G1.3].
3. **Local de estoque por item** [C3]: bar e cozinha na mesma nota.
4. **CFOP de entrada por item** [C4], sugerido pelo CFOP do fornecedor, para auditoria fiscal e relatórios por CFOP no estoque próprio.
5. **Categoria por item e "gera conta a pagar / movimenta estoque" por item** [C6/C7], prontos para a Fase E.
6. **Manifestação do destinatário completa** [F8]: Confirmação (210200), Desconhecimento (210220) e Operação não realizada (210240), além da Ciência. O botão "Manifestar" das lojas Omie é renomeado para o que ele faz ("Concluir recebimento").
7. **Validar a captura da SEFAZ ao vivo** [A2] com o certificado da ODARA (primeira consulta real, cStat 138/137, ciência 135). Precisa de OK do dono.
8. **Quadro de etapas do recebimento** [A1] (a conferir → conferida → lançada), com histórico de processamento [F9].
9. **CT-e de frete** ligado à nota (rateio do frete no custo) e importação por chave digitada [A4].
10. **Validação do XML importado** [A6]: protocolo, assinatura, ambiente; recusar nota emitida pela própria loja.

## Fase C — Compras: requisição, pedido, aprovação e sugestão (4–6 semanas)

1. **Pedido de compra** [I2]: fornecedor, itens (quantidade, preço combinado, local, unidade), previsão de entrega, parcelas, frete; imprimir/enviar ao fornecedor [I4]. Nas lojas Omie é gravado no Omie (`pedidocompra`); no estoque próprio, local.
2. **Conferência pedido × nota** (3 vias: pedido, nota, recebido) e "quantidade recebida" por item do pedido.
3. **Requisição de compra** [I1] e **aprovação** [I3] (gerente pede, dono aprova).
4. **Sugestão de compra** [I6]: consumo médio diário, duração do estoque, lead time, ponto de pedido, entradas previstas (pedidos abertos) e saídas projetadas (previsão de venda + OPs). Hoje só existe "mínimo − saldo".
5. Importar pedidos por planilha [I5] (baixa prioridade).

## Fase D — Relatórios que faltam (3–4 semanas)

1. **CMV/CPV para todas as lojas** [N9]: hoje as lojas Omie só têm margem teórica.
2. **Movimentação valorizada pelo valor do movimento** [N13], não pelo último preço de compra.
3. **Posição de estoque** [N6]: exportação, um total só, linhas zeradas, reservado; **posição tipo SPED (Bloco H)** para o contador [N7].
4. **Curva ABC por valor e por quantidade** [N10/N11].
5. **Saldo em data para todas as lojas** [L7]: estender o espelho completo do kardex às lojas 2, 3, 6 e 7 (a loja 4 fica fora, por regra). Isso também resolve as movimentações reconstruídas [L24].
6. Os demais relatórios do Omie marcados como faltando na matriz (produtos por fornecedor, compras por categoria/departamento, devoluções etc.), na ordem de impacto.

## Fase E — Financeiro (6–10 semanas; obrigatória se D1 = sair do Omie)

Ordem por dependência:
1. Contas correntes e caixas por loja.
2. Categorias com conta de DRE.
3. **Contas a pagar** (cadastro manual + geradas pela NF de entrada, uma por parcela) [E6].
4. Baixa (pagamento) e aprovação de pagamentos.
5. **Contas a receber geradas pelas vendas** (cartão, PIX, apps, convênio), com taxa da adquirente.
6. Conciliação de cartões e extrato OFX.
7. Relatórios: em aberto, realizados, atrasados, fluxo de caixa, DRE e resumo de finanças.

Atalho para as lojas que ficam no Omie: assinar os webhooks `Financas.ContaPagar.*`/`ContaReceber.*` e mostrar o financeiro do Omie dentro do app (só leitura), em vez de construir tudo.

## Fase F — Fiscal de saída e contador (sob demanda; tamanho XL)

1. **Devolução ao fornecedor** [H1] (NF-e de devolução; hoje "Desfazer entrada" apaga a compra). Registro sem NF-e: migration 231 (19/10). NF-e: migration 260 + `lib/nfe-saida` (20/10, plano `2026-10-20-fase-f-nfe-saida.md`; só homologação até o OK do dono).
2. **Remessa / transferência entre lojas com nota** [H4]. Migration 261 + `/transferencia-loja` (20/10, mesmo plano).
3. **Pacote do contador**: XMLs do período, SPED/Bloco H, livro de entradas.
4. **Fechamento de período** (trava edição de meses fechados; hoje só há aviso).
5. Painel NFC-e do estoque próprio: importação de XML e apuração.

## Fase G — Recursos transversais (contínuo)

Anexos nos registros [O2], histórico de alterações campo a campo [O3], notificações (validade, estoque baixo, nota parada, erro de integração), resumo diário por WhatsApp, departamentos/centros de custo, importação de produtos e fornecedores por planilha [K10/O6], editar EAN/CEST/origem do produto depois de criado [K1], duplicar produto/OP [K9/M6], webhooks do Omie que hoje são ignorados (`Produto.*`, `CompraProduto.*`, `NFe.*`, `Financas.*`).

## Os dois modos do Norte Estoque

Cada item vale para um modo, ou para os dois:
- **Conectado ao Omie (espelho):** lojas 2–7. O Omie é a verdade. O Norte Estoque lê, relata e corrige pelo Omie.
- **Independente (estoque próprio):** loja 15, ODARA, e qualquer loja que sair do Omie. O Norte Estoque é o próprio ERP.

| Fase | Conectado ao Omie | Independente |
|---|---|---|
| A | A1, A2, A4–A8, A12, A13 | A3, A9–A12, A13 |
| B | B5 (relatórios), B6 (renomear botão) | tudo |
| C | pedido gravado no Omie, sugestão, aprovação | tudo, local |
| D | tudo | tudo |
| E | E0 (financeiro do Omie, só leitura) | E1–E7 |
| F | — (o Omie emite) | tudo |
| G, H, I | tudo | tudo |

Toda tarefa testa os dois modos. Nenhuma mudança no modo independente pode alterar o comportamento do modo Omie, e vice-versa (despacho por `modo_estoque`, como em `lib/estoque/nf-despacho.test.ts`).

## Fase H — Auditoria de cibersegurança (no fim, depois das fases de construção)

Revisão completa e independente, com correção de tudo o que for encontrado:
1. **Acesso:** RLS de todas as tabelas (incluindo as novas), permissões por ação, cargos, loja 4 e lojas de teste; tentar ler e escrever dado de outra loja como usuário comum.
2. **Segredos:** chaves do Omie, certificado A1 e senha, `integracao_api_key`, chaves do Supabase; nada no navegador (achado conhecido: chaves do Omie enviadas para a tela `/loja`), nada em log, nada no build do desktop.
3. **Entradas:** webhook do Omie sem assinatura, rotas `/api/integracao/*`, `/api/offline/*`, `/api/correcoes/ingest`, upload de XML (XXE, tamanho, assinatura), CSV/Excel (injeção de fórmula).
4. **Servidor e banco:** portas abertas no Contabo, senha do Postgres (achado aberto: senha pública), `SUPABASE_DB_URL` errada, backups (existem, restauram?), TLS, cabeçalhos HTTP, limite de requisições, 2FA para admin.
5. **Dependências:** `npm audit`, versões de Next/Electron, assinatura do instalador do desktop.
6. **Relatório:** achados por gravidade, prova de cada um e correção com teste. Nada é testado contra produção sem OK.

## Fase I — Velocidade (no fim, junto com a H)

1. Medir no servidor, como usuário logado (padrão de 08/10), o tempo de cada tela e de cada relatório; meta de menos de 1 s nas telas do dia a dia.
2. Consultas lentas: `pg_stat_statements`, índices que faltam, RLS no padrão initplan em todas as tabelas novas, RPCs que agregam antes de juntar.
3. Leituras em lote: acabar com consultas uma por uma, paginar em ondas paralelas, cortar chamadas ao Contabo quando o banco principal já tem o dado.
4. Tela: carregamento em partes (streaming), cache por requisição, menos JavaScript no navegador, imagens e fontes.
5. Crons: tempo e chamadas ao Omie por ciclo, sem estourar o limite de uso da chave.
6. Antes × depois em tabela, tela por tela.

## Fora de escopo (o dono decide)

CRM (oportunidades, contas, contatos), serviços/NFS-e, contratos, ordens de serviço, MDF-e, boletos/CNAB, kits, Omie Drive e as preferências exclusivas do CRM. Estão listados nas matrizes com o motivo; nada foi descartado.

## Regras que valem para todas as fases

- Deploy é manual (`deploy.sh`), só depois de testado e com OK do dono no chat. Migration só com backup e OK. Depois de cada migration, recarregar o cache do PostgREST.
- Conferir sempre no `.env.local` do deploy qual banco está sendo usado.
- Escrita no Omie de produção só com OK explícito para aquela ação; testar antes na loja de teste (escrita simulada).
- Não mexer na Central de correções.
- Cada correção vem com teste e com a prova numérica dos dois lados (Omie × nosso).
