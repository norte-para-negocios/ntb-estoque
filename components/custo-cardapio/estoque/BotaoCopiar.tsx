'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { btnClass, type BtnVariant } from '@/components/ui-kit/Button'

/** Copia um texto pronto (lista para o WhatsApp). Se o navegador bloquear, mostra o texto para copiar à mão. */
export function BotaoCopiar({ texto, rotulo = 'Copiar para WhatsApp', variante = 'outline' }: { texto: string; rotulo?: string; variante?: BtnVariant }) {
  const [feito, setFeito] = useState(false)
  const [erro, setErro] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setFeito(true)
      setErro(false)
      setTimeout(() => setFeito(false), 2200)
    } catch {
      setErro(true)
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={copiar} className={btnClass(variante)}>
        {feito ? <Check className="size-4" /> : <Copy className="size-4" />}
        {feito ? 'Copiado' : rotulo}
      </button>
      {erro && (
        <>
          <span className="text-[12px] text-err">Não deu para copiar. Selecione o texto abaixo e copie.</span>
          <textarea readOnly value={texto} rows={6} onFocus={(e) => e.currentTarget.select()}
            className="w-[280px] rounded-[var(--r-md)] bg-surface-2 p-2 text-[12px] text-text outline-none" />
        </>
      )}
    </span>
  )
}
