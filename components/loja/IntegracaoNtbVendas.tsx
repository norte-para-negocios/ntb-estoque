'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Check, RefreshCw, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { gerarChaveIntegracaoNtbVendas, removerChaveIntegracaoNtbVendas } from '@/lib/actions/integracao-ntb-vendas'

// Integracao ntb-vendas -> ntb-estoque (Ordem de Producao automatica a cada
// venda fechada). A chave e write-only: so aparece aqui, uma vez, logo apos
// gerar/regenerar (estado local, nunca vem do banco de volta) -- mesmo
// principio ja usado pro CSC/senha do certificado neste projeto e no
// ntb-vendas. Depois disso a tela so mostra "Configurada" + acoes.
export function IntegracaoNtbVendas({
  lojaId,
  configurada,
}: {
  lojaId: number
  configurada: boolean
}) {
  const [revelado, setRevelado] = useState<{ chave: string; url: string } | null>(null)
  const [copiadoChave, setCopiadoChave] = useState(false)
  const [copiadoUrl, setCopiadoUrl] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function copiar(valor: string, marcar: (v: boolean) => void) {
    navigator.clipboard.writeText(valor)
    marcar(true)
    setTimeout(() => marcar(false), 2000)
  }

  function gerar() {
    startTransition(async () => {
      const res = await gerarChaveIntegracaoNtbVendas(lojaId)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      setRevelado({ chave: res.chave!, url: res.url! })
      toast.success(configurada ? 'Nova chave gerada' : 'Chave gerada')
      router.refresh()
    })
  }

  function remover() {
    startTransition(async () => {
      const res = await removerChaveIntegracaoNtbVendas(lojaId)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      setRevelado(null)
      toast.success('Integração removida')
      router.refresh()
    })
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Share2 className="size-4 text-text-muted" />
        <span className="text-[13px] font-medium text-text">Integração com NTB Vendas</span>
      </div>
      <p className="mb-2 text-[12px] text-text-muted">
        Gera a chave que autentica as chamadas do NTB Vendas pra esta loja (cada venda fechada por
        lá cria automaticamente uma Ordem de Produção aqui). Copie a URL e a chave e cole no
        formulário de loja do NTB Vendas — a chave só é mostrada uma vez, logo depois de gerar.
      </p>

      {revelado && (
        <div className="mb-3 space-y-2 rounded-md border border-brand/30 bg-brand/5 p-3">
          <p className="text-[12px] font-medium text-text">
            Copie agora — não será mostrada de novo:
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={revelado.url}
              readOnly
              className="num min-w-[12rem] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text outline-none"
            />
            <button type="button" onClick={() => copiar(revelado.url, setCopiadoUrl)} className={`${btnClass('outline')} shrink-0`}>
              {copiadoUrl ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiadoUrl ? 'Copiado' : 'Copiar URL'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={revelado.chave}
              readOnly
              className="num min-w-[12rem] flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] tracking-wide text-text outline-none"
            />
            <button type="button" onClick={() => copiar(revelado.chave, setCopiadoChave)} className={`${btnClass('outline')} shrink-0`}>
              {copiadoChave ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiadoChave ? 'Copiado' : 'Copiar chave'}
            </button>
          </div>
        </div>
      )}

      {configurada ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-1 text-[11px] font-semibold text-ok">
            Chave configurada
          </span>
          <button type="button" onClick={gerar} disabled={pending} className={`${btnClass('outline')} shrink-0`}>
            {pending ? <Spinner /> : <RefreshCw className="size-4" />} {pending ? 'Gerando...' : 'Gerar nova chave'}
          </button>
          <button
            type="button"
            onClick={remover}
            disabled={pending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-err/40 px-3 py-1.5 text-sm font-medium text-err transition-colors hover:bg-err/10 disabled:opacity-60"
          >
            <Trash2 className="size-4" /> Remover integração
          </button>
        </div>
      ) : (
        <button type="button" onClick={gerar} disabled={pending} className={btnClass('primary')}>
          {pending ? <Spinner /> : <Share2 className="size-4" />} {pending ? 'Gerando...' : 'Gerar chave de integração'}
        </button>
      )}
    </div>
  )
}
