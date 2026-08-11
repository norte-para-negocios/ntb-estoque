# Nomenclatura SEFAZ + auditoria completa do Faturamento — Design

**Data:** 2026-08-10

**Gatilho:** continuação direta da sessão de hoje. Depois de corrigir 2 bugs
reais no Faturamento (cupom cancelado que nunca atualizava; cupom que some
inteiro da Omie), o usuário pediu (1) trocar a nomenclatura do filtro de
Situação pra bater com o vocabulário oficial da SEFAZ, e (2) uma auditoria
completa do Faturamento pra achar qualquer outro "dado lixo" residual, com
um mecanismo que detecte esse tipo de problema automaticamente daqui pra
frente — não só correção manual pontual como a de hoje.

## Contexto já estabelecido (não re-investigar)

- `fat_cupons`/`fat_cupom_itens`/`fat_cupom_pagamentos` (Postgres nativo do
  Contabo, `ntb_frio`) guardam o fato granular do cupom fiscal, desde
  2025-07-01 (backfill histórico único, fora do repo, 2026-07-18).
  `faturamento_importado` (Supabase) é o pré-agregado, só cobre o ano
  corrente (2026).
- Bug 1 (corrigido hoje, commit `437bf7c`, deployado): `syncFaturamento`
  (`lib/omie/faturamento.ts`) tinha um `continue` que pulava o cupom
  cancelado ANTES de gravá-lo no fato — cupom cancelado depois da 1ª sync
  nunca atualizava. Corrigido: `cancelado`/`devolvido` computados uma vez,
  push do cabeçalho acontece antes do `continue`.
- Bug 2 (corrigido hoje, manual, ainda sem proteção automática): cupom que
  desaparece INTEIRAMENTE da consulta da Omie (não aparece nem como
  cancelado — simplesmente some) fica "fantasma" no fato, contando como
  Normal pra sempre. Achados e corrigidos manualmente 5 casos (loja 2: 2,
  loja 3: 2, loja 6: 1), confirmados via busca ao vivo na Omie (maio-agosto,
  64 páginas, nenhum rastro) antes de cada `UPDATE fat_cupons SET
  cancelado=true WHERE loja_id=X AND n_id_cupom=Y AND cancelado=false`.
- Verificação feita hoje: comparação `faturamento_importado` (pré-agregado)
  vs. fato-Normal recalculado, TODAS as 6 lojas, TODOS os meses de 2026
  (jan-ago) — só achou gap em loja 2 (jul/ago), loja 3 (jul/ago) e loja 6
  (jul). Todos os gaps batiam exatamente com os 5 cupons fantasmas. Depois
  da correção, os 3 lados batem centavo a centavo.
- Achado NÃO investigado ainda: loja 2 não tem nenhuma linha (nem
  pré-agregado, nem fato) pro mês de 2026-06 inteiro.
- Limitação conhecida: a comparação de hoje só cobre 2026 (única janela em
  que existe uma segunda fonte, o pré-agregado, pra comparar). O histórico
  2025-07 a 2025-12 nunca foi verificado dessa forma.

## Parte 1: Renomeação (Situação)

Troca só o RÓTULO exibido ao usuário — o valor interno usado no código e na
URL (`sp.status`: `'NORMAL' | 'DEVOLVIDO' | 'CANCELADO' | 'TODOS'`)
permanece EXATAMENTE como está. Isso evita qualquer risco de quebrar link
salvo, filtro ativo por query string, ou comportamento do export.

| Valor interno | Rótulo atual | Rótulo novo |
|---|---|---|
| `NORMAL` | Normal | **Autorizada** |
| `CANCELADO` | Cancelado | **Cancelada** |
| `DEVOLVIDO` | Devolvido | **Devolvida** |
| `TODOS` | Todos | Todos (sem mudança) |

"Autorizada" é o termo oficial que a SEFAZ usa pro status de uma NFC-e
válida (par oficial: Autorizada/Cancelada/Denegada). "Cancelada"/"Devolvida"
ajustadas pra concordância de gênero (nota, não cupom).

