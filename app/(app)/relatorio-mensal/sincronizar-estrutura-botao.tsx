'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui-kit/Button'

// Sincroniza SÓ os produtos com OP concluída no período que ainda não têm
// ficha técnica em cache (não o catálogo inteiro) -- pacing de 10s no
// servidor (app/api/sync/estrutura-produto/route.ts), pode demorar minutos
// se houver muitos produtos pendentes na primeira vez.
//
// Dois cuidados obrigatórios nesta tela, os dois por causa da mesma
// realidade de infra: o proxy reverso na frente do app MATA a requisição
// muito antes de um sync longo terminar (`maxDuration = 300` do Next.js é
// no-op nesta infra self-hosted, ver AGENTS.md), e o backend continua
// rodando desacoplado da UI.
//  (1) Toda falha (rede, JSON inválido, HTTP não-ok) é capturada e explicada
//      como "pode ter sido o proxy, o sync provavelmente continua rodando" --
//      antes disso um res.json() estourava sem catch e a tela só travava.
//  (2) Cooldown fixo depois de QUALQUER tentativa: um segundo clique
//      dispararia uma SEGUNDA sync concorrente contra o mesmo app_key de um
//      cliente real, dobrando a taxa de chamadas e convidando o
//      MISUSE_API_PROCESS (AGENTS.md: "toda tentativa durante o lockout
//      empurra o fim dele pra mais tarde").
const COOLDOWN_MS = 120_000

const AVISO_PROXY =
  'Falha ao completar (pode ter sido o timeout do proxy num sync longo, que continua rodando no servidor). ' +
  'Não clique de novo agora -- confira com o time técnico antes de tentar de novo.'

export function SincronizarEstruturaBotao({ dataIni, dataFim }: { dataIni: string; dataFim: string }) {
  const [status, setStatus] = useState<string | null>(null)
  // `carregando` = requisição em voo; `emEspera` = cooldown pós-tentativa
  // (independente do resultado). São estados separados de propósito: o
  // cooldown precisa sobreviver ao fim da requisição, inclusive quando ela
  // falha.
  const [carregando, setCarregando] = useState(false)
  const [emEspera, setEmEspera] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  async function sincronizar() {
    if (carregando || emEspera) return
    setCarregando(true)
    setEmEspera(true)
    setStatus('Buscando produtos pendentes...')
    try {
      let pendentes: number[] | undefined
      try {
        const resPendentes = await fetch(
          `/api/relatorio-mensal/estrutura-pendente?dataIni=${dataIni}&dataFim=${dataFim}`
        )
        const dadosPendentes = await resPendentes.json()
        if (!resPendentes.ok) {
          setStatus(`Erro ao buscar produtos pendentes: ${dadosPendentes?.error ?? 'falha desconhecida'}`)
          return
        }
        pendentes = dadosPendentes?.pendentes
      } catch {
        setStatus(`Erro ao buscar produtos pendentes. ${AVISO_PROXY}`)
        return
      }
      if (!pendentes?.length) {
        setStatus('Nada pendente -- ficha técnica já sincronizada pra este período.')
        return
      }

      setStatus(`Sincronizando ${pendentes.length} produto(s) -- pode levar alguns minutos...`)
      try {
        const res = await fetch('/api/sync/estrutura-produto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigosProduto: pendentes }),
        })
        const dados = await res.json()
        if (!res.ok) {
          setStatus(`Erro ao sincronizar: ${dados?.error ?? 'falha desconhecida'}`)
          return
        }
        setStatus(
          `Sincronizados: ${dados.sincronizados} · Sem estrutura: ${dados.semEstrutura} · Falhas: ${dados.falhas}` +
            (dados.abortadoPorBloqueioOmie ? ' · BLOQUEADO PELA OMIE, tente de novo mais tarde.' : '')
        )
      } catch {
        setStatus(AVISO_PROXY)
      }
    } finally {
      setCarregando(false)
      timerRef.current = setTimeout(() => setEmEspera(false), COOLDOWN_MS)
    }
  }

  const bloqueado = carregando || emEspera

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={sincronizar} disabled={bloqueado}>
        {carregando
          ? 'Sincronizando...'
          : emEspera
            ? 'Aguarde 2 minutos antes de tentar de novo'
            : 'Sincronizar ficha técnica (Baixas de Estoque)'}
      </Button>
      {status && <p className="text-sm text-text-muted">{status}</p>}
      {!carregando && emEspera && (
        <p className="text-xs text-text-muted">
          Botão travado por 2 minutos de propósito: um segundo sync em paralelo bate no mesmo app_key da Omie da loja
          real e pode bloquear a integração inteira.
        </p>
      )}
    </div>
  )
}
