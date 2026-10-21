import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { createClient } from '@/lib/supabase/server'
import { gerarModeloPedidos } from '@/lib/compras/modelo-planilha'
import { exigirDev } from '@/lib/recursos-dev'

// Modelo da planilha de importação de pedidos de compra (só estoque próprio). O exemplo usa um produto da própria loja.
export async function GET() {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio' || !(await requirePermissao(lojaId, 'Compras - Pedidos'))) return new NextResponse('Não encontrado', { status: 404 })
  const sb = await createClient()
  const [{ data: p }, { data: f }] = await Promise.all([
    sb.from('produtos').select('codigo').eq('loja_id', lojaId).neq('inativo', true).not('codigo', 'is', null).order('id').limit(1).maybeSingle(),
    sb.from('fornecedores').select('razao_social, cnpj_cpf').eq('loja_id', lojaId).order('id').limit(1).maybeSingle(),
  ])
  const buf = await gerarModeloPedidos(p?.codigo ? { codigo: p.codigo, fornecedor: f?.razao_social ?? null, cnpj: (f?.cnpj_cpf ?? '').replace(/\D/g, '') || null } : undefined)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-pedidos-de-compra.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
