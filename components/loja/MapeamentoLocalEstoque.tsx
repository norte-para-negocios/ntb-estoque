'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { salvarMapeamentoLocalEstoque } from '@/lib/actions/mapeamento-local-estoque'

type Local = { codigo_local_estoque: number; descricao: string }

// Escolhe, entre os locais de estoque que a propria loja ja cadastrou, qual
// representa "a" Cozinha e "o" Bar pra efeito da Ordem de Producao automatica
// disparada pelo ntb-vendas (migration 120). Sem nenhum local cadastrado
// ainda, mostra um aviso em vez do formulario.
export function MapeamentoLocalEstoque({
  lojaId,
  locais,
  cozinhaAtual,
  barAtual,
}: {
  lojaId: number
  locais: Local[]
  cozinhaAtual: number | null
  barAtual: number | null
}) {
  const [cozinha, setCozinha] = useState<string>(cozinhaAtual != null ? String(cozinhaAtual) : '')
  const [bar, setBar] = useState<string>(barAtual != null ? String(barAtual) : '')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function salvar() {
    startTransition(async () => {
      const res = await salvarMapeamentoLocalEstoque(
        lojaId,
        cozinha ? Number(cozinha) : null,
        bar ? Number(bar) : null
      )
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Mapeamento salvo')
      router.refresh()
    })
  }

  if (!locais.length) {
    return (
      <p className="text-[13px] text-text-muted">
        Esta loja ainda não tem nenhum local de estoque cadastrado.{' '}
        <a href="/local-estoque" className="font-medium text-brand hover:underline">
          Cadastre em Locais de Estoque
        </a>{' '}
        primeiro.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-text-muted">
        Quando o ntb-vendas disparar uma Ordem de Produção, ela usa o local escolhido aqui conforme onde o item foi
        preparado (Cozinha ou Bar). Sem escolher, a OP cai no local padrão do Omie, como sempre foi.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-text-muted">Cozinha</label>
          <select
            value={cozinha}
            onChange={(e) => setCozinha(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-brand"
          >
            <option value="">— Não mapeado —</option>
            {locais.map((l) => (
              <option key={l.codigo_local_estoque} value={l.codigo_local_estoque}>
                {l.descricao}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-text-muted">Bar</label>
          <select
            value={bar}
            onChange={(e) => setBar(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none focus:border-brand"
          >
            <option value="">— Não mapeado —</option>
            {locais.map((l) => (
              <option key={l.codigo_local_estoque} value={l.codigo_local_estoque}>
                {l.descricao}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="button" onClick={salvar} disabled={pending} className={btnClass('outline')}>
        {pending && <Spinner />} {pending ? 'Salvando...' : 'Salvar mapeamento'}
      </button>
    </div>
  )
}
