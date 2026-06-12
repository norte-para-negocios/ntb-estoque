'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'
import {
  addInventarioItem,
  setQuantidadeInventarioItem,
  removeInventarioItem,
  finishInventario,
} from '@/lib/actions/inventario'

export type ItemContagem = {
  id: number
  produto_codigo: string
  produto_descricao: string
  produto_familia: string | null
  quan: number | null
  status: string | null
}

export function ContagemInventario({
  inventarioId,
  itensIniciais,
  finalizado,
}: {
  inventarioId: number
  itensIniciais: ItemContagem[]
  finalizado: boolean
}) {
  const [itens, setItens] = useState(itensIniciais)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function adicionar(p: ProdutoBusca) {
    if (itens.some((i) => i.produto_codigo === p.codigo)) {
      toast.info('Produto ja esta na contagem')
      return
    }
    startTransition(async () => {
      await addInventarioItem(inventarioId, {
        produto_codigo_produto: p.codigo_produto,
        produto_codigo: p.codigo,
        produto_descricao: p.descricao,
        produto_familia: p.descricao_familia,
      })
      router.refresh()
      toast.success('Produto adicionado')
    })
  }

  function salvarQtd(itemId: number, valor: string) {
    const num = valor === '' ? null : Number(valor)
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade invalida')
      return
    }
    setItens((prev) => prev.map((i) => (i.id === itemId ? { ...i, quan: num } : i)))
    startTransition(() => setQuantidadeInventarioItem(itemId, num))
  }

  function remover(itemId: number) {
    setItens((prev) => prev.filter((i) => i.id !== itemId))
    startTransition(async () => {
      await removeInventarioItem(itemId)
      toast.success('Item removido')
    })
  }

  function finalizar() {
    startTransition(async () => {
      const res = await finishInventario(inventarioId)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Inventario enviado ao Omie')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      {!finalizado && (
        <Card className="p-4 space-y-3">
          <ProdutoSearch onSelect={adicionar} />
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Produto</th>
              <th className="text-left p-3 font-medium">Familia</th>
              <th className="text-right p-3 font-medium w-32">Quantidade</th>
              <th className="text-center p-3 font-medium">Status</th>
              {!finalizado && <th className="p-3 w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {itens.length ? (
              itens.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="p-3">
                    <div className="font-medium">{item.produto_descricao}</div>
                    <div className="text-xs text-gray-500">{item.produto_codigo}</div>
                  </td>
                  <td className="p-3 text-gray-600">{item.produto_familia}</td>
                  <td className="p-3">
                    <Input
                      type="number"
                      min={0}
                      defaultValue={item.quan ?? ''}
                      disabled={finalizado || pending}
                      onBlur={(e) => salvarQtd(item.id, e.target.value)}
                      className="text-right"
                      placeholder="0"
                    />
                  </td>
                  <td className="p-3 text-center text-xs">{item.status}</td>
                  {!finalizado && (
                    <td className="p-3">
                      <button
                        onClick={() => remover(item.id)}
                        className="text-gray-400 hover:text-red-600"
                        aria-label="Remover"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={finalizado ? 4 : 5} className="p-8 text-center text-gray-500">
                  Nenhum item. Use a busca acima para adicionar produtos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {!finalizado && itens.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={finalizar} disabled={pending}>
            <CheckCircle className="size-4" />
            {pending ? 'Enviando ao Omie...' : 'Finalizar e enviar ao Omie'}
          </Button>
        </div>
      )}
    </div>
  )
}
