import { exigirDev } from '@/lib/recursos-dev'

// Menu por módulos + Central de cada módulo: ainda só para desenvolvedores (lib/recursos-dev.ts).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await exigirDev()
  return children
}
