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

// Agrupamento por modulo. A permissao "...- Sincronizar" entra junto do modulo dela.
export const CATALOGO_PERMISSOES: ModuloCatalogo[] = [
  {
    modulo: 'Notas Fiscais',
    grupo: 'Operação',
    permissoes: [
      { nome: 'Notas Fiscais', label: 'Acessar' },
      { nome: 'Notas Fiscais - Sincronizar', label: 'Sincronizar' },
    ],
  },
  {
    modulo: 'Ordens de Produção',
    grupo: 'Operação',
    permissoes: [
      { nome: 'Ordens de Producao', label: 'Acessar' },
      { nome: 'Ordens de Producao - Sincronizar', label: 'Sincronizar' },
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
      { nome: 'Produtos - Sincronizar', label: 'Sincronizar' },
    ],
  },
  {
    modulo: 'Locais de Estoque',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Locais de Estoque', label: 'Acessar' },
      { nome: 'Locais de Estoque - Sincronizar', label: 'Sincronizar' },
    ],
  },
  {
    modulo: 'Famílias',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Familias', label: 'Acessar' },
      { nome: 'Familias - Sincronizar', label: 'Sincronizar' },
    ],
  },
  {
    modulo: 'Fornecedores',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Fornecedores', label: 'Acessar' },
      { nome: 'Fornecedores - Sincronizar', label: 'Sincronizar' },
    ],
  },
  {
    modulo: 'Clientes',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Clientes', label: 'Acessar' },
      { nome: 'Clientes - Sincronizar', label: 'Sincronizar' },
    ],
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
