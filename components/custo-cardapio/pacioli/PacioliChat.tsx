'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, RotateCcw, Square } from 'lucide-react'
import { acaoDaPergunta, LIMITES, type AcaoPacioli } from '@/lib/custo-cardapio/pacioli-puro'
import { PacioliMascote } from './PacioliMascote'
import { RespostaPacioli } from './RespostaPacioli'

// Pacioli: mascote grande à esquerda (no celular, em cima) e a conversa à direita. A conversa vive só nesta página.
// Com chave: conversa livre (POST /cozinha/pacioli/conversa, resposta em NDJSON). Sem chave: modo rápido, as mesmas
// contas respondidas na hora para as perguntas prontas, sem modelo.

type Msg = { id: number; papel: 'usuario' | 'pacioli'; texto: string; erro?: boolean }
type Modo = 'conversa' | 'rapido'

const SUGESTOES = [
  'Quais pratos estão acima da meta?',
  'Quanto devo cobrar no delivery pela moqueca?',
  'Se o camarão subir 20%, o que acontece?',
  'Qual insumo mais pesa no meu cardápio?',
]

const STATUS: Record<AcaoPacioli, string> = {
  '44-acenando': 'Olá! Pergunte sobre custo, CMV e preço.',
  '01-vigiando': 'Pronto para ajudar.',
  '10-ouvindo': 'Ouvindo…',
  '11-pensando': 'Pensando…',
  '12-falando': 'Respondendo…',
  '20-fazendo-prato': 'Montando o prato…',
  '21-ficha-tecnica': 'Abrindo a ficha técnica…',
  '23-calculando-custo': 'Fazendo as contas…',
  '03-tudo-certo': 'Pronto.',
  '40-comemorando': 'Tudo dentro da meta!',
  '42-erro': 'Algo deu errado.',
  '14-nao-entendi': 'Não entendi essa.',
}

const ENDPOINT = '/cozinha/pacioli/conversa'

