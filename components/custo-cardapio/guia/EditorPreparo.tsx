'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, Camera, Clock, ImageOff, Pencil, Scale, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { removerFotoReceita, salvarInfoReceita } from '@/lib/actions/cozinha-receitas'
import { formatarTempo, LIMITE_FOTO_BYTES, LIMITES_RECEITA, passosDoTexto } from '@/lib/custo-cardapio/guia-puro'

// Página do prato/preparação: seção "Preparo" (modo de preparo em passos, observações, tempo, rendimento e foto).
// Grava em custo_receita_info (só a Norte Cozinha; nada vai para o Omie).

export type PreparoTela = {
  modoPreparo: string | null
  observacoes: string | null
  tempoPreparoMin: number | null
  rendimentoTexto: string | null
  fotoUrl: string | null
  atualizadoPor: string | null
  atualizadoEm: string | null
}

const campo = 'w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40'
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }) : '')

export function EditorPreparo({ codigo, nome, info }: { codigo: number; nome: string; info: PreparoTela | null }) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [f, setF] = useState({
    modoPreparo: info?.modoPreparo ?? '', observacoes: info?.observacoes ?? '',
    tempo: info?.tempoPreparoMin != null ? String(info.tempoPreparoMin) : '', rendimento: info?.rendimentoTexto ?? '',
  })
  const [pendente, start] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)

  const passos = passosDoTexto(editando ? f.modoPreparo : info?.modoPreparo)
  const tempo = formatarTempo(info?.tempoPreparoMin)
  const vazio = !info || (!info.modoPreparo && !info.observacoes && !info.tempoPreparoMin && !info.rendimentoTexto && !info.fotoUrl)

  const salvar = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const r = await salvarInfoReceita(codigo, { modoPreparo: f.modoPreparo, observacoes: f.observacoes, tempoPreparoMin: f.tempo, rendimentoTexto: f.rendimento })
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Preparo salvo')
      setEditando(false)
      router.refresh()
    })
  }

  const cancelar = () => {
    setF({ modoPreparo: info?.modoPreparo ?? '', observacoes: info?.observacoes ?? '', tempo: info?.tempoPreparoMin != null ? String(info.tempoPreparoMin) : '', rendimento: info?.rendimentoTexto ?? '' })
    setEditando(false)
  }

  const enviarFoto = async (file: File | undefined) => {
    if (!file) return
    if (file.size > LIMITE_FOTO_BYTES) { toast.error('Foto muito grande: o limite é 5 MB.'); return }
    setEnviando(true)
    try {
      const fd = new FormData()
      fd.append('foto', file)
      const res = await fetch(`/cozinha/pratos/${codigo}/foto`, { method: 'POST', body: fd })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) { toast.error(j.error ?? 'Não foi possível enviar a foto.'); return }
      toast.success(info?.fotoUrl ? 'Foto trocada' : 'Foto adicionada')
      router.refresh()
    } catch {
      toast.error('Sem conexão. Tente de novo.')
    } finally {
      setEnviando(false)
      if (arquivo.current) arquivo.current.value = ''
    }
  }

  const tirarFoto = () => start(async () => {
    const r = await removerFotoReceita(codigo)
    if ('error' in r) { toast.error(r.error); return }
    toast.success('Foto removida')
    router.refresh()
  })

  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5" aria-labelledby="titulo-preparo">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="titulo-preparo" className="text-[17px] font-semibold">Preparo</h2>
          <p className="text-[13px] text-text-muted">
            {info?.atualizadoEm ? `Atualizado por ${info.atualizadoPor ?? 'alguém'} em ${quando(info.atualizadoEm)}.` : 'Como a cozinha faz este item. Aparece no guia de preparo e na ficha em PDF.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/cozinha/guia?p=${codigo}`} className={btnClass('outline')}><BookOpen className="size-4" /> Abrir no guia</Link>
          {!editando && <button type="button" onClick={() => setEditando(true)} className={btnClass(vazio ? 'primary' : 'outline')}><Pencil className="size-4" /> {vazio ? 'Escrever o preparo' : 'Editar'}</button>}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,240px)_1fr]">
        {/* Foto */}
        <div className="space-y-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--r-md)] bg-surface-2">
            {info?.fotoUrl
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada do bucket privado, muda a cada hora
              ? <img src={info.fotoUrl} alt={`Foto de ${nome}`} className="size-full object-cover" />
              : <div className="flex size-full flex-col items-center justify-center gap-1 text-text-muted"><ImageOff className="size-7" strokeWidth={1.5} /><span className="text-[13px]">Sem foto</span></div>}
          </div>
          <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Escolher foto" onChange={(e) => enviarFoto(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={enviando || pendente} onClick={() => arquivo.current?.click()} className={btnClass('outline')}>
              <Camera className="size-4" /> {enviando ? 'Enviando…' : info?.fotoUrl ? 'Trocar foto' : 'Adicionar foto'}
            </button>
            {info?.fotoUrl && (
              <button type="button" disabled={enviando || pendente} onClick={tirarFoto} className={btnClass('dangerSoft')} aria-label="Remover foto"><Trash2 className="size-4" /></button>
            )}
          </div>
          <p className="text-[12px] text-text-muted">JPG, PNG ou WebP, até 5 MB.</p>
        </div>

        {/* Texto */}
        {editando ? (
          <form onSubmit={salvar} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Tempo de preparo (minutos)</span>
                <input inputMode="numeric" value={f.tempo} onChange={(e) => setF({ ...f, tempo: e.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="Ex.: 40" className={`${campo} num h-10`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Rendimento</span>
                <input maxLength={LIMITES_RECEITA.rendimentoTexto} value={f.rendimento} onChange={(e) => setF({ ...f, rendimento: e.target.value })} placeholder="Ex.: 10 porções de 300 g" className={`${campo} h-10`} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium">Modo de preparo</span>
              <span className="mb-1 block text-[12px] text-text-muted">Um passo por linha. Não precisa numerar.</span>
              <textarea rows={8} maxLength={LIMITES_RECEITA.modoPreparo} value={f.modoPreparo} onChange={(e) => setF({ ...f, modoPreparo: e.target.value })}
                placeholder={'Refogue a cebola no azeite até dourar\nJunte o tomate e cozinhe por 10 minutos\nAcerte o sal'} className={`${campo} py-2 leading-relaxed`} />
            </label>
            {passos.length > 0 && <p className="text-[12px] text-text-muted">{passos.length === 1 ? '1 passo' : `${passos.length} passos`}</p>}
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium">Observações</span>
              <textarea rows={3} maxLength={LIMITES_RECEITA.observacoes} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })}
                placeholder="Ponto, montagem, como guardar, alergênicos" className={`${campo} py-2 leading-relaxed`} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancelar} className={btnClass('outline')}>Cancelar</button>
              <button type="submit" disabled={pendente} className={btnClass('primary')}>{pendente ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </form>
        ) : (
          <div className="min-w-0 space-y-4">
            {(tempo || info?.rendimentoTexto) && (
              <div className="flex flex-wrap gap-2">
                {tempo && <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium"><Clock className="size-3.5" /> {tempo}</span>}
                {info?.rendimentoTexto && <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium"><Scale className="size-3.5" /> {info.rendimentoTexto}</span>}
              </div>
            )}
            {passos.length > 0 ? (
              <ol className="space-y-2.5">
                {passos.map((p, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                    <span className="num mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-fill text-[12px] font-semibold text-white">{i + 1}</span>
                    <span className="min-w-0">{p}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[14px] text-text-muted">Modo de preparo ainda não escrito.</p>
            )}
            {info?.observacoes && (
              <div className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2.5">
                <p className="mb-0.5 text-[12px] font-semibold uppercase tracking-wide text-text-muted">Observações</p>
                <p className="whitespace-pre-line text-[14px] leading-relaxed">{info.observacoes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
