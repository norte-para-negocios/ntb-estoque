'use client'
import { Printer } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

/** Abre a impressão do navegador; "Salvar como PDF" gera o PDF do relatório (estilo em app/globals.css, @media print). */
export function BotaoImprimir() {
  return (
    <button type="button" onClick={() => window.print()} className={btnClass('outline')}>
      <Printer className="size-4" /> Imprimir / PDF
    </button>
  )
}