export function PacioliChat({ temChave, meta }: { temChave: boolean; meta: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [modo, setModo] = useState<Modo>(temChave ? 'conversa' : 'rapido')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [acao, setAcao] = useState<AcaoPacioli>('44-acenando')
  const [digitando, setDigitando] = useState(false)
  const [podeParar, setPodeParar] = useState(false)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const voltaRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const digitaRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(1)
  const ocupadoRef = useRef(false)

  /** Depois de um tempo na ação, volta a vigiar (se não estiver respondendo). */
  const voltarDepois = useCallback((ms: number) => {
    if (voltaRef.current) clearTimeout(voltaRef.current)
    voltaRef.current = setTimeout(() => { if (!ocupadoRef.current) setAcao('01-vigiando') }, ms)
  }, [])

  useEffect(() => {
    voltarDepois(3600)
    return () => {
      abortRef.current?.abort()
      if (voltaRef.current) clearTimeout(voltaRef.current)
      if (digitaRef.current) clearTimeout(digitaRef.current)
    }
  }, [voltarDepois])

  // Rola para o fim quando chega texto novo (só se a pessoa já estava perto do fim).
  useEffect(() => {
    const el = listaRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [msgs])

  const novaMsg = (papel: Msg['papel'], t: string, erro?: boolean): Msg => ({ id: idRef.current++, papel, texto: t, erro })
  const comecar = () => { ocupadoRef.current = true; setOcupado(true); if (voltaRef.current) clearTimeout(voltaRef.current) }
  const terminar = (fim: AcaoPacioli, ms = 2800) => { ocupadoRef.current = false; setOcupado(false); setPodeParar(false); setAcao(fim); voltarDepois(ms) }

  async function perguntarRapido(pergunta: string, aviso?: string) {
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modo: 'rapido', pergunta }) })
      const j = await r.json().catch(() => null) as { texto?: string; acao?: AcaoPacioli; mensagem?: string } | null
      if (!r.ok || !j?.texto) {
        setMsgs((m) => [...m, novaMsg('pacioli', j?.mensagem ?? 'Não consegui responder agora.', true)])
        terminar('42-erro', 4000)
        return
      }
      setMsgs((m) => [...m, novaMsg('pacioli', (aviso ? `${aviso}\n\n` : '') + j.texto)])
      terminar(j.acao ?? '03-tudo-certo')
    } catch {
      setMsgs((m) => [...m, novaMsg('pacioli', 'Sem conexão com o servidor. Tente de novo.', true)])
      terminar('42-erro', 4000)
    }
  }

  async function perguntarConversa(pergunta: string, historico: Msg[]) {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPodeParar(true)
    const mensagens = [...historico.filter((m) => !m.erro).map((m) => ({ papel: m.papel, texto: m.texto })), { papel: 'usuario' as const, texto: pergunta }]
    let r: Response
    try {
      r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modo: 'conversa', mensagens }), signal: ctrl.signal })
    } catch {
      if (ctrl.signal.aborted) return terminar('01-vigiando', 0)
      setMsgs((m) => [...m, novaMsg('pacioli', 'Sem conexão com o servidor. Tente de novo.', true)])
      return terminar('42-erro', 4000)
    }
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => null) as { codigo?: string; mensagem?: string } | null
      if (r.status === 503 && j?.codigo === 'sem_chave') {
        setModo('rapido')
        return perguntarRapido(pergunta, 'A conversa livre ainda não está ligada neste servidor. Respondi pelo modo rápido:')
      }
      setMsgs((m) => [...m, novaMsg('pacioli', j?.mensagem ?? 'Não consegui responder agora.', true)])
      return terminar('42-erro', 4000)
    }
    const id = idRef.current++
    let criada = false
    const acrescentar = (pedaco: string) => {
      setMsgs((m) => {
        if (!criada) { criada = true; return [...m, { id, papel: 'pacioli', texto: pedaco }] }
        return m.map((x) => (x.id === id ? { ...x, texto: x.texto + pedaco } : x))
      })
    }
    let fim: AcaoPacioli = '03-tudo-certo'
    let deuErro = false
    try {
      const leitor = r.body.getReader()
      const dec = new TextDecoder()
      let resto = ''
      for (;;) {
        const { value, done } = await leitor.read()
        if (done) break
        resto += dec.decode(value, { stream: true })
        const linhas = resto.split('\n')
        resto = linhas.pop() ?? ''
        for (const l of linhas) {
          if (!l.trim()) continue
          let ev: { t?: string; v?: string; acao?: AcaoPacioli; codigo?: string }
          try { ev = JSON.parse(l) } catch { continue }
          if (ev.t === 'acao' && ev.v && ev.v in STATUS) setAcao(ev.v as AcaoPacioli)
          else if (ev.t === 'texto' && ev.v) acrescentar(ev.v)
          else if (ev.t === 'fim' && ev.acao && ev.acao in STATUS) fim = ev.acao
          else if (ev.t === 'erro') {
            deuErro = true
            setMsgs((m) => [...m, novaMsg('pacioli', ev.v ?? 'Não consegui responder agora.', true)])
            if (ev.codigo === 'chave_invalida') setModo('rapido')
          }
        }
      }
    } catch {
      if (!ctrl.signal.aborted) { deuErro = true; setMsgs((m) => [...m, novaMsg('pacioli', 'A resposta foi interrompida. Tente de novo.', true)]) }
    } finally {
      abortRef.current = null
    }
    if (ctrl.signal.aborted) return terminar('01-vigiando', 0)
    terminar(deuErro ? '42-erro' : fim, deuErro ? 4000 : 2800)
  }

  async function perguntar(p0: string) {
    const pergunta = p0.trim().slice(0, LIMITES.caracteresPergunta)
    if (!pergunta || ocupadoRef.current) return
    const historico = msgs
    setMsgs((m) => [...m, novaMsg('usuario', pergunta)])
    setTexto('')
    setDigitando(false)
    comecar()
    setAcao(acaoDaPergunta(pergunta))
    if (modo === 'rapido') await perguntarRapido(pergunta)
    else await perguntarConversa(pergunta, historico)
  }

  function aoDigitar(v: string) {
    setTexto(v)
    if (ocupadoRef.current) return
    setDigitando(!!v.trim())
    if (v.trim()) {
      setAcao('10-ouvindo')
      if (voltaRef.current) clearTimeout(voltaRef.current)
      if (digitaRef.current) clearTimeout(digitaRef.current)
      digitaRef.current = setTimeout(() => { setDigitando(false); if (!ocupadoRef.current) setAcao('01-vigiando') }, 2200)
    } else setAcao('01-vigiando')
  }

  function limpar() {
    abortRef.current?.abort()
    setMsgs([])
    setAcao('44-acenando')
    voltarDepois(3600)
    campoRef.current?.focus()
  }

  const vazio = msgs.length === 0
  const chip = 'shrink-0 rounded-full bg-surface-2 px-3.5 py-2 text-left text-[13px] font-semibold text-text u-motion u-press-sm hover:bg-[var(--border)] disabled:opacity-50'

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,38%)_1fr]">
      {/* Mascote */}
      <section aria-label="Pacioli" className="overflow-hidden rounded-[var(--r-xl)] bg-surface-2 dark:bg-surface lg:sticky lg:top-4 lg:self-start">
        <PacioliMascote acao={acao} alvoRef={campoRef} olharAlvo={digitando} className="mx-auto aspect-square w-full max-w-[220px] lg:max-w-none" />
        <div className="px-5 pb-5 text-center">
          <p className="text-[17px] font-semibold text-text">Pacioli</p>
          <p className="mt-0.5 text-[13px] text-text-muted" role="status" aria-live="polite">{STATUS[acao]}</p>
        </div>
      </section>

      {/* Conversa */}
      <section aria-label="Conversa com o Pacioli" className="flex h-[min(76dvh,720px)] min-h-[440px] flex-col overflow-hidden rounded-[var(--r-xl)] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-[var(--border)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
          <p className="min-w-0 truncate text-[13px] text-text-muted">
            {modo === 'conversa' ? <>Conversa livre · meta de CMV {meta}</> : <>Modo rápido · meta de CMV {meta}</>}
          </p>
          {!vazio && (
            <button type="button" onClick={limpar} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-text-muted u-motion u-press-sm hover:bg-surface-2 hover:text-text">
              <RotateCcw className="size-3.5" strokeWidth={2.2} /> Nova conversa
            </button>
          )}
        </div>

        <div ref={listaRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite" aria-busy={ocupado}>
          {modo === 'rapido' && (
            <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-[13px] leading-snug text-text-muted">
              Modo rápido: respondo na hora as perguntas prontas, com os números da loja. A conversa livre liga quando a chave da Anthropic (ANTHROPIC_API_KEY) for configurada no servidor.
            </p>
          )}
          {vazio && (
            <div className="pt-2">
              <p className="text-[15px] text-text">Pergunte sobre custo dos pratos, CMV, preço de venda e insumos. Eu só leio os dados, não mudo nada.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SUGESTOES.map((s) => (
                  <button key={s} type="button" disabled={ocupado} onClick={() => perguntar(s)} className={`${chip} rounded-[var(--r-md)] px-3.5 py-3 text-[14px]`}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m) => m.papel === 'usuario' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-[var(--r-lg)] rounded-br-md bg-brand-fill px-3.5 py-2 text-[15px] leading-relaxed text-white">{m.texto}</p>
            </div>
          ) : (
            <div key={m.id} className={`max-w-[92%] ${m.erro ? 'rounded-[var(--r-md)] bg-err/10 px-3 py-2 text-err' : ''}`}>
              {m.erro ? <p className="text-[14px]">{m.texto}</p> : <RespostaPacioli texto={m.texto} />}
            </div>
          ))}
          {ocupado && msgs[msgs.length - 1]?.papel === 'usuario' && (
            <p className="text-[13px] text-text-muted">{STATUS[acao]}</p>
          )}
        </div>

        {!vazio && (
          <div className="-mb-1 flex gap-2 overflow-x-auto px-4 pb-2 pt-1" aria-label="Perguntas prontas">
            {SUGESTOES.map((s) => <button key={s} type="button" disabled={ocupado} onClick={() => perguntar(s)} className={chip}>{s}</button>)}
          </div>
        )}

        <form className="flex items-end gap-2 border-t border-[var(--border)] p-3" onSubmit={(e) => { e.preventDefault(); void perguntar(texto) }}>
          <label htmlFor="pergunta-pacioli" className="sr-only">Pergunta para o Pacioli</label>
          <textarea
            id="pergunta-pacioli"
            ref={campoRef}
            value={texto}
            rows={1}
            maxLength={LIMITES.caracteresPergunta}
            placeholder={modo === 'rapido' ? 'Ex.: quanto cobrar pelo bobó no delivery?' : 'Pergunte ao Pacioli…'}
            onChange={(e) => aoDigitar(e.target.value)}
            onBlur={() => { setDigitando(false); if (!ocupadoRef.current && acao === '10-ouvindo') setAcao('01-vigiando') }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void perguntar(texto) } }}
            className="max-h-36 min-h-11 flex-1 resize-none rounded-[var(--r-lg)] bg-surface-2 px-3.5 py-2.5 text-[15px] leading-snug text-text outline-none placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 field-sizing-content"
          />
          {ocupado && podeParar ? (
            <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Parar resposta"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text u-motion u-press hover:bg-[var(--border)]">
              <Square className="size-4" fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={ocupado || !texto.trim()} aria-label="Enviar pergunta"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-fill text-white u-motion u-press hover:bg-[var(--brand-fill-hover)] disabled:opacity-40">
              <ArrowUp className="size-5" strokeWidth={2.4} />
            </button>
          )}
        </form>
      </section>
    </div>
  )
}
