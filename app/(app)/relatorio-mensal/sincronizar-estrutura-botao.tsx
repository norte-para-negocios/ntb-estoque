'use client'
import { useState } from 'react'
import { Button } from '@/components/ui-kit/Button'

// Sincroniza SÓ os produtos com OP concluída no período que ainda não têm
// ficha técnica em cache (não o catálogo inteiro) -- pacing de 10s no
// servidor (app/api/sync/estrutura-produto/route.ts), pode demorar minutos
// se houver muitos produtos pendentes na primeira vez.
export function SincronizarEstruturaBotao({ dataIni, dataFim }: { dataIni: string; dataFim: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function sincronizar() {
    setCarregando(true)
    setStatus('Buscando produtos pendentes...')
    try {
      const resPendentes = await fetch(`/api/relatorio-mensal/estrutura-pendente?dataIni=${dataIni}&dataFim=${dataFim}`)
      const { pendentes } = await resPendentes.json()
      if (!pendentes?.length) {
        setStatus('Nada pendente -- ficha técnica já sincronizada pra este período.')
        return
      }
      setStatus(`Sincronizando ${pendentes.length} produto(s) -- pode levar alguns minutos...`)
      const res = await fetch('/api/sync/estrutura-produto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigosProduto: pendentes }),
      })
      const dados = await res.json()
      setStatus(
        `Sincronizados: ${dados.sincronizados} · Sem estrutura: ${dados.semEstrutura} · Falhas: ${dados.falhas}` +
          (dados.abortadoPorBloqueioOmie ? ' · BLOQUEADO PELA OMIE, tente de novo mais tarde.' : '')
      )
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={sincronizar} disabled={carregando}>
        {carregando ? 'Sincronizando...' : 'Sincronizar ficha técnica (Baixas de Estoque)'}
      </Button>
      {status && <p className="text-sm text-text-muted">{status}</p>}
    </div>
  )
}
