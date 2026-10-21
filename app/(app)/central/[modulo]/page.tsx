import { notFound } from 'next/navigation'
import { exigirDev } from '@/lib/recursos-dev'
import { moduloPorId } from '@/lib/central/modulos'
import { CentralModulo } from '@/components/central/CentralView'

export default async function CentralModuloPage({ params }: { params: Promise<{ modulo: string }> }) {
  await exigirDev()
  const { modulo } = await params
  if (!moduloPorId(modulo)) notFound()
  return <CentralModulo id={modulo} />
}
