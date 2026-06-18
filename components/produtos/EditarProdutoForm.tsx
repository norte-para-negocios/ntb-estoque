'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { editarProduto } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { parseNumBR } from '@/lib/num-br'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

export type ProdutoEditavel = {
  id: number
  codigo: string | null
  descricao: string | null
  codigoFamilia: number | null
  tipoItem: string | null
  unidade: string | null
  ncm: string | null
  valorUnitario: number | null
  estoqueMinimo: number | null
  inativo: boolean
}

// Edita um produto LOCAL (salva no banco, nao escreve no Omie). O codigo e read-only.
export function EditarProdutoForm({
  produto,
  familias,
}: {
  produto: ProdutoEditavel
  familias: { codigo: number; descricao: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [descricao, setDescricao] = useState(produto.descricao ?? '')
  // codigo_familia 0 no Omie = "sem familia": inicia como vazio para o select casar.
  const [familia, setFamilia] = useState(produto.codigoFamilia ? String(produto.codigoFamilia) : '')
  const [tipo, setTipo] = useState(produto.tipoItem ?? '')
  const [unidade, setUnidade] = useState(produto.unidade ?? '')
  const [ncm, setNcm] = useState(produto.ncm ?? '')
  const [valor, setValor] = useState(produto.valorUnitario != null ? String(produto.valorUnitario) : '')
  const [minimo, setMinimo] = useState(produto.estoqueMinimo != null ? String(produto.estoqueMinimo) : '')
  const [inativo, setInativo] = useState(produto.inativo)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function salvar() {
    if (!descricao.trim()) {
      toast.error('Informe a descrição')
      return
    }
    if (!unidade.trim()) {
      toast.error('Informe a unidade')
      return
    }
    const ncmLimpo = ncm.replace(/\D/g, '')
    if (ncmLimpo && ncmLimpo.length !== 8) {
      toast.error('O NCM deve ter 8 dígitos (ou deixe em branco)')
      return
    }
    const valNum = parseNumBR(valor)
    if (valNum != null && (Number.isNaN(valNum) || valNum < 0)) {
      toast.error('Preço de venda inválido')
      return
    }
    const minNum = parseNumBR(minimo)
    if (minNum != null && (Number.isNaN(minNum) || minNum < 0)) {
      toast.error('Estoque mínimo inválido')
      return
    }
    const fam = familias.find((f) => String(f.codigo) === familia)

    startTransition(async () => {
      const res = await editarProduto(produto.id, {
        descricao: descricao.trim(),
        codigoFamilia: fam ? fam.codigo : null,
        descricaoFamilia: fam ? fam.descricao : null,
        tipoItem: tipo || null,
        unidade: unidade.trim(),
        ncm: ncmLimpo || null,
        valorUnitario: valNum,
        estoqueMinimo: minNum,
        inativo,
      })
      if (res?.error) {
        toast.error('Erro ao salvar', { description: res.error })
        return
      }
      toast.success('Produto atualizado')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-brand"
            aria-label="Editar produto"
            title="Editar produto"
          >
            <Pencil className="size-4" />
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Editar produto
          {produto.codigo && <span className="ml-2 text-[13px] font-normal text-text-muted">#{produto.codigo}</span>}
        </div>
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto px-4 py-3">
          <div className="col-span-2">
            <label className={labelClass}>Descrição</label>
            <input
              className={inputClass}
              value={descricao}
              autoFocus
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Família</label>
            <select className={inputClass} value={familia} onChange={(e) => setFamilia(e.target.value)}>
              <option value="">Sem família</option>
              {familias
                .filter((f) => f.codigo > 0 && f.descricao.trim())
                .map((f) => (
                  <option key={f.codigo} value={f.codigo}>
                    {f.descricao}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Tipo de produto</label>
            <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Padrão</option>
              {PRODUTO_TIPO_ITEM.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Unidade</label>
            <input className={inputClass} value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="UN, KG..." />
          </div>
          <div>
            <label className={labelClass}>NCM</label>
            <input
              className={inputClass}
              value={ncm}
              inputMode="numeric"
              onChange={(e) => setNcm(e.target.value)}
              placeholder="8 dígitos"
            />
          </div>
          <div>
            <label className={labelClass}>Preço de venda</label>
            <input
              className={inputClass}
              value={valor}
              inputMode="decimal"
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div>
            <label className={labelClass}>Estoque mínimo</label>
            <input
              className={inputClass}
              value={minimo}
              inputMode="decimal"
              onChange={(e) => setMinimo(e.target.value)}
              placeholder="0"
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={inativo}
              onChange={(e) => setInativo(e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Produto inativo
          </label>
          <p className="col-span-2 text-[12px] text-text-muted">
            A edição é salva no NTB e protegida da sincronização com o Omie. A alteração no Omie ainda
            não é feita por aqui.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending && <Spinner />}
            {pending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
