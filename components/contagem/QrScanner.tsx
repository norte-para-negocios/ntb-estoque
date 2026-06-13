'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { QrCode, X } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'

// Tipo mínimo do html5-qrcode (carregado via dynamic import, ssr:false)
type Html5QrcodeInstance = {
  start: (
    cameraIdOrConfig: { facingMode: string } | string,
    config: { fps: number; qrbox: { width: number; height: number } },
    onSuccess: (decodedText: string) => void,
    onError?: (err: string) => void
  ) => Promise<void>
  stop: () => Promise<void>
  clear: () => void
}

export function QrScanner({ onLeitura }: { onLeitura: (codigo: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const scannerRef = useRef<Html5QrcodeInstance | null>(null)
  const regionId = useId().replace(/:/g, '')
  const lidoRef = useRef(false)

  async function parar() {
    const inst = scannerRef.current
    scannerRef.current = null
    if (inst) {
      try {
        await inst.stop()
        inst.clear()
      } catch {
        // ignora erros ao parar (camera ja parada)
      }
    }
    setAberto(false)
    setCarregando(false)
  }

  async function abrir() {
    setAberto(true)
    setCarregando(true)
    lidoRef.current = false
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      // garante que o elemento ja existe no DOM
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const inst = new Html5Qrcode(regionId) as unknown as Html5QrcodeInstance
      scannerRef.current = inst
      await inst.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          if (lidoRef.current) return
          lidoRef.current = true
          const codigo = decodedText.trim()
          parar()
          if (codigo) onLeitura(codigo)
        }
      )
      setCarregando(false)
    } catch (err) {
      console.error('QrScanner', err)
      const msg = String((err as Error)?.message ?? err)
      if (/permission|denied|NotAllowed/i.test(msg)) {
        toast.error('Permissão da câmera negada', {
          description: 'Libere o acesso à câmera nas configurações do navegador.',
        })
      } else if (/NotFound|no camera|Requested device not found/i.test(msg)) {
        toast.error('Nenhuma câmera encontrada', {
          description: 'Este dispositivo não tem câmera disponível.',
        })
      } else {
        toast.error('Não foi possível abrir a câmera', { description: msg })
      }
      parar()
    }
  }

  useEffect(() => {
    return () => {
      const inst = scannerRef.current
      if (inst) {
        inst.stop().then(() => inst.clear()).catch(() => {})
      }
    }
  }, [])

  return (
    <div>
      {!aberto ? (
        <button type="button" onClick={abrir} className={`${btnClass('outline')} w-full`}>
          <QrCode className="size-4" />
          Ler QR Code
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-text">
              {carregando ? 'Abrindo câmera...' : 'Aponte para o QR Code'}
            </span>
            <button
              type="button"
              onClick={parar}
              className={btnClass('ghost')}
              aria-label="Parar leitura"
            >
              <X className="size-4" />
              Parar
            </button>
          </div>
          <div
            id={regionId}
            className="mx-auto w-full max-w-xs overflow-hidden rounded-md bg-black [&_video]:w-full"
          />
        </div>
      )}
    </div>
  )
}
