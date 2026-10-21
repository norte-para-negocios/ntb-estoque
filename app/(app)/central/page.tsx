import { exigirDev } from '@/lib/recursos-dev'
import { CentralGeral } from '@/components/central/CentralView'

export const metadata = { title: 'Central' }

export default async function CentralPage() {
  await exigirDev()
  return <CentralGeral />
}
