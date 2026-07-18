# Auditoria total de telas × lojas (pós-incidente Movimentação)

Pedido: auditoria completa de TODAS as telas com número agregado (9 relatórios
do hub + 6 telas operacionais), em TODAS as 6 lojas ativas, com print de tela
como evidência e cada número validado contra o dado real (SQL/Omie), corrigindo
na hora qualquer bug achado.

## Gatilho

O usuário mandou print do relatório de Movimentação (loja 5, "Em quantidade")
mostrando números com 50+ dígitos sem sentido. Causa raiz encontrada e já
corrigida nesta sessão: `agregarMovimentacaoJS` (`lib/historico-contabo.ts`)
somava `entradas`/`saidas` vindos do Contabo sem `Number()` — o driver `pg`
cru só normaliza `bigint`/`date` (ver `server.js`), não `numeric`, então os
valores chegavam como string e `+=` concatenava em vez de somar.

Isso é o **3º bug real e distinto** encontrado em código de relatório nesta
sessão que eu tinha declarado "funcionando" sem verificar a fundo:
1. Corte de 1000 linhas do PostgREST/Supabase-JS sem paginação (Faturamento,
   Estoque Valorizado).
2. Chave de agregação com delimitador `"|"` que colide quando o rótulo
   (nome de produto) contém esse caractere (Faturamento, Movimentação).
3. `numeric` do Postgres/Contabo chegando como string e corrompendo somas
   com `+=` (Movimentação).

Conclusão: contagem de linhas ou "parece certo" não é verificação suficiente.
Esta auditoria exige prova visual (print) + numérica (comparação com SQL/API
direto) pra cada tela, em cada loja.

## Escopo

**15 telas**, cada uma testada nas 6 lojas ativas (2, 3, 4, 5, 6, 7 — loja 4
só leitura, nunca escrita ao vivo):

Relatórios do hub: Faturamento, Movimentação (2 modos: quantidade e por
operação), Compras, Margem, Estoque Valorizado, Indicadores (Fat×Compras),
Auditoria Fiscal, Resumo do dia, Pendências de Classificação.

Telas operacionais: Notas Fiscais, Ordens de Produção, Transferências,
Inventários, Produtos (+ export), Home.

## Decisões (aprovadas)

1. **Um agente por tela** (15 agentes), cada um cobrindo as 6 lojas e todas
   as dimensões/filtros/abas relevantes daquela tela especificamente.
2. **Prova exigida por achado**: screenshot (Playwright) + comparação
   numérica contra SQL direto (`node scripts/db.mjs`) ou chamada real à API
   do Omie — mesmo padrão usado nesta conversa pra achar e confirmar os 3
   bugs anteriores.
3. **Corrige na hora**: cada agente que achar um bug real aplica o fix,
   verifica com dado real, e reporta o que mudou — mesmo fluxo já usado hoje
   (sem esperar um "lote" de correções depois).
4. **Sempre usar a conta QA** (`claude.qa@ntb-estoque.dev`), trocando
   `current_loja_id` via SQL direto pra cobrir as 6 lojas, restaurando pro
   valor original ao final de cada agente.
5. **Nunca escrita ao vivo na loja 4** — só leitura/visualização nessa loja
   (regra já estabelecida no projeto).

## Como cada agente reporta

Cada agente devolve, por tela: lista de lojas testadas, prints tirados,
qualquer inconsistência encontrada (com a prova), o que foi corrigido (com
commit), e o que ficou íntegro (sem achado).
