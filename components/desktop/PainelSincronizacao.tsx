'use client'

import * as React from 'react'
import { btnClass } from '@/components/ui-kit/Button'

type Item = { intentId: string; acao: string; estado: string; erro?: string; criadoEm: string; modo: string }
type Status = {
  online: boolean | null
  ultimaSync: string | null
  erro: string | null
  pendentes: number
  comErro: number
  carga: { pronta: boolean; fase: string | null; pct: number }
}

const ESTADO: Record<string, string> = {
  pendente: 'Aguardando envio',
  aguardando_local: 'Salvando neste computador',
  erro: 'Recusada pelo servidor',
  verificar: 'Conferir na tela',
}

// "inventario#addInventarioItem" -> "Inventário · add inventario item" (rótulo legível sem tabela de nomes)
function rotulo(acao: string) {
  const [mod, fn] = acao.split('#')
  const modulo = mod.replaceAll('-', ' ')
  const funcao = fn.replace(/([A-Z])/g, ' $1').toLowerCase()
  return `${modulo.charAt(0).toUpperCase()}${modulo.slice(1)} · ${funcao}`
}

const post = (caminho: string, corpo: unknown = {}) =>
  fetch(caminho, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ntb': '1' }, body: JSON.stringify(corpo) })

export function PainelSincronizacao() {
  const [st, setSt] = React.useState<Status | null>(null)
  const [itens, setItens] = React.useState<Item[]>([])
  const [confirmarApagar, setConfirmarApagar] = React.useState(false)

  const ler = React.useCallback(async () => {
    try {
      const [s, f] = await Promise.all([fetch('/__ntb/status', { cache: 'no-store' }), fetch('/__ntb/fila', { cache: 'no-store' })])
      setSt(await s.json())
      setItens(await f.json())
    } catch {
      // gateway reiniciando
    }
  }, [])

  React.useEffect(() => {
    ler()
    const t = setInterval(ler, 3000)
    return () => clearInterval(t)
  }, [ler])

  if (!st) return null

  return (
    <div className="space-y-4">
      <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold">
              {st.online === false ? 'Sem internet' : st.online ? 'Conectado' : 'Verificando conexão…'}
            </p>
            <p className="text-[13px] text-text-muted">
              {st.ultimaSync ? `Última sincronização: ${new Date(st.ultimaSync).toLocaleString('pt-BR')}` : 'Ainda não sincronizou nesta sessão.'}
              {st.erro ? ` · ${st.erro}` : ''}
            </p>
            {!st.carga.pronta && st.carga.fase && <p className="text-[13px] text-text-muted">{st.carga.fase}</p>}
          </div>
          <button type="button" className={btnClass('outline')} onClick={() => post('/__ntb/sincronizar').then(ler)}>
            Sincronizar agora
          </button>
        </div>
      </section>

      <section className="rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        <h2 className="px-4 pt-4 text-[15px] font-semibold">Operações feitas sem internet</h2>
        {itens.length === 0 ? (
          <p className="px-4 pb-4 pt-1 text-[13px] text-text-muted">Nada aguardando. Tudo o que foi feito neste computador já está no servidor.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {itens.map((it) => (
              <li key={it.intentId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px]">{rotulo(it.acao)}</p>
                  <p className="text-[12px] text-text-muted">
                    {new Date(it.criadoEm).toLocaleString('pt-BR')} · {ESTADO[it.estado] ?? it.estado}
                  </p>
                  {it.erro && <p className="text-[13px] text-err">{it.erro}</p>}
                </div>
                {it.estado !== 'aguardando_local' && (
                  <button type="button" className={btnClass('dangerSoft')} onClick={() => post('/__ntb/fila/descartar', { intentId: it.intentId }).then(ler)}>
                    Descartar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
        <p className="text-[15px] font-semibold">Dados deste computador</p>
        <p className="mb-3 text-[13px] text-text-muted">
          Apaga a cópia local e a sessão. Use ao entregar o computador para outra pessoa. Operações ainda não enviadas são perdidas.
        </p>
        {confirmarApagar ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnClass('danger')}
              onClick={async () => {
                await post('/__ntb/apagar-dados')
                window.location.href = '/login'
              }}
            >
              Apagar tudo agora
            </button>
            <button type="button" className={btnClass('ghost')} onClick={() => setConfirmarApagar(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className={btnClass('dangerSoft')} onClick={() => setConfirmarApagar(true)}>
            Sair e apagar dados deste computador
          </button>
        )}
      </section>
    </div>
  )
}
