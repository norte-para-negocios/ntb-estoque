import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NTB Estoque',
    short_name: 'NTB Estoque',
    description: 'Sistema de gestão de estoque integrado ao Omie',
    start_url: '/home',
    display: 'standalone',
    background_color: '#f7f8fa',
    theme_color: '#2eb5c3',
    lang: 'pt-BR',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
