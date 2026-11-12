// Plataforma Norte: módulos, estados de assinatura e o que cada estado permite (PURO, sem banco, sem alias do Next; node --test).
// Regra de ouro: loja sem configuração = tudo como hoje (padrões abaixo reproduzem o comportamento atual).
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { LOJAS_PACIOLI } from '../pacioli.ts'

export type ModuloId = 'dashboard' | 'vendas' | 'erp' | 'cozinha' | 'pacioli'
export type Estado = 'ativo' | 'teste' | 'bloqueado' | 'suspenso'
export type Acesso = 'abre' | 'consulta' | 'vitrine'
export type Quem = { superAdmin: boolean; admin: boolean }

export const MODULOS: readonly { id: ModuloId; nome: string }[] = [
  { id: 'dashboard', nome: 'Início' },
  { id: 'vendas', nome: 'Norte Vendas' },
  { id: 'erp', nome: 'Norte ERP' },
  { id: 'cozinha', nome: 'Norte Cozinha' },
  { id: 'pacioli', nome: 'Pacioli' },
]

export const ESTADOS: readonly Estado[] = ['ativo', 'teste', 'bloqueado', 'suspenso']

/** Estado quando a loja não tem linha gravada. */
export function estadoPadrao(modulo: ModuloId, lojaId: number | null): Estado {
  if (modulo === 'cozinha') return 'teste'
  if (modulo === 'pacioli') return lojaId != null && lojaId in LOJAS_PACIOLI ? 'ativo' : 'bloqueado'
  return 'ativo'
}

export const estadoEfetivo = (gravado: Estado | undefined, modulo: ModuloId, lojaId: number | null): Estado =>
  gravado ?? estadoPadrao(modulo, lojaId)

export function acesso(estado: Estado, _modulo: ModuloId, quem: Quem): Acesso {
  if (estado === 'ativo') return 'abre'
  if (estado === 'suspenso') return 'consulta'
  if (estado === 'teste') return quem.superAdmin ? 'abre' : 'vitrine'
  return 'vitrine'
}

const LIVRES = ['modulos', 'plataforma', 'usuario', 'loja', 'minha-loja', 'cargo', 'login', 'central', 'api', 'porta', 'entrar']

/** Módulo dono da rota; null = rota livre (nunca bloqueada). Casa por segmento. */
export function moduloDaRota(pathname: string): ModuloId | null {
  const seg = pathname.split(/[?#]/)[0].split('/').filter(Boolean)[0] ?? ''
  if (LIVRES.includes(seg)) return null
  if (seg === 'home' || seg === 'resumo') return 'dashboard'
  if (seg === 'cozinha') return 'cozinha'
  if (seg === 'pacioli') return 'pacioli'
  return 'erp'
}

export function acessosDaLoja(gravados: Partial<Record<ModuloId, Estado>>, lojaId: number | null, quem: Quem): Record<ModuloId, Acesso> {
  const out = {} as Record<ModuloId, Acesso>
  for (const { id } of MODULOS) {
    // Paridade com pacioliLiberado: admin/dev abrem o Pacioli mesmo sem linha gravada.
    if (id === 'pacioli' && gravados.pacioli === undefined && (quem.admin || quem.superAdmin)) {
      out[id] = 'abre'
      continue
    }
    out[id] = acesso(estadoEfetivo(gravados[id], id, lojaId), id, quem)
  }
  return out
}
