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
    // Importada do Omie (nao se cria NF aqui): so acessar/ver.
    permissoes: [{ nome: 'Notas Fiscais', label: 'Acessar' }],
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
    modulo: 'Produtos',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Produtos', label: 'Acessar' },
      { nome: 'Produtos - Criar', label: 'Criar' },
      { nome: 'Produtos - Editar', label: 'Editar' },
      { nome: 'Produtos - Excluir', label: 'Excluir' },
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
    modulo: 'Fornecedores',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Fornecedores', label: 'Acessar' },
      { nome: 'Fornecedores - Criar', label: 'Criar' },
      { nome: 'Fornecedores - Editar', label: 'Editar' },
      { nome: 'Fornecedores - Excluir', label: 'Excluir' },
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
  '/nota-fiscal': 'Notas Fiscais',
  '/ordem-producao': 'Ordens de Producao',
  '/transferencia': 'Transferencias - Ver',
  '/inventario': 'Inventarios - Ver',
  // /movimentacoes, /validade, /impressoes: derivam de notas/op/produtos; sem
  //   permissao propria no banco, ficam visiveis (relatorios de leitura).
  '/produto': 'Produtos',
  '/local-estoque': 'Locais de Estoque',
  '/familia': 'Familias',
  '/fornecedor': 'Fornecedores',
  // /sintegra puxa fornecedor/cliente: exige uma das duas
  '/sintegra': 'Fornecedores',
  // /sync-status (Saude da integracao): so admin -> tratado pelo admin flag.
}
