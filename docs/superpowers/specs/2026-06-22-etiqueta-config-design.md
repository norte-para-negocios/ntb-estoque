# Etiqueta configurável + área "Minha loja"

Data: 2026-06-22
Status: aprovado pelo fundador (Joaquim) em 22/06

## Problema

Hoje a etiqueta imprime sempre no padrão fixo (largura 72,56mm fixa, altura em
preset, sem cor, sem UI de configuração). O fundador quer:

- O **admin da loja** administra a própria loja (dados de negócio) e define o
  **padrão da etiqueta** (informações, formato, cor, layout) com **várias opções**.
- O **usuário comum**, na hora de imprimir, só escolhe o **tamanho em cm**.

## Decisões (do fundador)

- Config do admin mora numa área **"Minha loja"** (não na tela Lojas, que é só
  admin global). Acessível a admin global E admin da loja, escopada na loja atual.
- Admin da loja edita **dados de negócio (sem Omie)**: nome fantasia, endereço.
  CNPJ, chaves Omie, webhook e ativo continuam só com admin global.
- Etiqueta com **customização completa**: campos on/off, nome, cor, tamanho cm,
  tipografia (escala + negrito), ordem dos campos, logo/borda on/off.
- Usuário escolhe **largura e altura em cm** num diálogo antes de imprimir.
- Impressão pode ser térmica (P&B) ou colorida → cor só no nome/filetes, nunca
  fundo cheio (degrada bem em P&B).

## Arquitetura

### Dados: tabela `etiqueta_config` (1 linha por loja)

`loja_id` (PK, FK lojas), `nome_exibido`, 8 `mostrar_*` (fabricacao, validade,
qtde_nf, qtde_etiqueta, lote, recebido, fornecedor, cnpj), `ordem_campos` text[],
`fonte_escala` numeric (0.8–1.3, default 1.0), `negrito_nome` bool,
`negrito_descricao` bool, `cor_destaque` text null (hex; null = preto),
`mostrar_logo` bool, `mostrar_borda` bool, `largura_cm` numeric (default 7.26),
`altura_cm` numeric (default 4.0), `offset_x`/`offset_y` numeric (mm),
`updated_at`, `updated_by`. Leitura cai em defaults quando não há linha.

### EtiquetaPDF (reescrita parametrizada)

`EtiquetaConfig` ganha: `larguraCm`, `alturaCm`, `corDestaque`, `fonteEscala`,
`negritoNome`, `negritoDescricao`, `ordemCampos`, `mostrarLogo`, `mostrarBorda`.
Largura deixa de ser fixa. Cor aplica no nome da loja e nos filetes. Os campos
opcionais passam a ser renderizados numa lista vertical na ordem escolhida.

### Página `/minha-loja` (nav Administração, gestaoUsuarios)

Escopada em `getCurrentLojaId`. Seções:
- **Informações**: form dos campos de negócio → server action `editarLojaNegocio`
  (gestaoUsuarios + escopo na loja atual), auditada.
- **Etiqueta**: form com todas as opções + **prévia ao vivo (HTML aproximada)** +
  **"Imprimir teste"** (PDF real, dados de exemplo) → server action
  `salvarEtiquetaConfig` (upsert), auditada.

### Impressão pelo usuário (tamanho em cm)

Componente cliente `DialogImprimirEtiqueta`: abre onde hoje há link direto de
imprimir (Impressões, Nota Fiscal, Ordem de Produção). Campos largura × altura em
cm, default = última escolha do usuário (localStorage) ou padrão da loja. Confirma
→ abre `/.../imprimir?lc=<cm>&ac=<cm>` em nova aba.

Os routes de impressão (`nota-fiscal/[id]/imprimir`, `ordem-producao/[id]/imprimir`)
carregam o `etiqueta_config` da loja (padrão) e aplicam o tamanho em cm da URL.

## Fora de escopo

- Editar chaves Omie/webhook/ativo pelo admin da loja (segue só admin global).
- Persistir o tamanho do usuário no banco (fica no navegador dele).
