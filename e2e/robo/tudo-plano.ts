// Plano da suíte completa do robô do ERP (ticket 12). Lógica pura: ordem, comandos, filtros por variável de ambiente.
export type Etapa = {
  id: string
  /** Nome do script do package.json (npm run <script>). */
  script: string
  ticket: string
  descricao: string
  /** Pasta de saída dentro de .local-data. */
  saida: string
  duracao: string
  /** Escreve na cópia local (e reseta no fim)? */
  escreve: boolean
  /** Variáveis de ambiente que o próprio robô já entende como filtro. */
  filtros: string[]
}

export const ETAPAS: Etapa[] = [
  { id: 'passeio', script: 'robo', ticket: '02', descricao: 'passeio por todas as telas, 9 logins', saida: 'robo', duracao: '~10 min', escreve: false, filtros: ['ROBO_SO', 'ROBO_PARALELO'] },
  { id: 'saldo', script: 'robo:saldo', ticket: '03', descricao: 'saldo de estoque contra o gabarito', saida: 'robo-saldo', duracao: 'poucos min', escreve: false, filtros: [] },
  { id: 'financeiro', script: 'robo:financeiro', ticket: '09', descricao: 'contas a pagar/receber e contas correntes', saida: 'robo-financeiro', duracao: 'poucos min', escreve: false, filtros: ['ROBO_SEM_CORTE'] },
  { id: 'permissoes', script: 'robo:permissoes', ticket: '10', descricao: 'matriz cargo x tela/ação/API', saida: 'robo-permissoes', duracao: '~5 min', escreve: false, filtros: ['ROBO_SO', 'ROBO_PARALELO'] },
  { id: 'entrada', script: 'robo:entrada', ticket: '04', descricao: 'nota de entrada e custo médio', saida: 'robo-entrada', duracao: '~5 min + reset', escreve: true, filtros: ['ROBO_CENARIOS', 'ROBO_SEM_RESET'] },
  { id: 'venda', script: 'robo:venda', ticket: '05', descricao: 'venda do Vendas, baixa e OP', saida: 'robo-venda', duracao: '~7 min + reset', escreve: true, filtros: ['ROBO_CENARIOS', 'ROBO_SEM_RESET'] },
  { id: 'inventario', script: 'robo:inventario', ticket: '06', descricao: 'inventário e ajuste', saida: 'robo-inventario', duracao: '~15 min + resets', escreve: true, filtros: ['ROBO_CENARIOS', 'ROBO_SEM_RESET'] },
  { id: 'compras', script: 'robo:compras', ticket: '07', descricao: 'pedido de compra ao recebimento', saida: 'robo-compras', duracao: '~6 min + reset', escreve: true, filtros: ['ROBO_CENARIOS', 'ROBO_SEM_RESET'] },
  { id: 'cozinha', script: 'robo:cozinha', ticket: '11', descricao: 'área /cozinha do ERP', saida: 'robo-cozinha', duracao: '~16 min', escreve: false, filtros: ['ROBO_LOJAS', 'ROBO_INSUMOS_DETALHE'] },
  { id: 'cmv', script: 'robo:cmv', ticket: '08', descricao: 'faturamento e CMV contra o gabarito', saida: 'robo-cmv', duracao: '~1 min', escreve: false, filtros: [] },
]

export type EtapaPlano = Etapa & { filtrosAtivos: string[] }
export type Plano = { etapas: EtapaPlano[]; erro: string | null }

const lerLista = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/**
 * Monta o plano. ROBO_TUDO_SO=a,b deixa só essas etapas; ROBO_TUDO_PULAR=a,b tira etapas.
 * A ordem é sempre a da suíte. Nome de etapa desconhecido é erro.
 */
export function montarPlano(env: Record<string, string | undefined>): Plano {
  const so = lerLista(env.ROBO_TUDO_SO)
  const pular = lerLista(env.ROBO_TUDO_PULAR)
  const ids = new Set(ETAPAS.map((e) => e.id))
  const desconhecidos = [...so, ...pular].filter((x) => !ids.has(x))
  if (desconhecidos.length) return { etapas: [], erro: `etapa desconhecida: ${desconhecidos.join(', ')} (válidas: ${[...ids].join(', ')})` }
  const etapas = ETAPAS.filter((e) => (!so.length || so.includes(e.id)) && !pular.includes(e.id)).map((e) => ({
    ...e,
    filtrosAtivos: e.filtros.filter((v) => env[v] !== undefined && env[v] !== '').map((v) => `${v}=${env[v]}`),
  }))
  return { etapas, erro: null }
}

export function formatarPlano(p: Plano): string {
  const L: string[] = ['Suíte do robô do ERP (ordem de execução):', '']
  p.etapas.forEach((e, i) => {
    const cmd = e.script === 'robo' ? 'npm run robo' : `npm run ${e.script}`
    L.push(`${i + 1}. ${e.id} (ticket ${e.ticket}, ${e.duracao}) -> ${cmd}${e.escreve ? '   [escreve na cópia e reseta no fim]' : ''}`)
    L.push(`     ${e.descricao}; saída em .local-data/${e.saida}/<rodada>/`)
    if (e.filtrosAtivos.length) L.push(`     filtros ativos: ${e.filtrosAtivos.join(' ')}`)
  })
  L.push('', 'Ao fim: npm run robo:lista -> .local-data/robo-tudo/lista-final.md')
  return L.join('\n')
}
