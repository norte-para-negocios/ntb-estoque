'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ParceiroForm, type ParceiroFormValues } from '@/components/parceiro/ParceiroForm'
import { PuxarParceiro } from '@/components/parceiro/PuxarParceiro'
import { btnClass } from '@/components/ui-kit/Button'
import {
  criarCliente,
  editarCliente,
  excluirCliente,
  puxarClientesDoOmie,
  type ClienteInput,
} from '@/lib/actions/cliente'

function toInput(v: ParceiroFormValues): ClienteInput {
  return {
    razao_social: v.razao_social,
    nome_fantasia: v.nome_fantasia,
    cnpj_cpf: v.cnpj_cpf,
    pessoa_fisica: v.pessoa_fisica,
    inscricao_estadual: v.inscricao_estadual,
    cest: v.cest ?? '',
    email: v.email,
    telefone: v.telefone,
    cep: v.cep,
    uf: v.uf,
    cidade: v.cidade,
    bairro: v.bairro,
    logradouro: v.logradouro,
    numero: v.numero,
    inativo: v.inativo,
  }
}

export function NovoCliente() {
  return (
    <ParceiroForm
      titulo="cliente"
      rotuloNovo="Novo cliente"
      comCest
      onSubmit={(_, v) => criarCliente(toInput(v))}
    />
  )
}

export function EditarCliente({ existente }: { existente: { id: number; values: ParceiroFormValues } }) {
  return (
    <ParceiroForm
      titulo="cliente"
      rotuloNovo="Editar cliente"
      comCest
      existente={existente}
      onSubmit={(id, v) => editarCliente(id!, toInput(v))}
    />
  )
}

export function PuxarClientes() {
  return <PuxarParceiro acao={puxarClientesDoOmie} sucesso="Clientes atualizados do Omie" />
}

export function ExcluirCliente({ id, nome }: { id: number; nome: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (!window.confirm(`Excluir o cliente "${nome}"?`)) return
    startTransition(async () => {
      const res = await excluirCliente(id)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Cliente excluído')
        router.refresh()
      }
    })
  }

  return (
    <button type="button" onClick={excluir} disabled={pending} className={btnClass('ghost')}>
      <Trash2 className="size-4" /> Excluir
    </button>
  )
}
