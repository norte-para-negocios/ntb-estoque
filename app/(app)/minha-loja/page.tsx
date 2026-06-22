import { notFound } from 'next/navigation'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { InformacoesForm, type LojaInfo } from '@/components/minha-loja/InformacoesForm'
import { EtiquetaEditor } from '@/components/minha-loja/EtiquetaEditor'
import { ETIQUETA_FORM_PADRAO, rowParaForm, type EtiquetaConfigRow, type EtiquetaFormValores } from '@/lib/etiqueta-config'
import { Store } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MinhaLojaPage() {
  // Admin global ou admin da loja, e a loja atual precisa ser uma que ele gere.
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  if (!ator.lojaIds.includes(lojaId)) notFound()

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia, cnpj, cep, uf, cidade, bairro, logradouro, numero')
    .eq('id', lojaId)
    .single<LojaInfo>()
  const { data: cfgRow } = await supabase.from('etiqueta_config').select('*').eq('loja_id', lojaId).maybeSingle()

  const etiquetaInicial: EtiquetaFormValores = cfgRow
    ? rowParaForm(cfgRow as EtiquetaConfigRow)
    : { ...ETIQUETA_FORM_PADRAO, nome_exibido: loja?.nome_fantasia ?? '' }

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Minha loja"
          icon={Store}
          description="Informações da loja e padrão da etiqueta"
        />
      </ListaHeader>

      {loja && <InformacoesForm loja={loja} />}
      <EtiquetaEditor inicial={etiquetaInicial} />
    </div>
  )
}
