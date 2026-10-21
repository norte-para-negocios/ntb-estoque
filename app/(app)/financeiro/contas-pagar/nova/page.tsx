import { Receipt } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, listarCategorias, listarFornecedores, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FormTitulo } from '@/components/financeiro/ContasPagarUI'

// Atalho "Incluir" da central de Finanças: abre o formulário de nova conta a pagar já pronto (volta para a lista ao salvar).
export default async function NovaContaPagarPage() {
  const { lojaId } = await acessoFinanceiro(PERM.contasPagar)
  const [fornecedores, categorias] = await Promise.all([listarFornecedores(lojaId), listarCategorias(lojaId)])
  return (
    <div className="space-y-4">
      <PageHeader title="Nova conta a pagar" icon={Receipt} voltarHref="/financeiro/contas-pagar" description="Lance um título a pagar de um fornecedor do cadastro." />
      <FormTitulo paginaCheia fornecedores={fornecedores} categorias={categorias.filter((c) => c.tipo === 'despesa' && c.ativa).map((c) => ({ id: c.id, nome: c.nome }))} hoje={hojeBahiaISO()} />
    </div>
  )
}
