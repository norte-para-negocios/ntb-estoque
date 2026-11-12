import type { Metadata } from 'next'
import { Geist, Newsreader } from 'next/font/google'
import './plataforma.css'

// Plataforma Norte: /entrar (login novo) e /porta (depois do login). Layout próprio, sem o AppShell do ERP.
const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--pn-geist', display: 'swap' })
const newsreader = Newsreader({ subsets: ['latin'], weight: ['300', '400'], style: 'italic', variable: '--pn-newsreader', display: 'swap' })

export const metadata: Metadata = { title: 'Norte' }

export default function PlataformaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pn ${geist.variable} ${newsreader.variable}`}>{children}</div>
}
