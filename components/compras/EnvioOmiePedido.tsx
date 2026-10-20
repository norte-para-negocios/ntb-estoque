'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { btnClass } from '@/components/ui-kit/Button'
import { enviarPedidoAoOmieAgora } from '@/lib/actions/pedido-compra'

// C1: situação da gravação do pedido no Omie (loja Omie liberada) na página do pedido.

type Envio = {
  status: 'pendente' | 'enviando' | 'enviado' | 'precisa_corrigir'; numeroOmie: string | null; nCodPed: number | null; tentativas: number
  ultimoErro: string | null; proximaTentativaEm: string | null; enviadoEm: string | null; incerto: boolean; divergente: boolean; naHora: boolean
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
    if (envio.divergente) {
      detalhe = `ATENÇÃO: o pedido já estava no Omie de uma tentativa anterior e pode estar diferente deste (itens, quantidades ou preços). Confira no Omie. ${detalhe}`
      tom = 'text-warn'
    }
  } else if (envio?.status === 'enviando') {
    titulo = 'Gravando no Omie agora…'
  } else if (envio?.status === 'precisa_corrigir') {
    titulo = envio.incerto ? 'Pode já estar no Omie: conferir' : 'Não foi para o Omie: precisa corrigir'
    detalhe = envio.incerto
      ? `A última tentativa ficou sem resposta do Omie (${envio.ultimoErro ?? 'sem detalhe'}). Antes de reabrir ou cancelar, use "Conferir no Omie" (só consulta; no máximo a cada 10 min).`
      : `${envio.ultimoErro ?? ''}${envio.tentativas ? ` (${envio.tentativas} tentativa(s))` : ''}. Para reenviar: Reabrir para editar → corrigir → aprovar de novo (zera as tentativas).`
    tom = 'text-err'
  } else if (envio?.status === 'pendente') {
    titulo = 'Na fila para o Omie'
    detalhe = [
      envio.tentativas ? `${envio.tentativas} tentativa(s)` : null,
      envio.proximaTentativaEm ? `próxima ${dataHora(envio.proximaTentativaEm)}` : null,
      envio.ultimoErro ? `último erro: ${envio.ultimoErro}` : null,
      envio.incerto ? 'a última tentativa ficou sem resposta: a próxima consulta o Omie antes' : null,
    ].filter(Boolean).join(' · ') || null
    tom = 'text-warn'
  } else {
    titulo = etapa === 'aprovado' ? 'Ainda não foi para o Omie' : 'Vai para o Omie quando for aprovado'
  }

  // Sem botão em 'precisa_corrigir' certo (só nova aprovação reenvia) e antes da hora da próxima tentativa.
  const naHora = envio?.naHora ?? true
  const conferir = envio?.status === 'precisa_corrigir' && envio.incerto
  const podeBotao = podeEnviar && etapa === 'aprovado' && (conferir || (envio?.status !== 'enviado' && envio?.status !== 'enviando' && envio?.status !== 'precisa_corrigir' && naHora))
  return (
    <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <h2 className="text-[15px] font-semibold text-text">Omie</h2>
      <p className={`text-[14px] font-medium ${tom}`}>{titulo}</p>
      {detalhe && <p className="text-[13px] text-text-muted">{detalhe}</p>}
      {podeBotao && (
        <button type="button" disabled={pend} onClick={enviar} className={btnClass('outline')}>
          {conferir ? 'Conferir no Omie' : 'Enviar ao Omie agora'}
        </button>
      )}
      {msg && <p className="text-[13px] text-text-muted">{msg}</p>}
    </section>
  )
}
