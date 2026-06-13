import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowLeftRight, Pencil } from 'lucide-react'
import { NovaTransferencia } from '@/components/transferencia/NovaTransferencia'
import { AcoesTransferencia } from '@/components/transferencia/AcoesTransferencia'

export default async function TransferenciaPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Transferencias - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Transferencias - Excluir')

  const { data: transferencias } = await supabase
    .from('transferencias')
    .select(
      'id, data, codigo_local_origem, codigo_local_destino, status, finalizado, movimentos(count), movStatus:movimentos(status)'
    )
    .eq('loja_id', lojaId)
    .order('data', { ascending: false })
    .limit(50)

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao')

  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  function fmtData(d: string | null): string {
    if (!d) return ''
    return new Date(d).toLocaleDateString('pt-BR')
  }

  return (
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <ArrowLeftRight className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Transferências</h1>
        </div>
        {podeCriar && <NovaTransferencia locais={locais ?? []} />}
      </div>

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {transferencias?.length ? (
          transferencias.map((t) => {
            const count = Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0
            const movStatus = Array.isArray(t.movStatus) ? t.movStatus : []
            const temErro = movStatus.some((m: { status: string | null }) => m.status === 'Erro')
            const concluido = t.status === 'Concluido'
            const origem = localMap.get(t.codigo_local_origem) || t.codigo_local_origem
            const destino = localMap.get(t.codigo_local_destino) || t.codigo_local_destino
            return (
              <div key={t.id}>
                <span className="text-sm text-[#8a8a8a]">Data: {fmtData(t.data)}</span>
                <div className="ntb-card mt-1">
                  <div
                    className="flex items-center justify-between px-4 py-2 text-xs font-medium text-white"
                    style={{ backgroundColor: concluido ? '#2eb5c3' : '#f24646' }}
                  >
                    <span>{t.status}</span>
                    {t.finalizado && <span>| {fmtData(t.finalizado)}</span>}
                  </div>
                  <div className="ntb-card-body flex flex-wrap items-center gap-y-3">
                    <div className="w-1/4 min-w-[90px]">
                      <small className="text-[#8a8a8a]">Estoque</small>
                      <p className="font-semibold text-[#5d5d5d]">#{t.id}</p>
                    </div>
                    <div className="w-1/4 min-w-[90px]">
                      <small className="text-[#8a8a8a]">Produtos</small>
                      <p className="font-semibold text-[#5d5d5d]">{count}</p>
                    </div>
                    <div className="w-1/2 min-w-[160px]">
                      <small className="text-[#8a8a8a]">Local</small>
                      <p className="truncate font-semibold text-[#5d5d5d]">
                        {origem} - {destino}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Link href={`/transferencia/${t.id}/contagem`} className="ntb-btn-outline">
                        <Pencil className="size-4" /> {concluido ? 'Ver' : 'Contar'}
                      </Link>
                      <AcoesTransferencia
                        transferenciaId={t.id}
                        temErro={temErro}
                        podeExcluir={podeExcluir}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhuma transferência. Crie uma nova para começar.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
