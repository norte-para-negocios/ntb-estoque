import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { NotaFiscalFiltros } from '@/components/nota-fiscal/NotaFiscalFiltros'
import { SyncButton } from '@/components/SyncButton'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function fmtMoeda(v: number | null): string {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function NotaFiscalPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    num_nfe?: string
    fornecedor?: string
    produto?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  const params = await searchParams
  const supabase = await createClient()

  const dataInicio =
    params.data_inicio || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = params.data_final || new Date().toISOString().split('T')[0]

  let query = supabase
    .from('notas_fiscais')
    .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa')
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .order('d_emissao_nfe', { ascending: false })
    .limit(50)

  if (params.num_nfe) query = query.ilike('c_numero_nfe', `%${params.num_nfe}%`)
  if (params.fornecedor) query = query.ilike('c_razao_social', `%${params.fornecedor}%`)

  const { data: notas } = await query

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notas Fiscais</h1>
        <SyncButton endpoint="/api/sync/notas-fiscais" label="Sincronizar com Omie" />
      </div>

      <NotaFiscalFiltros
        defaults={{
          data_inicio: dataInicio,
          data_final: dataFinal,
          num_nfe: params.num_nfe ?? '',
          fornecedor: params.fornecedor ?? '',
        }}
      />

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Emissao</th>
              <th className="text-left p-3 font-medium">NFe</th>
              <th className="text-left p-3 font-medium">Fornecedor</th>
              <th className="text-right p-3 font-medium">Valor</th>
              <th className="text-center p-3 font-medium">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {notas?.length ? (
              notas.map((nf) => (
                <tr key={nf.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">{fmtData(nf.d_emissao_nfe)}</td>
                  <td className="p-3">{nf.c_numero_nfe}</td>
                  <td className="p-3">{nf.c_razao_social || nf.c_nome}</td>
                  <td className="p-3 text-right">{fmtMoeda(nf.n_valor_nfe)}</td>
                  <td className="p-3 text-center">
                    <Badge variant={nf.c_etapa === '50' ? 'default' : 'secondary'}>
                      {nf.c_etapa === '50' ? 'Concluida' : 'Pendente'}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/nota-fiscal/${nf.id}`}
                      className="text-blue-600 hover:underline whitespace-nowrap"
                    >
                      Ver itens
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500">
                  Nenhuma nota fiscal no periodo. Sincronize com o Omie ou ajuste os filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
