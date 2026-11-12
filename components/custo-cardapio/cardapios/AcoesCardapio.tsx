'use client'

import { useTransition } from 'react'
import { Archive, ArchiveRestore, FileText, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { arquivarCardapio } from '@/lib/actions/cozinha-cardapios'
import type { CanalCardapio } from '@/lib/custo-cardapio/cardapios-puro'
import { FormCardapio } from './FormCardapio'

export function AcoesCardapio({ cardapio }: { cardapio: { id: number; nome: string; canal: CanalCardapio; ativo: boolean } }) {
  const [pendente, start] = useTransition()
  const alternar = () => start(async () => {
    const r = await arquivarCardapio(cardapio.id, !cardapio.ativo)
    if ('error' in r) toast.error(r.error)
    else toast.success(cardapio.ativo ? 'Cardápio arquivado' : 'Cardápio reativado')
  })
  return (
    <>
      <a href={`/cozinha/cardapios/${cardapio.id}/pdf`} className={btnClass('outline')}><FileText className="size-4" /> PDF</a>
      <a href={`/cozinha/cardapios/${cardapio.id}/pdf?interno=1`} className={btnClass('outline')}>PDF com custos</a>
      <FormCardapio cardapio={cardapio} gatilho={<button type="button" className={btnClass('outline')}><Pencil className="size-4" /> Editar</button>} />
      <button type="button" disabled={pendente} onClick={alternar} className={btnClass('ghost')}>
        {cardapio.ativo ? <><Archive className="size-4" /> Arquivar</> : <><ArchiveRestore className="size-4" /> Reativar</>}
      </button>
    </>
  )
}
