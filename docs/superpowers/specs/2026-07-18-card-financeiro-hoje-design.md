# Card financeiro "hoje" + meta configurável (Onda 2, item 3)

Pedido: card financeiro "hoje" no relatório de Indicadores (`relatorio-indicadores`,
hoje "Fat × Compras") via `ObterResumoFinancas` (1 chamada ao Omie, sem
sync/tabela nova) e tornar a meta compras/faturamento (hoje hardcoded no
código) configurável por loja.

## Contexto (já levantado, não repetir)

- `ObterResumoFinancas` (endpoint `v1/financas/resumo`, mesmo padrão
  `omieRequest` já usado no resto do projeto) aceita só `{ dDia: 'DD/MM/AAAA' }`.
  Testado ao vivo (lojas 3 e 7), resposta real:
  ```json
  {
    "dDia": "17/07/2026",
    "contaCorrente": { "vTotal": -1813134 },
    "contaPagar":   { "nTotal": 570,  "vAtraso": 748239.08, "vTotal": 755731.45 },
    "contaReceber": { "nTotal": 3611, "vAtraso": 677001.73, "vTotal": 680542.03 },
    "fluxoCaixa": [ { "dDia": "17/07/2026", "vPagar": 755731.45, "vReceber": 680542.03, "vSaldo": -2102906.36 }, /* +9 dias */ ]
  }
  ```
  `contaCorrente` é **um número agregado**, sem detalhe por conta bancária.
  `contaPagar`/`contaReceber` são o total de **todos os títulos em aberto**
  (não só os que vencem hoje), com `vAtraso` como o subconjunto vencido.
  `fluxoCaixa` é uma projeção de 10 dias a partir de `dDia` — só previsto,
  sem "realizado".
- O saldo de conta corrente veio **−R$1,81M** em ambas as lojas testadas —
  achado já registrado no spec mestre como possível conta não conciliada
  no Omie. Não é bug do nosso código; é um dado real do Omie que precisa de
  contexto visual, não escondido.
- `relatorio-indicadores/page.tsx` já tem `const META_PCT = 40` (hardcoded,
  colore a célula compras÷faturamento em ok/aviso/erro) e já tem um padrão
  de "pills" de estatística no topo da tela (Faturado/Comprado/Compras÷Fat/Meta).
- Não existe hoje nenhuma tabela/coluna de meta ou config numérica em
  `lojas`. O padrão de edição de configuração de loja já estabelecido é
  `app/(app)/minha-loja/page.tsx` + `components/minha-loja/InformacoesForm.tsx`
  + `lib/actions/minha-loja.ts` (`editarLojaNegocio`, permissão via
  `getAtorGestao().isAdminGlobal` + `lojaIds.includes`).
- Migrations 052-054 já escreveram tabelas (`contas_pagar`, `contas_receber`,
  `contas_correntes`) e RPCs (`financeiro_resumo_cr`, `financeiro_fluxo_caixa`)
  pra um sync financeiro completo, mas **nunca foram ligadas a nenhuma tela**
  — isso é o escopo da Onda 3 (sync incremental completo), fora desta spec.
  Esta spec não usa essas tabelas; a chamada é sempre ao vivo.

## Decisões (brainstorm, aprovadas)

1. **Saldo com aviso visual quando negativo**, não escondido. Um selo/tooltip
   "pode estar desconciliado no Omie" aparece quando `contaCorrente.vTotal < 0`.
2. **Os 3 blocos juntos no card**: saldo em conta, total a pagar/receber em
   aberto (atraso destacado), fluxo de caixa projetado dos próximos 5 dias
   (de 10 disponíveis — mantém o card compacto).
3. **Meta = tornar o `META_PCT` existente editável por loja**, não uma
   métrica nova. Coluna nova `lojas.meta_compras_pct numeric check
   (meta_compras_pct between 0 and 100)`, nula por padrão (nulo = mantém o
   comportamento atual de 40%, sem quebrar nenhuma loja que não configurar).
   Editável em "Minha loja", mesmo padrão de `editarLojaNegocio`.
4. **Chamada sempre ao vivo, sem persistência** — sem tabela nova, sem cron,
   sem cache. Se a chamada ao Omie falhar (rate limit, timeout, erro de
   rede), o card degrada silenciosamente (não aparece, ou aparece um
   estado "indisponível agora") — a página nunca quebra por causa disso,
   mesmo princípio de resiliência já usado em `buscarFrio`/`gravarFatoNoFrio`.

## Arquitetura

```
relatorio-indicadores/page.tsx
  │
  ├─ buscarResumoFinanceiroHoje(loja) [lib/omie/financeiro-resumo.ts, novo]
  │    → omieRequest({ endpoint: 'v1/financas/resumo', call: 'ObterResumoFinancas',
  │                     data: { dDia: hojeFormatado } })
  │    → nunca lança erro: falha retorna null, o card some da tela
  │
  ├─ card "hoje" (JSX novo, topo da página, acima da matriz atual)
  │    saldo (+ selo se negativo) | a pagar/receber (+ atraso) | fluxo 5 dias
  │
  └─ META_PCT hardcoded → loja.meta_compras_pct ?? 40
       (loja já vem carregada via getCurrentLojaId + query de lojas nesta página)

app/(app)/minha-loja/page.tsx + InformacoesForm.tsx + lib/actions/minha-loja.ts
  └─ campo novo "Meta de compras/faturamento (%)", editarLojaNegocio grava
     lojas.meta_compras_pct (clamp 0-100, igual ao padrão de fonte_escala)
```

## Testando

Sem suite automatizada neste repo (mesmo padrão do resto do projeto).
Verificação manual: chamada real a `ObterResumoFinancas` numa loja de teste
(3 ou 7, nunca 4 pra testes ao vivo), conferir os 3 blocos do card
renderizando com o dado real; editar a meta em "Minha loja" e conferir que
`relatorio-indicadores` reflete o novo valor na coloração da célula;
simular falha da API (ex.: credenciais erradas temporárias) e conferir que
a página carrega normalmente sem o card.
