# Mega-plano NTB Estoque — pós-reunião 18/06 (montado 19/06)

> **Execução:** cada fase vira plano detalhado na hora (REQUIRED SUB-SKILL: superpowers:subagent-driven-development)
> — um subagente por tarefa, eu verifico tela por tela no link (Chrome) com print antes de dar por pronta,
> disciplina criar+excluir sem lixo no Omie, `tsc --noEmit` (nunca `npm run build`), commit/push por fase, custo zero.

**Insumos:** `2026-06-18-reuniao-bugs.md` (18 bugs + 11 refinamentos) · `2026-06-19-varredura-achados.md`
(99 bugs / 90 refinamentos / 35 redesign, com arquivo+correção) · transcrição em `2026-06-18-reuniao-transcricao.md`.

**Constraints globais:** Next.js 16 (ler `node_modules/next/dist/docs/`; middleware = `proxy.ts`) · Supabase free
tier (`node scripts/db.mjs`) · Omie escrita = criar+excluir · tom Linear/Stripe, mobile-first · **o fundador usa
DARK MODE — todo redesign tem que ficar bom no escuro** · decimais BR (`lib/num-br.ts`) · nunca travessão ·
assinar "Joaquim Salles".

> **Confirmado por frames do vídeo (revisão tela a tela):** relatório com "PRODUTOSSTATUS" e "5Concluído"
> colados (2.2); toast "Erro ao reverter / Ordem de produção não encontrada" (0.4); seletor de data inline da
> conclusão de OP espremido nos botões (8.2); família "Selecione" sem a recém-criada (6.1); NF sem voltar (1.1);
> os 7 erros do log são todos "produto inativo" (0.2) e o texto vem truncado (2.x/log); Locais de Estoque sem
> ação de excluir por linha (6.2); menu filtra por permissão mas a ação de escrita não (0.1).

---

## Fase 0 — Bugs críticos (correção + integridade) · **P0, urgente pro Renato**

| ID | Tarefa | O que muda (arquivo) | Aceite |
|----|--------|----------------------|--------|
| 0.1 | Edição por **permissão** em Transferência e Inventário | guardar todas as server actions de escrita com `requirePermissao('..-Editar')` + gatear UI por `podeEditar`; botão da lista vira "Ver" (`transferencia.ts`, `inventario.ts`, contagem pages, `ContagemTransferencia/Inventario.tsx`) | quem só tem "Ver" não edita nem lança ajuste no Omie; editar some em concluído sem permissão |
| 0.2 | Filtrar **inativos** na busca de produtos | `.eq('inativo', false)` em `buscarProdutos` e `buscarProdutoPorCodigo` (`lib/actions/produtos-search.ts`) | busca não traz inativo em Transf/OP/Inventário |
| 0.3 | Editar **mínimo/produto** enviar ao Omie + **milhar BR** | action de editar → `AlterarProduto`; parse de valor unitário via `num-br` (`EditarProdutoForm`, `EstoqueMinimoInput`, actions) | edição reflete no Omie; valor não vira 0 |
| 0.4 | **Reverter OP** | validar endpoint real no Omie, corrigir lookup silencioso + mensagem (`lib/actions` OP, `lib/omie/*`) | reverter funciona, testado criar→concluir→reverter |
| 0.5 | **Inventário finalizado** reconciliar | máquina de estados ao editar/reenviar (`inventario.ts`, `ContagemInventario.tsx`) | finalizado não trava em "Iniciado" |
| 0.6 | **Rio Vermelho** sem custo (CMC) | sync de CMC incluir locais `inativo IS NOT TRUE` (sync/RPC de custo) | loja mostra custo |
| 0.7 | **Movimentações congeladas** (17/06) | religar atualização do histórico (cron/worker) | movimentação atualiza sozinha |

## Fase 1 — Navegação & Shell (PageHeader 2.0) · *resolve vários de uma vez*

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 1.1 | PageHeader sticky com **voltar + breadcrumb** embutidos | componente único reutilizado em TODAS as telas internas (NF detalhe não tem voltar; nenhuma tem breadcrumb) | voltar/breadcrumb consistentes em toda tela |
| 1.2 | **Header/toolbar fixo** na rolagem | sticky; no mobile ancorar abaixo do header do app (top-14) | header não rola embora; não passa por baixo |
| 1.3 | **Busca de produto sempre no topo** na contagem (igual OP) + unificar busca/scanner | remover toggle "buscar manualmente" (`ContagemTransferencia/Inventario.tsx`) | busca visível sem clicar, paridade com OP |
| 1.4 | **Mobile densidade** | linha estilo "extrato" em vez de card; remover a linha do "Buscar" no topo | mais itens por tela |
| 1.5 | **Filtro salvo** + botão limpar | persistência entre sessões | filtro mantém |

