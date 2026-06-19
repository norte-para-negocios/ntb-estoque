import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { EtiquetaConfigClient } from '@/components/etiqueta/EtiquetaConfigClient'
import { Settings } from 'lucide-react'

export default async function EtiquetaConfigPage() {
  const lojaId = await getCurrentLojaId()

  // Reusa a permissao de Notas Fiscais (quem pode imprimir etiquetas pode configurar)
  const temPermissao = await requirePermissao(lojaId, 'Notas Fiscais')
  if (!temPermissao) {
    return (
      <div className="space-y-4">
        <ListaHeader>
          <PageHeader
            title="Configuracao de etiqueta"
            icon={Settings}
            description="Ajuste o layout e o alinhamento das etiquetas desta loja"
          />
        </ListaHeader>
        <EmptyState icon={Settings} title="Sem permissao" hint="Voce nao tem acesso a esta tela." />
      </div>
    )
  }

  const supabase = await createClient()

  // Dados da loja (nome para o cabecalho)
  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia, cnpj')
    .eq('id', lojaId)
    .single()

  const nomeLojaDB = loja?.nome_fantasia || loja?.nome || ''

  // Busca uma NF ou OP existente para o botao de teste
  const { data: ultimaNF } = await supabase
    .from('nota_fiscal_items')
    .select('nota_fiscal_id')
    .eq('loja_id', lojaId)
    .not('quantidade', 'is', null)
    .gt('quantidade', 0)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: ultimaOP } = await supabase
    .from('ordens_producao')
    .select('id')
    .eq('loja_id', lojaId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Configuracao de etiqueta"
          icon={Settings}
          description="Ajuste o layout e o alinhamento das etiquetas desta loja. As configuracoes ficam salvas no navegador."
        />
      </ListaHeader>

      <div className="px-4 pb-8 max-w-lg">
        <EtiquetaConfigClient
          lojaId={lojaId}
          nomeLojaDB={nomeLojaDB}
          cnpjLoja={loja?.cnpj ?? ''}
          testNfId={ultimaNF?.nota_fiscal_id ?? undefined}
          testOpId={ultimaOP?.id ?? undefined}
        />
      </div>
    </div>
  )
}
