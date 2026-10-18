'use client'

// Nota pela chave digitada (loja de estoque próprio, Fase B/R14): consulta a SEFAZ (só leitura, 1 vez por chave por hora).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { buscarNotaPorChaveNF } from '@/lib/actions/nota-fiscal-proprio'

export function BuscarPorChave() {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [chave, setChave] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const digitos = chave.replace(/\D/g, '')
  function buscar() {
    setMsg(null)
    start(async () => {
      const r = await buscarNotaPorChaveNF(digitos)
      if ('error' in r) { setMsg(r.error); return }
      if (r.situacao === 'completa' && r.notaId) { toast.success('Nota encontrada'); router.push(`/nota-fiscal/${r.notaId}`); return }
      if (r.situacao === 'resumo') { setMsg('A SEFAZ mandou só o resumo: o XML completo chega depois da ciência da operação.'); router.refresh(); return }
      setMsg('A SEFAZ não encontrou esta nota para o CNPJ da loja.')
    })
  }
  if (!aberto) return <button type="button" className={btnClass('outline')} onClick={() => setAberto(true)}><KeyRound className="size-4" /> Buscar nota pela chave</button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input inputMode="numeric" autoFocus placeholder="Chave de acesso (44 dígitos)" aria-label="Chave de acesso"
        className="num h-9 w-[23rem] max-w-full rounded-[var(--r-md)] border border-[var(--border)] bg-surface px-3 text-[13px]" value={chave} onChange={(e) => setChave(e.target.value)} />
      <button type="button" className={btnClass('primary')} disabled={pending || digitos.length !== 44} onClick={buscar}>{pending && <Spinner />}Buscar</button>
      <button type="button" className={btnClass('outline')} onClick={() => { setAberto(false); setMsg(null) }}>Fechar</button>
      {msg && <p className="w-full text-[13px] text-text-muted">{msg}</p>}
    </div>
  )
}
