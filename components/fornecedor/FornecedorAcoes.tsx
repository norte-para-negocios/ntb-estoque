'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ParceiroForm, type ParceiroFormValues } from '@/components/parceiro/ParceiroForm'
import { PuxarParceiro } from '@/components/parceiro/PuxarParceiro'
import { btnClass } from '@/components/ui-kit/Button'
import {
  criarFornecedor,
  editarFornecedor,
  excluirFornecedor,
  puxarFornecedoresDoOmie,
  type ParceiroInput,
} from '@/lib/actions/fornecedor'

function toInput(v: ParceiroFormValues): ParceiroInput {
  return {
    razao_social: v.razao_social,
    nome_fantasia: v.nome_fantasia,
    cnpj_cpf: v.cnpj_cpf,
    pessoa_fisica: v.pessoa_fisica,
    inscricao_estadual: v.inscricao_estadual,
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

export function NovoFornecedor() {
  return (
    <ParceiroForm
      titulo="fornecedor"
      rotuloNovo="Novo fornecedor"
      onSubmit={(_, v) => criarFornecedor(toInput(v))}
    />
  )
}

export function EditarFornecedor({ existente }: { existente: { id: number; values: ParceiroFormValues } }) {
  return (
    <ParceiroForm
      titulo="fornecedor"
      rotuloNovo="Editar fornecedor"
      existente={existente}
      onSubmit={(id, v) => editarFornecedor(id!, toInput(v))}
    />
  )
}

export function PuxarFornecedores() {
  return <PuxarParceiro acao={puxarFornecedoresDoOmie} sucesso="Fornecedores atualizados do Omie" />
}

export function ExcluirFornecedor({ id, nome }: { id: number; nome: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (!window.confirm(`Excluir o fornecedor "${nome}"?`)) return
    startTransition(async () => {
      const res = await excluirFornecedor(id)
      if (res?.error) toast.error('Erro', { description: res.error })
      else {
        toast.success('Fornecedor excluído')
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
