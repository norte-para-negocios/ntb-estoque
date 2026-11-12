// Plataforma Norte: regras da tela da Norte para módulos e preços (PURO, sem banco, sem alias do Next; node --test).
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { MODULOS, ESTADOS, type ModuloId, type Estado } from './modulos-puro.ts'

/** Planos da migration 475 (ids fixos). preco_mensal começa vazio: "definir". Nunca aparece para o cliente. */
export const PLANOS: readonly { id: string; modulo: ModuloId; nome: string }[] = [
  { id: 'vendas-balcao', modulo: 'vendas', nome: 'Balcão' },
  { id: 'vendas-mesas', modulo: 'vendas', nome: 'Mesas' },
  { id: 'vendas-mais-10-mesas', modulo: 'vendas', nome: 'Mais 10 mesas' },
  { id: 'erp', modulo: 'erp', nome: 'Por loja' },
  { id: 'cozinha', modulo: 'cozinha', nome: 'Por loja' },
  { id: 'pacioli', modulo: 'pacioli', nome: 'Por loja' },
]
export const PLANOS_VENDAS = PLANOS.filter((p) => p.modulo === 'vendas')

export type DadosAssinatura = { estado: Estado | null; planoId: string | null; precoCombinado: number | null }

const precoRuim = (p: number | null) => p != null && (typeof p !== 'number' || !Number.isFinite(p) || p < 0)

/** null = válido; senão a mensagem para a tela. */
export function validarAssinatura(lojaId: number, modulo: ModuloId, d: DadosAssinatura): string | null {
  if (!Number.isInteger(lojaId) || lojaId <= 0) return 'Loja inválida.'
  if (!MODULOS.some((m) => m.id === modulo)) return 'Módulo desconhecido.'
  if (d.estado !== null && !ESTADOS.includes(d.estado)) return 'Estado desconhecido.'
  if (d.planoId != null && !PLANOS.some((p) => p.id === d.planoId && p.modulo === modulo)) return 'Plano não é deste módulo.'
  if (precoRuim(d.precoCombinado)) return 'Preço precisa ser um número igual ou maior que zero.'
  return null
}

export function validarPreco(planoId: string, preco: number | null): string | null {
  if (!PLANOS.some((p) => p.id === planoId)) return 'Plano desconhecido.'
  if (precoRuim(preco)) return 'Preço precisa ser um número igual ou maior que zero.'
  return null
}

/** Erro do PostgREST/Postgres de tabela que não existe (migration 475 ainda não aplicada). */
export function tabelaAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  return /could not find the table|does not exist/i.test(error.message ?? '') && /plataforma_/.test(error.message ?? '')
}

/** Lojas reais primeiro, depois as de teste; por nome (sem caixa nem acento) dentro de cada grupo. */
export function ordenarLojas<T extends { id: number; nome: string; is_test: boolean | null }>(lojas: T[]): T[] {
  return [...lojas].sort((a, b) =>
    Number(!!a.is_test) - Number(!!b.is_test) || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || a.id - b.id)
}
