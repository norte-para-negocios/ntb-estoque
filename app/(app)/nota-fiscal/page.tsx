import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { NotaFiscalFiltros } from '@/components/nota-fiscal/NotaFiscalFiltros'
import { SyncButton } from '@/components/SyncButton'
import { FileText, ArrowLeft, Eye } from 'lucide-react'

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

  const relatorioParams = new URLSearchParams()
  relatorioParams.set('data_inicio', dataInicio)
  relatorioParams.set('data_final', dataFinal)
  if (params.num_nfe) relatorioParams.set('num_nfe', params.num_nfe)
  if (params.fornecedor) relatorioParams.set('fornecedor', params.fornecedor)

  return (
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <FileText className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Notas Fiscais</h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/nota-fiscal/relatorio?${relatorioParams.toString()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ntb-btn-outline"
          >
            <FileText className="size-4" /> Relatório PDF
          </a>
          <SyncButton endpoint="/api/sync/notas-fiscais" label="Sincronizar" />
        </div>
      </div>

      <NotaFiscalFiltros
        defaults={{
          data_inicio: dataInicio,
          data_final: dataFinal,
          num_nfe: params.num_nfe ?? '',
          fornecedor: params.fornecedor ?? '',
        }}
      />

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {notas?.length ? (
          notas.map((nf) => (
            <div key={nf.id}>
              <span className="text-sm text-[#5d5d5d]">Emissão: {fmtData(nf.d_emissao_nfe)}</span>
              <div className="ntb-card mt-1">
                <div className="ntb-card-header flex items-center justify-between">
                  <span>NF nº {nf.c_numero_nfe ?? '-'}</span>
                  <span className="text-sm font-normal text-white/90">{fmtMoeda(nf.n_valor_nfe)}</span>
                </div>
                <div className="ntb-card-body flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <small className="text-[#8a8a8a]">Fornecedor</small>
                    <p className="truncate font-semibold text-[#5d5d5d]">
                      {nf.c_razao_social || nf.c_nome || '-'}
                    </p>
                  </div>
                  <Link href={`/nota-fiscal/${nf.id}`} className="ntb-btn-outline shrink-0">
                    <Eye className="size-4" /> Ver
                  </Link>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhuma nota fiscal no período. Sincronize com o Omie ou ajuste os filtros.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
