import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { PACIOLI_URL, LOJAS_PACIOLI, pacioliLiberado } from '@/lib/pacioli'

export const metadata = { title: 'Pacioli' }

// Pacioli (robô de correções) dentro do Norte Estoque: a tela do robô (servidor norte-faxina) embutida, já na loja
// selecionada aqui. Só dev (admin) e lojas que contrataram o robô (lib/pacioli.ts); o login do Pacioli é dele mesmo.
export default async function PacioliPage() {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'
  const superAdmin = profile.is_super_admin === true
  if (!pacioliLiberado(profile.current_loja_id, isAdmin, superAdmin)) notFound()
  const loja = profile.current_loja_id != null ? LOJAS_PACIOLI[profile.current_loja_id] : undefined
  const src = `${PACIOLI_URL}/${loja ? `?loja=${loja}` : ''}`
  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[560px] flex-col gap-2 md:h-[calc(100dvh-4rem)]">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-sm text-muted-foreground">
          Robô que confere e corrige o estoque no Omie{loja ? '' : ' (escolha a loja dentro da tela)'}.
        </p>
        <a href={src} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          Abrir em tela cheia <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <iframe
        src={src}
        title="Pacioli"
        className="w-full flex-1 rounded-2xl border border-border bg-background"
        allow="clipboard-write"
      />
    </div>
  )
}