**Onde aplicar** (buscar TODAS as ocorrências visíveis ao usuário, não só a
lista abaixo — usar grep como checklist mínimo, não teto):
- `app/(app)/relatorio-faturamento/page.tsx`: array de opções do campo
  Situação (`campos`), labels do `ChipsStatus` (modo "Ver cupons"), texto de
  ajuda ("Ative Ver cupons para ver e filtrar por situação
  (Normal/Cancelado/Devolvido/Todos)."), mensagem de estado vazio quando
  `statusCupomSel === 'DEVOLVIDO'` sem resultado.
- `app/(app)/relatorio-faturamento/export/route.ts`: subtítulo da planilha
  que menciona o status.
- Comentários no código que citam os nomes antigos (não precisam mudar
  funcionalmente, mas ajustar pra não confundir leitura futura, especialmente
  onde o comentário é sobre o VALOR exibido, não o enum interno).

**Fora de escopo:** mudar o enum interno (`NORMAL`/`CANCELADO`/`DEVOLVIDO`),
qualquer nome de coluna/tabela (`fat_cupons.cancelado`,
`fat_cupons.devolvido` continuam como estão), nomenclatura em
`relatorio-compras`/`relatorio-indicadores` (que usa outro vocabulário,
`CONCLUIDA`/`PENDENTE`/`CANCELADA`/`MANIFESTADA`, já correto pra NF de
entrada — só a NFC-e de venda usa Autorizada/Cancelada/Devolvida).

## Parte 2: Auditoria completa + reconciliação automática

### 2.1 Investigar o buraco de junho/2026, loja 2

Antes de tudo: confirmar se é sync que falhou silenciosamente ou loja
genuinamente fechada/sem movimento naquele mês. Checar: (a) logs do cron
daquele período (se ainda existirem), (b) consultar a Omie ao vivo pro
período de junho/2026, loja 2, e ver se existe cupom de verdade. Se existir
cupom real na Omie que nunca foi importado, isso é um 3º bug (sync pulou o
mês inteiro) — se não existir nada, é dado real (loja fechada/sem venda) e
não precisa de correção, só documentar.

### 2.2 Auditar o histórico completo (2025-07 a 2025-12) contra a Omie ao vivo

Mesma técnica já validada hoje (comparar o conjunto de `id_item` que a
Omie retorna AGORA, pra um loja+mês, contra o que está gravado em
`fat_cupom_itens` pra cupons `cancelado=false`/`devolvido=false` daquele
loja+mês — qualquer item no banco que não aparece mais na Omie é órfão).
Sem pré-agregado pra comparar nesses meses, então a checagem é direta
contra a Omie, não contra uma segunda fonte local.

Escopo: 6 lojas × 6 meses (2025-07 a 2025-12) = até 36 combinações. Cada
uma custa uma consulta paginada à Omie (rate limit ~340ms/página, meses
históricos tendem a ter menos cupons que os recentes). Rodar como script
ad-hoc (mesmo padrão dos scripts de reconciliação já usados nesta sessão),
via SSH, sem trazer credencial pro lado local. Qualquer cupom fantasma
encontrado: mesmo tratamento de hoje — `UPDATE fat_cupons SET
cancelado=true WHERE loja_id=X AND n_id_cupom=Y AND cancelado=false`, nunca
`INSERT`/`DELETE`, nunca outro campo.

### 2.3 Reconciliação automática (proteção daqui pra frente)

Ao invés de um cron novo separado (que gastaria chamadas extras à Omie),
estender `syncFaturamento` (`lib/omie/faturamento.ts`) pra reaproveitar o
fetch que ELE JÁ FAZ todo mês, todo run: depois de montar `cuponsBulk` (o
conjunto de cupons que a Omie retornou agora pra aquele loja+mês), comparar
contra os `n_id_cupom` que já existem em `fat_cupons` pra aquele mesmo
loja+mês com `cancelado=false`. Qualquer `n_id_cupom` que estava no banco
mas NÃO veio na resposta desta vez é candidato a "sumiu da Omie" — marcar
`cancelado=true` nele (mesmo UPDATE mínimo, mesma regra de ouro).

Isso não custa nenhuma chamada extra à Omie (reusa o fetch que já existe) e
roda automaticamente a cada sync (cron horário) — qualquer cupom que sumir
da Omie no futuro é pego e corrigido dentro de, no máximo, 1 hora, sem
intervenção manual.

**Cuidado de design:** essa comparação só é segura pro mês/loja que está
SENDO reprocessado no momento (`mes` do loop atual) — nunca aplicar a
mesma lógica pra meses fora do loop de `syncFaturamento` (ele só processa
o ano corrente), senão marcaria como sumido qualquer cupom de mês antigo só
por ele não aparecer numa busca que nunca o incluiu.

### 2.4 Documentação

- Atualizar `AGENTS.md` com uma seção nova, mesmo padrão das já existentes
  nesta sessão: causa raiz dos 2 bugs, achado do buraco de junho (o que
  for confirmado), números finais da auditoria de 2025 (quantos cupons
  fantasmas encontrados/corrigidos por loja/mês), e a descrição do
  mecanismo de reconciliação automática novo.
- Fechar o ledger do plano anterior
  (`.superpowers/sdd/2026-08-10-fix-cancelado-fato-faturamento/progress.md`)
  com um apontamento pra este plano novo, já que ele absorve o que faltava
  (documentação + reprocessamento retroativo, que na prática já foi feito
  de forma mais ampla que o Task 2 original previa).

## Fora de escopo (explícito)

- Investigar por que `devolvido` nunca vem `true` da Omie (achado antigo,
  já registrado como pendência em revisão anterior).
- Qualquer mudança na Compras/Auditoria Fiscal/Indicadores (vocabulário
  `CONCLUIDA` já correto, não é NFC-e).
- Reagregar `faturamento_importado` por causa dos cupons fantasmas
  corrigidos — o pré-agregado já excluía esses cupons desde sempre (é
  exatamente por isso que ele serviu de régua pra achar o bug); não precisa
  de correção.
