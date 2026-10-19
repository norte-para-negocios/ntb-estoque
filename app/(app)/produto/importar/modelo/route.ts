import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modeloPlanilha, respostaModelo } from '@/lib/importacao/modelo'

export async function GET() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos - Importar planilha'))) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  return respostaModelo('produtos', await modeloPlanilha('produtos'))
}
