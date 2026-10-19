// Fonte unica que organiza as permissoes do banco (tabela `permissoes`, ver
// migration 003/018) em MODULOS legiveis. Serve a UI de criar/editar usuario
// (4.1/4.6) e o filtro de menu por permissao (4.2). Os NOMES aqui precisam bater
// exatamente com `permissoes.nome` (sem acento, como esta no banco). Se um nome
// nao existir no banco, o catalogo simplesmente nao casa (degrada sem quebrar).

export type PermissaoCatalogoItem = {
  // nome exato em permissoes.nome (chave de casamento com o banco)
  nome: string
  // rotulo amigavel exibido na UI (com acento)
  label: string
}

export type ModuloCatalogo = {
  modulo: string
  // grupo do menu a que pertence, so pra organizar visualmente
  grupo: 'Operação' | 'Cadastros'
  permissoes: PermissaoCatalogoItem[]
}

// Agrupamento por modulo. "Acessar" e o ver/entrar no modulo (permissao com o nome
// do modulo, da qual o menu depende). As demais sao acoes (Criar/Editar/Excluir e
// especificas). O "Sincronizar" NAO entra mais no catalogo: o sync virou admin-only
// (perfil 'Admin') e nao depende de permissao por usuario (as permissoes "... -
// Sincronizar" continuam no banco, inertes, so nao sao mais exibidas como opcao).
export const CATALOGO_PERMISSOES: ModuloCatalogo[] = [
  {
    modulo: 'Notas Fiscais',
    grupo: 'Operação',
    // Importada do Omie (nao se cria NF aqui): acessar/ver + as 3 acoes reais
    // que chamam a API da Omie (manifestar/reverter/excluir recebimento).
    permissoes: [
      { nome: 'Notas Fiscais', label: 'Acessar' },
      { nome: 'Notas Fiscais - Manifestar', label: 'Manifestar' },
      { nome: 'Notas Fiscais - Reverter', label: 'Reverter' },
      { nome: 'Notas Fiscais - Excluir', label: 'Excluir' },
      // Fase B: manifestação do destinatário na SEFAZ (só loja de estoque próprio; vai para a SEFAZ e não se desfaz)
      { nome: 'Notas Fiscais - Manifestar na SEFAZ', label: 'Manifestar na SEFAZ' },
    ],
  },
  {
    modulo: 'Ordens de Produção',
    grupo: 'Operação',
    permissoes: [
      { nome: 'Ordens de Producao', label: 'Acessar' },
      { nome: 'Ordens de Producao - Criar', label: 'Criar' },
      { nome: 'Ordens de Producao - Editar', label: 'Editar' },
      { nome: 'Ordens de Producao - Excluir', label: 'Excluir' },
      { nome: 'Ordens de Producao - Concluir', label: 'Concluir' },
      { nome: 'Ordens de Producao - Reverter', label: 'Reverter' },
    ],
  },
  {
    modulo: 'Transferências',
    grupo: 'Operação',
    permissoes: [
      { nome: 'Transferencias - Ver', label: 'Ver' },
      { nome: 'Transferencias - Criar', label: 'Criar' },
      { nome: 'Transferencias - Editar', label: 'Editar' },
      { nome: 'Transferencias - Excluir', label: 'Excluir' },
    ],
  },
  {
    modulo: 'Inventários',
    grupo: 'Operação',
    permissoes: [
      { nome: 'Inventarios - Ver', label: 'Ver' },
      { nome: 'Inventarios - Criar', label: 'Criar' },
      { nome: 'Inventarios - Editar', label: 'Editar' },
      { nome: 'Inventarios - Excluir', label: 'Excluir' },
    ],
  },
  {
    modulo: 'Movimentações',
    grupo: 'Operação',
    // Historico de entradas/saidas importado do Omie + criar ajuste manual (ENT/SAI/TPQ).
    permissoes: [
      { nome: 'Movimentacoes', label: 'Acessar' },
      { nome: 'Movimentacoes - Criar', label: 'Criar' },
    ],
  },
  {
    modulo: 'Escrever no Omie pela tela',
    grupo: 'Operação',
    // "Nosso Omie" Fase 4 (migration 162), só loja de estoque Omie. Cada uma também exige a permissão de
    // sempre da ação (ex.: Movimentacoes - Criar, Ordens de Producao - Concluir).
    permissoes: [
      { nome: 'Estoque - Lancar no Omie', label: 'Entrada, ajuste e transferência no estoque' },
      { nome: 'OP - Acoes em lote', label: 'OPs em lote' },
      { nome: 'Fichas - Trocar insumo', label: 'Trocar insumo nas fichas' },
      { nome: 'Estoque - Corrigir custo', label: 'Corrigir custo de ajuste' },
      // Central de correções (migration 171): lançar OP de preparo/prato/cupom pela Central (com a permissão de OP de sempre).
      { nome: 'Correcoes - Executar', label: 'Corrigir pela Central de correções' },
    ],
  },
  {
    modulo: 'Compras',
    grupo: 'Operação',
    // Estoque proprio: nota de entrada (XML ou manual) que da entrada no ledger.
    permissoes: [
      { nome: 'Compras', label: 'Acessar' },
      { nome: 'Compras - Criar', label: 'Criar' },
      // Fase C (migrations 200/201): sugestão de compra (as duas lojas) e pedido de compra (só estoque próprio).
      { nome: 'Compras - Sugestao', label: 'Ver a sugestão de compra' },
      { nome: 'Compras - Pedidos', label: 'Criar e editar pedidos de compra' },
      { nome: 'Compras - Aprovar pedidos', label: 'Aprovar pedidos e requisições de compra, cadastrar compradores' },
      // Fase C2 (migration 240): requisição de compra (só estoque próprio).
      { nome: 'Compras - Requisicoes', label: 'Criar e editar requisições de compra' },
      // Fase F (migration 231): devolução ao fornecedor no estoque próprio (sem emitir NF-e).
      { nome: 'Compras - Devolucao ao fornecedor', label: 'Registrar e cancelar devolução ao fornecedor' },
    ],
  },
  {
    modulo: 'Fechamento e contador',
    grupo: 'Operação',
    // Fase F (migrations 230/232): fechar o mês trava toda escrita com data nele; reabrir é registrado com motivo.
    permissoes: [
      { nome: 'Fechamento - Fechar mes', label: 'Fechar o mês' },
      { nome: 'Fechamento - Reabrir mes', label: 'Reabrir um mês fechado' },
      { nome: 'Contador - Pacote', label: 'Baixar o pacote do contador (XMLs, livro de entradas, Bloco H)' },
    ],
  },
  {
    modulo: 'Validade',
    grupo: 'Operação',
    // Modulo de leitura: OPs com validade proxima ou vencida.
    permissoes: [{ nome: 'Validade', label: 'Acessar' }],
  },
  {
    modulo: 'Impressões',
    grupo: 'Operação',
    // Modulo de leitura: historico de impressao de etiquetas.
    permissoes: [{ nome: 'Impressoes', label: 'Acessar' }],
  },
  {
    modulo: 'Produtos',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Produtos', label: 'Acessar' },
      { nome: 'Produtos - Criar', label: 'Criar' },
      { nome: 'Produtos - Editar', label: 'Editar' },
      { nome: 'Produtos - Excluir', label: 'Excluir' },
      // Fase G (migration 223): importar produtos por planilha (só estoque próprio).
      { nome: 'Produtos - Importar planilha', label: 'Importar planilha' },
    ],
  },
  {
    modulo: 'Locais de Estoque',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Locais de Estoque', label: 'Acessar' },
      { nome: 'Locais de Estoque - Criar', label: 'Criar' },
      { nome: 'Locais de Estoque - Editar', label: 'Editar' },
      { nome: 'Locais de Estoque - Excluir', label: 'Excluir' },
    ],
  },
  {
    modulo: 'Famílias',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Familias', label: 'Acessar' },
      { nome: 'Familias - Criar', label: 'Criar' },
      { nome: 'Familias - Editar', label: 'Editar' },
      { nome: 'Familias - Excluir', label: 'Excluir' },
    ],
  },
  {
    modulo: 'Categorias Contábeis',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Categorias Contabeis', label: 'Acessar' },
      { nome: 'Categorias Contabeis - Criar', label: 'Criar' },
      { nome: 'Categorias Contabeis - Editar', label: 'Editar' },
      { nome: 'Categorias Contabeis - Excluir', label: 'Excluir' },
    ],
  },
  {
    modulo: 'Produtos Substitutos',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Produto Substituicoes', label: 'Acessar' },
      { nome: 'Produto Substituicoes - Criar', label: 'Criar' },
      { nome: 'Produto Substituicoes - Excluir', label: 'Excluir' },
    ],
  },
  {
    modulo: 'Fornecedores',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Fornecedores', label: 'Acessar' },
      { nome: 'Fornecedores - Criar', label: 'Criar' },
      { nome: 'Fornecedores - Editar', label: 'Editar' },
      { nome: 'Fornecedores - Excluir', label: 'Excluir' },
      // Fase G (migration 223): importar fornecedores por planilha (só estoque próprio).
      { nome: 'Fornecedores - Importar planilha', label: 'Importar planilha' },
    ],
  },
  {
    modulo: 'Anexos',
    grupo: 'Operação',
    // Fase G (migration 221): arquivos anexados a produto, nota de entrada, pedido de compra e OP (só estoque próprio).
    // Ver os anexos acompanha a permissão de ver o registro.
    permissoes: [
      { nome: 'Anexos - Enviar', label: 'Enviar anexos' },
      { nome: 'Anexos - Excluir', label: 'Excluir anexos' },
    ],
  },
  {
    modulo: 'Clientes',
    grupo: 'Cadastros',
    permissoes: [{ nome: 'Clientes', label: 'Acessar' }],
  },
]

