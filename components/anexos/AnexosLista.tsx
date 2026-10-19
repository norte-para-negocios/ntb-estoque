'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Eye, Paperclip, Trash2 } from 'lucide-react'
import { excluirAnexo } from '@/lib/actions/anexos'
import { ACCEPT_ANEXO, LIMITE_ANEXO_BYTES, MAX_ANEXOS_POR_REGISTRO } from '@/lib/anexos/anexos-puro'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

export type AnexoLinha = { id: number; nome: string; mime: string; tamanho: number; enviadoPor: string | null; em: string }

const VER = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])

function tamanhoLegivel(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`
  return `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export function AnexosLista({ entidade, entidadeId, anexos, podeEnviar, podeExcluir }: {
  entidade: string
  entidadeId: string
  anexos: AnexoLinha[]
  podeEnviar: boolean
  podeExcluir: boolean
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [pending, start] = useTransition()
  const cheio = anexos.length >= MAX_ANEXOS_POR_REGISTRO

  async function enviar(arquivos: FileList | null) {
    const lista = Array.from(arquivos ?? [])
    if (!lista.length) return
    setEnviando(true)
    let ok = 0
    for (const arquivo of lista) {
      if (arquivo.size > LIMITE_ANEXO_BYTES) { toast.error(`${arquivo.name}: o limite é 8 MB`); continue }
      const fd = new FormData()
      fd.set('entidade', entidade)
      fd.set('entidade_id', entidadeId)
      fd.set('arquivo', arquivo)
      try {
        const r = await fetch('/api/anexos', { method: 'POST', body: fd })
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) toast.error(`${arquivo.name}: ${j.error ?? 'falha ao enviar'}`)
        else ok++
      } catch {
        toast.error(`${arquivo.name}: sem conexão com o servidor (anexos precisam de internet)`)
      }
    }
    setEnviando(false)
    if (input.current) input.current.value = ''
    if (ok) { toast.success(ok === 1 ? 'Anexo enviado' : `${ok} anexos enviados`); router.refresh() }
  }

  function excluir(a: AnexoLinha) {
    if (!window.confirm(`Excluir o anexo "${a.nome}"?`)) return
    start(async () => {
      const r = await excluirAnexo(a.id)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Anexo excluído')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {anexos.length === 0 ? (
        <p className="text-[13px] text-text-muted">Nenhum anexo.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {anexos.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0">
              <div className="min-w-0">
                <a href={`/api/anexos/${a.id}`} className="block truncate text-[14px] font-medium text-text hover:underline">{a.nome}</a>
                <span className="text-[12px] text-text-muted">
                  {tamanhoLegivel(a.tamanho)} · {a.enviadoPor ?? 'Usuário'} · {new Date(a.em).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {VER.has(a.mime) && (
                  <a href={`/api/anexos/${a.id}?ver=1`} target="_blank" rel="noopener noreferrer" className={btnLinhaClass('ghost')} title="Abrir">
                    <Eye className="size-4" /> <RotuloAcao>Abrir</RotuloAcao>
                  </a>
                )}
                <a href={`/api/anexos/${a.id}`} className={btnLinhaClass('ghost')} title="Baixar"><Download className="size-4" /> <RotuloAcao>Baixar</RotuloAcao></a>
                {podeExcluir && (
                  <button type="button" onClick={() => excluir(a)} disabled={pending} className={btnLinhaClass('ghost')} title="Excluir">
                    <Trash2 className="size-4" /> <RotuloAcao>Excluir</RotuloAcao>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {podeEnviar && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" multiple accept={ACCEPT_ANEXO} className="sr-only" id={`anexo-${entidade}-${entidadeId}`}
            onChange={(e) => enviar(e.target.files)} disabled={enviando || cheio} />
          <label htmlFor={`anexo-${entidade}-${entidadeId}`}
            className={`${btnClass('outline')} ${enviando || cheio ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
            {enviando ? <Spinner /> : <Paperclip className="size-4" />} {enviando ? 'Enviando...' : 'Anexar arquivo'}
          </label>
          <span className="text-[12px] text-text-muted">
            {cheio ? `Máximo de ${MAX_ANEXOS_POR_REGISTRO} anexos.` : 'PDF, imagem, XML, CSV, TXT, XLSX ou DOCX, até 8 MB.'}
          </span>
        </div>
      )}
    </div>
  )
}
