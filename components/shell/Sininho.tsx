'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Popover } from '@base-ui/react/popover'
import { Bell } from 'lucide-react'
import { marcarNotificacaoLida, marcarTodasLidas, minhasNotificacoes, type NotificacaoTela } from '@/lib/actions/notificacoes'

const INTERVALO_MS = 5 * 60_000
const COR: Record<NotificacaoTela['gravidade'], string> = { err: 'bg-err', warn: 'bg-warn', info: 'bg-brand' }

function quando(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit' })
}

/**
 * Sininho (Fase G, migration 222): notificações da loja atual geradas pelo cron gerar-notificacoes. Consulta ao abrir a
 * tela, a cada 5 min e ao voltar para a aba. Clicar numa notificação marca como lida e abre a tela certa.
 */
export function Sininho({ tela, className = '' }: { tela: 'desktop' | 'celular'; className?: string }) {
  const router = useRouter()
  const [itens, setItens] = React.useState<NotificacaoTela[]>([])
  const [naoLidas, setNaoLidas] = React.useState(0)
  const [aberto, setAberto] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      const r = await minhasNotificacoes()
      setItens(r.itens)
      setNaoLidas(r.naoLidas)
    } catch {
      /* sem conexão: mantém o que já estava */
    }
  }, [])

  // Há um sininho no topo do celular e outro no desktop (o outro fica escondido por CSS): só o visível consulta.
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const minha = () => (tela === 'desktop') === mq.matches
    if (minha()) void carregar()
    const t = window.setInterval(() => { if (minha() && document.visibilityState === 'visible') void carregar() }, INTERVALO_MS)
    const aoVoltar = () => { if (minha() && document.visibilityState === 'visible') void carregar() }
    document.addEventListener('visibilitychange', aoVoltar)
    mq.addEventListener('change', aoVoltar)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar); mq.removeEventListener('change', aoVoltar) }
  }, [carregar, tela])

  async function abrir(n: NotificacaoTela) {
    setAberto(false)
    if (!n.lida) {
      setItens((xs) => xs.map((x) => (x.id === n.id ? { ...x, lida: true } : x)))
      setNaoLidas((k) => Math.max(0, k - 1))
      void marcarNotificacaoLida(n.id)
    }
    if (n.link) router.push(n.link)
  }

  async function todasLidas() {
    setItens((xs) => xs.map((x) => ({ ...x, lida: true })))
    setNaoLidas(0)
    await marcarTodasLidas()
  }

  return (
    <Popover.Root open={aberto} onOpenChange={(o) => { setAberto(o); if (o) void carregar() }}>
      <Popover.Trigger
        aria-label={naoLidas ? `Notificações: ${naoLidas} não lida${naoLidas === 1 ? '' : 's'}` : 'Notificações'}
        className={`relative flex size-10 items-center justify-center rounded-full text-text-muted u-motion u-press-sm hover:bg-surface-2 hover:text-text lg:size-9 lg:bg-surface lg:shadow-[var(--shadow-sm)] ${className}`}
      >
        <Bell className="size-5 lg:size-4" aria-hidden />
        {naoLidas > 0 && (
          <span className="num absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-err px-1 text-[11px] font-semibold text-white">
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          <Popover.Popup className="w-[min(92vw,380px)] rounded-[var(--r-lg)] bg-surface p-2 text-text shadow-[var(--shadow-lg,0_10px_30px_rgba(0,0,0,.15))] outline-none ring-1 ring-border/60">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <Popover.Title className="text-[15px] font-semibold">Notificações</Popover.Title>
              {naoLidas > 0 && (
                <button type="button" onClick={todasLidas} className="text-[12px] font-medium text-brand hover:underline">Marcar todas como lidas</button>
              )}
            </div>
            {itens.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px] text-text-muted">Nada pendente por aqui.</p>
            ) : (
              <ul className="max-h-[60vh] overflow-y-auto">
                {itens.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => abrir(n)}
                      className={`flex w-full items-start gap-2.5 rounded-[var(--r-md)] px-2 py-2 text-left u-motion hover:bg-surface-2 ${n.lida ? 'opacity-70' : ''}`}>
                      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${COR[n.gravidade]}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] ${n.lida ? 'text-text-muted' : 'font-semibold text-text'}`}>{n.titulo}</span>
                        {n.mensagem && <span className="mt-0.5 block text-[12px] text-text-muted">{n.mensagem}</span>}
                        <span className="mt-0.5 block text-[11px] text-text-muted">{quando(n.atualizadaEm)}{n.lida ? '' : ' · nova'}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
