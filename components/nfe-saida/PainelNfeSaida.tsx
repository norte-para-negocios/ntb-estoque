'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import {
  cancelarNfeSaida, conferirNfeSaida, consultarNfeSaida, corrigirNfeSaida, descartarNfeSaida, emitirNfeSaida,
} from '@/lib/actions/nfe-saida'
import { acoesNfe, dentroDoPrazoCancelamento, rotuloStatusNfe } from '@/lib/nfe-saida/regras-puro'
import type { NfeResumo } from '@/lib/nfe-saida/loader'

// Painel da NF-e de saída de UM documento (devolução ao fornecedor ou transferência entre lojas): situação, emitir,
// consultar, descartar, baixar XML/DANFE, cancelar e carta de correção. O ambiente (homologação/produção) vem do
// servidor (NFE_AMBIENTE); a tela só mostra.

type Props = {
  origem: 'devolucao' | 'transferencia_loja'
  origemId: number
  nfes: NfeResumo[]
  tpAmb: 1 | 2
  pode: boolean
  /** o documento está num estado que permite emitir (devolução "a emitir", transferência registrada) */
  emitivel: boolean
}

const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const dataHora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : '—')
const cor = (s: string) => (s === 'autorizada' ? 'text-ok' : s === 'rejeitada' || s === 'denegada' ? 'text-err' : s === 'cancelada' || s === 'descartada' ? 'text-text-muted' : 'text-warn')
const input = 'w-full rounded-[var(--r-md)] bg-surface-2 px-3 py-2'

type Resp = { ok: true; mensagem: string; status?: string } | { error: string }
/** Erro de verdade = vermelho; SEFAZ recusou/sem resposta = aviso (a NF-e mostra o motivo); deu certo = verde. */
function avisar(r: Resp) {
  if ('error' in r) toast.error('NF-e', { description: r.error, duration: 12000 })
  else if (r.status && !['autorizada', 'cancelada', 'descartada'].includes(r.status)) toast.warning('NF-e', { description: r.mensagem, duration: 12000 })
  else toast.success('NF-e', { description: r.mensagem, duration: 8000 })
}

