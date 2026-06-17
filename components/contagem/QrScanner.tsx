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

// Scanner como instrumento de cozinha: leitura CONTÍNUA (não fecha a cada bip),
// mira visível e feedback corpóreo (flash de tela cheia + vibração) no sucesso/erro.
// onLeitura pode devolver Promise<boolean> (false = produto não encontrado) para
// o flash vermelho; void/true = sucesso (flash verde).
export function QrScanner({
  onLeitura,
}: {
  onLeitura: (codigo: string) => void | boolean | Promise<boolean | void>
}) {
  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null)
  const scannerRef = useRef<Html5QrcodeInstance | null>(null)
  const regionId = useId().replace(/:/g, '')
  const lidoRef = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function vibrar(padrao: number | number[]) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(padrao)
      } catch {
        // alguns navegadores bloqueiam vibrate; ignora
      }
    }
  }

  function piscar(tipo: 'ok' | 'err') {
    setFlash(tipo)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 450)
  }

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
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash(null)
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
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          // Trava só o mesmo frame: a câmera segue aberta para o próximo item.
          if (lidoRef.current) return
          const codigo = decodedText.trim()
          if (!codigo) return
          lidoRef.current = true
          Promise.resolve(onLeitura(codigo))
            .then((res) => {
              const achou = res !== false
              piscar(achou ? 'ok' : 'err')
              vibrar(achou ? 60 : [120, 60, 120])
            })
            .finally(() => {
              // libera para a próxima leitura (parent já deduplica itens repetidos)
              setTimeout(() => {
                lidoRef.current = false
              }, 1500)
            })
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
      if (flashTimer.current) clearTimeout(flashTimer.current)
      const inst = scannerRef.current
      if (inst) {
        inst
          .stop()
          .then(() => inst.clear())
          .catch(() => {})
      }
    }
  }, [])

  return (
    <div>
      {/* Flash de tela cheia: feedback que aguenta luz forte de cozinha. */}
      {flash && (
        <div
          className={`pointer-events-none fixed inset-0 z-[60] ${flash === 'ok' ? 'bg-ok/50' : 'bg-err/50'}`}
          aria-hidden
        />
      )}

      {!aberto ? (
        <button type="button" onClick={abrir} className={`${btnClass('primary')} h-14 w-full text-base`}>
          <QrCode className="size-5" />
          Ler QR Code
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-text">
              {carregando ? 'Abrindo câmera...' : 'Leitura contínua, aponte para o QR'}
            </span>
            <button type="button" onClick={parar} className={btnClass('ghost')} aria-label="Parar leitura">
              <X className="size-4" />
              Parar
            </button>
          </div>
          <div className="relative mx-auto w-full max-w-xs">
            <div id={regionId} className="overflow-hidden rounded-md bg-black [&_video]:w-full" />
            {/* Mira: cantos brancos sobre o vídeo (não captura toque). */}
            {!carregando && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative size-[60%]">
                  <span className="absolute left-0 top-0 size-7 rounded-tl-lg border-l-4 border-t-4 border-white/90" />
                  <span className="absolute right-0 top-0 size-7 rounded-tr-lg border-r-4 border-t-4 border-white/90" />
                  <span className="absolute bottom-0 left-0 size-7 rounded-bl-lg border-b-4 border-l-4 border-white/90" />
                  <span className="absolute bottom-0 right-0 size-7 rounded-br-lg border-b-4 border-r-4 border-white/90" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