## Fase 2 — Relatórios (melhora significativa) · *pedido do fundador*

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 2.1 | **Motor único** de PDF (RelatorioBase + colunas declarativas + PdfChrome) | `components/relatorio/*` | um só padrão de relatório |
| 2.2 | Corrigir **palavras coladas** (padding por célula) | todos os PDFs/contagens | campos separados |
| 2.3 | **Filtros refletidos** no subtítulo (status/motivo) | PDFs | relatório mostra os filtros |
| 2.4 | Tirar **código numérico do local** da impressão | inventário PDF | só o nome |
| 2.5 | Decimais consistentes + nome de arquivo loja+data + erro amigável + **totais/valor** + consolidado por período | vários | relatórios completos |

## Fase 3 — Etiqueta (repaginar) · *pedido do fundador*

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 3.1 | **Nome da loja** + layout em 3 zonas (Cabeçalho-Loja / Corpo / Rodapé) | `EtiquetaPDF` | nome aparece |
| 3.2 | Eliminar **sobra vertical** + **altura ajustável** | EtiquetaPDF/preset | sem sobra; altura configurável |
| 3.3 | Corrigir **deslocamento à esquerda** (margem/offset X/Y) | rota da etiqueta | impressão alinhada |
| 3.4 | **Config por loja** + **teste (1 amostra)** + **preview** na tela | nova tela de config | configurável e testável |

## Fase 4 — Lojas (redesign forte) · *pedido do fundador*

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 4.1 | Card de loja **colapsável em acordeão "clico e aparece"** | seções (sync, chaves, endereço, empresa, certificado, onboarding) fechadas, abrindo uma por vez (`components/loja/*`) | tela compacta, "clico e abre" |
| 4.2 | **Health badge** de sync por loja (semáforo único) | topo do card | status num relance |
| 4.3 | Separar **lista x detalhe** + tirar convite/onboarding de dentro do card | rota própria | tela de admin limpa |
| 4.4 | Exibir **empresa_status** + **máscaras** CNPJ/CEP/UF/tel + segredos Omie consistentes | `LojaForm` | dados visíveis e validados |

## Fase 5 — Permissões & Usuários

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 5.1 | Permissões granulares **Movimentações/Validade/Impressões** | migration + catálogo + gating menu/rota/botão | só vê o que pode em todo módulo |
| 5.2 | Convite/cadastro **só-código** (sem nome+email) + senha provisória copiável | `NovoUsuario`, convite | convite simples |
| 5.3 | AdminLoja aplica as permissões do convite + "Recusar" com confirmação + erro Supabase amigável | actions de usuário | sem furo |
| 5.4 | Unificar os 4 diálogos (Novo/Aprovar/Convidar/Editar) | componente | consistência |

## Fase 6 — Cadastros (Família/Local/Fornecedor)

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 6.1 | **Família** como cadastro mestre lido pelo produto (resolve "travada", nova não aparece, `codigo_familia` ausente) | família + produto | família nova usável no produto e no Omie |
| 6.2 | **Excluir Local** de estoque (não existe ação) + criar local testado | `local-estoque` | exclui/cria |
| 6.3 | **Sync automático** Família/Fornecedor + "Puxar do Omie" automático | cron | sincroniza sozinho |

## Fase 7 — Movimentações

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 7.1 | **"Por mês" como padrão** | `movimentacoes` | abre por mês |
| 7.2 | Mostrar **valores (entrada/saída)** + **origem/destino** | RPC/tela | sem valor astronômico |
| 7.3 | **Cron** do histórico (casa com 0.7) + guarda-corpo de CMC errado | sync | atualizado |

## Fase 8 — Ordem de Produção (refino)

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 8.1 | **Separar por status** (previsto/pendente/atrasado/concluído) em abas | OP lista | OP organizada |
| 8.2 | **Conclusão guiada** (data + quantidade + validade) num Sheet + corrigir interface bugada | OP | conclusão limpa |
| 8.3 | Corrigir **fuso UTC** (validade off-by-one) + **z-index** lista atrás do "Criar OP" | OP | validade certa, sem sobreposição |
| 8.4 | **Formatação de quantidade/unidade** (achado nos frames): OP mostra "20.000 UN" (3 casas) em vez de "20"; NF mostra unidade colada com dígito ("KG9"/"UND9"/"PCT9") | formatar via `num-br` (sem casas para inteiros), separar unidade | números/unidades limpos |

## Fase 9 — Validade

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 9.1 | **Painel de triagem** (vencidos / hoje / esta semana / depois) | `validade` | triagem em vez de lista solta |
| 9.2 | **Imprimir por linha** + linha clicável → OP + "dias até vencer" textual + alertas proativos | `validade` | acionável |
| 9.3 | Corrigir fuso + a **permissão com acento** que quebra a impressão de etiqueta | validade/rota | impressão funciona |

## Fase 10 — Polish transversal

| ID | Tarefa | O que muda | Aceite |
|----|--------|-----------|--------|
| 10.1 | Unificar as **3 telas de contagem** num componente base | DRY | menos divergência |
| 10.2 | Estados **loading/erro/vazio** + skeletons por rota | geral | sem telas cruas |
| 10.3 | Densidade mobile + consistências de design system | geral | polido |

---

## Cadência
0 (hoje) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Por fase: subagentes implementam tarefa a tarefa,
eu verifico no link (print), commit/push.