export function PainelNfeSaida({ origem, origemId, nfes, tpAmb, pode, emitivel }: Props) {
  const router = useRouter()
  const [pend, start] = useTransition()
  // denegada/inutilizada consomem o número mas não prendem o documento (vão para o histórico; pode emitir outra)
  const ativa = nfes.find((n) => n.tpAmb === tpAmb && !['descartada', 'cancelada', 'denegada', 'inutilizada'].includes(n.status)) ?? null
  const historico = nfes.filter((n) => n !== ativa)
  const rotuloEmitir = origem === 'devolucao' ? 'Emitir NF-e de devolução' : 'Emitir NF-e de transferência'

  function rodar(f: () => Promise<Resp>) {
    start(async () => {
      const r = await f()
      avisar(r)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-text">NF-e</span>
        {tpAmb === 2 && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">HOMOLOGAÇÃO · teste, sem valor fiscal</span>}
      </div>

      {ativa ? <LinhaNfe n={ativa} pode={pode} pend={pend} rodar={rodar} tpAmb={tpAmb} /> : (
        <p className="text-text-muted">{emitivel ? 'Nenhuma NF-e emitida para este documento.' : 'Sem NF-e.'}</p>
      )}

      {pode && emitivel && !ativa && <DialogoEmitir origem={origem} origemId={origemId} rotulo={rotuloEmitir} tpAmb={tpAmb} />}

      {historico.length > 0 && (
        <details className="text-text-muted">
          <summary className="cursor-pointer text-[12px]">Histórico ({historico.length})</summary>
          <ul className="mt-1 space-y-1">
            {historico.map((n) => (
              <li key={n.id}>
                {n.tpAmb === 2 ? '[homologação] ' : ''}nº {n.numero} série {n.serie} · <span className={cor(n.status)}>{rotuloStatusNfe(n.status)}</span>
                {n.cStat ? ` · ${n.cStat} ${n.xMotivo ?? ''}` : ''}
                {(n.status === 'cancelada' || n.status === 'autorizada') && <> · <a className="text-brand hover:underline" href={`/api/nfe-saida/${n.id}/xml`}>XML</a> · <a className="text-brand hover:underline" href={`/api/nfe-saida/${n.id}/danfe`} target="_blank">DANFE</a></>}
                {n.status === 'cancelada' && <> · <a className="text-brand hover:underline" href={`/api/nfe-saida/${n.id}/xml?tipo=cancelamento`}>XML do cancelamento</a></>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function LinhaNfe({ n, pode, pend, rodar, tpAmb }: { n: NfeResumo; pode: boolean; pend: boolean; tpAmb: 1 | 2; rodar: (f: () => Promise<Resp>) => void }) {
  const [agora] = useState(() => Date.now())
  const a = acoesNfe(n.status, n.enviandoDesde, agora, n.podeRegerar)
  const [modo, setModo] = useState<'cancelar' | 'cce' | null>(null)
  const [texto, setTexto] = useState('')
  const prazo = dentroDoPrazoCancelamento(n.dhRecbto, agora)
  return (
    <div className="space-y-1">
      <p className="text-text">
        nº <b>{n.numero}</b> série {n.serie} · <span className={`font-medium ${cor(n.status)}`}>{rotuloStatusNfe(n.status, n.enviandoDesde, agora)}</span>
        {n.valorTotal != null && <> · {brl(n.valorTotal)}</>}
      </p>
      {n.chave && <p className="break-all font-mono text-[11px] text-text-muted">chave {n.chave}</p>}
      {n.protocolo && <p className="text-text-muted">protocolo {n.protocolo} · {dataHora(n.dhRecbto)}</p>}
      {n.xMotivo && n.status !== 'autorizada' && <p className="text-err">{n.cStat ? `${n.cStat} — ` : ''}{n.xMotivo}</p>}
      {n.cceSeq > 0 && <p className="text-text-muted">Carta de correção nº {n.cceSeq}: {n.cceUltima}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {a.baixar && <a className={btnClass('outline')} href={`/api/nfe-saida/${n.id}/xml`}>Baixar XML</a>}
        {a.baixar && <a className={btnClass('outline')} href={`/api/nfe-saida/${n.id}/danfe`} target="_blank">DANFE</a>}
        {pode && a.enviar && <DialogoEmitir origem={n.origemTipo as 'devolucao' | 'transferencia_loja'} origemId={n.origemId} tpAmb={tpAmb}
          rotulo={a.mesmoXml ? 'Reenviar o mesmo XML' : n.status === 'rejeitada' ? 'Corrigir e reenviar (mesmo número)' : 'Enviar à SEFAZ'} />}
        {pode && a.consultar && <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => rodar(() => consultarNfeSaida(n.id))}>{pend && <Spinner />}Consultar na SEFAZ</button>}
        {pode && a.descartar && <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => { if (confirm('Descartar esta NF-e? O número volta para a próxima emissão.')) rodar(() => descartarNfeSaida(n.id, 'descartada pela tela')) }}>Descartar</button>}
        {pode && a.cancelar && prazo && <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => { setModo('cancelar'); setTexto('') }}>Cancelar NF-e</button>}
        {pode && a.cce && <button type="button" className={btnClass('outline')} disabled={pend} onClick={() => { setModo('cce'); setTexto('') }}>Carta de correção</button>}
      </div>
      {a.cancelar && !prazo && <p className="text-[12px] text-text-muted">Prazo de cancelamento (24 h) encerrado.</p>}
      {a.mesmoXml && <p className="text-[12px] text-text-muted">A SEFAZ pode já ter recebido esta chave: o reenvio usa exatamente o mesmo XML (sem nova chave) e descartar fica bloqueado até uma resposta definitiva.</p>}
      {modo && (
        <div className="space-y-2 pt-2">
          <textarea className={`${input} min-h-[70px]`} value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={modo === 'cancelar' ? 'Justificativa do cancelamento (mín. 15 letras)' : 'O que corrigir (mín. 15 letras). Não pode mudar valores, quantidades, impostos, remetente/destinatário nem data.'} />
          <div className="flex gap-2">
            <button type="button" className={btnClass('primary')} disabled={pend || texto.trim().length < 15}
              onClick={() => rodar(() => (modo === 'cancelar' ? cancelarNfeSaida(n.id, texto) : corrigirNfeSaida(n.id, texto)))}>
              {pend && <Spinner />}{modo === 'cancelar' ? 'Confirmar cancelamento na SEFAZ' : 'Enviar carta de correção'}
            </button>
            <button type="button" className={btnClass('ghost')} onClick={() => setModo(null)}>Voltar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function DialogoEmitir({ origem, origemId, rotulo, tpAmb }: { origem: 'devolucao' | 'transferencia_loja'; origemId: number; rotulo: string; tpAmb: 1 | 2 }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [pend, start] = useTransition()
  const [faltas, setFaltas] = useState<string[] | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [modFrete, setModFrete] = useState('9')
  const [qVol, setQVol] = useState('')
  const [esp, setEsp] = useState('')
  const [pesoB, setPesoB] = useState('')
  const [obs, setObs] = useState('')
  const n = (s: string) => Number(s.replace(',', '.')) || null

  function abrir() {
    setAberto(true); setErro(null); setFaltas(null)
    start(async () => {
      const r = await conferirNfeSaida(origem, origemId)
      if ('error' in r) setErro(r.error)
      else { setFaltas(r.faltas); setAvisos(r.avisos) }
    })
  }
  function emitir() {
    setErro(null)
    start(async () => {
      const r = await emitirNfeSaida(origem, origemId, { modFrete: Number(modFrete) as 0 | 1 | 2 | 9, volumes: { qVol: n(qVol), esp: esp || null, pesoB: n(pesoB), pesoL: n(pesoB) }, observacao: obs || null })
      if ('error' in r) { setErro(r.error); router.refresh(); return }
      avisar(r)
      setAberto(false)
      router.refresh()
    })
  }
  return (
    <>
      <button type="button" className={btnClass('primary')} onClick={abrir}>{rotulo}</button>
      <Dialog open={aberto} onOpenChange={(o) => { if (!pend) setAberto(o) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rotulo}</DialogTitle>
            <p className="text-[13px] text-text-muted">
              {tpAmb === 2 ? 'Ambiente de HOMOLOGAÇÃO: a SEFAZ autoriza como teste, sem valor fiscal. A devolução continua "a emitir".'
                : 'Ambiente de PRODUÇÃO: a NF-e tem valor fiscal e o número é consumido.'} O estoque não muda: os itens já saíram ao registrar o documento.
            </p>
          </DialogHeader>
          <div className="space-y-3 text-[13px]">
            {pend && faltas === null && !erro && <p className="text-text-muted"><Spinner /> Conferindo o cadastro…</p>}
            {faltas && faltas.length > 0 && (
              <div className="rounded-[var(--r-md)] bg-err/10 p-2 text-err">
                <p className="font-medium">Falta cadastro para emitir:</p>
                <ul className="list-disc pl-5">{faltas.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}
            {avisos.length > 0 && <ul className="list-disc rounded-[var(--r-md)] bg-warn/10 p-2 pl-6 text-warn">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
            <label className="block space-y-1"><span>Frete</span>
              <select className={input} value={modFrete} onChange={(e) => setModFrete(e.target.value)}>
                <option value="9">Sem frete</option><option value="0">Por conta do emitente (nós)</option>
                <option value="1">Por conta do destinatário</option><option value="2">Por conta de terceiros</option>
              </select>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1"><span>Volumes</span><input className={input} inputMode="numeric" value={qVol} onChange={(e) => setQVol(e.target.value)} /></label>
              <label className="space-y-1"><span>Espécie</span><input className={input} value={esp} onChange={(e) => setEsp(e.target.value)} placeholder="CAIXA" /></label>
              <label className="space-y-1"><span>Peso (kg)</span><input className={input} inputMode="decimal" value={pesoB} onChange={(e) => setPesoB(e.target.value)} /></label>
            </div>
            <label className="block space-y-1"><span>Observação na nota (opcional)</span>
              <input className={input} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} />
            </label>
            {erro && <p className="rounded-[var(--r-md)] bg-surface-2 p-2 font-medium text-err">{erro}</p>}
          </div>
          <DialogFooter>
            <button type="button" className={btnClass('primary')} disabled={pend || faltas === null || faltas.length > 0} onClick={emitir}>
              {pend && <Spinner />}Assinar e enviar à SEFAZ
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
