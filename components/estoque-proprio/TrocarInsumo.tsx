'use client'

// Trocar insumo em massa nas fichas do Omie ("nosso Omie" Fase 4): escolher de/para (e a quantidade), ver a prévia
// dos pratos, confirmar e trocar UM prato por vez (trocarInsumoNoPrato), parando no primeiro erro.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Repeat } from 'lucide-react'
import { Combobox } from '@/components/ui-kit/Combobox'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { trocarInsumoNoPrato } from '@/lib/actions/fichas-omie'

type Opcao = { value: string; label: string }
const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

export function FormTrocaInsumo({ insumos, produtos, de, para, qtd }: { insumos: Opcao[]; produtos: Opcao[]; de: string; para: string; qtd: string }) {
  const [vDe, setDe] = useState(de)
  const [vPara, setPara] = useState(para)
  const [vQtd, setQtd] = useState(qtd)
  const router = useRouter()
  function previa() {
    if (!vDe || !vPara) return
    const p = new URLSearchParams({ troca_de: vDe, troca_para: vPara })
    if (vQtd.trim()) p.set('troca_qtd', vQtd.trim())
    router.push(`/estoque/fichas?${p.toString()}`)
  }
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end">
      <label className="space-y-1 text-[12px] text-text-muted">Trocar o insumo<Combobox options={insumos} value={vDe} onChange={setDe} placeholder="Insumo que sai" /></label>
      <label className="space-y-1 text-[12px] text-text-muted">Por<Combobox options={produtos} value={vPara} onChange={setPara} placeholder="Insumo que entra" /></label>
      <label className="space-y-1 text-[12px] text-text-muted">Quantidade (opcional)<input inputMode="decimal" className={campo} value={vQtd} onChange={(e) => setQtd(e.target.value)} placeholder="a de cada prato" /></label>
      <button type="button" className={btnClass('outline')} disabled={!vDe || !vPara || vDe === vPara} onClick={previa}><Repeat className="size-4" />Ver prévia</button>
    </div>
  )
}

export type LinhaPrevia = { produto: number; nome: string; atual: number; nova: number; unidade: string; jaTemNovo: boolean }
type Res = { produto: number; ok: boolean; msg: string }

export function ConfirmarTroca({ de, para, nomeDe, nomePara, quantidadeFixa, linhas, simulado }: {
  de: number; para: number; nomeDe: string; nomePara: string; quantidadeFixa: number | null; linhas: LinhaPrevia[]; simulado: boolean
}) {
  const elegiveis = linhas.filter((l) => !l.jaTemNovo)
  const [marcados, setMarcados] = useState<Set<number>>(new Set(elegiveis.map((l) => l.produto)))
  const [ciente, setCiente] = useState(false)
  const [rodando, setRodando] = useState(false)
  const [res, setRes] = useState<Res[]>([])
  const [parou, setParou] = useState<string | null>(null)
  const router = useRouter()

  function alternar(p: number) { setMarcados((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n }) }

  async function executar() {
    setRodando(true); setRes([]); setParou(null)
    const lista: Res[] = []
    const nome = new Map(linhas.map((l) => [l.produto, l.nome]))
    for (const l of elegiveis.filter((x) => marcados.has(x.produto))) {
      let r: Awaited<ReturnType<typeof trocarInsumoNoPrato>>
      try { r = await trocarInsumoNoPrato({ de, para, quantidadeFixa, produto: l.produto }) }
      catch (e) { r = { error: e instanceof Error ? e.message : 'Falha de comunicação', etapa: 'nao_confirmado', parar: true } }
      if ('error' in r) {
        lista.push({ produto: l.produto, ok: false, msg: r.error })
        setRes([...lista])
        setParou(`Parei em ${nome.get(l.produto)}. ${r.etapa === 'incluido_sem_excluir' ? 'Atenção: esta ficha ficou com os dois insumos.' : r.etapa === 'nao_confirmado' ? 'Confira esta ficha no Omie antes de tentar de novo.' : 'Nada foi mudado nesta ficha.'} Os pratos seguintes não foram tocados.`)
        break
      }
      lista.push({ produto: l.produto, ok: true, msg: r.simulado ? 'simulado (loja de teste)' : `trocado (${fmt(r.quantidade)})` })
      setRes([...lista])
    }
    setRodando(false)
    router.refresh()
  }

  const nomeDe2 = new Map(linhas.map((l) => [l.produto, l.nome]))
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-text">
        <b>{nomeDe}</b> sai e <b>{nomePara}</b> entra em {elegiveis.length} prato{elegiveis.length === 1 ? '' : 's'}
        {quantidadeFixa != null ? <> com <b className="num">{fmt(quantidadeFixa)}</b> em todos.</> : ', com a mesma quantidade de cada prato.'}
      </p>
      <ul className="divide-y divide-[var(--border)] rounded-[var(--r-md)] bg-surface-2 px-3 text-[13px]">
        {linhas.map((l) => (
          <li key={l.produto} className="flex flex-wrap items-center gap-2 py-2">
            <input type="checkbox" disabled={l.jaTemNovo || rodando} checked={marcados.has(l.produto) && !l.jaTemNovo} onChange={() => alternar(l.produto)} aria-label={`Trocar em ${l.nome}`} />
            <span className="min-w-0 flex-1 truncate">{l.nome}</span>
            {l.jaTemNovo
              ? <span className="text-warn">já tem o insumo novo: fica de fora (confira no Omie)</span>
              : <span className="num text-text-muted">{fmt(l.atual)} → {fmt(l.nova)} {l.unidade}</span>}
          </li>
        ))}
      </ul>
      <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-text-muted">
        <li>Em cada prato: inclui o insumo novo, relê a ficha, exclui o antigo e relê de novo. Um prato por vez; no primeiro erro, para.</li>
        <li>A perda (%) do item antigo vai para o novo. O <b>local de consumo</b> do item novo fica em branco no Omie: confira na tela Estrutura do Produto.</li>
        <li>OPs já abertas continuam com a ficha antiga gravada nelas.</li>
        {simulado && <li className="text-warn">Loja de teste: nada é enviado ao Omie (simulado), as fichas mostradas são as da loja real.</li>}
      </ul>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5" checked={ciente} onChange={(e) => setCiente(e.target.checked)} disabled={rodando} />
        Confirmo trocar {nomeDe} por {nomePara} nas {marcados.size} fichas marcadas, direto no Omie.
      </label>
      <button type="button" className={btnClass('primary')} disabled={!ciente || rodando || !marcados.size || res.length > 0} onClick={executar}>
        {rodando && <Spinner />}Trocar em {marcados.size} ficha{marcados.size === 1 ? '' : 's'}
      </button>
      {res.length > 0 && (
        <div className="space-y-1 text-[13px]">
          <p className="font-medium">{res.filter((r) => r.ok).length} de {marcados.size} feitas{rodando ? '…' : ''}</p>
          {res.map((r) => <p key={r.produto} className={r.ok ? 'text-text-muted' : 'text-err'}>{nomeDe2.get(r.produto)}: {r.msg}</p>)}
          {parou && <p className="font-medium text-warn">{parou}</p>}
        </div>
      )}
    </div>
  )
}
