# Roadmap em fases: NTB Estoque rumo a substituir o ERP

Plano de evolução. Não executa nada. Cada fase é um bloco fechado, ordenado por
dependência e valor. Insumo para a gente alinhar antes de começar.

## Princípios que guiam o plano

1. **Não quebrar o que já está em uso.** O cliente (Renato, loja do livro) já começou. Estabilidade antes de novidade.
2. **Custo zero.** Só free tier (Supabase, Vercel, WhatsApp via Evolution). Nada pago sem aprovação.
3. **Omie é a fonte fiscal.** Onde a API deixa escrever, a gente escreve de volta. Onde não deixa (NF, custo, família), o NTB mantém a verdade operacional e sinaliza o que corrigir no Omie.
4. **Cada fase entrega algo usável.** Nada de fase que só "prepara" sem o cliente sentir.

## Decisões do fundador (20/06)

- **Fase 5 (fiscal) fica fora por ora.** Entra quando o certificado por loja estiver no ar.
- **Não mexer na home "do nada".** Só mudar a home se for utilidade clara, nunca redesign por estética.
- **Nada de valores (R$) ainda.** O custo (CMC) está furado na fonte (Omie), então qualquer coisa monetária (relatório financeiro, margem, faturamento, valor estimado) fica ADIADA até o custo ser corrigido. Por enquanto o foco é QUANTIDADE e OPERAÇÃO. "Parar de mostrar valor errado" é permitido (e necessário); "construir feature de valor" não.

## Visão geral

| Fase | Objetivo | Depende do Ramon/Omie? |
|---|---|---|
| 0. Confiança no uso diário | O que já roda não trava nem mente | Não |
| 1. Tudo editável de verdade | Criar/editar/excluir/gerir tudo | Parcial (OP parcial) |
| 2. Dados confiáveis e auditáveis | Número certo + quem fez o quê | Sinaliza; correção é no Omie |
| 3. Visão de dono | Abrir o sistema e entender o negócio | Não (alertas usam free tier) |
| 4. Menos dependência do Omie | Editar no NTB reflete no Omie | Muito (validar/testar com Ramon) |
| 5. Fiscal (entrada de NF) | Receber nota pelo sistema | Sim (certificado + SEFAZ) |

---

## Fase 0 — Confiança no uso diário

**Objetivo:** quem está usando agora opera sem susto. Dado não mente, tela não trava.

- Total de Movimentações ignora CMC suspeito (parar de inflar o R$). Marca o produto como "custo não confiável" em vez de somar.
- Placar de integração separa "sem custo" de "erro" (hoje conta junto e parece falha eterna).
- Confirmar ao finalizar contagem quando há itens sem quantidade ou com erro (resumo antes de fechar).
- Travar duplicação de envio no input de quantidade (blur + botão +/- disparando junto).
- Duplicar inventário/transferência preservando data e responsável.
- Folga de espaçamento nos PDFs (colunas coladas).

**Depende:** nada do Omie. 100% nosso.
**Pronto quando:** uma semana de uso real sem reporte de dado errado ou trava.

## Fase 1 — Tudo editável de verdade

**Objetivo:** criar, editar, excluir e gerir tudo, sem nada "travado". A promessa do "tudo editável".

- Editar local de estoque (edição local; o Omie não altera local via API).
- Excluir OP concluída por permissão, com fluxo claro (hoje exige reverter antes na mão).
- OP: concluir parte e deixar o saldo pendente na MESMA OP (o Omie permite; falta confirmar o parâmetro da API com o Ramon).
- Revisar e padronizar o gating de edição por permissão em todas as entidades (consistência: quem tem permissão edita, inclusive registro concluído).
- Coluna "Responsável" nas listas de inventário e transferência.

**Depende:** parcial do Ramon (parâmetro da OP parcial).
**Pronto quando:** cada entidade tem criar/editar/excluir óbvios; nada bloqueado sem motivo.

## Fase 2 — Dados confiáveis e auditáveis

**Objetivo:** o número está certo e dá para saber quem fez o quê e quando.

- Trilha de auditoria consultável: criação/edição/exclusão de produto, transferência, inventário, OP, com usuário e horário.
- Tratamento de custo: marcar CMC suspeito, não somar no total, e gerar um relatório "produtos com custo furado" (saldo negativo / custo errado) para o Ramon corrigir no Omie.
- Reconciliação de status como máquina de estados no servidor (inventário/transferência/OP), para o status nunca ficar inconsistente após editar concluído.
- Mostrar o saldo do produto na hora da contagem.

**Depende:** a correção do custo na fonte é do Ramon; o sistema aponta exatamente o que corrigir.
**Pronto quando:** o total bate com a realidade e toda ação tem dono e data.

## Fase 3 — Visão de dono (só o que NÃO envolve valor por enquanto)

**Objetivo:** enxergar a operação sem precisar do Omie. Sem dinheiro até o custo ser corrigido.

PODE AGORA (sem valor):
- Alertas quando o produto bate o mínimo (baseado em QUANTIDADE, não em R$).
- Vencimentos próximos e contagens/OPs abertas (operacional, sem dinheiro).
- Exportar XLSX de transferência e inventário (quantidade; sem coluna de valor por ora).
- Resumo do dia refinado (já existe), sem os blocos de valor.

ADIADO (envolve valor, espera o custo ser corrigido no Omie):
- Relatórios financeiros: faturamento por período/família, margem, consumo x compra, curva ABC.
- Qualquer painel/coluna de R$.

NÃO FAZER por estética:
- Redesign da home "do nada". Só ajustar a home se for utilidade concreta (ex.: card de ruptura por quantidade), nunca por visual.

**Depende:** nada pago. **Pronto quando:** o dono acompanha a operação (quantidade, ruptura, validade) sem abrir o Omie.

## Fase 4 — Menos dependência do Omie

**Objetivo:** onde a API deixa, editar no NTB reflete no Omie. Onde não deixa, caminho decidido e documentado.

- AlterarProduto no Omie: editar produto no NTB altera lá também (validar e testar com o Ramon).
- Escrita de família/fornecedor no Omie, se a API permitir; senão, manter local oficial e documentar.
- Estoque mínimo: como o Omie não aceita escrita, oficializar o override local do NTB como a verdade operacional, com relatório de divergência para conferência.

**Depende:** muito de teste com o Ramon (escrita real no Omie, risco de produção).
**Pronto quando:** editar no NTB reflete no Omie em tudo que a API permitir.

## Fase 5 — Fiscal (entrada de NF) — FORA DO ESCOPO POR ORA

Decisão do fundador (20/06): não fazer agora. Entra quando o certificado A1 por loja estiver no ar.

**Objetivo:** receber nota fiscal pelo próprio sistema.

- Certificado A1 por loja (upload já existe) ligado à manifestação/consulta na SEFAZ.
- Lançamento de NF de entrada em poucos cliques.

**Depende:** certificado .pfx por loja e integração SEFAZ.
**Pronto quando:** a entrada de nota deixa de ser feita só no Omie.

---

## Sequência sugerida

Fase 0 já (estabiliza o uso atual). Fase 1 em seguida (fecha o "tudo editável" que o fundador mais cobra). Fase 2 junto/logo após (confiança no número). Fase 3 quando o operacional estiver redondo. Fases 4 e 5 dependem de janelas com o Ramon e do certificado, então entram quando esses destravarem.

Cada fase, quando for a vez, vira um plano de implementação detalhado próprio.
