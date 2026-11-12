import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { carregarAcessos } from '@/lib/plataforma/assinaturas'
import { MODULOS, type ModuloId } from '@/lib/plataforma/modulos-puro'
import { Vitrine } from '@/components/plataforma/Vitrine'

// Plataforma Norte: página de um módulo que a loja não tem. Rota livre (moduloDaRota('/modulos') = null): nunca é
// bloqueada. Módulo que abre nesta loja vai direto para a tela dele. `?previa` (só equipe da Norte) mostra a vitrine
// mesmo com o módulo aberto, para conferir o visual.
export const dynamic = 'force-dynamic'

/** Tela de entrada de cada módulo quando ele abre (Vendas é outro app e o ERP não tem tela única: voltam ao Início). */
const ROTA: Record<ModuloId, string> = {
  dashboard: '/home',
  vendas: '/home',
  erp: '/home',
  cozinha: '/cozinha',
  pacioli: '/pacioli',
}

const moduloDe = (id: string) => MODULOS.find((m) => m.id === id)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const m = moduloDe((await params).id)
  return { title: m ? m.nome : 'Módulo' }
}

export default async function ModuloPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ previa?: string }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const modulo = moduloDe(id)
  if (!modulo) notFound()
  const [profile, { acessos }] = await Promise.all([getProfile(), carregarAcessos()])
  const previa = sp.previa !== undefined && profile.is_super_admin === true
  if (acessos[modulo.id] === 'abre' && !previa) redirect(ROTA[modulo.id])
  const loja = profile.loja?.nome_fantasia || profile.loja?.nome || ''
  return <Vitrine modulo={modulo.id} loja={loja} />
}
