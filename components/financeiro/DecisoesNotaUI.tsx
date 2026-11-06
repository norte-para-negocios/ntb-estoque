'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { decidirNotaDesfeita, gerarContasNotasSemConta, salvarFamiliaCategoria } from '@/lib/actions/financeiro'
import { campo } from './comum'

// Decisões do dono de 05/11 (migration 360), telas só dev: categoria por família, notas sem conta, notas desfeitas com conta paga.

/** Select da categoria de uma família: muda na hora (vazio = sem categoria). */
export function SelectFamiliaCategoria({ codigoFamilia, atual, categorias }: {
  codigoFamilia: number; atual: number | null; categorias: { id: number; nome: string }[]
}) {
  const [valor, setValor] = useState(atual ? String(atual) : '')
  const [pendente, start] = useTransition()
  const router = useRouter()
  return (
    <select aria-label="Categoria financeira" className={`${campo} max-w-[320px]`} value={valor} disabled={pendente}
      onChange={(e) => {
        const novo = e.target.value
        const antes = valor
        setValor(novo)
        start(async () => {
          const r = await salvarFamiliaCategoria(codigoFamilia, novo ? Number(novo) : null)
          if ('error' in r) { toast.error(r.error); setValor(antes); return }
          if (r.mudou) toast.success(novo ? 'Categoria ligada à família.' : 'Família ficou sem categoria.')
          router.refresh()
        })
      }}>
      <option value="">A definir (sem categoria)</option>
      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
    </select>
  )
}

function resumoGeracao(r: { notaId: number; ok: boolean; gerados: number; mensagem: string | null }[]) {
  const geradas = r.reduce((a, x) => a + x.gerados, 0)
  const falhas = r.filter((x) => !x.ok)
  if (geradas) toast.success(geradas === 1 ? '1 conta a pagar gerada.' : `${geradas} contas a pagar geradas.`)
  for (const f of falhas.slice(0, 3)) toast.error(`Nota ${f.notaId}: ${f.mensagem}`)
  if (!geradas && !falhas.length) toast.info(r[0]?.mensagem ?? 'Nada a gerar.')
}

/** "Gerar contas desta nota". */
export function GerarNotaBotao({ notaId }: { notaId: number }) {
  const [pendente, start] = useTransition()
  const router = useRouter()
  return (
    <button type="button" className={btnClass('outline')} disabled={pendente} onClick={() => start(async () => {
      const r = await gerarContasNotasSemConta([notaId])
      if ('error' in r) { toast.error(r.error); return }
      resumoGeracao(r.resultados)
      router.refresh()
    })}>{pendente ? 'Gerando…' : 'Gerar contas desta nota'}</button>
  )
}

/** Caixa de seleção de cada nota + "Gerar das selecionadas" (o formulário junta as caixas pelo atributo form). */
export function GerarSelecionadas({ formId, total }: { formId: string; total: number }) {
  const [pendente, start] = useTransition()
  const router = useRouter()
  return (
    <button type="button" className={btnClass('primary')} disabled={pendente || !total} onClick={() => {
      const ids = [...document.querySelectorAll<HTMLInputElement>(`input[form="${formId}"][name="nota"]:checked`)].map((i) => Number(i.value))
      if (!ids.length) { toast.error('Selecione pelo menos uma nota.'); return }
      if (!window.confirm(`Gerar as contas a pagar de ${ids.length === 1 ? '1 nota' : `${ids.length} notas`}? Vale mesmo em loja com a geração automática desligada.`)) return
      start(async () => {
        const r = await gerarContasNotasSemConta(ids)
        if ('error' in r) { toast.error(r.error); return }
        resumoGeracao(r.resultados)
        router.refresh()
      })
    }}>{pendente ? 'Gerando…' : 'Gerar das selecionadas'}</button>
  )
}

/** Duas decisões do gerente sobre a conta paga de nota desfeita. Motivo obrigatório. */
export function DecidirNotaDesfeita({ tituloId, rotulo }: { tituloId: number; rotulo: string }) {
  const [motivo, setMotivo] = useState('')
  const [pendente, start] = useTransition()
  const router = useRouter()
  const decidir = (acao: 'estornar' | 'manter') => {
    if (motivo.trim().length < 3) { toast.error('Escreva o motivo da decisão.'); return }
    const texto = acao === 'estornar'
      ? `Estornar o pagamento de ${rotulo}? O valor volta ao extrato e a conta é cancelada.`
      : `Manter ${rotulo} como está (paga)?`
    if (!window.confirm(texto)) return
    start(async () => {
      const r = await decidirNotaDesfeita(tituloId, acao, motivo)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(acao === 'estornar' ? 'Pagamento estornado e conta cancelada.' : 'Decisão registrada: a conta fica.')
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Motivo" className={`${campo} max-w-[280px]`} placeholder="Motivo (obrigatório)" value={motivo}
        onChange={(e) => setMotivo(e.target.value)} maxLength={300} disabled={pendente} />
      <button type="button" className={btnClass('outline')} disabled={pendente} onClick={() => decidir('estornar')}>Estornar o pagamento</button>
      <button type="button" className={btnClass('outline')} disabled={pendente} onClick={() => decidir('manter')}>Manter a conta</button>
    </div>
  )
}
