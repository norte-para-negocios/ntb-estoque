'use client'

import { Label } from '@/components/ui/label'

const inputClass =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40'

export type CamposLocal = {
  tipo: string
  padrao: boolean
  inativo: boolean
  dispVenda: boolean
  dispConsumoOp: boolean
  dispOrdemProducao: boolean
  dispRemessa: boolean
}

export const CAMPOS_LOCAL_PADRAO: CamposLocal = {
  tipo: '',
  padrao: false,
  inativo: false,
  dispVenda: true,
  dispConsumoOp: true,
  dispOrdemProducao: true,
  dispRemessa: true,
}

function Opcao({ id, rotulo, dica, marcado, onChange }: { id: string; rotulo: string; dica?: string; marcado: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-[var(--r-md)] bg-surface-2 px-3 py-2.5">
      <input id={id} type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand)]" />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-text">{rotulo}</span>
        {dica && <span className="block text-[12px] text-text-muted">{dica}</span>}
      </span>
    </label>
  )
}

/** Campos do local de estoque de uma loja com estoque próprio: os mesmos que a tela mostra para as lojas com Omie. */
export function CamposLocalProprio({ valor, onChange, mostrarInativo }: { valor: CamposLocal; onChange: (v: CamposLocal) => void; mostrarInativo?: boolean }) {
  const set = <K extends keyof CamposLocal>(k: K, v: CamposLocal[K]) => onChange({ ...valor, [k]: v })
  return (
    <>
      <div className="space-y-2">
        <Label>Tipo (opcional)</Label>
        <input value={valor.tipo} onChange={(e) => set('tipo', e.target.value)} className={inputClass} placeholder="Ex.: Depósito, Câmara fria, Praça" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Opcao id="loc-padrao" rotulo="Local padrão" dica="Usado quando nada mais indica o local." marcado={valor.padrao} onChange={(v) => set('padrao', v)} />
        {mostrarInativo && (
          <Opcao id="loc-inativo" rotulo="Inativo" dica="Some das telas de escolha de local." marcado={valor.inativo} onChange={(v) => set('inativo', v)} />
        )}
        <Opcao id="loc-venda" rotulo="Disponível para venda" marcado={valor.dispVenda} onChange={(v) => set('dispVenda', v)} />
        <Opcao id="loc-consumo" rotulo="Disponível para consumo" dica="Consumo de insumos em produção." marcado={valor.dispConsumoOp} onChange={(v) => set('dispConsumoOp', v)} />
        <Opcao id="loc-op" rotulo="Disponível para produção" marcado={valor.dispOrdemProducao} onChange={(v) => set('dispOrdemProducao', v)} />
        <Opcao id="loc-remessa" rotulo="Disponível para remessa" marcado={valor.dispRemessa} onChange={(v) => set('dispRemessa', v)} />
      </div>
    </>
  )
}
