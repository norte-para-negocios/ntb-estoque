import { Tags } from 'lucide-react'
import { acessoFinanceiro, listarCategorias, listarFamiliasCategoria, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { SelectFamiliaCategoria } from '@/components/financeiro/DecisoesNotaUI'

// Decisão do dono (05/11, migration 360): não existe categoria padrão para a conta da nota de entrada. Ela vem da FAMÍLIA do
// produto: cada família aponta para uma categoria financeira. A conta leva a categoria da família de maior valor da nota; família
// sem categoria = conta "A definir". Só desenvolvedor (rota-mãe /financeiro em ROTAS_SO_DEV).
export default async function FamiliasCategoriaPage() {
  const { lojaId } = await acessoFinanceiro(PERM.categorias)
  const [{ familias, semMigration }, categorias] = await Promise.all([listarFamiliasCategoria(lojaId), listarCategorias(lojaId)])
  const opcoes = categorias.filter((c) => c.tipo === 'despesa' && c.ativa).map((c) => ({ id: c.id, nome: c.nome }))
  const ligadas = familias.filter((f) => f.categoria_id && f.categoria_ok).length
  return (
    <div className="space-y-4">
      <PageHeader title="Categoria por família" icon={Tags}
        description="Cada família de produto aponta para uma categoria financeira. A conta a pagar da nota leva a categoria da família de maior valor; família sem categoria deixa a conta “A definir”." />
      {semMigration ? (
        <p className="text-[13px] text-text-muted">Ainda não ativado nesta instalação (migration 360).</p>
      ) : familias.length === 0 ? (
        <EmptyState icon={Tags} title="Nenhuma família nesta loja" hint="Cadastre as famílias dos produtos primeiro." />
      ) : (
        <>
          <p className="text-[13px] text-text-muted">{ligadas} de {familias.length} famílias com categoria.{opcoes.length === 0 && ' Crie categorias de despesa em Categorias financeiras.'}</p>
          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Família</th>
                  <th className="px-2 py-2.5 text-right font-medium">Produtos</th>
                  <th className="px-4 py-2.5 font-medium">Categoria financeira</th>
                </tr>
              </thead>
              <tbody>
                {familias.map((f) => (
                  <tr key={f.codigo_familia} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2">
                      <span className="font-medium text-text">{f.nome}</span>
                      {f.inativa && <span className="ml-2 text-text-muted">(inativa)</span>}
                      {f.categoria_id && !f.categoria_ok && <p className="text-warn">A categoria ligada foi desativada ou virou receita: a conta fica “A definir”.</p>}
                    </td>
                    <td className="num px-2 py-2 text-right text-text-muted">{f.produtos}</td>
                    <td className="px-4 py-2"><SelectFamiliaCategoria codigoFamilia={f.codigo_familia} atual={f.categoria_ok ? f.categoria_id : null} categorias={opcoes} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
