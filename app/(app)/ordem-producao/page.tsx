import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { SyncButton } from '@/components/SyncButton'
import { OrdemProducaoRow } from '@/components/ordem-producao/OrdemProducaoRow'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Factory } from 'lucide-react'

export default async function OrdemProducaoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const supabase = await createClient()

  const { data: ordens } = await supabase
    .from('ordens_producao')
    .select(
      'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, validade, quantidade'
    )
    .eq('loja_id', lojaId)
    .order('updated_at', { ascending: false })
    .limit(50)

  // Buscar descricoes dos produtos relacionados
  const codigos = [...new Set((ordens ?? []).map((o) => o.identificacao_n_cod_produto).filter(Boolean))]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }

  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ordens de Produção"
        icon={Factory}
        actions={<SyncButton endpoint="/api/sync/ordens-producao" label="Sincronizar" />}
      />

      {ordens?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>OP</th>
              <th>Produto</th>
              <th className="text-right">Qtd OP</th>
              <th>Validade</th>
              <th>Quantidade</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ordens.map((op) => {
              const prod = prodMap.get(op.identificacao_n_cod_produto)
              return (
                <OrdemProducaoRow
                  key={op.id}
                  op={{
                    id: op.id,
                    numOP: op.identificacao_c_num_op || op.num_ordem || '-',
                    produto: prod?.descricao || `Produto ${op.identificacao_n_cod_produto}`,
                    unidade: prod?.unidade || 'UN',
                    qtdOP: op.identificacao_n_qtde,
                    validade: op.validade,
                    quantidade: op.quantidade,
                  }}
                />
              )
            })}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          icon={Factory}
          title="Nenhuma ordem de produção"
          hint="Sincronize com o Omie."
        />
      )}
    </div>
  )
}
