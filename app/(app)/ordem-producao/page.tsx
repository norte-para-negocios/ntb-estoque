import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { SyncButton } from '@/components/SyncButton'
import { OrdemProducaoRow } from '@/components/ordem-producao/OrdemProducaoRow'

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ordens de Produção</h1>
        <SyncButton endpoint="/api/sync/ordens-producao" label="Sincronizar com Omie" />
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">OP</th>
              <th className="text-left p-3 font-medium">Produto</th>
              <th className="text-right p-3 font-medium">Qtd OP</th>
              <th className="text-left p-3 font-medium w-40">Validade</th>
              <th className="text-left p-3 font-medium w-32">Qtd etiqueta</th>
              <th className="p-3 w-56"></th>
            </tr>
          </thead>
          <tbody>
            {ordens?.length ? (
              ordens.map((op) => {
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
              })
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500">
                  Nenhuma ordem de produção. Sincronize com o Omie.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
