# Reunião NTB 18/06 (noite, ~80 min) — bugs e pedidos (varredura completa)

Sessão de teste ao vivo do sistema com Ramon e André (gravação `Videos/2026-06-18 19-31-54.mp4`,
transcrição `2026-06-18-reuniao-transcricao.md`, 1169 segmentos). Varrido linha a linha.
Contexto/urgência: **Renato começa amanhã de manhã** (loja dele) e a loja do livro **sábado**.
Fundador: "hoje eu já conserto esses bugs que apareceram" `[01:14:39]`.

> Diarization deu 1 speaker (áudio de tela mixado). Voxtral transcreveu vários trechos com ruído;
> interpretados pelo contexto. Referências `[hh:mm:ss]` apontam o ponto na transcrição.

---

## BUGS (quebrado / consertar)

### Busca e seleção de produtos
- **1. Produto INATIVO aparece na busca de produtos** (transferência, inventário e busca do
  cadastro). `[36:51-37:14]` "Está puxando um produto inativo... Anotar isso também. Não pode estar
  nesse cadastro de produtos, nessa busca. Não pode puxar inativo." `[48:32]` "o camarão também está
  zero e permitido." `[49:48]` "Ele tem que proibir completamente essa busca (de inativos)." **Foi a
  causa dos 7 erros do log** `[01:02:55]`. → filtrar inativos da busca.
- **2. Busca de produtos na OP tem que ficar SEMPRE visível no topo** — sem precisar clicar "buscar
  manualmente" antes. E **padronizar transferência/inventário igual à OP**. `[33:38]` "Deixa essa
  parte igual a de ordem de produção." `[22:29-22:39]` (posição do "buscar") + esclarecimento do
  fundador agora.

### Ordem de Produção (OP)
- **3. Reverter OP dá erro "Ordem de produção não encontrada".** `[28:55-29:18]` Testaram criar →
  concluir (com data escolhida) → reverter, e a reversão falhou.
- **4. Interface de "concluir OP escolhendo a data" está bugada (front-end).** `[27:49-27:57]`
  Funciona (escolhe a data prevista), mas a interface está visualmente quebrada.
- **5. Z-index: lista de busca de produtos fica ATRÁS do painel "Criar OP".** `[23:33-23:45]`
  "A lista está ficando atrás do criar o (OP)... consertar isso."

### Edição / permissões
- **6. Editar (estoque mínimo e produto) não salva/não envia ao Omie** — só grava no banco local.
  `[55:01-55:16]` "Pode editar, mas não está editando... não está enviando minha edição... Está
  falando só do nosso banco."
- **7. Botão "Editar" aparece em transferência/inventário CONCLUÍDO.** `[73:18-74:05]` Regra: editar
  é por **permissão**, não por status. Quem tem permissão edita (mesmo concluído); quem não tem, o
  botão não aparece. Hoje aparece editar em concluído.

### Navegação / voltar
- **8. VÁRIOS locais sem botão de voltar** (não é só uma tela — auditar TODAS). `[17:29]` "senti
  falta... só tem um botão de voltar" foi só um exemplo. Garantir voltar em todas as telas internas.
- **9. Cadastro de produto não volta pra tela anterior + falta breadcrumb.** `[57:25-58:19]` "o
  produto teve que voltar... na outra tela que estava, teve que voltar." → adicionar **breadcrumb**
  ("migalha de pão") e voltar pro lugar/filtro de origem.

### Cadastros
- **10. Família travada/"fixa" no cadastro de produto** (campo família parece preso). `[56:56-57:07]`
  "A família está (travada) igual a outra família... isso aqui está fixo." (Abrir a tela pra
  confirmar o comportamento.)
- **11. Família não vem no produto** (produto que tem família não trouxe). `[06:56-07:11]` (não é
  imperativo, mas anotado.)
- **12. Cadastro de LOCAL de estoque:** cadastrar por dentro do sistema não funciona e **excluir
  local está complicado/bugado.** `[59:29-59:44]`

### Inventário / integração
- **13. Inventário finalizado fica como "Iniciado" ao reprocessar / conflito.** `[46:27-48:12]`
  Reenviou pendentes de um inventário finalizado e continuava "iniciado"; processou item a item
  (151→153). Ligado aos inativos puxados (bug 1).
