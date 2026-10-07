import { redirect } from 'next/navigation'
import { getCurrentLojaId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'

// Compras agora são vistas em Notas Fiscais: abre a nota ligada a esta compra.
export default async function CompraDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  const { id } = await params
  const { data } = Number.isFinite(Number(id))
    ? await createServiceClient().from('compras_proprio').select('nota_fiscal_id').eq('id', Number(id)).eq('loja_id', lojaId).maybeSingle()
    : { data: null }
  redirect(data?.nota_fiscal_id ? `/nota-fiscal/${data.nota_fiscal_id}` : '/nota-fiscal')
}
