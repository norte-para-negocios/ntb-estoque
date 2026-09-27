import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Norte Estoque',
    short_name: 'Norte Estoque',
    description: 'Sistema de gestão de estoque integrado ao Omie',
    start_url: '/home',
    display: 'standalone',
    background_color: '#f7f8fa',
    theme_color: '#2eb5c3',
    lang: 'pt-BR',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