- **14. Log de integração: erro truncado.** `[01:02:52-01:03:45]` Os 7 erros: ao clicar em
  "detalhes" mostra só o código truncado (3 pontinhos). Mostrar o motivo completo e explicado de
  forma clara/amigável.

### Relatório
- **15. Relatório/PDF de transferência com palavras coladas** (Origem/Destino/Produto/Status/
  Quantidade grudados). `[44:24-44:38]` "As palavras estão juntas... Produto e status, tá tudo
  junto." + `[44:45]` adicionar mais informação de valor.

### Layout / sticky / automação
- **16. Barra/topo NÃO fica fixo na rolagem** em várias telas — deixar sticky. `[56:25]` "precisa
  deixar um barco (barra) fixo aqui em cima"; `[01:02:10]` "deixar a (top bar) fixa na rolagem."
- **17. "Puxar do Omie/MIE" deve ser AUTOMÁTICO** — tirar a dependência dos botões manuais (manter só
  por garantia). `[01:00:28-01:00:44]` "Era para ser automático... não quero esses botões de ficar
  puxando... tem que ser tudo automático."

### Investigar (pode ser dado do Omie, não código)
- **18. Loja Rio Vermelho não puxa o CUSTO (CMC) via API.** `[06:03, 13:21-14:18, 53:20, 01:07:00]`
  "Aqui não está fixando... o custo não está vindo" só na Rio Vermelho; as outras lojas vêm. (Separado
  do bloqueio "Consumo Indevido" dos **dados de empresa** das lojas 5/6, que é limite do Omie
  `[01:06:39-01:06:56]`.)

---

## PEDIDOS / refinamentos (melhoria, não "quebrado")

- **19. Cadastro de produto: TIPO primeiro (no topo) + sugerir CÓDIGO pela faixa.** `[10:46-13:06,
  12:47]` forçar selecionar o tipo antes; sugerir o código: matéria-prima ~80 mil; revenda/produto
  acabado ~90 a 91 mil; produto em processo/uso e consumo ~70 mil; ativo ~50 mil.
- **20. OP: separar por status** previsto (após o dia) / pendente / atrasado (antes do dia) /
  concluído, como filtros rápidos. `[30:00-30:33]`
- **21. Mobile: otimizar espaço vertical** — validade + quantidade à direita (não em coluna embaixo),
  linha mais fina, máximo de itens sem rolar. `[31:21-32:08]`
- **22. Etiqueta:** incluir nome da loja/restaurante, aproveitar o espaço com mais info, e testar
  impressão (André reportou problema). `[18:22-19:24]`
- **23. Movimentações: "por mês" como PADRÃO** + mostrar **valores (entrada e saída)** + **origem/
  destino** (senão soma tudo e dá valor astronômico). `[50:38-52:10]`
- **24. Filtro salvo:** manter o filtro escolhido + botão limpar. `[58:51-59:18]`
- **25. Validade na OP por produto individual** (não herdar de um só). `[22:22-22:29]`
- **26. Aviso de validade quando algo está fora** + imprimir produto pra validar / histórico.
  `[52:10-52:44]`
- **27. Permissões granulares a ADICIONAR: movimentação, validade, impressão** (ver/bloquear por
  seleção). `[01:12:16]`
- **28. Convite de usuário: NÃO pedir nome completo + email** — a gente só gera o código; a pessoa
  preenche ao entrar. `[68:29-68:35]`
- **29. Sidebar: grupos colapsáveis "colar para sair"** (operação/cadastro/administração), por loja.
  `[65:15-65:46]` (parte já feita.)

---

## Confirmado FUNCIONANDO (não são bugs)
Validade em dias `[24:48, 26:23]`; sem-CMC bloqueia transferência `[42:08]`; saldo zerado fica
negativo ao transferir (aceito, sem limitar) `[42:35, 39:05]`; botão excluir some sem permissão
`[72:41]`; sync automático a cada 10 min `[01:06:29]`.

## Pendente (não bug)
- Certificado digital ainda não obtido `[01:04:34]`.
- Dados de EMPRESA das lojas 5/6 não vêm via API (bloqueio "Consumo Indevido") `[01:06:39]`.

## Decisões
- **Não limitar** transferência por falta de estoque/entrada anterior por enquanto (fica negativo, e
  tudo bem) `[39:05]`.
- Infra: manter **Supabase** (segurança/backup) vs Contabo; 200 MB de 500 usados; histórico >1 ano
  vai pro storage `[01:16:00 em diante]`.
