import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { exigirDev } from '@/lib/recursos-dev'
import * as q from './consultas'

// Leitura do financeiro (migrations 285/286) para as telas. Sempre pelo servidor, com o service role, DEPOIS de checar:
// desenvolvedor, loja de estoque próprio e permissão. Nenhum cliente acessa as tabelas fin_* direto.

export const PERM = {
  contasPagar: 'Financeiro - Contas a pagar',
  pagar: 'Financeiro - Contas a pagar - Pagar',
  contasCorrentes: 'Financeiro - Contas correntes',
  categorias: 'Financeiro - Categorias',
  // 360: parcela paga em nota desfeita (cargo Gerente; Admin/AdminLoja já têm tudo)
  decidirNotaDesfeita: 'Financeiro - Decidir nota desfeita',
  // 370/371: aprovação (Gerente até a faixa dele; alto valor e configurar só Admin/AdminLoja), recorrentes (Gerente),
  // lançamento avulso e transferência (só Admin/AdminLoja, mexem em dinheiro como o Pagar)
  aprovar: 'Financeiro - Aprovar pagamento',
  aprovarAlto: 'Financeiro - Aprovar pagamento alto valor',
  configurarAprovacao: 'Financeiro - Configurar aprovacao',
  recorrentes: 'Financeiro - Contas recorrentes',
  lancamentos: 'Financeiro - Lancamentos e transferencias',
} as const

/** Porta de entrada de toda página do financeiro: 404 para quem não é dev, loja não-própria ou sem permissão. */
export async function acessoFinanceiro(permissao: string): Promise<{ lojaId: number; podePagar: boolean }> {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, permissao))) notFound()
  const podePagar = permissao === PERM.contasPagar ? await requirePermissao(lojaId, PERM.pagar) : false
  return { lojaId, podePagar }
}

// Atalhos com o cliente de serviço (use depois de acessoFinanceiro). Tipos e regras de erro vivem em consultas.ts (testado com cliente falso).
export type {
  ContaCorrente, Categoria, Titulo, TotaisTitulos, LinhaExtrato, PagamentoTitulo, DetalheTitulo, FiltrosTitulos, TituloNota, FamiliaCategoria,
  NotaSemConta, PendenciaNotaDesfeita, ParcelaPrevista, TituloAprovacao, Recorrente, LancamentoAvulso, Transferencia,
} from './consultas'
export { semMigration } from './consultas'

export const listarContas = (lojaId: number) => q.listarContas(createServiceClient(), lojaId)
export const listarCategorias = (lojaId: number) => q.listarCategorias(createServiceClient(), lojaId)
export const listarCategoriasContabeis = (lojaId: number) => q.listarCategoriasContabeis(createServiceClient(), lojaId)
export const listarFornecedores = (lojaId: number) => q.listarFornecedores(createServiceClient(), lojaId)
export const listarTitulos = (lojaId: number, filtros: q.FiltrosTitulos, hoje: string, limite: number, offset: number) =>
  q.listarTitulos(createServiceClient(), lojaId, filtros, hoje, limite, offset)
export const detalheTitulo = (lojaId: number, id: number, hoje: string) => q.detalheTitulo(createServiceClient(), lojaId, id, hoje)
export const extratoConta = (lojaId: number, contaId: number, de: string | null, ate: string | null) =>
  q.extratoConta(createServiceClient(), lojaId, contaId, de, ate)

// Contas a pagar geradas pela nota de entrada (migration 340): a tela da nota usa só para desenvolvedor, depois de exigir 'proprio'.
export const titulosDaNota = (lojaId: number, notaId: number) => q.titulosDaNota(createServiceClient(), lojaId, notaId)

// Decisões do dono de 05/11 (migration 360): mapa família → categoria, notas sem conta e notas desfeitas com conta paga.
export const listarFamiliasCategoria = (lojaId: number) => q.listarFamiliasCategoria(createServiceClient(), lojaId)
export const notasSemConta = (lojaId: number | null) => q.notasSemConta(createServiceClient(), lojaId)
export const pendenciasNotaDesfeita = (lojaId: number) => q.pendenciasNotaDesfeita(createServiceClient(), lojaId)

// Fase 4 passo 2 (migration 370): configuração, aprovações, recorrentes, avulsos e transferências.
export const lerConfigFinanceiro = (lojaId: number) => q.lerConfigFinanceiro(createServiceClient(), lojaId)
export const listarAprovacoes = (lojaId: number, situacao: 'pendente' | 'decididas') => q.listarAprovacoes(createServiceClient(), lojaId, situacao)
export const listarRecorrentes = (lojaId: number, hoje: string) => q.listarRecorrentes(createServiceClient(), lojaId, hoje)
export const listarAvulsosTransferencias = (lojaId: number) => q.listarAvulsosTransferencias(createServiceClient(), lojaId)

/** Nível de aprovação do usuário na loja: 2 = alto valor (admin/dono), 1 = gerente, 0 = não aprova. */
export async function nivelAprovacaoUsuario(lojaId: number): Promise<0 | 1 | 2> {
  if (await requirePermissao(lojaId, PERM.aprovarAlto)) return 2
  return (await requirePermissao(lojaId, PERM.aprovar)) ? 1 : 0
}

/** Lojas de estoque próprio (ativas) em que o desenvolvedor tem a permissão: a tela "Notas sem conta a pagar" olha todas. */
export async function lojasPropriasComPermissao(permissao: string): Promise<{ id: number; nome: string }[]> {
  await exigirDev()
  const { data, error } = await createServiceClient().from('lojas').select('id, nome').eq('modo_estoque', 'proprio').eq('ativo', true).order('id')
  if (error) throw new Error(`Não foi possível carregar as lojas: ${error.message}`)
  const out: { id: number; nome: string }[] = []
  for (const l of (data ?? []) as { id: number; nome: string }[]) if (await requirePermissao(l.id, permissao)) out.push({ id: Number(l.id), nome: String(l.nome) })
  return out
}