// Mapa rota do menu -> permissao "de acesso" que controla a visibilidade (4.2).
// Apenas rotas que dependem de permissao granular entram aqui. Rotas sem entrada
// sao SEMPRE visiveis (ex.: /home), e rotas com `admin: true` no NavItems ja sao
// tratadas a parte (so admin). Se uma rota nao tem permissao mapeada, nao filtra.
export const MENU_PERMISSAO: Record<string, string> = {
  '/estoque': 'Movimentacoes',
  '/estoque/saude': 'Movimentacoes',
  '/estoque/correcoes': 'Movimentacoes',
  '/producao-propria': 'Ordens de Producao',
  '/ficha-tecnica': 'Produtos',
  '/inventario-proprio': 'Inventarios - Ver',
  '/reposicao': 'Movimentacoes',
  '/compras': 'Compras',
  '/sugestao-compra': 'Compras - Sugestao',
  '/pedido-compra': 'Compras - Pedidos',
  '/requisicao-compra': 'Compras - Requisicoes',
  '/tarefas-compras': 'Compras - Pedidos',
  '/compras-cadastros': 'Compras - Pedidos',
  '/devolucao-fornecedor': 'Compras - Devolucao ao fornecedor',
  '/nota-fiscal': 'Notas Fiscais',
  '/ordem-producao': 'Ordens de Producao',
  '/transferencia': 'Transferencias - Ver',
  '/inventario': 'Inventarios - Ver',
  '/movimentacoes': 'Movimentacoes',
  '/validade': 'Validade',
  '/impressoes': 'Impressoes',
  '/produto': 'Produtos',
  '/local-estoque': 'Locais de Estoque',
  '/familia': 'Familias',
  '/grupo-produto': 'Familias',
  '/sync-catalogo': 'Produtos',
  '/categoria-contabil': 'Categorias Contabeis',
  '/produto-substituicao': 'Produto Substituicoes',
  '/fornecedor': 'Fornecedores',
  // /sintegra puxa fornecedor/cliente: exige uma das duas
  '/sintegra': 'Fornecedores',
  // /sync-status (Saude da integracao): so admin -> tratado pelo admin flag.
}
