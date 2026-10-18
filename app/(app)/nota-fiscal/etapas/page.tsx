import { notFound, redirect } from 'next/navigation'
import { KanbanSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { QuadroEtapasNF, type CartaoEtapa } from '@/components/nota-fiscal/QuadroEtapasNF'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { addDias, lerPeriodo } from '@/lib/faturamento-periodo'
import { agruparPorEtapa } from '@/lib/estoque/nf-etapas'

// Etapas do recebimento (só loja de estoque próprio, Fase B/R9): Aguardando o XML → A conferir → Conferida → Lançada.
// Sem arrastar: a etapa muda pelas ações da própria nota.

type Sp = Record<string, string | undefined>

export default async function EtapasRecebimentoPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()
  if ((await modoDaLoja(lojaId)) !== 'proprio') redirect('/nota-fiscal')
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  // padrão: últimos 30 dias
  const per = sp.ini || sp.mes ? lerPeriodo({ ini: sp.ini, fim: sp.fim, mes: sp.mes }, hoje, 366) : { ini: addDias(hoje, -29), fim: hoje }

  const supabase = await createClient()
  const linhas: CartaoEtapa[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('notas_fiscais')
      .select('id, c_numero_nfe, c_razao_social, c_nome, d_emissao_nfe, n_valor_nfe, full_object')
      .eq('loja_id', lojaId).is('deleted_at', null).gte('d_emissao_nfe', per.ini).lte('d_emissao_nfe', per.fim)
      .order('d_emissao_nfe', { ascending: false }).order('id').range(from, from + 999)
    if (error) break
    for (const n of data ?? []) {
      const fo = (n.full_object ?? {}) as { infoCadastro?: { cCancelada?: string }; sefaz?: { situacao?: string } }
      linhas.push({
        id: Number(n.id), numero: n.c_numero_nfe ?? null, fornecedor: n.c_razao_social || n.c_nome || null, valor: n.n_valor_nfe != null ? Number(n.n_valor_nfe) : null,
        emissao: n.d_emissao_nfe ?? null, situacao: fo.sefaz?.situacao ?? null, cancelada: fo.infoCadastro?.cCancelada === 'S',
      })
    }
    if (!data || data.length < 1000) break
  }
  const grupos = agruparPorEtapa(linhas)

  return (
    <div className="space-y-4">
      <PageHeader title="Etapas do recebimento" icon={KanbanSquare} description="Onde está cada nota de entrada: da chegada do XML até a entrada no estoque." />
      <PeriodoBar basePath="/nota-fiscal/etapas" params={{}} ini={per.ini} fim={per.fim} hoje={hoje} />
      <QuadroEtapasNF grupos={grupos} />
    </div>
  )
}
