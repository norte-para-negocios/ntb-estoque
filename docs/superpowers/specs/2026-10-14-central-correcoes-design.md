# Central de correções — design curto

Data: 2026-10-14 · Loja de referência: Donana Praia do Forte (loja 5, `modo_estoque='omie'`, `espelho_completo`).
Protótipo aprovado (UX, textos, comportamento): `scratchpad/prototipo-correcoes/index.html` (dados reais de 14/10).
Pedido do dono: "faz o que você achar perfeito e que resolva tudo".

## O que é

A tela `/estoque/correcoes` substitui a Saúde do estoque (`/estoque/saude` redireciona). Mostra **um problema por
linha**, com causa em uma frase, valor em R$ e a correção guiada ao lado (painel), usando as escritas no Omie que já
existem (Fase 4) e as novas que faltavam.

1. **Hero**: progresso do dia (resolvidos hoje, esperando Ramon, ignorados; anel), R$ em aberto, chips por tipo.
2. **Comece por aqui**: os 3 abertos que mais pesam em R$.
3. **Grupos** colapsáveis ordenados por R$ em aberto: Pratos negativos (PA), Preparos negativos (PI), Insumos e
   revenda negativos (MP), Custo fora do normal, OPs abertas sobrando ou faltando, Contagens estranhas, Insumo sem custo
   ou inativo na ficha, **Cupons sem OP** (venda do PDV de prato com ficha sem OP correspondente), Taxas que não são
   estoque (sempre por último). Cada grupo com busca, ordenação (maior valor / mais negativo|maior custo|mais antiga /
   A–Z) e filtro de estado (Abertos / Esperando / Feitos / Todos) com contagem.
4. **Estado por problema no banco** (`central_problema_estado`, por loja + chave estável): aberto, resolvido, ramon
   (mensagem guardada; nada é enviado), ignorado (motivo; "olhar outro dia" vale até amanhã), quem e quando.
5. **Painel lateral universal** (folha de baixo no celular) para produto, OP, nota, cupom e ajuste/contagem: abas
   Resumo / Movimentos (com busca) / Ligado a, pilha com voltar e caminho. Carrega sob demanda (server action).
6. **Correção guiada**: causa, opções com prévia do efeito (saldo/custo) e confirmação; dependências avisadas com link
   (ex.: "corrija antes o custo de X" para concluir OP; "crie as OPs dos cupons antes de zerar o prato").
7. **Busca rápida** `/` e ⌘K global: produto, OP (número com ou sem ano), nota, cupom. Na Central abre o painel.
8. **Feito pelo robô**: log da faxina (`correcoes_automaticas`, ingestão `POST /api/correcoes/ingest`, tela
   `/correcoes`) trazido do checkout antigo; a Central mostra o que o robô fez nos últimos 7 dias, ligado aos problemas.

## Ações

Existentes (Fase 4, chamadas pelo painel): `ajusteOmie` (saldo contado / diferença / zerar), `acaoOPLote`
(concluir / excluir / mudar data), `corrigirCustoAjuste`. Novas (`lib/actions/central.ts`):
`lancarOPCorrecao` (IncluirOrdemProducao + ConcluirOrdemProducao com data escolhida; idempotente por `cCodIntOP`
determinístico: `CP-<cupom>-<produto>` para cupom, `CT-<hash>` para preparo/prato), `marcarNaoControla` (só local),
`marcarEstadoProblema` (resolvido/ramon/ignorado/reaberto), `carregarPainel` (leitura).
Toda escrita no Omie: permissão nova `Correcoes - Executar` + a de sempre, `is_test` (simula), loja 4 bloqueada,
`audit_log`, uma escrita por vez, para no primeiro bloqueio do Omie (MISUSE/consumo redundante).

## Velocidade

Central < 1 s no servidor: leituras em paralelo (páginas em ondas), cupons de 14 dias do Contabo (0,2 s medidos) em
paralelo com o banco, sem consulta por produto em laço; painel sob demanda.

## Fora

Escrever "não controla estoque" no Omie; enviar WhatsApp ao Ramon; informar custo direto no Omie (não há API de
"setar CMC": a correção de custo é pelo ajuste que trouxe o custo errado).
