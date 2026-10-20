'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { btnClass } from '@/components/ui-kit/Button'
import { enviarPedidoAoOmieAgora } from '@/lib/actions/pedido-compra'

// C1: situação da gravação do pedido no Omie (loja Omie liberada) na página do pedido.

type Envio = {
  status: 'pendente' | 'enviando' | 'enviado' | 'precisa_corrigir'; numeroOmie: string | null; nCodPed: number | null; tentativas: number
  ultimoErro: string | null; proximaTentativaEm: string | null; enviadoEm: string | null
}

const dataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })

export function EnvioOmiePedido({ id, etapa, envio, podeEnviar }: { id: number; etapa: string; envio: Envio | null; podeEnviar: boolean }) {
  const router = useRouter()
  const [pend, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function enviar() {
    setMsg(null)
    start(async () => {
      const r = await enviarPedidoAoOmieAgora(id)
      if ('error' in r) setMsg(r.error)
      else {
        setMsg(r.omie.status === 'enviado' ? `Gravado no Omie${r.omie.numero ? `: pedido nº ${r.omie.numero}` : ''}.` : r.omie.mensagem ?? 'Ainda não foi.')
        router.refresh()
      }
    })
  }

  let titulo: string
  let detalhe: string | null = null
  let tom = 'text-text'
  if (envio?.status === 'enviado') {
    titulo = `No Omie: pedido nº ${envio.numeroOmie ?? envio.nCodPed ?? '—'}`
    detalhe = `Gravado ${envio.enviadoEm ? dataHora(envio.enviadoEm) : ''}. Para a NF-e do fornecedor ligar sozinha a este pedido no Omie, ele informa o nº ${envio.numeroOmie ?? ''} na tag xPed e o nº do item (a ordem deste pedido) em nItemPed; sem isso, associe no Recebimento da NF-e do Omie. Alterar ou cancelar: no Omie.`
    tom = 'text-ok'
  } else if (envio?.status === 'enviando') {
    titulo = 'Gravando no Omie agora…'
  } else if (envio?.status === 'precisa_corrigir') {
    titulo = 'Não foi para o Omie: precisa corrigir'
    detalhe = `${envio.ultimoErro ?? ''}${envio.tentativas ? ` (${envio.tentativas} tentativa(s))` : ''}. Corrija (Reabrir para editar → aprovar de novo) ou, se o problema era no Omie, tente de novo.`
    tom = 'text-err'
  } else if (envio?.status === 'pendente') {
    titulo = 'Na fila para o Omie'
    detalhe = [
      envio.tentativas ? `${envio.tentativas} tentativa(s)` : null,
      envio.proximaTentativaEm ? `próxima ${dataHora(envio.proximaTentativaEm)}` : null,
      envio.ultimoErro ? `último erro: ${envio.ultimoErro}` : null,
    ].filter(Boolean).join(' · ') || null
    tom = 'text-warn'
  } else {
    titulo = etapa === 'aprovado' ? 'Ainda não foi para o Omie' : 'Vai para o Omie quando for aprovado'
  }

  const podeBotao = podeEnviar && etapa === 'aprovado' && envio?.status !== 'enviado' && envio?.status !== 'enviando'
  return (
    <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <h2 className="text-[15px] font-semibold text-text">Omie</h2>
      <p className={`text-[14px] font-medium ${tom}`}>{titulo}</p>
      {detalhe && <p className="text-[13px] text-text-muted">{detalhe}</p>}
      {podeBotao && (
        <button type="button" disabled={pend} onClick={enviar} className={btnClass('outline')}>
          {envio?.status === 'precisa_corrigir' ? 'Tentar de novo' : 'Enviar ao Omie agora'}
        </button>
      )}
      {msg && <p className="text-[13px] text-text-muted">{msg}</p>}
    </section>
  )
}
