import { notFound, redirect } from 'next/navigation'
import { exigirDev } from '@/lib/recursos-dev'
import { moduloPorId } from '@/lib/central/modulos'
import { CentralModulo } from '@/components/central/CentralView'

export async function generateMetadata({ params }: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await params
  return { title: moduloPorId(modulo)?.nome ?? 'Central' }
}

export default async function CentralModuloPage({ params }: { params: Promise<{ modulo: string }> }) {
  await exigirDev()
  const { modulo } = await params
  const m = moduloPorId(modulo)
  if (!m) notFound()
  // Dashboard não tem central: o nome do módulo já abre o painel.
  if (m.href) redirect(m.href)
  return <CentralModulo id={modulo} />
}
