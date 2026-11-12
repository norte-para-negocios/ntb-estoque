import type { Metadata } from 'next'
import './plataforma.css'

// Plataforma Norte: /entrar (login novo) e /porta (depois do login). Layout próprio, sem o AppShell do ERP.
// Fontes pelo CSS do Google Fonts (next/font/google falha no build do servidor: ele não baixa as fontes).
export const metadata: Metadata = { title: 'Norte' }

const FONTES = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@1,6..72,300;1,6..72,400&display=swap'

export default function PlataformaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pn" style={{ ['--pn-geist' as string]: "'Geist'", ['--pn-newsreader' as string]: "'Newsreader'" }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={FONTES} />
      {children}
    </div>
  )
}
