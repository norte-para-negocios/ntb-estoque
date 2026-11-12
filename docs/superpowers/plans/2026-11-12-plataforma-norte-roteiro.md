# Plataforma Norte · roteiro

> Visão geral das fases. Cada fase tem plano próprio, escrito quando a anterior entra em produção, porque cada uma depende do que a anterior ensinou. A fase 1 já está detalhada em `2026-11-12-plataforma-norte-fase1-assinaturas.md`.

**Desenho:** `docs/superpowers/specs/2026-11-12-plataforma-norte-modulos-design.md`
**Protótipo aprovado na linha (12/11):** `~/Projects/plataforma-norte-prototipo/index.html`
**Landing page (protótipo):** `~/Projects/plataforma-norte-prototipo/lp/index.html`

## Regras que valem para todas as fases

- **Regra de ouro:** loja sem configuração = tudo como hoje. Nenhuma loja real perde acesso no dia de uma virada.
- **Protótipo antes de código** em toda tela nova ou reorganizada. O dono aprova o protótipo, depois se codifica.
- **Cada tela:** uma pergunta, uma ação principal, um nome por coisa, tudo a 1 clique no menu.
- **Norte Vendas:** visual e fluxo não mudam. Só login, porta e bloqueio por assinatura.
- **Deploy:** ERP só de madrugada (ou com ordem explícita do dono). Vendas só depois de testar pedido→impressão→conta→nota→baixa.
- **Migrations:** só aditivas, aplicadas à mão no Contabo e conferidas com `\d`/`\df`. Depois: `desktop/scripts/gerar-schema.sh` + versão nova do desktop.
- **Preços:** nada publicado sem autorização do Ramon/dono. Na plataforma, preço é dado editável, nunca texto fixo.
- **Em teste primeiro:** cada fase vai para produção como "em teste" (só desenvolvedores), depois uma loja-piloto (Donana PF ou ODARA), depois as outras.

## Fases

| # | Fase | Entrega | Depende de | Tamanho |
|---|---|---|---|---|
| 1 | Assinaturas e bloqueio no ERP | Catálogo de módulos, estado por loja (ativo, teste, bloqueado, suspenso), tela de administração da Norte, menu e rotas do ERP respeitando, vitrine do módulo bloqueado; Cozinha e Pacioli saem das regras soltas | — | M |
| 2 | Porta + Conta Norte | Porta pós-login (Pacioli com o resumo do dia, módulos, troca de loja), pessoas vinculadas (ERP ↔ Vendas), cadastro de equipe num lugar só | 1 | G |
| 3 | Vendas na plataforma | Passe curto da porta para o Vendas; login do Vendas aceitando a Conta Norte (nome + loja + senha); assinatura `vendas` respeitada com falha aberta; apps nativos com versão nova não obrigatória | 1, 2 | G |
| 4 | Cozinha sozinha | Bloqueio de servidor para rotas do ERP em vitrine também na navegação dentro do app (proxy com cache curto), limitação conhecida da fase 1. Loja só com `cozinha`: insumos, importação por planilha, compra simples, contagem simples dentro da Cozinha, gravando nas tabelas do estoque próprio | 1 | M |
| 5 | ERP reorganizado | Por módulo (Estoque → Compras → Produção → Fiscal → Finanças): inventário de telas e botões, protótipo, aprovação, implementação, teste com a operação | 1, trilha de design | G |
| 6 | Cobrança (opcional) | Mensalidade automática | 1 | M |

### Portões entre fases

- Fase 1 → 2: tela de administração usada pela Norte por uma semana sem nenhuma loja perder acesso.
- Fase 2 → 3: todas as pessoas de uma loja-piloto vinculadas e entrando pela porta.
- Fase 3 → lojas reais: um dia inteiro de serviço na loja-piloto com garçom e caixa pela Conta Norte, sem chamado.

## Trilha de design (corre junto das fases)

1. **Sistema visual da plataforma** (antes da fase 2): `docs/design/plataforma-norte.md` com tokens (cores da família, Geist + Newsreader itálico só em saudações, raios, sombras, movimento), componentes da porta (cartão de módulo vivo, linha de resumo do Pacioli, trilho de módulos, vitrine) e regras de texto. Base: o protótipo aprovado.
2. **Símbolos oficiais da Norte Cozinha e do Pacioli** no mesmo processo dos símbolos de Vendas e Estoque (gerados e escolhidos pelo dono; não desenhados à mão), substituindo os provisórios.
3. **Protótipo por fase:** porta e pessoas (fase 2), login do Vendas com Conta Norte (fase 3), Cozinha sozinha (fase 4), cada módulo do ERP (fase 5). Sempre clicável, com dado real da ODARA/Donana, aprovado antes de codar.
4. **Revisão visual** de cada entrega com prints (desktop e celular) antes de dizer "pronto".

## Trilha da landing page

1. Protótipo da LP (feito em 12/11, local) com o texto passado pela skill de copy.
2. Aprovação do dono e do Ramon (texto e o que pode ser dito sobre preço).
3. Entrar no site oficial (`~/Projects/norte-site`, Astro) como página da plataforma, no padrão da família, com testes do site.
4. Publicar só com OK explícito do dono (backup do `public_html` antes).

## Próximo passo

Executar a fase 1 pelo plano detalhado. Ao terminar, escrever o plano da fase 2 com o que a fase 1 ensinou.
