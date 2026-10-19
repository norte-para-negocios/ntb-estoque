import { notFound } from 'next/navigation'
import { UserCog } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Compradores, PrazosFornecedores, type CompradorLinha, type FornecedorPrazo } from '@/components/compras/CadastrosCompras'

// Compradores [I8] e prazo de entrega por fornecedor (Fase C2). Só estoque próprio; loja Omie = 404.
export default async function ComprasCadastrosPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const [podePedidos, podeGestor] = await Promise.all([requirePermissao(lojaId, 'Compras - Pedidos'), requirePermissao(lojaId, 'Compras - Aprovar pedidos')])
  if (!podePedidos && !podeGestor) notFound()

  const sb = await createClient()
  const [comps, { data: fs }, { data: prazos }, { data: lu }] = await Promise.all([
    sb.from('compradores').select('id, nome, user_id, ativo').eq('loja_id', lojaId).order('ativo', { ascending: false }).order('nome'),
    sb.from('fornecedores').select('id, razao_social, nome_fantasia, cnpj_cpf, inativo').eq('loja_id', lojaId).order('razao_social').limit(3000),
    sb.from('fornecedor_compra_param').select('fornecedor_id, lead_time_dias').eq('loja_id', lojaId),
    // nomes dos usuários da loja (profiles tem RLS por pessoa: lido pelo servidor)
    createServiceClient().from('loja_user').select('user_id').eq('loja_id', lojaId),
  ])
  const ids = [...new Set((lu ?? []).map((x) => String(x.user_id)))]
  const { data: perfis } = ids.length ? await createServiceClient().from('profiles').select('id, name').in('id', ids) : { data: [] as { id: string; name: string }[] }
  const usuarios = (perfis ?? []).map((p) => ({ id: String(p.id), nome: p.name || 'Usuário' })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  const dias = new Map((prazos ?? []).map((p) => [Number(p.fornecedor_id), Number(p.lead_time_dias)]))
  const compradores: CompradorLinha[] = (comps.data ?? []).map((c) => ({ id: Number(c.id), nome: c.nome, userId: c.user_id, ativo: c.ativo }))
  const fornecedores: FornecedorPrazo[] = (fs ?? []).filter((f) => !f.inativo).map((f) => ({
    id: Number(f.id), nome: f.razao_social || f.nome_fantasia || `Fornecedor ${f.id}`, cnpj: (f.cnpj_cpf ?? '').replace(/\D/g, '') || null, dias: dias.get(Number(f.id)) ?? null,
  }))

  return (
    <div className="space-y-4">
      <PageHeader title="Compradores e prazos" icon={UserCog} description="Quem compra e quanto cada fornecedor demora para entregar." />
      {comps.error && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">Compradores ainda não ativados nesta instalação (migrations 240 e 241).</p>}
      <Compradores compradores={compradores} usuarios={usuarios} podeEditar={podeGestor && !comps.error} />
      <PrazosFornecedores fornecedores={fornecedores} podeEditar={podePedidos && !comps.error} />
    </div>
  )
}
