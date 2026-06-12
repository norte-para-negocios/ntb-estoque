import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyWebhook } from '@/components/loja/CopyWebhook'

function statusBadge(status: string | null) {
  if (status === 'Concluido') return <Badge>Concluído</Badge>
  if (status === 'Processando') return <Badge variant="secondary">Processando</Badge>
  if (status === 'Erro') return <Badge variant="destructive">Erro</Badge>
  return <Badge variant="secondary">-</Badge>
}

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString('pt-BR') : '-'
}

export default async function LojaPage() {
  if (!(await isAdmin())) notFound()

  const supabase = await createClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('*')
    .order('id')

  const webhookUrl =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://ntb-estoque.vercel.app') + '/api/webhook'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Lojas</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook do Omie</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-2">
            Configure esta URL no Omie (Segurança {'>'} My Apps {'>'} Webhook) de cada loja:
          </p>
          <CopyWebhook url={webhookUrl} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {lojas?.map((loja) => (
          <Card key={loja.id}>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>{loja.nome_fantasia || loja.nome}</span>
                <Badge variant={loja.ativo ? 'default' : 'secondary'}>
                  {loja.ativo ? 'Ativa' : 'Inativa'}
                </Badge>
              </CardTitle>
              <p className="text-xs text-gray-500">{loja.cnpj}</p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Produtos</span>
                <span className="flex items-center gap-2">
                  {statusBadge(loja.produto_status)}
                  <span className="text-xs text-gray-400">{fmt(loja.produto_ultima_atualizacao)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Locais</span>
                <span className="flex items-center gap-2">
                  {statusBadge(loja.local_estoque_status)}
                  <span className="text-xs text-gray-400">{fmt(loja.local_estoque_ultima_atualizacao)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Notas Fiscais</span>
                <span className="flex items-center gap-2">
                  {statusBadge(loja.nota_fiscal_status)}
                  <span className="text-xs text-gray-400">{fmt(loja.nota_fiscal_ultima_atualizacao)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Ordens de Produção</span>
                <span className="flex items-center gap-2">
                  {statusBadge(loja.ordem_producao_status)}
                  <span className="text-xs text-gray-400">{fmt(loja.ordem_producao_ultima_atualizacao)}</span>
                </span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-gray-600">Integração Omie</span>
                <Badge variant={loja.omie_app_key ? 'default' : 'destructive'}>
                  {loja.omie_app_key ? 'Conectada' : 'Sem chave'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
