'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { confirmarImportacao, previaImportacao, type PreviaImportacao } from '@/lib/actions/importacao'
import type { AcaoLinha, TipoImportacao } from '@/lib/importacao/planilha-puro'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const ACAO: Record<AcaoLinha, { rotulo: string; cor: string }> = {
  novo: { rotulo: 'Novo', cor: 'bg-ok' },
  atualizar: { rotulo: 'Atualiza', cor: 'bg-info' },
  sem_mudanca: { rotulo: 'Sem mudança', cor: 'bg-text-muted' },
  erro: { rotulo: 'Erro', cor: 'bg-err' },
}
const FILTROS: (AcaoLinha | 'todas')[] = ['todas', 'erro', 'novo', 'atualizar', 'sem_mudanca']

function resumoDados(d: Record<string, string | number | boolean | null>): string {
  return Object.entries(d).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v)}`).join(' · ')
}

/** Enviar planilha → prévia linha a linha → confirmar (Fase G [K10/O6]; só estoque próprio). */
export function ImportarPlanilha({ tipo, voltar }: { tipo: TipoImportacao; voltar: string }) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null)
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number } | null>(null)
  const [filtro, setFiltro] = useState<AcaoLinha | 'todas'>('todas')
  const [pending, start] = useTransition()
  const validas = previa ? previa.resumo.novo + previa.resumo.atualizar : 0
  const visiveis = useMemo(() => (previa?.linhas ?? []).filter((l) => filtro === 'todas' || l.acao === filtro).slice(0, 500), [previa, filtro])

  function verPrevia() {
    if (!arquivo) return
    const fd = new FormData()
    fd.set('tipo', tipo)
    fd.set('arquivo', arquivo)
    setResultado(null)
    start(async () => {
      const r = await previaImportacao(fd)
      if ('error' in r) { toast.error(r.error); return }
      setPrevia(r)
      setFiltro(r.resumo.erro ? 'erro' : 'todas')
    })
  }

  function confirmar() {
    if (!previa || !validas) return
    if (!window.confirm(`Gravar ${validas} linha(s) no cadastro? ${previa.resumo.erro ? `${previa.resumo.erro} linha(s) com erro ficam de fora.` : ''}`)) return
    start(async () => {
      const r = await confirmarImportacao(previa.id, tipo)
      if ('error' in r) { toast.error(r.error); return }
      setResultado({ criados: r.criados, atualizados: r.atualizados })
      setPrevia(null)
      setArquivo(null)
      toast.success(r.duplicado ? 'Esta prévia já tinha sido importada.' : 'Importação concluída')
    })
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
        <ol className="list-decimal space-y-1 pl-5 text-[14px] text-text">
          <li>Baixe o modelo e preencha (a aba &ldquo;Instruções&rdquo; explica cada coluna). Também aceita .csv.</li>
          <li>Envie a planilha e confira a prévia: nada é gravado antes de você confirmar.</li>
          <li>Confirme: as linhas válidas entram de uma vez; as com erro ficam de fora.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`${voltar}/importar/modelo`} className={btnClass('outline')}><Download className="size-4" /> Baixar modelo</a>
          <input id="planilha" type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setPrevia(null) }} />
          <label htmlFor="planilha" className={`${btnClass('outline')} cursor-pointer`}><FileSpreadsheet className="size-4" /> {arquivo ? arquivo.name : 'Escolher planilha'}</label>
          <button type="button" onClick={verPrevia} disabled={!arquivo || pending} className={btnClass('primary')}>
            {pending && !previa ? <Spinner /> : <Upload className="size-4" />} Ver prévia
          </button>
        </div>
      </section>

      {resultado && (
        <section className="rounded-[var(--r-lg)] bg-surface p-5 text-[14px] shadow-[var(--shadow-sm)]">
          <p className="font-semibold text-text">Importação concluída: {resultado.criados} novo(s), {resultado.atualizados} atualizado(s).</p>
          <Link href={voltar} className="mt-2 inline-block text-[13px] font-semibold text-brand">Ver o cadastro</Link>
        </section>
      )}

      {previa && (
        <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold text-text">Prévia</h2>
            <button type="button" onClick={confirmar} disabled={!validas || pending} className={btnClass('primary')}>
              {pending ? <Spinner /> : null} Importar {validas} linha{validas === 1 ? '' : 's'}
            </button>
          </div>
          {previa.jaImportadaEm && (
            <p className="text-[13px] text-warn">Esta mesma planilha já foi importada em {new Date(previa.jaImportadaEm).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}. O que já entrou aparece como &ldquo;Sem mudança&rdquo;.</p>
          )}
          {previa.desconhecidas.length > 0 && (
            <p className="text-[13px] text-text-muted">Colunas ignoradas (não reconhecidas): {previa.desconhecidas.join(', ')}.</p>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar linhas">
            {FILTROS.map((f) => (
              <button key={f} type="button" onClick={() => setFiltro(f)}
                className={`rounded-full px-3 py-1 text-[13px] ${filtro === f ? 'bg-brand text-white' : 'bg-surface-2 text-text'}`}>
                {f === 'todas' ? `Todas (${previa.linhas.length})` : `${ACAO[f].rotulo} (${previa.resumo[f]})`}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead><tr className="border-b border-border text-left text-[12px] text-text-muted">
                <th className="px-2 py-1.5">Linha</th><th className="px-2 py-1.5">Situação</th><th className="px-2 py-1.5">Registro</th><th className="px-2 py-1.5">O que vai mudar / erro</th>
              </tr></thead>
              <tbody>
                {visiveis.map((l) => (
                  <tr key={l.n} className="border-t border-border/60 align-top">
                    <td className="num px-2 py-1.5 text-text-muted">{l.n}</td>
                    <td className="whitespace-nowrap px-2 py-1.5"><span className={`mr-1.5 inline-block size-2 rounded-full ${ACAO[l.acao].cor}`} aria-hidden />{ACAO[l.acao].rotulo}</td>
                    <td className="px-2 py-1.5">{l.chave}</td>
                    <td className={`px-2 py-1.5 ${l.acao === 'erro' ? 'text-err' : 'text-text-muted'}`}>{l.acao === 'erro' ? l.erros.join('; ') : resumoDados(l.dados) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visiveis.length === 500 && <p className="mt-2 text-[12px] text-text-muted">Mostrando as primeiras 500 linhas deste filtro.</p>}
          </div>
        </section>
      )}
    </div>
  )
}
