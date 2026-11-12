import { notFound } from 'next/navigation'
import { getAtorGestao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { NavCozinha } from '@/components/custo-cardapio/NavCozinha'

// Norte Cozinha: só desenvolvedor (ROTAS_SO_DEV) e quem gere a loja. Cada página repete a checagem do que grava.
export default async function CozinhaLayout({ children }: { children: React.ReactNode }) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) notFound()
  return (
    <div className="space-y-4">
      <NavCozinha />
      {children}
    </div>
  )
}
