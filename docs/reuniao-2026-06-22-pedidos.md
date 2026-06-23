# Reunião NTB — 22/06/2026 (Ramon × Joaquim)

Fonte: `C:\Users\media\Videos\2026-06-22 19-20-57.mp4` (≈33 min).
Transcrição: `C:\Users\media\Videos\ntb-reuniao-2026-06-22\transcricao.txt`.

## Decisão de prioridade (timeline)
- **Próximos 2–3 dias: SÓ relatórios** (os bugs já estão usáveis, o pessoal já consegue trabalhar).
- Depois disso: **Vendas** — o banco de vendas **já está no Supabase do André**; é só pegar com ele e integrar (não precisa import manual de venda).
- Depois de vendas: **rodada de correções** (lógica de correção de erros).

## Foco imediato — Relatório de Movimentação (refinar) ✅ FEITO (23/06)
O de Movimentação ainda não está no formato da planilha dele. Falta:
1. **Filtro por OPERAÇÃO/ORIGEM**: Movimento Manual de Estoque, Inventário, Transferência, Ordem de Produção, Compra. Hoje mistura tudo (toda entrada e toda saída).
2. **Dimensão Local de Estoque** (além de tipo SPED).
3. **Em VALORES (R$)** — feito via import do MOV_DRV, mas precisa casar com o filtro de operação.
4. **Visão de PERDAS** = movimento manual de saída (é o que ele mais quer enxergar).
5. **Transferências**: ver pra onde foi, em valores (entradas de transferência por local).

### Como ficou (modo "Por operação (R$)")
- **Fonte:** aba **BD** do MOV_DRV (935k linhas/160MB) — a ÚNICA com operação + local por
  movimento. A API ListarMovimentos do Omie NÃO traz operação nem local nem valor.
- **Import por script** (arquivo é grande demais p/ upload web): `node --max-old-space-size=4096
  scripts/importar-mov-bd.mjs <loja_id> "<MOV_DRV.xlsx>"` → grava agregados compactos
  (origem×sentido×local×tipo SPED×família×mês). Refaz tudo da loja (idempotente).
- **Validado:** baixa manual saída = **R$241.192,41**, idêntico à BAIXA RESUMO do Ramon.
- **Tela:** filtros Operação/Local/Sentido + cards (Perdas reais, Ajuste por inventário,
  Compras, Consumo de OP) + matriz mês a mês por família/local/tipo SPED + Baixar Excel.
- **PERDA REAL vs INVENTÁRIO:** a "baixa manual" do Ramon (R$241k) é 99% **ajuste de
  inventário** (R$239k); perda manual real é só **R$2.488,77**. A tela separa os dois.
- **PDV-saída:** valor distorcido no Omie (CMC podre de acabado) → mostrado como
  "não-confiável"; usar o modo quantidade para volume de venda.
- **Transferências:** nesta loja NÃO existe origem "Transferência" no Omie — transferências
  entre locais aparecem como Movimento Manual e/ou pelos pares de local. A dimensão "Por local"
  cobre "pra onde foi". CONFIRMAR com o Ramon se ele faz transferência por ajuste manual.
- **Import nas lojas de produção:** só a loja 3 (teste) foi importada. Rodar o script com o
  MOV_DRV de cada loja quando o Ramon mandar.

## Pedidos NOVOS (features)
1. **OP — recorrência (repetir)**: opções diário (todo dia), semanal (a cada 2/3/4 semanas), quinzenal, mensal (1/2/3 por mês).
2. **Cadastro — aba ESTRUTURA (ficha técnica / BOM)**: ao cadastrar **produto acabado** ou **produto em processo**, liberar a criação da estrutura ali. Só esses dois tipos têm estrutura.
3. **Cadastro — "vender no PDV / frente de loja"**: flag em informações adicionais ("vender através do cupom fiscal no PDV") para **produto acabado** e **revenda**. Só esses aparecem no PDV.
4. **Cadastro — estoque mínimo no produto NOVO**: testar mandar o mínimo + local pro Omie no momento da criação (o bloqueio da API era para produto já existente; para novo talvez funcione).
5. **Resumo do dia / Produção — separar produção ACABADO × EM PROCESSO (intermediário)**: ele quer ver mais a produção de intermediário (mostra o trabalho da cozinha; acabado é frente de loja).
6. **Usuários — cargos/permissões CONFIGURÁVEIS (RBAC)**: gerente não pode ter acesso de dono. Criar cargos diferentes com permissões diferentes; o que cada um acessa é configurável (ex.: gerente não vê parte de cadastro). Relacionado ao login por código (a pessoa da loja faz o login do funcionário).
7. **Etiqueta — logo OBRIGATÓRIA**: tirar o "logo no rodapé" opcional; a logo passa a ser sempre exibida.

## Indicador Fat × Compras (validação da meta)
- A tela de Indicadores está certa. Meta dele: **Compras ÷ Faturamento ideal < 40%** (na indústria), alguns miram **35%** — quanto menos melhor. (Nosso número atual: 39,7%.)
- Sugestão: marcar o limite/meta (40%) visualmente na tela. Fecha de vez quando entrar o faturamento real (via André).

## BUG identificado (Joaquim já reconheceu)
- **Estoque negativo com estoque mínimo = 0 não fica vermelho.** Deve ficar vermelho sempre que o saldo passou do mínimo (negativo). Joaquim já vai consertar.

## Aprovado / elogiado nesta reunião
- Cadastro de produto com **sugestão de código por faixa** (revenda 90k, acabado 91k, uso/consumo 60k, processo 70k, ativo 50k). ✅
- **Compras (BETA)** — "pegou minha planilha e jogou pra capa!" (muito satisfeito); por família/fornecedor/tipo, baixar tudo, detalhar. ✅
- **Minha loja / configuração de etiqueta** (padrão pelo ADM da loja). ✅
- Família inativa, cadastro de fornecedor, auditoria (clicável por loja/dia), resumo do dia. ✅

## Pontos de BAIXA CONFIANÇA (áudio ruidoso, modelo small — confirmar)
- **~01:43** "transferência também, eu não tenho o nome aqui, essa questão aqui" — possível campo/nome faltando ou problema na tela de transferência. Trecho garbled.
- **~03:00–04:11** inventário deu erro; "tá sem CMC, ele avisa que tá sem CMC" — produto sem CMC dando erro/aviso no inventário. Ver se precisa tratar produto sem CMC na contagem.
- **~32:30 (final)** "manda o ___ pra mim, se você botar lá mesmo" — Joaquim ia enviar algo pro Ramon (arquivo/planilha/link). Não identificado.
- Trechos com transcrição claramente errada ("limão/taitivo/nativo", "darmanilão") = ruído do modelo small. Re-transcrever com modelo `medium` para limpar.

## Futuro (não agora)
- **Lógica de correção de erros de estoque**: Ramon tem vídeos gravados de como corrige; quer criar uma lógica (varredura para justificar movimentações de entrada erradas — erro de NF, de inventário, ou falta de entrada de OP, em que o sistema faz a entrada de produção). Treinar para corrigir.
- **Testar loja nova / trabalhar fora da loja 1**: cadastrar produto, movimentações, entrada fiscal numa loja de teste.
