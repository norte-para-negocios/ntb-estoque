'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { salvarCertificado } from '@/lib/actions/certificado'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-brand'

// Bloco 5.2: a propria loja sobe o certificado A1 (.pfx) + senha. A senha vai
// criptografada; o arquivo, para o Storage privado. Tudo via server action.
export function CertificadoUpload({
  lojaId,
  nome,
  validade,
}: {
  lojaId: number
  nome: string | null
  validade: string | null
}) {
  const [senha, setSenha] = useState('')
  const [validadeInput, setValidadeInput] = useState(validade ?? '')
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function enviar() {
    const arquivo = fileRef.current?.files?.[0]
    if (!arquivo) {
      toast.error('Selecione o arquivo .pfx')
      return
    }
    if (!senha) {
      toast.error('Informe a senha do certificado')
      return
    }
    const fd = new FormData()
    fd.set('loja_id', String(lojaId))
    fd.set('arquivo', arquivo)
    fd.set('senha', senha)
    fd.set('validade', validadeInput)
    startTransition(async () => {
      const res = await salvarCertificado(fd)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Certificado salvo')
      setSenha('')
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-text">
        <ShieldCheck className="size-4 text-text-muted" /> Certificado digital A1
      </div>
      {nome ? (
        <p className="mb-3 text-[12px] text-text-muted">
          Atual: <span className="text-text">{nome}</span>
          {validade && (
            <>
              {' · vence em '}
              <span className="text-text">
                {new Date(validade).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })}
              </span>
            </>
          )}
        </p>
      ) : (
        <p className="mb-3 text-[12px] text-text-muted">Nenhum certificado enviado.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Arquivo (.pfx)</label>
          <input
            ref={fileRef}
            type="file"
            accept=".pfx,.p12"
            className="block w-full text-[13px] text-text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text hover:file:bg-surface-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Senha</label>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className={inputClass}
            placeholder="Senha do certificado"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-text-muted">Validade (opcional)</label>
          <input type="date" value={validadeInput} onChange={(e) => setValidadeInput(e.target.value)} className={inputClass} />
        </div>
        <div className="flex items-end">
          <button type="button" onClick={enviar} disabled={pending} className={btnClass('outline')}>
            {pending ? <Spinner /> : <Upload className="size-4" />}
            {pending ? 'Enviando...' : 'Salvar certificado'}
          </button>
        </div>
      </div>
    </div>
  )
}
